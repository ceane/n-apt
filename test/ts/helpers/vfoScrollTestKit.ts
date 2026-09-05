import { act } from "@testing-library/react";
import type { FrequencyRange } from "@n-apt/consts/schemas/websocket";
import type { SpectrumInteractionOptions } from "@n-apt/spectrum/hooks/useSpectrumInteraction";

export const SPECTRUM_MAX_HZ = 30_000_000_000;
export const DEFAULT_HARDWARE_BOUNDS = { min: 10_000, max: 6_000_000_000 };
export const DC_ANCHORED_ACQUISITION: FrequencyRange = { min: 0, max: 4_372_000 };
export const CANVAS_WIDTH = 1000;
export const VFO_WHEEL_CLIENT_Y = 590;

/** Deterministic PRNG so fuzz failures reproduce with the logged seed. */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type FrequencyDragMocks = {
  onFrequencyRangeChange: jest.Mock;
  onVizPanChange: jest.Mock;
  onVizZoomChange: jest.Mock;
  onVizZoomFloorChange: jest.Mock;
  onFftDbLimitsChange: jest.Mock;
  onSelectionChange: jest.Mock;
  onPowerLineDbChange: jest.Mock;
  onTxCenterFrequencyChange: jest.Mock;
  onTxSampleRateChange: jest.Mock;
  onTxOptionsRequest: jest.Mock;
  onDragRepaint: jest.Mock;
  /** Tracks whether a scroll tick marked the view dirty for repaint. */
  overlayDirty: { current: boolean };
};

export type FrequencyDragHarness = {
  frequencyRangeRef: { current: FrequencyRange };
  vizPanOffsetRef: { current: number };
  vizZoomRef: { current: number };
  vizZoomFloorRef: { current: number };
  vizDbMinRef: { current: number };
  vizDbMaxRef: { current: number };
  spectrumGpuCanvasRef: { current: { getBoundingClientRect: () => DOMRectLike } };
  spectrumContainerRef: { current: SpectrumContainerNode };
  mocks: FrequencyDragMocks;
  listeners: Record<string, (...args: unknown[]) => void>;
  buildOptions: (
    overrides?: Partial<SpectrumInteractionOptions>,
  ) => SpectrumInteractionOptions;
  containerHandler: (eventName: string) => ((event: unknown) => void) | undefined;
  wheel: (payload: WheelPayload, flushFrame?: boolean) => void;
  resetGestureState: (acquisition?: FrequencyRange) => void;
};

type DOMRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SpectrumContainerNode = {
  getBoundingClientRect: () => DOMRectLike;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  classList: {
    contains: jest.Mock;
    add: jest.Mock;
    remove: jest.Mock;
  };
  style: { cursor: string };
  setPointerCapture: jest.Mock;
  releasePointerCapture: jest.Mock;
  appendChild: jest.Mock;
  focus: jest.Mock;
};

export type WheelPayload = {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  clientX?: number;
  clientY?: number;
};

export type VfoScrollInvariantContext = {
  step: number;
  seed?: number;
  frequencyRangeRef: { current: FrequencyRange };
  vizPanOffsetRef: { current: number };
  vizZoomRef: { current: number };
  mockOnFrequencyRangeChange: jest.Mock;
  initialSpan: number;
  spectrumMaxHz?: number;
  hardwareBounds?: { min: number; max: number };
  previousDisplayCenter?: number;
};

const failInvariant = (step: number, seed: number | undefined, detail: string) =>
  new Error(
    `VFO scroll invariant violated at seed=${seed ?? "n/a"} step=${step}: ${detail}`,
  );

export const displayCenterHz = (
  frequencyRangeRef: { current: FrequencyRange },
  vizPanOffsetRef: { current: number },
) => {
  const { min, max } = frequencyRangeRef.current;
  return (min + max) / 2 + vizPanOffsetRef.current;
};

export const displayViewport = (
  frequencyRangeRef: { current: FrequencyRange },
  vizPanOffsetRef: { current: number },
  zoom: number,
) => {
  const { min, max } = frequencyRangeRef.current;
  const center = (min + max) / 2;
  const pan = vizPanOffsetRef.current;
  const visualRange = (max - min) / zoom;
  return {
    min: center + pan - visualRange / 2,
    max: center + pan + visualRange / 2,
    span: visualRange,
    center: center + pan,
  };
};

