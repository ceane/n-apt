/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import fc from "fast-check";
import { useFrequencyDrag } from "@n-apt/spectrum/hooks/useFrequencyDrag";
import { useDrawWebGPUFFTSignal } from "@n-apt/spectrum/hooks/useDrawWebGPUFFTSignal";
import {
  shouldEnableGpuMirrorFold,
  shouldMirrorPanOnlyRedraw,
  shouldRepaintCachedSpectrumForViewportChange,
} from "@n-apt/spectrum/FFTCanvas";
import {
  displayRangeNeedsBasebandMirror,
  resolveDisplayRangeForPanOffset,
  resolvePanZoomForDisplayRange,
} from "@n-apt/math/basebandMirror";
import {
  prepareSpectrumRenderData,
  resolveLiveSpectrumPaintContract,
} from "@n-apt/spectrum/fft/frameProcessing";
import { createFFTZoomProcessor } from "@n-apt/spectrum/utils/rendering/fftZoom";
import {
  assertDcCrossingContinuity,
  assertMonotonicDisplayCenter,
  assertPanMatchesDisplayRange,
  createFrequencyDragHarness,
  DC_ANCHORED_ACQUISITION,
  DEFAULT_HARDWARE_BOUNDS,
  displayViewport,
  mulberry32,
  VFO_WHEEL_CLIENT_Y,
} from "./helpers/vfoScrollTestKit";

jest.mock("@n-apt/app/infrastructure/visualization/webgpu", () => ({
  configureWebGPUCanvas: jest.fn(() => ({
    configure: jest.fn(),
    getCurrentTexture: jest.fn(() => ({
      createView: jest.fn(),
    })),
  })),
  parseCssColorToRgba: jest.fn(() => [0, 0, 0, 1]),
}));

jest.mock("@n-apt/consts", () => ({
  LINE_COLOR: "#ffffff",
  SHADOW_COLOR: "#000000",
  FFT_AREA_MIN: 0,
}));

jest.mock("@n-apt/shaders", () => ({
  SPECTRUM_SHADER: "shader",
  RESAMPLE_WGSL: "shader",
  SPIKE_COMPUTE_WGSL: "shader",
  SPIKE_RENDER_WGSL: "shader",
  FLOOR_AVG_WGSL: "shader",
  NAPT_CLASSIFY_WGSL: "shader",
  NAPT_DETECT_WGSL: "shader",
  NAPT_TEMPORAL_WGSL: "shader",
}));

(global as any).GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
(global as any).GPUBufferUsage = {
  STORAGE: 1,
  COPY_DST: 2,
  COPY_SRC: 4,
  UNIFORM: 8,
};

const FLOOR_DB = -120;
const _INITIAL_SPAN = DC_ANCHORED_ACQUISITION.max - DC_ANCHORED_ACQUISITION.min;

