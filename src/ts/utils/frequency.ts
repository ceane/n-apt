/**
 * Frequency formatting utilities for precise and consistent display
 */

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

const trimNumericString = (value: string): string =>
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
  const precisionMHz = options.precisionMHz ?? 3;
  const precisionGHz = options.precisionGHz ?? 3;
  const precisionKHz = options.precisionKHz ?? 0;
  const trimTrailingZeros = options.trimTrailingZeros ?? false;

  if (freqHz === undefined || freqHz === null || Number.isNaN(freqHz) || !Number.isFinite(freqHz)) {
    return "---" + (showUnits ? " Hz" : "");
  }

  const abs = Math.abs(freqHz);
  let val: number;
  let unit: string;
  let precision: number;

  if (freqHz === 0) {
    val = 0;
    unit = "Hz";
    precision = 0;
  } else if (abs < 1000) {
    val = freqHz;
    unit = "Hz";
    precision = 0;
  } else if (abs < 1_000_000) {
    val = freqHz / 1000;
    unit = "kHz";
    precision = precisionKHz;
  } else if (abs < 1_000_000_000) {
    val = freqHz / 1_000_000;
    unit = "MHz";
    precision = precisionMHz;
  } else {
    val = freqHz / 1_000_000_000;
    unit = "GHz";
    precision = precisionGHz;
  }

  const formattedNumber = trimTrailingZeros
    ? trimNumericString(val.toFixed(precision))
    : val.toFixed(precision);
  return formattedNumber + (showUnits ? " " + unit : "");
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

/**
 * High resolution frequency formatting: 100.000.000 MHz
 * @param freqHz Frequency in Hz
 * @returns Formatted frequency string with dot separators for thousands
 */
export const formatFrequencyHighRes = (freqHz: number): string => {
  if (freqHz === undefined || freqHz === null || Number.isNaN(freqHz) || !Number.isFinite(freqHz)) {
    return "--- Hz";
  }
  const abs = Math.abs(freqHz);
  
  if (abs >= 1_000_000_000) {
    // GHz.MHz.kHz.Hz
    const val = freqHz / 1_000_000_000;
    const fixed = val.toFixed(9);
    const [g, rest] = fixed.split(".");
    return `${g}.${rest.slice(0, 3)}.${rest.slice(3, 6)}.${rest.slice(6, 9)} GHz`;
  } else if (abs >= 1_000_000) {
    // MHz.kHz.Hz
    const val = freqHz / 1_000_000;
    const fixed = val.toFixed(6);
    const [m, rest] = fixed.split(".");
    return `${m}.${rest.slice(0, 3)}.${rest.slice(3, 6)} MHz`;
  } else if (abs >= 1000) {
    // kHz.Hz
    const val = freqHz / 1000;
    const fixed = val.toFixed(3);
    const [k, rest] = fixed.split(".");
    return `${k}.${rest.slice(0, 3)} kHz`;
  } else {
    // Hz
    return `${Math.round(freqHz)} Hz`;
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
  defaultUnit: "Hz" | "kHz" | "MHz" | "GHz" = "Hz"
): number => {
  if (!freqStr) return NaN;
  const normalized = freqStr.trim().replace(/_/g, "");
  const match = normalized.match(/^([\d.]+)\s*([a-zA-Z]*)$/);
  if (!match) return NaN;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  if (!unit) {
    switch (defaultUnit) {
      case "GHz": return value * 1_000_000_000;
      case "MHz": return value * 1_000_000;
      case "kHz": return value * 1_000;
      case "Hz": return value;
    }
  }

  switch (unit) {
    case "ghz": return value * 1_000_000_000;
    case "mhz": return value * 1_000_000;
    case "khz": return value * 1000;
    case "hz": return value;
    default: return NaN;
  }
};