const viewportStraddlesDc = (viewport: { min: number; max: number }) =>
  viewport.min <= 0 && viewport.max >= 0;

/**
 * Sustained scroll in one direction must not reverse the displayed center
 * unless the gesture reverses or the viewport is pinned at an edge.
 */
export const assertMonotonicDisplayCenter = ({
  step,
  seed,
  direction,
  previousCenter,
  currentCenter,
  pinnedAtEdge,
}: {
  step: number;
  seed?: number;
  direction: "ascending" | "descending";
  previousCenter: number;
  currentCenter: number;
  pinnedAtEdge: boolean;
}) => {
  if (pinnedAtEdge && currentCenter === previousCenter) {
    return;
  }
  const toleranceHz = 1;
  if (direction === "ascending" && currentCenter + toleranceHz < previousCenter) {
    throw failInvariant(
      step,
      seed,
      `display center reversed downward while ascending (${previousCenter} -> ${currentCenter})`,
    );
  }
  if (direction === "descending" && currentCenter - toleranceHz > previousCenter) {
    throw failInvariant(
      step,
      seed,
      `display center reversed upward while descending (${previousCenter} -> ${currentCenter})`,
    );
  }
};

/**
 * The signed display axis must not teleport across DC. A positive-to-negative
 * flip (or the reverse) requires the viewport to straddle 0 Hz on the
 * previous tick, current tick, or both.
 */
export const assertDcCrossingContinuity = ({
  step,
  seed,
  previousViewport,
  currentViewport,
}: {
  step: number;
  seed?: number;
  previousViewport: { min: number; max: number; center: number };
  currentViewport: { min: number; max: number; center: number };
}) => {
  const previousSign = Math.sign(previousViewport.center);
  const currentSign = Math.sign(currentViewport.center);
  if (
    previousSign === 0 ||
    currentSign === 0 ||
    previousSign === currentSign
  ) {
    return;
  }
  const crossedThroughDc =
    viewportStraddlesDc(previousViewport) ||
    viewportStraddlesDc(currentViewport) ||
    Math.abs(previousViewport.center) <= previousViewport.max - previousViewport.min ||
    Math.abs(currentViewport.center) <= currentViewport.max - currentViewport.min;
  if (!crossedThroughDc) {
    throw failInvariant(
      step,
      seed,
      `display center flipped sign without crossing DC (${previousViewport.center} -> ${currentViewport.center})`,
    );
  }
};

/** Pan offset must stay the presentation axis — never a separate presentation offset. */
export const assertPanMatchesDisplayRange = ({
  hardwareRange,
  zoom: _zoom,
  panOffsetHz,
  displayRange,
}: {
  hardwareRange: FrequencyRange;
  zoom: number;
  panOffsetHz: number;
  displayRange: FrequencyRange;
}) => {
  const axisCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const displayCenter = (displayRange.min + displayRange.max) / 2;
  expect(displayCenter - axisCenter).toBeCloseTo(panOffsetHz, 0);
};

