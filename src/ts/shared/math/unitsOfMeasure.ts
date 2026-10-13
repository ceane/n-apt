export type SiUnit = {
  symbol: string;
  factor: number;
};

export const FREQUENCY_UNITS: readonly SiUnit[] = [
  { symbol: "GHz", factor: 1e9 },
  { symbol: "MHz", factor: 1e6 },
  { symbol: "kHz", factor: 1e3 },
  { symbol: "Hz", factor: 1 },
];

export const TIME_UNITS: readonly SiUnit[] = [
  { symbol: "s", factor: 1 },
  { symbol: "ms", factor: 1e-3 },
  { symbol: "µs", factor: 1e-6 },
  { symbol: "ns", factor: 1e-9 },
  { symbol: "ps", factor: 1e-12 },
  { symbol: "fs", factor: 1e-15 },
];

export const LENGTH_UNITS: readonly SiUnit[] = [
  { symbol: "km", factor: 1e3 },
  { symbol: "m", factor: 1 },
  { symbol: "cm", factor: 1e-2 },
  { symbol: "mm", factor: 1e-3 },
  { symbol: "µm", factor: 1e-6 },
  { symbol: "nm", factor: 1e-9 },
  { symbol: "pm", factor: 1e-12 },
];

export const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
export const BINARY_BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
export const DATA_RATE_UNITS = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"] as const;

const formatFixed = (value: number, digits: number): string => value.toFixed(digits);

/** File-size display retains the app's existing base-1024 KB/MB convention. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** index;
  return index === 0 ? `${Math.round(value)} ${BYTE_UNITS[index]}` : `${formatFixed(value, 2)} ${BYTE_UNITS[index]}`;
};

/** Data rates retain the app's existing base-1000 KB/s to TB/s convention. */
export const formatBytesPerSecond = (bytesPerSecond: number): string => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 B/s";
  const factors = [1, 1e3, 1e6, 1e9, 1e12];
  let index = factors.length - 1;
  while (index > 0 && bytesPerSecond < factors[index]) index--;
  const value = bytesPerSecond / factors[index];
  return index === 0 ? `${Math.round(value)} ${DATA_RATE_UNITS[index]}` : `${formatFixed(value, 2)} ${DATA_RATE_UNITS[index]}`;
};

/** Total-size display retains the app's existing base-1024 MB-through-TB convention. */
export const formatByteTotal = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
};

export function getSiUnitScale(unit: string, units: readonly SiUnit[]): number {
  return units.find((candidate) => candidate.symbol === unit)?.factor ?? 1;
}

export function getOptimalSiScale(value: number, units: readonly SiUnit[]): { value: number; unit: string } {
  const absolute = Math.abs(value);
  const selected = units.find((unit) => absolute >= unit.factor) ?? units[units.length - 1];
  return { value: value / selected.factor, unit: selected.symbol };
}

export function formatSiValue(value: number, units: readonly SiUnit[], precision = 4): string {
  if (!Number.isFinite(value)) return `0 ${units[units.length - 1]?.symbol ?? ""}`.trim();
  const scaled = getOptimalSiScale(value, units);
  return `${Number(scaled.value.toPrecision(precision))} ${scaled.unit}`;
}

export const formatFrequency = (hertz: number, precision = 4): string =>
  formatSiValue(hertz, FREQUENCY_UNITS, precision);

export const formatTime = (seconds: number, precision = 4): string =>
  formatSiValue(seconds, TIME_UNITS, precision);

export const formatLength = (meters: number, precision = 4): string =>
  formatSiValue(meters, LENGTH_UNITS, precision);
