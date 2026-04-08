import { applyWaterfallStateOverrides } from "@n-apt/hooks/spectrumStoreOverrides";

describe("applyWaterfallStateOverrides", () => {
  it("prefers Redux waterfall source selection over local spectrum state", () => {
    const merged = applyWaterfallStateOverrides(
      {
        activeSignalArea: "A",
        frequencyRange: null,
        displayTemporalResolution: "medium",
        powerScale: "dB",
        sourceMode: "live",
        selectedFiles: [],
        snapshotGridPreference: true,
        drawParams: [],
        activeClumpIndex: 0,
        globalNoiseFloor: -100,
        stitchStatus: "old",
        visualizerPaused: false,
        isTrainingCapturing: false,
        trainingCaptureLabel: null,
        trainingCapturedSamples: 0,
        stitchTrigger: 0,
        stitchSourceSettings: { gain: 10, ppm: 0 },
        isStitchPaused: false,
        fftFrameRate: 60,
        isAutoFftApplied: false,
        isWaterfallCleared: false,
        vizZoom: 1,
        vizPanOffset: 0,
        fftMinDb: -120,
        fftMaxDb: 0,
        fftSize: 32768,
        fftWindow: "Rectangular",
        showSpikeOverlay: false,
        gain: 10,
        ppm: 0,
        tunerAGC: false,
        rtlAGC: false,
        sampleRateHz: 3_200_000,
        heterodyningVerifyRequestId: 0,
        heterodyningStatusText: "Idle",
        heterodyningVerifyDisabled: false,
        heterodyningDetected: false,
        heterodyningConfidence: null,
        heterodyningHighlightedBins: [],
        lastKnownRanges: {},
        diagnosticStatus: "Ready",
        isDiagnosticRunning: false,
        diagnosticTrigger: 0,
        drawSignal3D: false,
        displayMode: "fft",
      },
      {
        sourceMode: "file",
        selectedFiles: [{ id: "file-1", name: "capture.napt" }],
        snapshotGridPreference: false,
        stitchStatus: "processing",
        stitchTrigger: 4,
        stitchSourceSettings: { gain: 22, ppm: 3 },
        isStitchPaused: true,
        isTrainingCapturing: false,
        trainingCaptureLabel: null,
        trainingCapturedSamples: 0,
        drawSignal3D: true,
        isWaterfallCleared: false,
        drawParams: [],
        activeClumpIndex: 0,
        globalNoiseFloor: -100,
        activePlaybackMetadata: null,
      },
    );

    expect(merged.sourceMode).toBe("file");
    expect(merged.selectedFiles).toEqual([{ id: "file-1", name: "capture.napt" }]);
    expect(merged.stitchStatus).toBe("processing");
    expect(merged.isStitchPaused).toBe(true);
    expect(merged.drawSignal3D).toBe(true);
  });
});