/** Shared invariants for scroll/fuzz diagnostics — call after every gesture event. */
export const assertVfoScrollInvariants = (context: VfoScrollInvariantContext) => {
  const {
    step,
    seed,
    frequencyRangeRef,
    vizPanOffsetRef,
    vizZoomRef,
    mockOnFrequencyRangeChange,
    initialSpan,
    spectrumMaxHz = SPECTRUM_MAX_HZ,
    hardwareBounds = DEFAULT_HARDWARE_BOUNDS,
    previousDisplayCenter,
  } = context;

  const fail = (detail: string) => {
    throw failInvariant(step, seed, detail);
  };

  for (const [index, call] of mockOnFrequencyRangeChange.mock.calls.entries()) {
    const range = call[0] as FrequencyRange;
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      fail(`publish #${index} is non-finite: ${JSON.stringify(range)}`);
    }
    if (
      range.min < 0 ||
      range.min < hardwareBounds.min ||
      range.max > Math.min(hardwareBounds.max, spectrumMaxHz)
    ) {
      fail(`publish #${index} out of spectrum: ${JSON.stringify(range)}`);
    }
    if (range.max - range.min > initialSpan * 1.01 + 1) {
      fail(
        `publish #${index} widened the window to ${range.max - range.min} (initial ${initialSpan})`,
      );
    }
  }

  const viewport = displayViewport(frequencyRangeRef, vizPanOffsetRef, vizZoomRef.current);
  if (
    !Number.isFinite(vizPanOffsetRef.current) ||
    viewport.min < -spectrumMaxHz - 1 ||
    viewport.max > spectrumMaxHz + 1
  ) {
    fail(
      `viewport [${viewport.min}, ${viewport.max}] escaped ±spectrum (pan=${vizPanOffsetRef.current})`,
    );
  }

  if (typeof previousDisplayCenter === "number") {
    const maxStep = viewport.span * 3 + 2;
    const stepHz = Math.abs(viewport.center - previousDisplayCenter);
    if (stepHz > maxStep) {
      fail(
        `display center jumped ${stepHz} Hz in one tick (max ${maxStep}); center=${viewport.center.toExponential(3)}`,
      );
    }
  }

  const published = mockOnFrequencyRangeChange.mock.calls;
  if (published.length >= 2) {
    const previous = published[published.length - 2][0] as FrequencyRange;
    const latest = published[published.length - 1][0] as FrequencyRange;
    const previousCenter = (previous.min + previous.max) / 2;
    const latestCenter = (latest.min + latest.max) / 2;
    const maxPublishStep =
      ((latest.max - latest.min) / vizZoomRef.current) * 2 + 2;
    if (Math.abs(latestCenter - previousCenter) > maxPublishStep) {
      fail(
        `published window center jumped ${Math.abs(
          latestCenter - previousCenter,
        )} in one tick (max ${maxPublishStep})`,
      );
    }
  }
};

