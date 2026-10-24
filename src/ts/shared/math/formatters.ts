export { formatBytes as formatFileSize, formatBytesPerSecond as formatDataRate, formatByteTotal as formatDataTotal } from "@n-apt/math/unitsOfMeasure";

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);

  return parts.join(" ");
};

// Millisecond-aware duration formatter
export const formatDurationMs = (duration: number): string => {
  // Normalize to a human-friendly string:
  // - If duration >= 1 second: show seconds, but drop trailing zeros (e.g., 2 -> "2 s", 2.5 -> "2.5 s")
  // - If duration < 1 second: show milliseconds (e.g., 0.45 -> 450 ms)
  if (!Number.isFinite(duration) || duration <= 0) return "0 ms";
  if (duration >= 1) {
    if (Number.isInteger(duration)) {
      return `${Math.round(duration)} s`;
    }
    const rounded = duration.toFixed(2).replace(/\.0+$/, "").replace(/\.$/, "");
    // remove trailing zeros after decimal
    const compact = rounded.replace(/\.?0+$/, "");
    return `${compact} s`;
  }
  const ms = duration * 1000;
  return `${Math.round(ms)} ms`;
};

export function formatTimestampWithTimezone(isoString: string): string {
  try {
    const date = new Date(isoString);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `${dateStr} ${timeStr} (${tz})`;
  } catch {
    return isoString;
  }
}

/** Formats an ISO timestamp as a concise relative time such as "2 days ago". */
export function formatRelativeTimestamp(
  isoString: string,
  now = Date.now(),
): string {
  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) return "Invalid date";

  const elapsedSeconds = (timestamp - now) / 1000;
  const elapsed = Math.abs(elapsedSeconds);
  const units = [
    { limit: 60, seconds: 1, unit: "second" },
    { limit: 60 * 60, seconds: 60, unit: "minute" },
    { limit: 24 * 60 * 60, seconds: 60 * 60, unit: "hour" },
    { limit: 7 * 24 * 60 * 60, seconds: 24 * 60 * 60, unit: "day" },
    { limit: 28 * 24 * 60 * 60, seconds: 7 * 24 * 60 * 60, unit: "week" },
    { limit: 365 * 24 * 60 * 60, seconds: 30 * 24 * 60 * 60, unit: "month" },
    { limit: Number.POSITIVE_INFINITY, seconds: 365 * 24 * 60 * 60, unit: "year" },
  ] as const;
  const { seconds, unit } = units.find(({ limit }) => elapsed < limit)!;
  const value = Math.round(elapsedSeconds / seconds);

  return new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(
    value,
    unit,
  );
}
