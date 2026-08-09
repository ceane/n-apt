import {
  formatFrequency,
  formatFrequencyHighRes,
} from "@n-apt/math/frequency";

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
export function fmtFreqTick(hz: number, _stepHz: number): string {
  const { precisionMHz, precisionKHz, precisionGHz } =
    tickPrecisionForStep(_stepHz);
  return formatFrequency(hz, {
    trimTrailingZeros: true,
    precisionMHz: Math.max(precisionMHz, 4),
    precisionKHz: Math.max(precisionKHz, 2),
    precisionGHz,
  });
}

/**
 * Compute the minimum decimal precision needed for tick labels given
 * a step size in Hz so that adjacent values format to different strings.
 */
export function tickPrecisionForStep(stepHz: number): {
  precisionMHz: number;
  precisionKHz: number;
  precisionGHz: number;
} {
  if (stepHz >= 1_000_000) {
    return { precisionMHz: 1, precisionKHz: 0, precisionGHz: 3 };
  }
  if (stepHz >= 100_000) {
    return { precisionMHz: 1, precisionKHz: 0, precisionGHz: 4 };
  }
  if (stepHz >= 10_000) {
    return { precisionMHz: 2, precisionKHz: 1, precisionGHz: 5 };
  }
  if (stepHz >= 1_000) {
    return { precisionMHz: 3, precisionKHz: 2, precisionGHz: 6 };
  }
  return { precisionMHz: 4, precisionKHz: 3, precisionGHz: 6 };
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
