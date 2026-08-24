/**
 * Frequency formatting utilities for precise and consistent display
 */
import type { FrequencyRange } from "@n-apt/consts/types";

/**
 * Standard frequency formatting: 100.000 MHz or 500 kHz
 * @param freqHz Frequency in Hz
 * @param showUnits Whether to append the unit string
 * @returns Formatted frequency string
 */
export interface FormatFrequencyOptions {
  showUnits?: boolean;
  precisionMHz?: number;
  precisionGHz?: number;
  precisionKHz?: number;
  trimTrailingZeros?: boolean;
}

export type FrequencyUnit = "Hz" | "kHz" | "MHz" | "GHz";

export interface FrequencyScale {
  value: number;
  unit: FrequencyUnit;
}

export const clampFrequencyHz = (
  hz: number,
  minHz: number,
  maxHz: number,
): number => {
  const safeMin = Number.isFinite(minHz) ? minHz : 0;
  const safeMax = Number.isFinite(maxHz) ? maxHz : Number.MAX_VALUE;
  const lo = Math.min(safeMin, safeMax);
  const hi = Math.max(safeMin, safeMax);
  if (!Number.isFinite(hz)) return lo;
  return Math.max(lo, Math.min(hz, hi));
};

export const getFrequencyUnitScale = (unit: FrequencyUnit): number => {
  switch (unit) {
    case "GHz":
      return 1_000_000_000;
    case "MHz":
      return 1_000_000;
    case "kHz":
      return 1_000;
    case "Hz":
    default:
      return 1;
  }
};

export const getOptimalFrequencyScale = (hz: number): FrequencyScale => {
  const absHz = Math.abs(hz);
  if (absHz >= 1_000_000_000) return { value: hz / 1_000_000_000, unit: "GHz" };
  if (absHz >= 1_000_000) return { value: hz / 1_000_000, unit: "MHz" };
  if (absHz >= 1_000) return { value: hz / 1_000, unit: "kHz" };
  return { value: hz, unit: "Hz" };
};

export const getCenteredFrequencyHz = (
  centerHz: number,
  bandwidthHz: number,
): number => centerHz - bandwidthHz / 2;

export const resolveCenteredFrequencyHz = (
  centerHz: number,
  fallbackCenterHz: number,
): number =>
  Number.isFinite(centerHz)
    ? centerHz
    : Number.isFinite(fallbackCenterHz)
      ? fallbackCenterHz
      : 0;

export const resolveMockTxMonitorCenterHz = (
  txCenterHz: number,
  fallbackCenterHz: number,
): number => resolveCenteredFrequencyHz(txCenterHz, fallbackCenterHz);

export const buildCenteredFrequencyRange = (
  centerHz: number,
  spanHz: number,
  minimumFrequencyHz: number = 0,
): FrequencyRange => {
  const safeSpan = Number.isFinite(spanHz) && spanHz > 0 ? spanHz : 0;
  const halfSpan = safeSpan / 2;
  const rawMin = Math.round(centerHz - halfSpan);
  const rawMax = Math.round(centerHz + halfSpan);

  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || safeSpan <= 0) {
    return { min: 0, max: 0 };
  }

  const minimum = Number.isFinite(minimumFrequencyHz)
    ? minimumFrequencyHz
    : Number.NEGATIVE_INFINITY;

  if (rawMin < minimum) {
    return {
      min: Number.isFinite(minimum) ? Math.round(minimum) : rawMin,
      max: Number.isFinite(minimum)
        ? Math.round(minimum + safeSpan)
        : rawMax,
    };
  }

  return rawMin <= rawMax
    ? { min: rawMin, max: rawMax }
    : { min: rawMax, max: rawMin };
};

export const getBandwidthEndHz = (
  startHz: number,
  bandwidthHz: number,
): number => startHz + bandwidthHz;

export const getBandwidthStartHz = (
  endHz: number,
  bandwidthHz: number,
): number => endHz - bandwidthHz;

export const MIN_CAPTURE_BANDWIDTH_HZ = 3_200_000;

export const AVAILABLE_SPECTRUM_FALLBACK: FrequencyRange = {
  min: 0,
  max: 30_000_000_000,
};

export const normalizeFrequencyRangeToHz = (
  range: FrequencyRange,
): FrequencyRange => {
  const min = Math.round(range.min);
  const max = Math.round(range.max);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 0 };
  }

  return min <= max ? { min, max } : { min: max, max: min };
};

