import { formatFrequency, formatFrequencyHighRes } from "@n-apt/utils/frequency";

/**
 * Format Hz value for display — trims trailing zeros, always includes unit.
 * Precision depends on zoom level.
 */
export function fmtFreq(hz: number, zoom: number = 1): string {
  if (zoom >= 100) return formatFrequencyHighRes(hz);
  return formatFrequency(hz, { trimTrailingZeros: true });
}

/**
 * Format a frequency for tick labels.
 * Precision adapts to the step size so adjacent ticks are distinguishable.
 */
export function fmtFreqTick(hz: number, stepHz: number): string {
  const { precisionMHz, precisionKHz } = tickPrecisionForStep(stepHz);
  return formatFrequency(hz, { trimTrailingZeros: true, precisionMHz, precisionKHz });
}

/**
 * Compute the minimum decimal precision needed for tick labels given
 * a step size in Hz so that adjacent values format to different strings.
 */
export function tickPrecisionForStep(stepHz: number): { precisionMHz: number; precisionKHz: number } {
  if (stepHz >= 100_000) return { precisionMHz: 1, precisionKHz: 0 };
  if (stepHz >= 10_000)  return { precisionMHz: 2, precisionKHz: 1 };
  if (stepHz >= 1_000)   return { precisionMHz: 3, precisionKHz: 2 };
  return { precisionMHz: 4, precisionKHz: 3 };
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
