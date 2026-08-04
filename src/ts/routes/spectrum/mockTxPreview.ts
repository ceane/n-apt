import type { RenderableLiveFrame } from "@n-apt/utils/liveSourcePresentation";
import {
  getLatestLiveFrame,
  hasRenderableFramePayload,
} from "@n-apt/utils/liveSourcePresentation";

/** Stable request identity used to suppress duplicate Mock Tx previews. */
export const getMockTxPreviewRequestKey = ({
  sourceId,
  centerFrequencyHz,
  sampleRateHz,
  signal,
  powerDbm,
  ifftSize,
}: {
  sourceId?: string | null;
  centerFrequencyHz?: number | null;
  sampleRateHz?: number | null;
  signal?: string | null;
  powerDbm?: number | null;
  ifftSize?: number | null;
}) =>
  JSON.stringify({
    sourceId: sourceId ?? null,
    centerFrequencyHz:
      typeof centerFrequencyHz === "number" &&
      Number.isFinite(centerFrequencyHz)
        ? Math.round(centerFrequencyHz)
        : null,
    sampleRateHz:
      typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
        ? Math.round(sampleRateHz)
        : null,
    signal: signal ?? null,
    powerDbm:
      typeof powerDbm === "number" && Number.isFinite(powerDbm)
        ? Number(powerDbm.toFixed(3))
        : null,
    ifftSize:
      typeof ifftSize === "number" && Number.isFinite(ifftSize)
        ? Math.round(ifftSize)
        : null,
  });

/** True when buffered samples are a current-center Mock Tx preview frame. */
export const hasMockTxPreviewFrame = ({
  data,
  centerFrequencyHz,
}: {
  data: RenderableLiveFrame | RenderableLiveFrame[] | null | undefined;
  centerFrequencyHz: number | null | undefined;
}): boolean => {
  const frame = getLatestLiveFrame(data);
  if (
    !frame ||
    !hasRenderableFramePayload(frame) ||
    frame.is_mock_apt === true
  ) {
    return false;
  }
  if (
    typeof centerFrequencyHz !== "number" ||
    !Number.isFinite(centerFrequencyHz)
  ) {
    return false;
  }

  const frameCenterHz =
    typeof frame.center_frequency_hz === "number"
      ? frame.center_frequency_hz
      : null;
  return (
    typeof frameCenterHz === "number" &&
    Number.isFinite(frameCenterHz) &&
    Math.abs(frameCenterHz - centerFrequencyHz) <= 1
  );
};

/** Choose a monitor span large enough for stable Mock Tx presentation. */
export const resolveMockTxMonitorSampleRateHz = (
  ...candidates: Array<number | null | undefined>
): number => {
  for (const candidate of candidates) {
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0
    ) {
      return Math.max(candidate, 3_200_000);
    }
  }
  return 3_200_000;
};

/** Prefer the active displayed span over stale source metadata. */
export const resolveMockTxMonitorSampleRateForView = (
  viewSampleRateHz: number | null | undefined,
  ...sourceCandidates: Array<number | null | undefined>
): number =>
  resolveMockTxMonitorSampleRateHz(viewSampleRateHz, ...sourceCandidates);

/**
 * Clear Mock Tx preview dedupe when the handoff fence advances without a
 * frame. Early publishes can land before the Tx stream subscribes; each
 * unique fence should get one more request_next_frame.
 */
export const shouldClearMockTxPreviewRequestDedupe = ({
  isMockTxMonitorActive,
  selectedSourceId,
  activeSourceId,
  hasRenderableFrame,
  lifecyclePhase = null,
  transportPhase = null,
  previousFence = null,
}: {
  isMockTxMonitorActive: boolean;
  selectedSourceId?: string | null;
  activeSourceId?: string | null;
  hasRenderableFrame: boolean;
  lifecyclePhase?: string | null;
  transportPhase?: string | null;
  previousFence?: string | null;
}): boolean => {
  if (
    !isMockTxMonitorActive ||
    hasRenderableFrame ||
    typeof selectedSourceId !== "string" ||
    selectedSourceId.length === 0
  ) {
    return false;
  }
  const fence = `${selectedSourceId}|${activeSourceId ?? ""}|${lifecyclePhase ?? ""}|${transportPhase ?? ""}`;
  return fence !== previousFence;
};
