import { formatFrequency, formatFrequencyHighRes } from "@n-apt/utils/frequency";

/**
 * Format Hz value for display — trims trailing zeros, always includes unit.
 * Precision depends on zoom level.
 */
export function fmtFreq(hz: number, zoom: number = 1): string {
  return zoom >= 100 ? formatFrequencyHighRes(hz) : formatFrequency(hz, { trimTrailingZeros: true, precisionKHz: 2 });
}

/**
 * Format a frequency for tick labels.
 */
export function fmtFreqTick(hz: number, stepHz: number): string {
  if (!Number.isFinite(hz)) return "---";
  const mhz = hz / 1_000_000;
  if (stepHz >= 500_000) return mhz.toFixed(1);
  if (stepHz >= 10_000) return mhz.toFixed(2);
  return mhz.toFixed(3);
}

export function fmtTimestamp(includeTimezone: boolean = true): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (!includeTimezone) return `${dateStr} ${timeStr}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${dateStr} ${timeStr} ${tz}`;
}
