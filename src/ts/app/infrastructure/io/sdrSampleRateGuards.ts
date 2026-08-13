export type CaptureAcquisitionMode =
  | "stepwise"
  | "interleaved"
  | "whole_sample";

const SAMPLE_RATE_TOLERANCE_HZ = 10_000;

interface DeviceIdentity {
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
}

const normalize = (value?: string | null) =>
  value?.toLowerCase().replace(/[_\s]+/g, "-") ?? "";

export const resolveSourceSampleRateHz = ({
  candidates,
  maxSampleRateHz,
}: {
  candidates: Array<number | null | undefined>;
  maxSampleRateHz?: number | null;
}): number | null => {
  const maximum =
    typeof maxSampleRateHz === "number" &&
    Number.isFinite(maxSampleRateHz) &&
    maxSampleRateHz > 0
      ? maxSampleRateHz
      : null;

  for (const candidate of candidates) {
    if (
      typeof candidate !== "number" ||
      !Number.isFinite(candidate) ||
      candidate <= 0
    ) {
      continue;
    }
    if (maximum !== null && candidate > maximum) continue;
    return candidate;
  }

  return maximum;
};

export const clampSampleRateToSourceMaximum = (
  sampleRateHz: number,
  maxSampleRateHz?: number | null,
): number => {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) return 0;
  if (
    typeof maxSampleRateHz === "number" &&
    Number.isFinite(maxSampleRateHz) &&
    maxSampleRateHz > 0
  ) {
    return Math.min(sampleRateHz, maxSampleRateHz);
  }
  return sampleRateHz;
};

type DisplaySampleRateInput = DeviceIdentity & {
  frameSampleRateHz?: number | null;
  configuredSampleRateHz?: number | null;
  derivedSampleRateHz?: number | null;
  maxSampleRateHz?: number | null;
};

export const resolveDisplaySampleRateHz = ({
  frameSampleRateHz,
  configuredSampleRateHz,
  derivedSampleRateHz,
  maxSampleRateHz,
}: DisplaySampleRateInput): number | null => {
  const frameRate =
    typeof frameSampleRateHz === "number" &&
    Number.isFinite(frameSampleRateHz) &&
    frameSampleRateHz > 0
      ? frameSampleRateHz
      : null;
  const configured =
    typeof configuredSampleRateHz === "number" &&
    Number.isFinite(configuredSampleRateHz) &&
    configuredSampleRateHz > 0
      ? configuredSampleRateHz
      : null;
  const derived =
    typeof derivedSampleRateHz === "number" &&
    Number.isFinite(derivedSampleRateHz) &&
    derivedSampleRateHz > 0
      ? derivedSampleRateHz
      : null;
  return resolveSourceSampleRateHz({
    // Effective frame metadata is the render authority for every source.
    candidates: [frameRate, configured, derived],
    maxSampleRateHz,
  });
};

/**
 * Resolve the display rate with the active live-control state taking
 * precedence over a stale source floor or derived frame value. RTL-SDR keeps
 * its frame-first safety behavior inside resolveDisplaySampleRateHz.
 */
export const resolveCanonicalDisplaySampleRateHz = ({
  activeSampleRateHz,
  ...input
}: DisplaySampleRateInput & {
  activeSampleRateHz?: number | null;
}): number | null => {
  const activeRate =
    typeof activeSampleRateHz === "number" &&
    Number.isFinite(activeSampleRateHz) &&
    activeSampleRateHz > 0
      ? activeSampleRateHz
      : null;
  return resolveDisplaySampleRateHz({
    ...input,
    derivedSampleRateHz:
      activeRate ?? input.derivedSampleRateHz,
    configuredSampleRateHz: activeRate ?? input.configuredSampleRateHz ?? null,
  });
};

