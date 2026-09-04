/** @jest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { useSpectrumInteraction } from "@n-apt/spectrum/hooks/useSpectrumInteraction";
import {
  resolveIncomingChannelsActiveSignalArea,
} from "@n-apt/redux/middleware/websocketMiddleware";
import React from "react";

/**
 * Fuzzed gesture + echo-sequence invariants.
 *
 * These tests exist because three shipped regressions were never caught by
 * example-based tests:
 *
 *  1. Out-of-bounds publishes (backend rejects → no frames → frozen UI).
 *  2. The pan ratchet: a mirror retune that re-anchors pan by another
 *     spectrum-reach on every wheel tick, running the viewport to hundreds
 *     of GHz past the ±30 GHz cap.
 *  3. Step escalation: the per-tick scroll step growing from kHz to GHz
 *     because the acquisition window silently widened (e.g. a channel-swap
 *     adopting a whole-channel span mid-gesture).
 *
 * The fuzzer drives seeded-random gesture sequences and asserts the
 * invariants after EVERY event, so a violation is reported with the exact
 * step index and seed.
 */

const SPECTRUM_MAX_HZ = 30_000_000_000;
const HARDWARE_BOUNDS = { min: 10_000, max: 6_000_000_000 };
const ACQUISITION = { min: 100, max: 110 };
const INITIAL_SPAN = ACQUISITION.max - ACQUISITION.min;

