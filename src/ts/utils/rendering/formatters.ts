import { formatFrequency, formatFrequencyHighRes } from "@n-apt/utils/frequency";

/**
 * Format MHz value for display — trims trailing zeros, always includes unit.
 * Precision depends on zoom level.
 */
export function fmtFreq(mhz: number, zoom: number = 1): string {
  return zoom >= 100 ? formatFrequencyHighRes(mhz) : formatFrequency(mhz, { trimTrailingZeros: true, precisionKHz: 2 });
}

/**
 * Format a frequency for tick labels.
 */
export function fmtFreqTick(mhz: number, stepMHz: number): string {
  if (stepMHz >= 0.5) return mhz.toFixed(1);
  if (stepMHz >= 0.01) return mhz.toFixed(2);
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
