import type { RenderableLiveFrame } from "@n-apt/spectrum/public/liveSourceLifecycle";
import {
  getLatestLiveFrame,
  hasRenderableFramePayload,
} from "@n-apt/spectrum/public/liveSourceLifecycle";
import { MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ } from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";

/** One-shot preview requests belong to the selected presentation source. */
export const resolvePausedPreviewRequestSourceId = (
  activeSourceId: string | null | undefined,
  selectedSourceId: string | null | undefined,
): string | null => selectedSourceId ?? activeSourceId ?? null;

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
      return Math.max(candidate, MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ);
    }
  }
  return MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ;
};

/** Prefer the active displayed span over stale source metadata. */
export const resolveMockTxMonitorSampleRateForView = (
  viewSampleRateHz: number | null | undefined,
  ...sourceCandidates: Array<number | null | undefined>
): number =>
  resolveMockTxMonitorSampleRateHz(viewSampleRateHz, ...sourceCandidates);

/** Prefer the physical source rate for non-Mock Tx previews. */
export const resolveTxPreviewSampleRateForSource = ({
  isMockTxSource,
  viewerSampleRateHz,
  sourceSampleRateHz,
  fallbackSampleRateHz,
}: {
  isMockTxSource: boolean;
  viewerSampleRateHz?: number | null;
  sourceSampleRateHz?: number | null;
  fallbackSampleRateHz?: number | null;
}): number =>
  isMockTxSource
    ? resolveMockTxMonitorSampleRateForView(
        viewerSampleRateHz,
        fallbackSampleRateHz,
        sourceSampleRateHz,
      )
    : resolveMockTxMonitorSampleRateForView(
        sourceSampleRateHz,
        viewerSampleRateHz,
        fallbackSampleRateHz,
      );

/** Prefer the selected monitor span over a stale Redux viewport span. */
export const resolveMockTxMonitorViewSampleRateHz = ({
  viewerSampleRateHz,
  fallbackSampleRateHz,
  sourceCandidates = [],
}: {
  viewerSampleRateHz?: number | null;
  fallbackSampleRateHz?: number | null;
  sourceCandidates?: Array<number | null | undefined>;
}): number => {
  const validViewerSampleRateHz =
    typeof viewerSampleRateHz === "number" &&
    Number.isFinite(viewerSampleRateHz) &&
    viewerSampleRateHz >= MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ
      ? viewerSampleRateHz
      : null;
  return resolveMockTxMonitorSampleRateForView(
    validViewerSampleRateHz ?? fallbackSampleRateHz,
    ...(sourceCandidates ?? []),
  );
};

/**
 * Resolve the Mock Tx monitor window without borrowing either the planned Tx
 * carrier or another source's acquisition window. The monitor may be moved
 * independently, so a stored source-view range is authoritative when present.
 */
export const resolveMockTxMonitorFrequencyRange = ({
  sourceViewRange,
  txCenterFrequencyHz,
  fallbackCenterFrequencyHz,
  sampleRateHz,
}: {
  sourceViewRange?: { min: number; max: number } | null;
  txCenterFrequencyHz?: number | null;
  fallbackCenterFrequencyHz?: number | null;
  sampleRateHz: number;
}): { min: number; max: number } | null => {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) return null;

  const sourceViewCenterHz =
    sourceViewRange &&
    Number.isFinite(sourceViewRange.min) &&
    Number.isFinite(sourceViewRange.max) &&
    sourceViewRange.max > sourceViewRange.min
      ? (sourceViewRange.min + sourceViewRange.max) / 2
      : null;
  const centerHz =
    sourceViewCenterHz ??
    (typeof txCenterFrequencyHz === "number" &&
    Number.isFinite(txCenterFrequencyHz)
      ? txCenterFrequencyHz
      : null) ??
    (typeof fallbackCenterFrequencyHz === "number" &&
    Number.isFinite(fallbackCenterFrequencyHz)
      ? fallbackCenterFrequencyHz
      : null);
  if (centerHz === null) return null;

  return {
    min: centerHz - sampleRateHz / 2,
    max: centerHz + sampleRateHz / 2,
  };
};

/** Move a subscriber-local view without borrowing shared acquisition bounds. */
export const resolveSourceViewPanRange = (
  currentRange: { min: number; max: number } | null | undefined,
  nextPanHz: number,
): { min: number; max: number } | null => {
  if (
    !currentRange ||
    !Number.isFinite(currentRange.min) ||
    !Number.isFinite(currentRange.max) ||
    currentRange.max <= currentRange.min ||
    !Number.isFinite(nextPanHz)
  ) {
    return null;
  }
  const spanHz = currentRange.max - currentRange.min;
  const nextCenterHz = (currentRange.min + currentRange.max) / 2 + nextPanHz;
  return {
    min: nextCenterHz - spanHz / 2,
    max: nextCenterHz + spanHz / 2,
  };
};

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

/** Standby previews are generated once on demand; they are never an RX frame. */
export const resolveTxStandbyPreviewTransport = ({
  isSelectedTxPreviewStandby,
  isMockTxMonitorActive,
}: {
  isSelectedTxPreviewStandby: boolean;
  isMockTxMonitorActive: boolean;
}): "one_shot" | "none" =>
  isSelectedTxPreviewStandby || isMockTxMonitorActive ? "one_shot" : "none";

/**
 * A Tx lifecycle edge needs one fresh frame even when the viewer is paused.
 * Starting Tx replaces the standby preview with the first live-shaped frame;
 * stopping Tx replaces the last live frame with the new standby preview.
 * Unrelated Rx transitions must not advance the Tx waveform.
 */
export const shouldRequestTxLifecycleFrame = ({
  previousStatus,
  nextStatus,
}: {
  previousStatus?: string | null;
  nextStatus?: string | null;
}): boolean => {
  const wasTransmitting = previousStatus === "transmitting";
  const isTransmitting = nextStatus === "transmitting";
  const wasTxIdle = previousStatus === "standby" || previousStatus === "paused";
  const isTxIdle = nextStatus === "standby" || nextStatus === "paused";

  return (wasTxIdle && isTransmitting) || (wasTransmitting && isTxIdle);
};