export const isRtlSdrDevice = ({
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: DeviceIdentity): boolean => {
  if (isRtlSdr === true) return true;

  const kind = normalize(deviceKind);
  const backendName = normalize(backend);
  const name = normalize(deviceName);

  return (
    kind === "rtl-sdr" ||
    backendName === "rtl-sdr" ||
    name.includes("rtl-sdr") ||
    name.includes("rtlsdr")
  );
};

export const isHackrfDevice = ({
  deviceKind,
  backend,
  deviceName,
  sourceId,
}: DeviceIdentity & { sourceId?: string | null }): boolean => {
  const kind = normalize(deviceKind);
  const backendName = normalize(backend);
  const name = normalize(deviceName);
  const id = normalize(sourceId);

  return (
    kind.includes("hackrf") ||
    backendName.includes("hackrf") ||
    name.includes("hackrf") ||
    id.includes("hackrf")
  );
};

export const canUseWholeChannelSnapshot = ({
  requestedWhole,
}: DeviceIdentity & { requestedWhole: boolean }): boolean => {
  // Whole Channel is a presentation/acquisition intent. The backend is
  // responsible for splitting an oversized request into safe hops.
  return requestedWhole;
};

export const resolveCaptureAcquisitionMode = ({
  requestedMode,
  isOnscreenActive,
  onscreenSpanHz,
  hardwareSampleRateHz,
}: DeviceIdentity & {
  requestedMode: CaptureAcquisitionMode;
  isOnscreenActive: boolean;
  onscreenSpanHz: number;
  hardwareSampleRateHz: number;
}): CaptureAcquisitionMode => {
  const hardwareRate =
    Number.isFinite(hardwareSampleRateHz) && hardwareSampleRateHz > 0
      ? hardwareSampleRateHz
      : 0;
  const onscreenSpan =
    Number.isFinite(onscreenSpanHz) && onscreenSpanHz > 0 ? onscreenSpanHz : 0;

  if (isOnscreenActive) {
    return "whole_sample";
  }

  if (!hardwareRate || !onscreenSpan) {
    return requestedMode === "whole_sample" ? "stepwise" : requestedMode;
  }

  const widerThanHardware =
    onscreenSpan > hardwareRate + SAMPLE_RATE_TOLERANCE_HZ;
  if (requestedMode === "whole_sample" && widerThanHardware) {
    return "stepwise";
  }

  if (
    isOnscreenActive &&
    Math.abs(onscreenSpan - hardwareRate) < SAMPLE_RATE_TOLERANCE_HZ
  ) {
    return "whole_sample";
  }

  return requestedMode;
};

export const resolveRenderableFrequencyRange = ({
  requestedRange,
  centerFrequencyHz: _centerFrequencyHz,
  hardwareSampleRateHz,
  preferRequestedRange,
}: DeviceIdentity & {
  requestedRange: { min: number; max: number };
  centerFrequencyHz?: number | null;
  hardwareSampleRateHz?: number | null;
  preferRequestedRange?: boolean;
}): { min: number; max: number } => {
  const positiveRequestedRange =
    requestedRange.min < 0
      ? {
          min: 0,
          max: requestedRange.max - requestedRange.min,
        }
      : requestedRange;
  const requestedSpan = positiveRequestedRange.max - positiveRequestedRange.min;
  if (
    Number.isFinite(requestedSpan) &&
    requestedSpan > 0 &&
    preferRequestedRange
  ) {
    return positiveRequestedRange;
  }

  const sampleRate =
    typeof hardwareSampleRateHz === "number" &&
    Number.isFinite(hardwareSampleRateHz) &&
    hardwareSampleRateHz > 0
      ? hardwareSampleRateHz
      : 3_200_000;
  if (
    Number.isFinite(requestedSpan) &&
    requestedSpan > 0 &&
    requestedSpan <= sampleRate + SAMPLE_RATE_TOLERANCE_HZ
  ) {
    return positiveRequestedRange;
  }

  return {
    min: positiveRequestedRange.min,
    max: positiveRequestedRange.min + sampleRate,
  };
};

export const clampFrequencyRangeToHardwareWindow = ({
  range,
  channelBounds,
  hardwareSampleRateHz,
}: {
  range: { min: number; max: number };
  channelBounds?: { min: number; max: number } | null;
  hardwareSampleRateHz?: number | null;
}): { min: number; max: number } => {
  if (!channelBounds) {
    return range;
  }

  const rangeSpan = range.max - range.min;
  const channelSpan = channelBounds.max - channelBounds.min;
  const hardwareSpan =
    typeof hardwareSampleRateHz === "number" &&
    Number.isFinite(hardwareSampleRateHz) &&
    hardwareSampleRateHz > 0
      ? Math.min(hardwareSampleRateHz, channelSpan)
      : null;

  if (
    !hardwareSpan ||
    !Number.isFinite(rangeSpan) ||
    rangeSpan <= hardwareSpan + SAMPLE_RATE_TOLERANCE_HZ
  ) {
    return range;
  }

  const min =
    channelSpan <= hardwareSpan
      ? channelBounds.min
      : Math.max(
          channelBounds.min,
          Math.min(channelBounds.max - hardwareSpan, range.min),
        );

  return {
    min,
    max: min + hardwareSpan,
  };
};

/** @deprecated Use clampFrequencyRangeToHardwareWindow. */
export const clampRtlSdrFrequencyRangeToHardwareWindow = ({
  range,
  channelBounds,
  hardwareSampleRateHz,
}: DeviceIdentity & {
  range: { min: number; max: number };
  channelBounds?: { min: number; max: number } | null;
  hardwareSampleRateHz?: number | null;
}): { min: number; max: number } =>
  clampFrequencyRangeToHardwareWindow({
    range,
    channelBounds,
    hardwareSampleRateHz,
  });