describe("FFTCanvas mirror pan redraw gate", () => {
  it("repaints from cache when mirror pan moves without a new IQ frame", () => {
    expect(
      shouldMirrorPanOnlyRedraw({
        allowNegativeFrequencies: true,
        hasNewData: false,
        shouldReprocessCurrentFrame: false,
        hasCachedWaveform: true,
        lastPaintedMirrorPan: 0,
        currentMirrorPan: -500_000,
      }),
    ).toBe(true);
  });

  it("does not mirror-pan redraw when mirror mode is off", () => {
    expect(
      shouldMirrorPanOnlyRedraw({
        allowNegativeFrequencies: false,
        hasNewData: false,
        shouldReprocessCurrentFrame: false,
        hasCachedWaveform: true,
        lastPaintedMirrorPan: 0,
        currentMirrorPan: -500_000,
      }),
    ).toBe(false);
  });

  it("keeps the GPU |f| fold armed on both sides of DC while the setting is on", () => {
    const positive = shouldEnableGpuMirrorFold({
      mirrorOnGpu: true,
      allowNegativeFrequencies: true,
      displayMinHz: 18_000,
    });
    const straddling = shouldEnableGpuMirrorFold({
      mirrorOnGpu: true,
      allowNegativeFrequencies: true,
      displayMinHz: -1,
    });
    const negative = shouldEnableGpuMirrorFold({
      mirrorOnGpu: true,
      allowNegativeFrequencies: true,
      displayMinHz: -2_186_000,
    });

    expect(positive).toBe(true);
    expect(straddling).toBe(true);
    expect(negative).toBe(true);
    expect(positive).toBe(straddling);
    expect(straddling).toBe(negative);
  });

  it("does not arm the GPU |f| fold when the mirror setting is off", () => {
    expect(
      shouldEnableGpuMirrorFold({
        mirrorOnGpu: true,
        allowNegativeFrequencies: false,
        displayMinHz: -1,
      }),
    ).toBe(false);
  });

  it("does not mirror-pan redraw when a fresh frame arrived", () => {
    expect(
      shouldMirrorPanOnlyRedraw({
        allowNegativeFrequencies: true,
        hasNewData: true,
        shouldReprocessCurrentFrame: false,
        hasCachedWaveform: true,
        lastPaintedMirrorPan: 0,
        currentMirrorPan: -500_000,
      }),
    ).toBe(false);
  });

  it("mirror-off and mirror-on share the same viewport-change redraw contract", () => {
    const mirrorOn = shouldMirrorPanOnlyRedraw({
      allowNegativeFrequencies: true,
      hasNewData: false,
      shouldReprocessCurrentFrame: false,
      hasCachedWaveform: true,
      lastPaintedMirrorPan: 0,
      currentMirrorPan: -250_000,
    });
    const mirrorOff = shouldRepaintCachedSpectrumForViewportChange({
      hasNewData: false,
      shouldReprocessCurrentFrame: false,
      hasCachedWaveform: true,
      zoomChanged: false,
      panChanged: true,
    });
    expect(mirrorOn).toBe(true);
    expect(mirrorOff).toBe(true);
  });
});

describe("mirror scroll direction continuity", () => {
  let harness = createFrequencyDragHarness();

  beforeEach(() => {
    jest.useFakeTimers();
    harness = createFrequencyDragHarness();
    harness.resetGestureState();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps descending while scrolling into the mirror and ascending while scrolling back", () => {
    renderHook(() =>
      useFrequencyDrag(
        harness.buildOptions({
          allowNegativeFrequencies: true,
          hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
        }),
      ),
    );

    let previous = displayViewport(
      harness.frequencyRangeRef,
      harness.vizPanOffsetRef,
      harness.vizZoomRef.current,
    );

    for (let tick = 1; tick <= 120; tick += 1) {
      // Positive deltaY moves toward lower displayed frequencies.
      harness.wheel({ deltaY: 120, clientY: VFO_WHEEL_CLIENT_Y });
      const current = displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      );
      assertMonotonicDisplayCenter({
        step: tick,
        direction: "descending",
        previousCenter: previous.center,
        currentCenter: current.center,
        pinnedAtEdge: current.center === previous.center,
      });
      assertDcCrossingContinuity({
        step: tick,
        previousViewport: previous,
        currentViewport: current,
      });
      previous = current;
    }

    for (let tick = 1; tick <= 180; tick += 1) {
      harness.wheel({ deltaY: -120, clientY: VFO_WHEEL_CLIENT_Y });
      const current = displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      );
      assertMonotonicDisplayCenter({
        step: 120 + tick,
        direction: "ascending",
        previousCenter: previous.center,
        currentCenter: current.center,
        pinnedAtEdge: current.center === previous.center,
      });
      assertDcCrossingContinuity({
        step: 120 + tick,
        previousViewport: previous,
        currentViewport: current,
      });
      previous = current;
    }
  });

  it("keeps a lagged frame complete and reflected while scrolling below DC", () => {
    const acquisition = { min: 0, max: 10_000_000 };
    const laggedFrame = { min: 4_294_000, max: 8_666_000 };
    const hardwareCenter = (acquisition.min + acquisition.max) / 2;
    const frameCenter = (laggedFrame.min + laggedFrame.max) / 2;
    let previousPaintCenter: number | null = null;
    let sawBelowDc = false;

    for (let pan = 0; pan >= -12_000_000; pan -= 250_000) {
      const gestureCenter = hardwareCenter + pan;
      const contract = resolveLiveSpectrumPaintContract({
        requestedViewRange: acquisition,
        sourceFrequencyRange: laggedFrame,
        zoom: 1,
        panOffsetHz: pan,
        mirrorEnabled: true,
      });
      const paintCenter =
        (contract.displayRange.min + contract.displayRange.max) / 2;

      if (gestureCenter < 0) {
        sawBelowDc = true;
        expect(paintCenter).toBeLessThan(0);
        expect(paintCenter).toBeCloseTo(-frameCenter, -3);
        expect(paintCenter).not.toBeCloseTo(Math.abs(gestureCenter), -3);
        if (previousPaintCenter !== null) {
          expect(paintCenter).toBeLessThanOrEqual(previousPaintCenter + 1);
        }
      }
      previousPaintCenter = paintCenter;
    }

    expect(sawBelowDc).toBe(true);
  });

  it.each([2, 5, 11])(
    "seeded one-direction bursts stay monotonic and cross DC continuously (seed %i)",
    (seed) => {
      const random = mulberry32(seed);
      renderHook(() =>
        useFrequencyDrag(
          harness.buildOptions({
            allowNegativeFrequencies: true,
            hardwareSpectrumBounds: DEFAULT_HARDWARE_BOUNDS,
          }),
        ),
      );

      let previous = displayViewport(
        harness.frequencyRangeRef,
        harness.vizPanOffsetRef,
        harness.vizZoomRef.current,
      );
      const direction: "ascending" | "descending" =
        random() < 0.5 ? "ascending" : "descending";
      // Wheel sign matches useFrequencyDrag: +deltaY lowers displayed frequency.
      const deltaSign = direction === "descending" ? 1 : -1;

      for (let step = 0; step < 180; step += 1) {
        const magnitude = 40 + random() * 120;
        harness.wheel({
          deltaY: deltaSign * magnitude,
          clientY: VFO_WHEEL_CLIENT_Y,
        });
        const current = displayViewport(
          harness.frequencyRangeRef,
          harness.vizPanOffsetRef,
          harness.vizZoomRef.current,
        );
        assertMonotonicDisplayCenter({
          step,
          seed,
          direction,
          previousCenter: previous.center,
          currentCenter: current.center,
          pinnedAtEdge: current.center === previous.center,
        });
        assertDcCrossingContinuity({
          step,
          seed,
          previousViewport: previous,
          currentViewport: current,
        });
        previous = current;
      }
    },
  );
});

