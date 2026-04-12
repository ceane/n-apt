export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  if (exponent === 0) {
    return `${Math.round(value)} ${units[exponent]}`;
  }

  return `${value.toFixed(2)} ${units[exponent]}`;
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