export const createFrequencyDragHarness = (): FrequencyDragHarness => {
  const overlayDirty = { current: false };
  const mocks: FrequencyDragMocks = {
    onFrequencyRangeChange: jest.fn(),
    onVizPanChange: jest.fn((pan: number) => {
      vizPanOffsetRef.current = pan;
      overlayDirty.current = true;
    }),
    onVizZoomChange: jest.fn((zoom: number) => {
      vizZoomRef.current = zoom;
      overlayDirty.current = true;
    }),
    onVizZoomFloorChange: jest.fn(),
    onFftDbLimitsChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onPowerLineDbChange: jest.fn(),
    onTxCenterFrequencyChange: jest.fn(),
    onTxSampleRateChange: jest.fn(),
    onTxOptionsRequest: jest.fn(),
    onDragRepaint: jest.fn(() => {
      overlayDirty.current = true;
    }),
    overlayDirty,
  };

  const frequencyRangeRef = { current: { ...DC_ANCHORED_ACQUISITION } };
  const vizPanOffsetRef = { current: 0 };
  const vizZoomRef = { current: 1 };
  const vizZoomFloorRef = { current: 1 };
  const vizDbMinRef = { current: -120 };
  const vizDbMaxRef = { current: 0 };

  const spectrumGpuCanvasRef = {
    current: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: CANVAS_WIDTH,
        height: 600,
      }),
    },
  };

  const spectrumContainerRef = {
    current: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: CANVAS_WIDTH,
        height: 600,
      }),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      classList: {
        contains: jest.fn().mockReturnValue(false),
        add: jest.fn(),
        remove: jest.fn(),
      },
      style: { cursor: "" },
      setPointerCapture: jest.fn(),
      releasePointerCapture: jest.fn(),
      appendChild: jest.fn(),
      focus: jest.fn(),
    },
  } as { current: SpectrumContainerNode };

  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const listenerCallbacks = new Map<string, Set<(...args: unknown[]) => void>>();

  const installWindowListeners = () => {
    jest.spyOn(window, "addEventListener").mockImplementation((event, cb) => {
      const handler = cb as (...args: unknown[]) => void;
      let callbacks = listenerCallbacks.get(event);
      if (!callbacks) {
        callbacks = new Set();
        listenerCallbacks.set(event, callbacks);
        listeners[event] = (...args: unknown[]) => {
          callbacks!.forEach((registered) => registered(...args));
        };
      }
      callbacks.add(handler);
    });
    jest.spyOn(window, "removeEventListener").mockImplementation((event, cb) => {
      listenerCallbacks.get(event)?.delete(cb as (...args: unknown[]) => void);
    });
  };

  installWindowListeners();

  const containerHandler = (eventName: string) => {
    const calls = spectrumContainerRef.current.addEventListener.mock.calls.filter(
      (call) => call[0] === eventName,
    );
    return calls[calls.length - 1]?.[1] as ((event: unknown) => void) | undefined;
  };

  const wheel = (payload: WheelPayload, flushFrame = true) => {
    const handler = containerHandler("wheel");
    act(() => {
      handler?.({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        clientX: CANVAS_WIDTH / 2,
        clientY: VFO_WHEEL_CLIENT_Y,
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: false,
        ...payload,
      });
      if (flushFrame) {
        // useSpectrumInteraction coalesces wheel input onto requestAnimationFrame.
        // Step-wise diagnostics flush each event; burst diagnostics queue the
        // complete burst and flush once below.
        jest.advanceTimersByTime(17);
      }
    });
  };

  const buildOptions = (
    overrides: Partial<SpectrumInteractionOptions> = {},
  ): SpectrumInteractionOptions =>
    ({
      spectrumGpuCanvasRef,
      spectrumGpuCanvasNode: spectrumGpuCanvasRef.current,
      spectrumContainerRef,
      frequencyRangeRef,
      spectrumWebgpuEnabled: true,
      activeSignalArea: "TEST",
      signalAreaBounds: { TEST: { min: 0, max: SPECTRUM_MAX_HZ } },
      onFrequencyRangeChange: mocks.onFrequencyRangeChange,
      onVizPanChange: mocks.onVizPanChange,
      onVizZoomChange: mocks.onVizZoomChange,
      onVizZoomFloorChange: mocks.onVizZoomFloorChange,
      onFftDbLimitsChange: mocks.onFftDbLimitsChange,
      onSelectionChange: mocks.onSelectionChange,
      onPowerLineDbChange: mocks.onPowerLineDbChange,
      onTxCenterFrequencyChange: mocks.onTxCenterFrequencyChange,
      onTxSampleRateChange: mocks.onTxSampleRateChange,
      onTxOptionsRequest: mocks.onTxOptionsRequest,
      onDragRepaint: mocks.onDragRepaint,
      vizZoomRef,
      vizZoomFloorRef,
      vizPanOffsetRef,
      vizDbMinRef,
      vizDbMaxRef,
      ...overrides,
    }) as unknown as SpectrumInteractionOptions;

  const resetGestureState = (acquisition: FrequencyRange = DC_ANCHORED_ACQUISITION) => {
    jest.clearAllMocks();
    mocks.overlayDirty.current = false;
    frequencyRangeRef.current = { ...acquisition };
    vizPanOffsetRef.current = 0;
    vizZoomRef.current = 1;
    vizZoomFloorRef.current = 1;
    spectrumContainerRef.current.addEventListener.mockClear();
    spectrumContainerRef.current.removeEventListener.mockClear();
  };

  return {
    frequencyRangeRef,
    vizPanOffsetRef,
    vizZoomRef,
    vizZoomFloorRef,
    vizDbMinRef,
    vizDbMaxRef,
    spectrumGpuCanvasRef,
    spectrumContainerRef,
    mocks,
    listeners,
    buildOptions,
    containerHandler,
    wheel,
    resetGestureState,
  };
};

/** Every state-changing scroll tick must synchronously signal a repaint path. */
export const assertScrollPaintSignaled = (
  overlayDirty: { current: boolean },
  vizPanCallsBefore: number,
  dragRepaintCallsBefore: number,
  vizPanCallsAfter: number,
  dragRepaintCallsAfter: number,
  panBefore: number,
  panAfter: number,
  publishBefore: number,
  publishAfter: number,
) => {
  const stateChanged = panBefore !== panAfter || publishAfter > publishBefore;
  if (!stateChanged) {
    return;
  }
  expect(
    overlayDirty.current ||
      vizPanCallsAfter > vizPanCallsBefore ||
      dragRepaintCallsAfter > dragRepaintCallsBefore,
  ).toBe(true);
};

export const simulateTrackpadBurst = (
  wheel: FrequencyDragHarness["wheel"],
  random: () => number,
  eventCount: number,
) => {
  for (let step = 0; step < eventCount; step += 1) {
    const momentum = random() < 0.85 ? 40 + random() * 120 : 400 + random() * 600;
    wheel(
      {
        deltaY: (random() < 0.5 ? -1 : 1) * momentum,
        deltaMode: 0,
      },
      false,
    );
  }
  act(() => {
    jest.advanceTimersByTime(17);
  });
};