/** Deterministic PRNG so failures reproduce with the logged seed. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe("useSpectrumInteraction gesture fuzz", () => {
  const mockOnFrequencyRangeChange = jest.fn();
  const mockOnVizPanChange = jest.fn();
  const mockOnVizZoomChange = jest.fn();
  const mockOnVizZoomFloorChange = jest.fn();
  const mockOnFftDbLimitsChange = jest.fn();
  const mockOnSelectionChange = jest.fn();
  const mockOnPowerLineDbChange = jest.fn();
  const mockOnTxCenterFrequencyChange = jest.fn();
  const mockOnTxSampleRateChange = jest.fn();
  const mockOnTxOptionsRequest = jest.fn();
  const mockOnDragRepaint = jest.fn();

  const frequencyRangeRef = { current: { ...ACQUISITION } };
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
        width: 1000,
        height: 600,
      }),
    },
  } as any;
  const spectrumContainerRef = {
    current: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1000,
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
  } as any;

  const buildOptions = (overrides: Record<string, unknown> = {}): any => ({
    spectrumGpuCanvasRef,
    spectrumGpuCanvasNode: spectrumGpuCanvasRef.current,
    spectrumContainerRef,
    frequencyRangeRef,
    spectrumWebgpuEnabled: true,
    activeSignalArea: "TEST",
    signalAreaBounds: { TEST: { min: 0, max: 1000 } },
    onFrequencyRangeChange: mockOnFrequencyRangeChange,
    onVizPanChange: mockOnVizPanChange,
    onVizZoomChange: mockOnVizZoomChange,
    onVizZoomFloorChange: mockOnVizZoomFloorChange,
    onFftDbLimitsChange: mockOnFftDbLimitsChange,
    onSelectionChange: mockOnSelectionChange,
    onPowerLineDbChange: mockOnPowerLineDbChange,
    onTxCenterFrequencyChange: mockOnTxCenterFrequencyChange,
    onTxSampleRateChange: mockOnTxSampleRateChange,
    onTxOptionsRequest: mockOnTxOptionsRequest,
    onDragRepaint: mockOnDragRepaint,
    vizZoomRef,
    vizZoomFloorRef,
    vizPanOffsetRef,
    vizDbMinRef,
    vizDbMaxRef,
    ...overrides,
  });

  let listeners: Record<string, Function> = {};
  const listenerCallbacks = new Map<string, Set<Function>>();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    listeners = {};
    listenerCallbacks.clear();
    frequencyRangeRef.current = { ...ACQUISITION };
    vizPanOffsetRef.current = 0;
    vizZoomRef.current = 1;
    vizZoomFloorRef.current = 1;

    jest.spyOn(window, "addEventListener").mockImplementation((event, cb) => {
      let callbacks = listenerCallbacks.get(event);
      if (!callbacks) {
        callbacks = new Set();
        listenerCallbacks.set(event, callbacks);
        listeners[event] = (...args: any[]) => {
          callbacks!.forEach((h) => h(...args));
        };
      }
      callbacks.add(cb as Function);
    });
    jest
      .spyOn(window, "removeEventListener")
      .mockImplementation((event, cb) => {
        listenerCallbacks.get(event)?.delete(cb as Function);
      });
    spectrumContainerRef.current.addEventListener.mockClear();
    spectrumContainerRef.current.removeEventListener.mockClear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const containerHandler = (eventName: string) => {
    const calls =
      spectrumContainerRef.current.addEventListener.mock.calls.filter(
        (c: any) => c[0] === eventName,
      );
    return calls[calls.length - 1]?.[1];
  };

  const wheel = (payload: {
    deltaX?: number;
    deltaY?: number;
    ctrlKey?: boolean;
  }) => {
    const handler = containerHandler("wheel");
    act(() => {
      handler({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        clientX: 500,
        clientY: 300,
        deltaX: 0,
        deltaY: 0,
        ctrlKey: false,
        ...payload,
      } as any);
    });
  };

  const drag = (fromX: number, toX: number) => {
    const down = containerHandler("pointerdown");
    act(() => {
      down({ clientX: fromX, clientY: 550, pointerId: 1 } as any);
    });
    const move = listeners["pointermove"];
    act(() => {
      move({ clientX: toX, clientY: 550, pointerId: 1 } as any);
    });
    const up = listeners["pointerup"];
    act(() => {
      up({ clientX: toX, clientY: 550, pointerId: 1 } as any);
    });
  };

  const assertInvariants = (step: number, seed: number) => {
    const fail = (detail: string) =>
      new Error(
        `Invariant violated at seed=${seed} step=${step}: ${detail}`,
      );

    for (const [index, call] of mockOnFrequencyRangeChange.mock.calls.entries()) {
      const range = call[0];
      if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
        throw fail(`publish #${index} is non-finite: ${JSON.stringify(range)}`);
      }
      if (
        range.min < 0 ||
        range.min < HARDWARE_BOUNDS.min ||
        range.max > Math.min(HARDWARE_BOUNDS.max, SPECTRUM_MAX_HZ)
      ) {
        throw fail(
          `publish #${index} out of spectrum: ${JSON.stringify(range)}`,
        );
      }
      // The acquisition must never silently widen mid-gesture: that is the
      // kHz→GHz scroll-step escalation.
      if (range.max - range.min > INITIAL_SPAN * 1.01 + 1) {
        throw fail(
          `publish #${index} widened the window to ${
            range.max - range.min
          } (initial ${INITIAL_SPAN})`,
        );
      }
    }

    // Display viewport must stay inside the mirrored spectrum extent.
    const { min, max } = frequencyRangeRef.current;
    const center = (min + max) / 2;
    const visualRange = (max - min) / vizZoomRef.current;
    const viewportMin = center + vizPanOffsetRef.current - visualRange / 2;
    const viewportMax = center + vizPanOffsetRef.current + visualRange / 2;
    if (
      !Number.isFinite(vizPanOffsetRef.current) ||
      viewportMin < -SPECTRUM_MAX_HZ - 1 ||
      viewportMax > SPECTRUM_MAX_HZ + 1
    ) {
      throw fail(
        `viewport [${viewportMin}, ${viewportMax}] escaped ±spectrum (pan=${vizPanOffsetRef.current})`,
      );
    }

    // Step-escalation detector: one wheel tick must not move the published
    // window center by more than a couple of viewports.
    const published = mockOnFrequencyRangeChange.mock.calls;
    if (published.length >= 2) {
      const previous = published[published.length - 2][0];
      const latest = published[published.length - 1][0];
      const previousCenter = (previous.min + previous.max) / 2;
      const latestCenter = (latest.min + latest.max) / 2;
      const maxStep =
        ((latest.max - latest.min) / vizZoomRef.current) * 2 + 2;
      if (Math.abs(latestCenter - previousCenter) > maxStep) {
        throw fail(
          `window center jumped ${Math.abs(
            latestCenter - previousCenter,
          )} in one tick (max ${maxStep})`,
        );
      }
    }
  };

  it.each([1, 2, 3, 4, 5])(
    "random gesture sequences hold spectrum invariants (seed %i)",
    (seed) => {
      const random = mulberry32(seed);
      renderHook(() =>
        useSpectrumInteraction(
          buildOptions({
            allowNegativeFrequencies: true,
            hardwareSpectrumBounds: HARDWARE_BOUNDS,
          }),
        ),
      );

      const eventCount = 300;
      for (let step = 0; step < eventCount; step += 1) {
        const roll = random();
        if (roll < 0.55) {
          // Scroll tick, mostly small with occasional momentum flicks.
          const magnitude = random() < 0.85 ? 40 + random() * 120 : 400 + random() * 600;
          wheel({ deltaY: (random() < 0.5 ? -1 : 1) * magnitude });
        } else if (roll < 0.7) {
          wheel({ ctrlKey: true, deltaY: (random() < 0.5 ? -1 : 1) * (5 + random() * 30) });
        } else if (roll < 0.9) {
          const fromX = random() * 1000;
          drag(fromX, random() * 1000);
        } else {
          // Idle tick — lets coalescers flush between gestures.
          act(() => {
            jest.advanceTimersByTime(60);
          });
        }
        assertInvariants(step, seed);
      }
    },
  );
});

describe("channels echo resolution fuzz", () => {
  type Channel = { label: string; min_hz: number; max_hz: number };

  const randomChannels = (random: () => number): Channel[] => {
    const count = 2 + Math.floor(random() * 4);
    const channels: Channel[] = [];
    let cursor = random() * 1_000_000;
    for (let index = 0; index < count; index += 1) {
      const width = 1_000 + random() * 100_000_000;
      channels.push({
        label: String.fromCharCode(65 + index),
        min_hz: Math.round(cursor),
        max_hz: Math.round(cursor + width),
      });
      // Deliberate gaps between some channels.
      cursor += width + (random() < 0.4 ? random() * 500_000 : 0);
    }
    return channels;
  };

  it("re-applying an identical echo never flips the active channel (seeded)", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = mulberry32(seed * 7919);
      const channels = randomChannels(random);
      const currentRange = {
        min: Math.round(random() * 2_000_000),
        max:
          Math.round(random() * 2_000_000) +
          channels[channels.length - 1].max_hz,
      };
      const incomingArea =
        random() < 0.5
          ? channels[Math.floor(random() * channels.length)].label
          : null;

      const first = resolveIncomingChannelsActiveSignalArea({
        channels,
        currentRange,
        incomingActiveSignalArea: incomingArea,
        currentActiveSignalArea: incomingArea,
      });
      // Re-resolving with the resolution installed as the current area must
      // be a fixed point: the highlight may not flip-flop between echoes
      // that carry identical state.
      const second = resolveIncomingChannelsActiveSignalArea({
        channels,
        currentRange,
        incomingActiveSignalArea: incomingArea,
        currentActiveSignalArea: first,
      });

      expect(`seed=${seed}: ${first} -> ${second}`).toBe(
        `seed=${seed}: ${first} -> ${first}`,
      );
    }
  });

  it("prefers the channel containing the range center when one exists (seeded)", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = mulberry32(seed * 104729);
      const channels = randomChannels(random);
      const container = channels[Math.floor(random() * channels.length)];
      const center =
        container.min_hz +
        random() * (container.max_hz - container.min_hz);
      const currentRange = {
        min: Math.round(center - 100),
        max: Math.round(center + 100),
      };

      const resolved = resolveIncomingChannelsActiveSignalArea({
        channels,
        currentRange,
        incomingActiveSignalArea: "Z",
        currentActiveSignalArea: "Z",
      });

      // A containing channel always wins over the incoming label — the
      // highlight must track where the window actually is.
      expect(`seed=${seed}: ${resolved}`).toBe(
        `seed=${seed}: ${container.label}`,
      );
    }
  });
});
