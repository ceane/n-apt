import { applyWaterfallStateOverrides } from "@n-apt/spectrum/hooks/spectrumStoreOverrides";
import { INITIAL_SPECTRUM_STATE } from "@n-apt/spectrum/hooks/useSpectrumStore";
import type { WaterfallState } from "@n-apt/redux/slices/waterfallSlice";

describe("applyWaterfallStateOverrides", () => {
  it("prefers Redux waterfall source selection over local spectrum state", () => {
    const waterfallMock: WaterfallState = {
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
      playbackChannels: [],
      playbackFrameCounter: 0,
    };

    const merged = applyWaterfallStateOverrides(
      INITIAL_SPECTRUM_STATE,
      waterfallMock,
    );

    expect(merged.sourceMode).toBe("file");
    expect(merged.selectedFiles).toEqual([
      { id: "file-1", name: "capture.napt" },
    ]);
    expect(merged.stitchStatus).toBe("processing");
    expect(merged.isStitchPaused).toBe(true);
    expect(merged.drawSignal3D).toBe(true);
  });
});
