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

export const resolveDisplaySampleRateHz = ({
  frameSampleRateHz,
  configuredSampleRateHz,
  derivedSampleRateHz,
  ...identity
}: DeviceIdentity & {
  frameSampleRateHz?: number | null;
  configuredSampleRateHz?: number | null;
  derivedSampleRateHz?: number | null;
}): number | null => {
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

  return isRtlSdrDevice(identity)
    ? (frameRate ?? configured ?? derived)
    : (derived ?? configured);
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

export const canUseWholeChannelSnapshot = ({
  requestedWhole,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: DeviceIdentity & { requestedWhole: boolean }): boolean => {
  if (!requestedWhole) return false;
  return !isRtlSdrDevice({ deviceKind, backend, deviceName, isRtlSdr });
};

export const resolveCaptureAcquisitionMode = ({
  requestedMode,
  isOnscreenActive,
  onscreenSpanHz,
  hardwareSampleRateHz,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
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

  if (!hardwareRate || !onscreenSpan) {
    return requestedMode === "whole_sample" ? "stepwise" : requestedMode;
  }

  const widerThanHardware =
    onscreenSpan > hardwareRate + SAMPLE_RATE_TOLERANCE_HZ;
  if (
    requestedMode === "whole_sample" &&
    widerThanHardware &&
    isRtlSdrDevice({ deviceKind, backend, deviceName, isRtlSdr })
  ) {
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
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: DeviceIdentity & {
  requestedRange: { min: number; max: number };
  centerFrequencyHz?: number | null;
  hardwareSampleRateHz?: number | null;
  preferRequestedRange?: boolean;
}): { min: number; max: number } => {
  const kind = normalize(deviceKind);
  if (kind === "mock-tx" || kind === "mock_tx") {
    const center =
      typeof _centerFrequencyHz === "number" &&
      Number.isFinite(_centerFrequencyHz)
        ? _centerFrequencyHz
        : 137_100_000;
    const rate =
      typeof hardwareSampleRateHz === "number" &&
      Number.isFinite(hardwareSampleRateHz) &&
      hardwareSampleRateHz > 0
        ? Math.max(hardwareSampleRateHz, 3_200_000)
        : 3_200_000;
    return {
      min: center - rate / 2,
      max: center + rate / 2,
    };
  }

  if (!isRtlSdrDevice({ deviceKind, backend, deviceName, isRtlSdr })) {
    return requestedRange;
  }

  const requestedSpan = requestedRange.max - requestedRange.min;
  if (
    Number.isFinite(requestedSpan) &&
    requestedSpan > 0 &&
    preferRequestedRange
  ) {
    return requestedRange;
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
    return requestedRange;
  }

  return {
    min: requestedRange.min,
    max: requestedRange.min + sampleRate,
  };
};

export const clampRtlSdrFrequencyRangeToHardwareWindow = ({
  range,
  channelBounds,
  hardwareSampleRateHz,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: DeviceIdentity & {
  range: { min: number; max: number };
  channelBounds?: { min: number; max: number } | null;
  hardwareSampleRateHz?: number | null;
}): { min: number; max: number } => {
  if (
    !channelBounds ||
    !isRtlSdrDevice({ deviceKind, backend, deviceName, isRtlSdr })
  ) {
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
