/**
 * Frequency formatting utilities for precise and consistent display
 */

/**
 * Standard frequency formatting: 100.000 MHz or 500 kHz
 * @param freqMHz Frequency in MHz
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

export const formatFrequency = (
  freqMHz: number,
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
  const abs = Math.abs(freqMHz);
  let val: number;
  let unit: string;
  let precision: number;

  if (freqMHz === 0) {
    val = 0;
    unit = "kHz";
    precision = precisionKHz;
  } else if (abs < 1) {
    val = freqMHz * 1000;
    unit = "kHz";
    precision = precisionKHz;
  } else if (abs >= 1000) {
    val = freqMHz / 1000;
    unit = "GHz";
    precision = precisionGHz;
  } else {
    val = freqMHz;
    unit = "MHz";
    precision = precisionMHz;
  }

  const formattedNumber = trimTrailingZeros
    ? trimNumericString(val.toFixed(precision))
    : val.toFixed(precision);
  return formattedNumber + (showUnits ? " " + unit : "");
};

/**
 * High resolution frequency formatting: 100.000.000 MHz
 * @param freqMHz Frequency in MHz
 * @returns Formatted frequency string with dot separators for thousands
 */
export const formatFrequencyHighRes = (freqMHz: number): string => {
  const abs = Math.abs(freqMHz);
  
  if (abs >= 1000) {
    // GHz.MHz.kHz.Hz
    const val = freqMHz / 1000;
    const fixed = val.toFixed(9);
    const [g, rest] = fixed.split(".");
    return `${g}.${rest.slice(0, 3)}.${rest.slice(3, 6)}.${rest.slice(6, 9)} GHz`;
  } else if (abs >= 1) {
    // MHz.kHz.Hz
    const val = freqMHz;
    const fixed = val.toFixed(6);
    const [m, rest] = fixed.split(".");
    return `${m}.${rest.slice(0, 3)}.${rest.slice(3, 6)} MHz`;
  } else if (abs >= 0.001) {
    // kHz.Hz
    const val = freqMHz * 1000;
    const fixed = val.toFixed(3);
    const [k, rest] = fixed.split(".");
    return `${k}.${rest.slice(0, 3)} kHz`;
  } else {
    // Hz
    return `${Math.round(freqMHz * 1000000)} Hz`;
  }
};
