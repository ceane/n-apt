export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  if (exponent === 0) {
    return `${Math.round(value)} ${units[exponent]}`;
  }

  return `${value.toFixed(2)} ${units[exponent]}`;
};

export const formatDataRate = (bytesPerSecond: number): string => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "0 B/s";
  }

  if (bytesPerSecond >= 1_000_000_000_000) {
    return `${(bytesPerSecond / 1_000_000_000_000).toFixed(2)} TB/s`;
  }
  if (bytesPerSecond >= 1_000_000_000) {
    return `${(bytesPerSecond / 1_000_000_000).toFixed(2)} GB/s`;
  }
  if (bytesPerSecond >= 1_000_000) {
    return `${(bytesPerSecond / 1_000_000).toFixed(2)} MB/s`;
  }
  if (bytesPerSecond >= 1_000) {
    return `${(bytesPerSecond / 1_000).toFixed(2)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
};

export const formatDataTotal = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }

  const gb = bytes / 1024 ** 3;
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
};

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