export const getFrequencyRangeCenterHz = (range: FrequencyRange): number =>
  Math.round((range.min + range.max) / 2);

export const clampCenteredFrequencyRangeToZeroHz = (
  centerHz: number,
  bandwidthHz: number,
): FrequencyRange => {
  return clampCenteredFrequencyRange(centerHz, bandwidthHz, 0);
};

export const clampCenteredFrequencyRange = (
  centerHz: number,
  bandwidthHz: number,
  minimumFrequencyHz: number = 0,
): FrequencyRange => {
  const safeBandwidth =
    Number.isFinite(bandwidthHz) && bandwidthHz > 0 ? bandwidthHz : 0;
  const halfBandwidth = safeBandwidth / 2;
  const rawCenter = Number.isFinite(centerHz) ? centerHz : 0;

  if (safeBandwidth <= 0) {
    return { min: 0, max: 0 };
  }

  const minimum = Number.isFinite(minimumFrequencyHz)
    ? minimumFrequencyHz
    : Number.NEGATIVE_INFINITY;
  const adjustedCenter = Number.isFinite(minimum)
    ? Math.max(rawCenter, minimum + halfBandwidth)
    : rawCenter;
  const min = getCenteredFrequencyHz(adjustedCenter, safeBandwidth);
  const max = min + safeBandwidth;

  return {
    min: Number.isFinite(minimum)
      ? Math.round(Math.max(minimum, min))
      : Math.round(min),
    max: Number.isFinite(minimum)
      ? Math.round(Math.max(minimum, max))
      : Math.round(max),
  };
};

export const getAvailableSpectrumBounds = (
  bounds?: FrequencyRange | null,
): FrequencyRange => {
  if (
    bounds &&
    Number.isFinite(bounds.min) &&
    Number.isFinite(bounds.max) &&
    bounds.max > bounds.min
  ) {
    return bounds;
  }
  return AVAILABLE_SPECTRUM_FALLBACK;
};

/**
 * Corrects a requested center frequency so a window of `spanHz` stays inside
 * `[minHz, maxHz]`: entering a bound corrects the center so the window's
 * *edge* lands on the bound instead of pushing half the window past it.
 * Pass `-Infinity`/`Infinity` for an unbounded side.
 */
export const resolveEdgeClampedCenterHz = (
  centerHz: number,
  spanHz: number,
  minHz: number,
  maxHz: number,
): number => {
  const halfSpan =
    Number.isFinite(spanHz) && spanHz > 0 ? spanHz / 2 : 0;
  const safeMax = Number.isFinite(maxHz) ? maxHz : Number.POSITIVE_INFINITY;
  const safeMin = Number.isFinite(minHz) ? minHz : Number.NEGATIVE_INFINITY;
  const raw = Number.isFinite(centerHz) ? centerHz : 0;
  if (halfSpan <= 0) {
    return Math.max(safeMin, Math.min(raw, safeMax));
  }
  return Math.max(
    safeMin === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : safeMin + halfSpan,
    Math.min(raw, safeMax - halfSpan),
  );
};

export const clampFrequencyRangeToBounds = (
  range: FrequencyRange,
  bounds?: FrequencyRange | null,
  options?: { minimumFrequencyHz?: number },
): FrequencyRange => {
  const safeBounds = getAvailableSpectrumBounds(bounds);
  const minimumFrequencyHz =
    options?.minimumFrequencyHz === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : safeBounds.min;
  const span = range.max - range.min;
  const boundsSpan = safeBounds.max - minimumFrequencyHz;
  if (!Number.isFinite(span) || span <= 0) {
    return {
      min: safeBounds.min,
      max: safeBounds.min,
    };
  }

  if (span >= boundsSpan) {
    return {
      min: safeBounds.min,
      max: safeBounds.max,
    };
  }

  let min = range.min;
  let max = range.max;

  if (min < minimumFrequencyHz) {
    min = minimumFrequencyHz;
    max = min + span;
  }
  if (max > safeBounds.max) {
    max = safeBounds.max;
    min = max - span;
  }

  return { min, max };
};

export const isFrequencyWithinRange = (
  frequencyHz: number,
  range: FrequencyRange | null | undefined,
): boolean => {
  if (
    !range ||
    !Number.isFinite(frequencyHz) ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max)
  ) {
    return false;
  }

  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  return frequencyHz >= min && frequencyHz <= max;
};

