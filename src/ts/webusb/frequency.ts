/** Small standalone copy of the app's frequency display/field utilities. */
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

/** Percentage of the selected denomination used for keyboard tuning steps. */
export const getFrequencyArrowStepHz = (unit: FrequencyUnit): number =>
  Math.max(1, Math.round(getFrequencyUnitScale(unit) * 0.05));

export const getOptimalFrequencyScale = (hz: number): FrequencyScale => {
  const absHz = Math.abs(hz);
  if (absHz >= 1_000_000_000) return { value: hz / 1_000_000_000, unit: "GHz" };
  if (absHz >= 1_000_000) return { value: hz / 1_000_000, unit: "MHz" };
  if (absHz >= 1_000) return { value: hz / 1_000, unit: "kHz" };
  return { value: hz, unit: "Hz" };
};

export const formatFrequencyHz = (frequencyHz: number): string =>
  Number.isFinite(frequencyHz)
    ? Math.round(frequencyHz).toLocaleString("en-US")
    : "0";

export const formatFrequencyValue = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(3) : "0";

export const trimNumericString = (value: string): string =>
  value.includes(".") ? value.replace(/\.?0+$/, "") : value;

export const formatFrequencyInputValue = (
  frequencyHz: number,
  unit: FrequencyUnit,
): string => {
  const value = frequencyHz / getFrequencyUnitScale(unit);
  return unit === "Hz"
    ? formatFrequencyHz(frequencyHz)
    : trimNumericString(formatFrequencyValue(value));
};

export const parseFrequencyInputValue = (
  value: string,
  unit: FrequencyUnit,
  minHz: number,
  maxHz: number,
): number | null => {
  const parsed = Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) return null;
  return clampFrequencyHz(parsed * getFrequencyUnitScale(unit), minHz, maxHz);
};

export const formatFrequency = (
  frequencyHz: number,
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

  if (!Number.isFinite(frequencyHz)) return `---${showUnits ? "Hz" : ""}`;

  const normalized = Object.is(frequencyHz, -0) ? 0 : frequencyHz;
  const absolute = Math.abs(normalized);
  let value: number;
  let unit: string;
  let precision: number;

  if (normalized === 0) {
    value = 0;
    unit = "Hz";
    precision = 0;
  } else if (absolute < 1_000) {
    value = normalized;
    unit = "Hz";
    precision = 0;
  } else if (absolute < 1_000_000) {
    value = normalized / 1_000;
    unit = "kHz";
    precision = precisionKHz;
  } else if (absolute < 1_000_000_000) {
    value = normalized / 1_000_000;
    unit = "MHz";
    precision = precisionMHz;
  } else {
    value = normalized / 1_000_000_000;
    unit = "GHz";
    precision = precisionGHz;
  }

  const displayValue = Number(value.toFixed(precision)) === 0 ? 0 : value;
  const formatted = trimTrailingZeros
    ? trimNumericString(displayValue.toFixed(precision))
    : displayValue.toFixed(precision);
  return `${formatted}${showUnits ? unit : ""}`;
};
