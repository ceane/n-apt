import { renderHook } from "@testing-library/react";
import { useFftCanvasInvalidation } from "@n-apt/hooks/useFftCanvasInvalidation";

const ref = <T,>(current: T) => ({ current });

function createOptions(overrides = {}) {
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
});