export const findRangeContainingFrequency = <T extends FrequencyRange>(
  frequencyHz: number,
  ranges: readonly T[] | null | undefined,
): T | null => {
  if (!Array.isArray(ranges) || !Number.isFinite(frequencyHz)) {
    return null;
  }

  return (
    ranges.find((range) => isFrequencyWithinRange(frequencyHz, range)) ?? null
  );
};

export const clampBandwidthWithMinSpan = (
  startHz: number,
  endHz: number,
  minSpanHz: number = MIN_CAPTURE_BANDWIDTH_HZ,
  movingBoundary: "start" | "end" = "end",
): { startHz: number; endHz: number } => {
  const minSpan =
    Number.isFinite(minSpanHz) && minSpanHz > 0
      ? minSpanHz
      : MIN_CAPTURE_BANDWIDTH_HZ;
  let start = Number.isFinite(startHz) ? Math.max(0, startHz) : 0;
  let end = Number.isFinite(endHz) ? Math.max(0, endHz) : start + minSpan;

  if (end - start < minSpan) {
    if (movingBoundary === "start") {
      end = start + minSpan;
    } else {
      start = end - minSpan;
      if (start < 0) {
        start = 0;
        end = minSpan;
      }
    }
  }

  return { startHz: Math.round(start), endHz: Math.round(end) };
};

