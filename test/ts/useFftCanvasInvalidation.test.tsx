import { renderHook } from "@testing-library/react";
import {
  useFftCanvasInvalidation,
  type FftCanvasInvalidationOptions,
} from "@n-apt/spectrum/hooks/useFftCanvasInvalidation";

const ref = <T,>(current: T) => ({ current });

function createOptions(
  overrides: Partial<Omit<FftCanvasInvalidationOptions, "forceRender">> & {
    forceRender?: jest.Mock;
  } = {},
): FftCanvasInvalidationOptions & { forceRender: jest.Mock } {
  return {
    displayTemporalResolution: "reduced",
    previousTemporalResolutionRef: ref("reduced"),
    pendingWaterfallRestoreRef: ref(null),
    pausedWaterfallRowRef: ref(null),
    restoredWaterfallRef: ref(false),
    waveformFloatRef: ref(null),
    renderWaveformRef: ref(null),
    dataRef: ref(null),
    lastProcessedDataRef: ref(null),
    lastProcessedFrameSignatureRef: ref(null),
    fftWindow: "Rectangular",
    previousFftWindowRef: ref("Rectangular"),
    invalidateSpectrumProcessingCaches: jest.fn(),
    isPaused: false,
    forceRender: jest.fn(),
    awaitingDeviceData: false,
    showSpikeOverlay: true,
    stableSpikeFloorDbmRef: ref(null),
    stableSpikeClassifierRef: ref(null),
    stableSpikeDecisionRef: ref(false),
    selectionRange: null,
    overlayDirtyRef: ref({ grid: false, markers: false, spikes: false }),
    deviceBackend: null,
    deviceName: null,
    deviceProfileKind: null,
    deviceIsRtlSdr: null,
    hardwareSampleRateHz: null,
    limitMarkers: [],
    markersOverlayRendererRef: ref(null),
    clearOverlayCanvas: jest.fn(),
    spectrumOverlayCanvas: null,
    ...overrides,
  };
}

describe("useFftCanvasInvalidation", () => {
  it("marks marker overlays dirty and schedules a frame when selection changes", () => {
    const options = createOptions();
    const { rerender } = renderHook(
      ({ currentOptions }) => useFftCanvasInvalidation(currentOptions),
      { initialProps: { currentOptions: options } },
    );

    const updated = {
      ...options,
      selectionRange: { min: 100, max: 200 },
    };
    rerender({ currentOptions: updated });

    expect(options.overlayDirtyRef.current.markers).toBe(true);
    expect(options.forceRender).toHaveBeenCalled();
  });

  it("does not re-fire forceRender when the sample rate is unchanged", () => {
    const options = createOptions({ hardwareSampleRateHz: 3_200_000 });
    const { rerender } = renderHook(
      ({ currentOptions }) => useFftCanvasInvalidation(currentOptions),
      { initialProps: { currentOptions: options } },
    );
    const before = options.forceRender.mock.calls.length;

    // A rerender with the same rate (new options object, same value) must not
    // schedule another frame.
    const sameRate = { ...options, hardwareSampleRateHz: 3_200_000 };
    rerender({ currentOptions: sameRate });

    expect(options.forceRender).toHaveBeenCalledTimes(before);
  });

  it("fires forceRender exactly once when the sample rate changes", () => {
    const options = createOptions({ hardwareSampleRateHz: 3_200_000 });
    const { rerender } = renderHook(
      ({ currentOptions }) => useFftCanvasInvalidation(currentOptions),
      { initialProps: { currentOptions: options } },
    );
    const before = options.forceRender.mock.calls.length;

    const changed = { ...options, hardwareSampleRateHz: 5_200_000 };
    rerender({ currentOptions: changed });
    rerender({ currentOptions: { ...changed, hardwareSampleRateHz: 5_200_000 } });

    expect(options.forceRender.mock.calls.length).toBe(before + 1);
    expect(options.overlayDirtyRef.current.grid).toBe(true);
    expect(options.overlayDirtyRef.current.markers).toBe(true);
  });

  it("an unrelated option change still fires forceRender at the same sample rate", () => {
    const options = createOptions({ hardwareSampleRateHz: 3_200_000 });
    const { rerender } = renderHook(
      ({ currentOptions }) => useFftCanvasInvalidation(currentOptions),
      { initialProps: { currentOptions: options } },
    );
    const before = options.forceRender.mock.calls.length;

    // selectionRange is a separate invalidation path; the sample-rate guard
    // must not suppress it.
    rerender({
      currentOptions: {
        ...options,
        selectionRange: { min: 100, max: 200 },
        hardwareSampleRateHz: 3_200_000,
      },
    });

    expect(options.forceRender.mock.calls.length).toBeGreaterThan(before);
  });
});
