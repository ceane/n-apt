export type SampleRateSpec =
  | number
  | string
  | string[]
  | {
      value: string;
      min: string;
      max: string;
    };

export interface SignalFrequencyRange {
  min: number;
  max: number;
}

/** Returns whether a requested range is fully contained by one configured N-APT channel. */
export function isValidNaptRange(
  range: SignalFrequencyRange,
  channels: readonly SignalFrequencyRange[],
): boolean {
  if (
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min > range.max
  ) {
    return false;
  }

  return channels.some(
    (channel) =>
      Number.isFinite(channel.min) &&
      Number.isFinite(channel.max) &&
      channel.min <= range.min &&
      range.max <= channel.max,
  );
}

/**
 * Resolves the dynamic sample rate value (or option range) for a device
 * using the signals.yaml spec and the active channel frame.
 * Includes strict input validation guards to prevent unintended inputs/arbitrary execution.
 */
export function resolveSampleRateSpec(
  spec: SampleRateSpec | undefined,
  activeFrame: { min_hz: number; max_hz: number } | null,
  floorSampleRate: number,
  maxSampleRate: number,
): { rate: number; options: number[] } {
  // Safe default boundaries to prevent division by zero or excessive allocation
  const SAFE_MIN_RATE = 10_000; // 10 kHz
  const SAFE_MAX_RATE = 40_000_000; // 40 MHz

  const safeMax = Math.max(
    SAFE_MIN_RATE,
    Math.min(SAFE_MAX_RATE, maxSampleRate),
  );
  const safeFloor = Math.max(
    SAFE_MIN_RATE,
    Math.min(safeMax, Math.min(SAFE_MAX_RATE, floorSampleRate)),
  );

  if (spec === undefined) {
    return { rate: safeFloor, options: [safeFloor] };
  }

  // Active channel span:
  const channelSpan =
    activeFrame && activeFrame.max_hz > activeFrame.min_hz
      ? activeFrame.max_hz - activeFrame.min_hz
      : safeFloor;
  const safeChannelSpan = Math.max(
    SAFE_MIN_RATE,
    Math.min(safeMax, Math.min(SAFE_MAX_RATE, channelSpan)),
  );

  // Strict validation of placeholder values
  const resolveSymbolic = (val: string): number => {
    // Only permit strict expected string values
    if (val === "__NAPT_SAMPLE_RATE_CHANNEL__") return safeChannelSpan;
    if (val === "__NAPT_SAMPLE_RATE_FLOOR__") return safeFloor;
    if (val === "__NAPT_SAMPLE_RATE_MAX__") return safeMax;

    // For numbers passed as strings, strictly validate format
    if (/^\d+$/.test(val)) {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) {
        return Math.max(SAFE_MIN_RATE, Math.min(safeMax, parsed));
      }
    }
    return safeFloor;
  };

  const CURATED_RATES = [
    1_000_000, 2_000_000, 3_200_000, 4_000_000, 5_000_000, 6_400_000, 8_000_000,
    10_000_000, 12_800_000, 16_000_000, 20_000_000,
  ];

  const resolveOptionsRange = (minVal: number, maxVal: number): number[] => {
    const minClamped = Math.max(SAFE_MIN_RATE, Math.min(safeMax, minVal));
    const maxClamped = Math.max(SAFE_MIN_RATE, Math.min(safeMax, maxVal));
    const lower = Math.min(minClamped, maxClamped);
    const upper = Math.max(minClamped, maxClamped);

    const rates = new Set<number>();
    rates.add(lower);
    rates.add(upper);
    for (const r of CURATED_RATES) {
      if (r >= lower && r <= upper) {
        rates.add(r);
      }
    }
    // Cap options length to a maximum of 50 values to prevent CPU exhaustion
    return Array.from(rates)
      .sort((a, b) => a - b)
      .slice(0, 50);
  };

  if (typeof spec === "number") {
    const val = Math.max(SAFE_MIN_RATE, Math.min(safeMax, spec));
    return { rate: val, options: [val] };
  }

  if (typeof spec === "string") {
    const rate = resolveSymbolic(spec);
    return { rate, options: [rate] };
  }

  if (Array.isArray(spec)) {
    // Range format: e.g., ["__NAPT_SAMPLE_RATE_FLOOR__", "__NAPT_SAMPLE_RATE_CHANNEL__"]
    const minVal =
      typeof spec[0] === "string" ? resolveSymbolic(spec[0]) : safeFloor;
    const maxVal =
      typeof spec[1] === "string" ? resolveSymbolic(spec[1]) : safeMax;
    const options = resolveOptionsRange(minVal, maxVal);
    const rate = maxVal;
    return { rate, options };
  }

  if (typeof spec === "object" && spec !== null) {
    const valueStr = (spec as any).value;
    const minStr = (spec as any).min;
    const maxStr = (spec as any).max;

    if (
      typeof valueStr === "string" &&
      typeof minStr === "string" &&
      typeof maxStr === "string"
    ) {
      const val = resolveSymbolic(valueStr);
      const minVal = resolveSymbolic(minStr);
      const maxVal = resolveSymbolic(maxStr);
      const rate = Math.max(minVal, Math.min(maxVal, val));
      const options = resolveOptionsRange(minVal, maxVal);
      return { rate, options };
    }
  }

  return { rate: safeFloor, options: [safeFloor] };
}

export const MAX_SCREEN_REFRESH_RATE = 60;

export const computeMaxFrameRate = (
  maxSampleRate: number,
  fftSize: number,
  maxFrameRateLimit?: number,
): number => {
  if (!fftSize) return 0;
  // Fallback calculation: floor(sample_rate / fft_size) clamped to range [1, MAX_SCREEN_REFRESH_RATE]
  const theoretical = Math.floor(maxSampleRate / fftSize);
  const limit = Math.min(
    maxFrameRateLimit ?? MAX_SCREEN_REFRESH_RATE,
    MAX_SCREEN_REFRESH_RATE,
  );
  return Math.max(1, Math.min(theoretical, limit));
};

/** Preserve a valid user-selected rate; only reduce a rate beyond the new limit. */
export const clampFrameRateToLogicalMax = (
  frameRate: number,
  logicalMaxFrameRate: number,
): number =>
  Math.max(1, Math.min(Math.floor(frameRate || 1), logicalMaxFrameRate));

export const getLogicalMaxFrameRate = (
  sampleRate: number,
  fftSize: number,
  sdrSettings?: any,
): number => {
  if (!sampleRate || sampleRate <= 0) {
    return sdrSettings?.fft?.max_frame_rate ?? MAX_SCREEN_REFRESH_RATE;
  }
  // Compute frame rate from the actual sample rate:
  // floor(sampleRate / fftSize) clamped to max_frame_rate.
  //
  // The size_to_frame_rate map is NOT used here because its values are
  // computed for a specific sample rate, but sdrSettings.sample_rate is
  // dynamically updated to the active rate by the WebSocket middleware.
  // This makes it impossible to detect when the map values are stale.
  return computeMaxFrameRate(
    sampleRate,
    fftSize,
    sdrSettings?.fft?.max_frame_rate,
  );
};