export const roundDbValue = (value: number) => {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const trimNumericString = (value: string): string =>
  value.includes(".") ? value.replace(/\.?0+$/, "") : value;

const formatIntegerWithSeparators = (value: number): string =>
  Math.round(value).toLocaleString("en-US");

export const formatFrequency = (
  freqHz: number,
  showUnitsOrOptions: boolean | FormatFrequencyOptions = true,
): string => {
  const options =
    typeof showUnitsOrOptions === "boolean"
      ? { showUnits: showUnitsOrOptions }
      : showUnitsOrOptions;
  const showUnits = options.showUnits ?? true;
  const precisionMHz = options.precisionMHz ?? 1;
  const precisionGHz = options.precisionGHz ?? 1;
  const precisionKHz = options.precisionKHz ?? 0;
  const trimTrailingZeros = options.trimTrailingZeros ?? false;

  if (
    freqHz === undefined ||
    freqHz === null ||
    Number.isNaN(freqHz) ||
    !Number.isFinite(freqHz)
  ) {
    return "---" + (showUnits ? "Hz" : "");
  }

  const normalizedFreqHz = Object.is(freqHz, -0) ? 0 : freqHz;
  const abs = Math.abs(normalizedFreqHz);
  let val: number;
  let unit: string;
  let precision: number;

  if (normalizedFreqHz === 0) {
    val = 0;
    unit = "Hz";
    precision = 0;
  } else if (abs < 1000) {
    val = normalizedFreqHz;
    unit = "Hz";
    precision = 0;
  } else if (abs < 1_000_000) {
    val = normalizedFreqHz / 1000;
    unit = "kHz";
    precision = precisionKHz;
  } else if (abs < 1_000_000_000) {
    val = normalizedFreqHz / 1_000_000;
    unit = "MHz";
    precision = precisionMHz;
  } else {
    val = normalizedFreqHz / 1_000_000_000;
    unit = "GHz";
    precision = precisionGHz;
  }

  const displayVal = Number(val.toFixed(precision)) === 0 ? 0 : val;
  const formattedNumber = trimTrailingZeros
    ? trimNumericString(displayVal.toFixed(precision))
    : displayVal.toFixed(precision);
  return formattedNumber + (showUnits ? unit : "");
};

/**
 * Plain Hertz formatting for UI fields that should preserve raw numeric scale.
 * @param freqHz Frequency in Hertz
 * @returns Formatted raw Hertz string
 */
export const formatFrequencyHz = (freqHz: number): string => {
  if (!Number.isFinite(freqHz)) return "0";
  return formatIntegerWithSeparators(freqHz);
};

export const formatPowerDbm = (powerDbm: number): string => {
  const value = Number.isFinite(powerDbm) ? Math.round(powerDbm) : 0;
  return `${value} dBm`;
};

/**
 * Format a raw frequency value to at most 3 decimal places and drop trailing zeros.
 * @param val Numeric value to format
 * @returns Formatted string
 */
export const formatFrequencyValue = (val: number): string => {
  if (!Number.isFinite(val)) return "0";
  return val.toFixed(3);
};

/**
 * High resolution frequency formatting: 100.000.000 MHz
 * @param freqHz Frequency in Hz
 * @returns Formatted frequency string with dot separators for thousands
 */
export const formatFrequencyHighRes = (freqHz: number): string => {
  if (
    freqHz === undefined ||
    freqHz === null ||
    Number.isNaN(freqHz) ||
    !Number.isFinite(freqHz)
  ) {
    return "---Hz";
  }
  const abs = Math.abs(freqHz);

  if (abs >= 1_000_000_000) {
    // GHz.MHz.kHz.Hz
    const unit = "GHz";
    const val = freqHz / 1_000_000_000;
    const fixed = val.toFixed(9);
    const [g, rest] = fixed.split(".");
    return `${g}.${rest.slice(0, 3)}.${rest.slice(3, 6)}.${rest.slice(6, 9)}${unit}`;
  } else if (abs >= 1_000_000) {
    // MHz.kHz.Hz
    const unit = "MHz";
    const val = freqHz / 1_000_000;
    const fixed = val.toFixed(6);
    const [m, rest] = fixed.split(".");
    return `${m}.${rest.slice(0, 3)}.${rest.slice(3, 6)}${unit}`;
  } else if (abs >= 1000) {
    // kHz.Hz
    const unit = "kHz";
    const val = freqHz / 1000;
    const fixed = val.toFixed(3);
    const [k, rest] = fixed.split(".");
    return `${k}.${rest.slice(0, 3)}${unit}`;
  } else {
    // Hz
    return `${Math.round(freqHz)}Hz`;
  }
};

export const getFrequencyClass = (valueHz: number) => {
  if (valueHz < 3e5) {
    return "LF";
  }

  if (valueHz < 3e6) {
    return "MF";
  }

  if (valueHz < 3e7) {
    return "HF";
  }

  if (valueHz < 3e8) {
    return "VHF";
  }

  if (valueHz < 1e9) {
    return "Low end microwave (pre L band)";
  }

  if (valueHz < 2e9) {
    return "L-band Microwave (1-2GHz)";
  }

  if (valueHz < 4e9) {
    return "S-band Microwave (2-4GHz)";
  }

  if (valueHz < 12e9) {
    return "X-band (8-12GHz)";
  }

  return "Microwave";
};

/**
 * Parse a frequency string with units (Hz, kHz, MHz, GHz) into a number of Hz.
 * Supports numeric separators (underscores) and handles various unit cases.
 * @param freqStr Frequency string (e.g. "137.5MHz", "2.4 GHz", "440_000")
 * @param defaultUnit The unit to assume if none is found (default: Hz)
 * @returns Frequency in Hz or NaN if invalid
 */
export const parseFrequency = (
  freqStr: string,
  defaultUnit: "Hz" | "kHz" | "MHz" | "GHz" = "Hz",
): number => {
  if (!freqStr) return NaN;
  const normalized = freqStr.trim().replace(/_/g, "");
  const match = normalized.match(/^([\d.]+)\s*([a-zA-Z]*)$/);
  if (!match) return NaN;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  if (!unit) {
    switch (defaultUnit) {
      case "GHz":
        return value * 1_000_000_000;
      case "MHz":
        return value * 1_000_000;
      case "kHz":
        return value * 1_000;
      case "Hz":
        return value;
    }
  }

  switch (unit) {
    case "ghz":
      return value * 1_000_000_000;
    case "mhz":
      return value * 1_000_000;
    case "khz":
      return value * 1000;
    case "hz":
      return value;
    default:
      return NaN;
  }
};

/**
 * Formats frequency with up to 3 decimal places, strictly truncating (no rounding).
 */
export const formatChannelFreq = (hz: number): string => {
  const abs = Math.abs(hz);
  let val: number;
  let unit: string;

  if (abs >= 1_000_000) {
    val = hz / 1_000_000;
    unit = "MHz";
  } else if (abs >= 1_000) {
    val = hz / 1_000;
    unit = "kHz";
  } else {
    val = hz;
    unit = "Hz";
  }

  // Truncate to 3 decimal places without rounding
  const s = val.toString();
  const dotIndex = s.indexOf(".");
  if (dotIndex !== -1) {
    return s.slice(0, dotIndex + 4) + unit;
  }
  return s + unit;
};
