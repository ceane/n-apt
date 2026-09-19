export type CaptureAcquisitionMode =
  | "stepwise"
  | "interleaved"
  | "whole_sample";

const SAMPLE_RATE_TOLERANCE_HZ = 10_000;

/** The smallest valid receive/monitor window for the Mock Tx source. */
export const MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ = 3_200_000;

interface DeviceIdentity {
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
}

const normalize = (value?: string | null) =>
  value?.toLowerCase().replace(/[_\s]+/g, "-") ?? "";

/** A usable acquisition rate is a finite number above zero. */
export const isValidSampleRateHz = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Assert a sample rate at the point it is produced.
 *
 * Rates originate from a handful of gesture/form sites (the Signal Display
 * selector, channel clicks, presets, the Settings form). A non-finite or
 * non-positive value there is a programming error, not user input. It used to
 * travel to the reducer, get dropped by its `Number.isFinite` guard, and leave
 * the control showing the previous rate with nothing logged — so "I changed the
 * rate and it stayed at 3.2 MHz" had no trace anywhere. Throwing here surfaces
 * it with a stack trace at the producer, while the reducer stays defensive as
 * the last resort for hydrated values that must never crash a render.
 */
export const assertValidSampleRateHz = (
  value: number,
  source: string,
): number => {
  if (!isValidSampleRateHz(value)) {
    throw new Error(
      `Invalid sample rate from ${source}: ${String(value)} (expected a finite number greater than 0)`,
    );
  }
  return value;
};

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

/**
 * Mock Tx has two independent rate domains: its generated waveform may use a
 * rate below the SDR receive floor, while its monitor is still an SDR view.
 * Keep the waveform rate out of the monitor selector and repair persisted
 * values from before that distinction existed.
 */
export const resolveMockTxMonitorSampleRateOptions = ({
  options,
  minimumSampleRateHz = MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ,
  maximumSampleRateHz,
}: {
  options?: readonly number[] | null;
  minimumSampleRateHz?: number | null;
  maximumSampleRateHz?: number | null;
}): number[] => {
  const minimum =
    typeof minimumSampleRateHz === "number" &&
    Number.isFinite(minimumSampleRateHz) &&
    minimumSampleRateHz > 0
      ? Math.round(minimumSampleRateHz)
      : MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ;
  const maximum =
    typeof maximumSampleRateHz === "number" &&
    Number.isFinite(maximumSampleRateHz) &&
    maximumSampleRateHz >= minimum
      ? Math.round(maximumSampleRateHz)
      : null;
  const validOptions = (options ?? [])
    .filter(
      (rate): rate is number =>
        Number.isFinite(rate) &&
        rate >= minimum &&
        (maximum === null || rate <= maximum),
    )
    .map((rate) => Math.round(rate));

  // The configured floor is always a valid recovery option. This matters for
  // a client whose source metadata was hydrated from an older server.
  return Array.from(new Set([minimum, ...validOptions])).sort((a, b) => a - b);
};

export const resolveMockTxMonitorSampleRateHz = ({
  requestedSampleRateHz,
  options,
  wholeChannelSampleRateHz,
}: {
  requestedSampleRateHz?: number | null;
  options: readonly number[];
  wholeChannelSampleRateHz?: number | null;
}): number => {
  const requested =
    typeof requestedSampleRateHz === "number" &&
    Number.isFinite(requestedSampleRateHz) &&
    requestedSampleRateHz > 0
      ? Math.round(requestedSampleRateHz)
      : null;
  const wholeChannelRate =
    typeof wholeChannelSampleRateHz === "number" &&
    Number.isFinite(wholeChannelSampleRateHz) &&
    wholeChannelSampleRateHz >= 3_200_000
      ? Math.round(wholeChannelSampleRateHz)
      : null;
  if (requested !== null && requested === wholeChannelRate) {
    return requested;
  }
  if (requested !== null && options.includes(requested)) return requested;
  return options[0] ?? MOCK_TX_MIN_MONITOR_SAMPLE_RATE_HZ;
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
  const deviceKind = input.deviceKind;
  const backend = input.backend;
  const deviceName = input.deviceName;
  const isRtlSdr = isRtlSdrDevice({
    deviceKind,
    backend,
    deviceName,
    isRtlSdr: input.isRtlSdr,
  });
  if (activeRate === null || isRtlSdr) {
    // RTL-SDR keeps the frame-first safety behavior: the accepted I/Q frame
    // rate is authoritative and the configured floor guards stale metadata.
    return resolveDisplaySampleRateHz({
      ...input,
      derivedSampleRateHz:
        activeRate ?? input.derivedSampleRateHz,
      configuredSampleRateHz:
        activeRate ?? input.configuredSampleRateHz ?? null,
    });
  }
  // Whole-channel capable sources (HackRF, Mock APT, ...) can legally widen
  // their acquisition window beyond the last frame's sample rate. The active
  // live-control rate is the user's explicit selection (e.g. Whole Channel
  // 4.372 MHz) and must win over a stale frame whose metadata still reports
  // the previous 3.2 MHz window.
  return resolveSourceSampleRateHz({
    candidates: [activeRate, input.frameSampleRateHz, input.configuredSampleRateHz, input.derivedSampleRateHz],
    maxSampleRateHz: input.maxSampleRateHz,
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
