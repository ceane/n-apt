import type { WaterfallState } from "@n-apt/redux/slices/waterfallSlice";
import type { SpectrumState } from "@n-apt/hooks/useSpectrumStore";

export const applyWaterfallStateOverrides = (
  state: SpectrumState,
  waterfall: WaterfallState,
): SpectrumState => ({
  ...state,
  sourceMode: waterfall.sourceMode,
  selectedFiles: waterfall.selectedFiles,
  snapshotGridPreference: waterfall.snapshotGridPreference,
  drawParams: waterfall.drawParams,
  activeClumpIndex: waterfall.activeClumpIndex,
  globalNoiseFloor: waterfall.globalNoiseFloor,
  stitchStatus: waterfall.stitchStatus,
  stitchTrigger: waterfall.stitchTrigger,
  stitchSourceSettings: waterfall.stitchSourceSettings,
  isStitchPaused: waterfall.isStitchPaused,
  isTrainingCapturing: waterfall.isTrainingCapturing,
  trainingCaptureLabel: waterfall.trainingCaptureLabel,
  trainingCapturedSamples: waterfall.trainingCapturedSamples,
  drawSignal3D: waterfall.drawSignal3D,
  isWaterfallCleared: waterfall.isWaterfallCleared,
});