describe("positive and negative mirror paint symmetry", () => {
  const waveform = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const getZoomedData = createFFTZoomProcessor(FLOOR_DB).process;
  const sourceFrequencyRange = { min: 0, max: 8_744_000 };

  const paintForDisplay = (displayRange: { min: number; max: number }) => {
    const { zoom, panOffsetHz } = resolvePanZoomForDisplayRange({
      hardwareRange: sourceFrequencyRange,
      displayRange,
    });
    const contract = resolveLiveSpectrumPaintContract({
      requestedViewRange: sourceFrequencyRange,
      sourceFrequencyRange,
      zoom,
      panOffsetHz,
      mirrorEnabled: true,
      frameCenterHz: 4_372_000,
      frameSampleRateHz: 8_744_000,
    });
    assertPanMatchesDisplayRange({
      hardwareRange: contract.sourceFrequencyRange,
      zoom: contract.zoom,
      panOffsetHz: contract.panOffsetHz,
      displayRange: contract.displayRange,
    });
    return prepareSpectrumRenderData({
      waveform,
      frequencyRange: contract.paintViewportRange,
      sourceFrequencyRange: contract.sourceFrequencyRange,
      zoom: contract.zoom,
      panOffset: contract.panOffsetHz,
      invert: false,
      dbMin: FLOOR_DB,
      dbMax: 0,
      allowNegativeFrequencies: true,
      mirrorOnGpu: true,
      resampleOnGpu: true,
      getZoomedData,
    });
  };

  it("uses panOffsetHz for both sides of DC — not a separate presentation offset", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 4_000_000 }),
        (positiveExtentHz) => {
          const positiveDisplay = {
            min: 0,
            max: positiveExtentHz,
          };
          const negativeDisplay = {
            min: -positiveExtentHz,
            max: 0,
          };

          expect(displayRangeNeedsBasebandMirror(positiveDisplay)).toBe(false);
          expect(displayRangeNeedsBasebandMirror(negativeDisplay)).toBe(true);

          const positiveResolved = resolvePanZoomForDisplayRange({
            hardwareRange: sourceFrequencyRange,
            displayRange: positiveDisplay,
          });
          const negativeResolved = resolvePanZoomForDisplayRange({
            hardwareRange: sourceFrequencyRange,
            displayRange: negativeDisplay,
          });

          const roundTrip = (
            displayRange: { min: number; max: number },
            resolved: { zoom: number; panOffsetHz: number },
          ) => {
            const rebuilt = resolveDisplayRangeForPanOffset({
              hardwareRange: sourceFrequencyRange,
              zoom: resolved.zoom,
              panOffsetHz: resolved.panOffsetHz,
            });
            expect(rebuilt.min).toBeCloseTo(displayRange.min, 0);
            expect(rebuilt.max).toBeCloseTo(displayRange.max, 0);
          };

          roundTrip(positiveDisplay, positiveResolved);
          roundTrip(negativeDisplay, negativeResolved);

          // Symmetric windows around DC use opposite pan offsets measured from
          // the acquisition center — never a second presentation-offset field.
          expect(
            positiveResolved.panOffsetHz + negativeResolved.panOffsetHz,
          ).toBeCloseTo(
            -(sourceFrequencyRange.min + sourceFrequencyRange.max),
            0,
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  it("draws mirrored negative display windows from the same resident acquisition axis", () => {
    const positive = paintForDisplay({ min: 0, max: 4_372_000 });
    const negative = paintForDisplay({ min: -4_372_000, max: 0 });

    expect(positive.visualRange.min).toBeGreaterThanOrEqual(0);
    expect(negative.visualRange.max).toBeLessThanOrEqual(0);
    expect(positive.coversDisplay).toBe(true);
    expect(negative.coversDisplay).toBe(true);
    expect(positive.spectrumWaveform.length).toBe(waveform.length);
    expect(negative.spectrumWaveform.length).toBe(waveform.length);
    expect(positive.spectrumWaveform.some((value) => value !== FLOOR_DB)).toBe(
      true,
    );
    expect(negative.spectrumWaveform.some((value) => value !== FLOOR_DB)).toBe(
      true,
    );
  });

  it("crosses DC through a straddling viewport instead of teleporting sign", () => {
    const whollyPositive = paintForDisplay({ min: 0, max: 2_000_000 });
    const straddling = paintForDisplay({ min: -500_000, max: 500_000 });
    const whollyNegative = paintForDisplay({ min: -2_000_000, max: -1_000_000 });

    expect(whollyPositive.visualRange.min).toBeGreaterThanOrEqual(0);
    expect(straddling.visualRange.min).toBeLessThan(0);
    expect(straddling.visualRange.max).toBeGreaterThan(0);
    expect(whollyNegative.visualRange.max).toBeLessThanOrEqual(0);

    assertDcCrossingContinuity({
      step: 1,
      previousViewport: {
        min: whollyPositive.visualRange.min,
        max: whollyPositive.visualRange.max,
        center:
          (whollyPositive.visualRange.min + whollyPositive.visualRange.max) /
          2,
      },
      currentViewport: {
        min: straddling.visualRange.min,
        max: straddling.visualRange.max,
        center:
          (straddling.visualRange.min + straddling.visualRange.max) / 2,
      },
    });
    assertDcCrossingContinuity({
      step: 2,
      previousViewport: {
        min: straddling.visualRange.min,
        max: straddling.visualRange.max,
        center:
          (straddling.visualRange.min + straddling.visualRange.max) / 2,
      },
      currentViewport: {
        min: whollyNegative.visualRange.min,
        max: whollyNegative.visualRange.max,
        center:
          (whollyNegative.visualRange.min + whollyNegative.visualRange.max) /
          2,
      },
    });
  });
});

describe("mirror GPU resample continuity", () => {
  const createMockBuffer = () => ({ destroy: jest.fn() });
  const computePass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    dispatchWorkgroups: jest.fn(),
    end: jest.fn(),
  };
  const mockDevice = {
    createShaderModule: jest.fn(),
    createRenderPipeline: jest.fn(() => ({
      getBindGroupLayout: jest.fn(() => ({})),
    })),
    createComputePipeline: jest.fn(() => ({
      getBindGroupLayout: jest.fn(() => ({})),
    })),
    createPipelineLayout: jest.fn(() => ({})),
    createBindGroupLayout: jest.fn(() => ({})),
    createBindGroup: jest.fn(() => ({})),
    createBuffer: jest.fn(() => createMockBuffer()),
    createCommandEncoder: jest.fn(() => ({
      clearBuffer: jest.fn(),
      beginComputePass: jest.fn(() => computePass),
      beginRenderPass: jest.fn(() => ({
        setPipeline: jest.fn(),
        setBindGroup: jest.fn(),
        draw: jest.fn(),
        end: jest.fn(),
      })),
      finish: jest.fn(() => ({})),
    })),
    queue: {
      writeBuffer: jest.fn(),
      submit: jest.fn(),
      onSubmittedWorkDone: jest.fn(() => Promise.resolve()),
    },
    popErrorScope: jest.fn(() => Promise.resolve(null)),
    pushErrorScope: jest.fn(),
  };
  const mockCanvas = {
    parentElement: { offsetWidth: 1380 },
    offsetWidth: 1380,
    width: 1380,
    height: 400,
    getContext: jest.fn(() => ({
      configure: jest.fn(),
      getCurrentTexture: jest.fn(() => ({
        createView: jest.fn(),
      })),
    })),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const resampleParamBytes = 48;

  const resamplePaddingIsZero = (data: ArrayBuffer) => {
    const view = new DataView(data);
    expect(view.getFloat32(36, true)).toBe(0);
    expect(view.getFloat32(40, true)).toBe(0);
    expect(view.getFloat32(44, true)).toBe(0);
  };

  it("resamples negative display pans without re-uploading the acquisition", async () => {
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    const waveform = new Float32Array(2048).fill(-50);
    const sourceFrequencyRange = { min: 0, max: 8_744_000 };
    const draw = (
      frequencyRange: { min: number; max: number },
      waveformDirty: boolean,
    ) =>
      result.current.drawWebGPUFFTSignal({
        canvas: mockCanvas,
        device: mockDevice as any,
        format: "rgba8unorm" as GPUTextureFormat,
        waveform,
        waveformDirty,
        frequencyRange,
        sourceFrequencyRange,
        mirrorEnabled: true,
        reuseWaveformUpload: true,
      });

    await draw({ min: 0, max: 4_372_000 }, true);
    await draw({ min: -4_372_000, max: 0 }, false);

    const waveformUploads = mockDevice.queue.writeBuffer.mock.calls.filter(
      (call) => call[2] === waveform.buffer,
    );
    expect(waveformUploads).toHaveLength(1);

    const resampleUploads = mockDevice.queue.writeBuffer.mock.calls.filter(
      (call) =>
        call[2] !== waveform.buffer &&
        (call[2] as ArrayBuffer)?.byteLength === resampleParamBytes,
    );
    expect(resampleUploads.length).toBeGreaterThanOrEqual(2);
    for (const call of resampleUploads) {
      resamplePaddingIsZero(call[2] as ArrayBuffer);
    }
  });

  it("keeps ascending then descending GPU pans on the same uploaded frame", async () => {
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    const waveform = new Float32Array(1024).fill(-40);
    const sourceFrequencyRange = { min: 0, max: 4_372_000 };
    const draw = (frequencyRange: { min: number; max: number }) =>
      result.current.drawWebGPUFFTSignal({
        canvas: mockCanvas,
        device: mockDevice as any,
        format: "rgba8unorm" as GPUTextureFormat,
        waveform,
        waveformDirty: false,
        frequencyRange,
        sourceFrequencyRange,
        mirrorEnabled: true,
        reuseWaveformUpload: true,
      });

    await result.current.drawWebGPUFFTSignal({
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      waveform,
      waveformDirty: true,
      frequencyRange: { min: 0, max: 2_186_000 },
      sourceFrequencyRange,
      mirrorEnabled: true,
      reuseWaveformUpload: true,
    });

    await draw({ min: -2_186_000, max: 0 });
    await draw({ min: -1_000_000, max: 1_000_000 });
    await draw({ min: 0, max: 2_186_000 });

    const waveformUploads = mockDevice.queue.writeBuffer.mock.calls.filter(
      (call) => call[2] === waveform.buffer,
    );
    expect(waveformUploads).toHaveLength(1);
  });
});
