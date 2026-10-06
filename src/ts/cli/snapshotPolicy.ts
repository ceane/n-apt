export type CliSnapshotFormat = "png" | "svg" | "animated-svg" | "webm" | "mp4";

export type CliSnapshotAspectRatio =
  | "default"
  | "4:3"
  | "16:10"
  | "16:9"
  | "19.5:9";

const ANIMATED_FORMATS: ReadonlySet<string> = new Set([
  "animated-svg",
  "webm",
  "mp4",
]);

/** Animated formats replay recent frame history, so they need all 64 frames. */
export function resolveCliSnapshotFrameCount(options: {
  waterfall: boolean;
  format?: string;
}): 1 | 64 {
  if (options.waterfall || ANIMATED_FORMATS.has(options.format ?? ""))
    return 64;
  return 1;
}

export type CliSnapshotDimensions = {
  width: number;
  spectrumHeight: number;
  waterfallHeight: number;
  /** Spectrum + waterfall height; the stats row adds to this. */
  height: number;
};

/**
 * Mirrors the UI snapshot's aspect-ratio handling: keep the base geometry, then
 * shrink the tall dimension so the composed frame matches the requested ratio.
 */
export function resolveCliSnapshotDimensions(options: {
  baseWidth: number;
  spectrumHeight: number;
  waterfallHeight: number;
  waterfall: boolean;
  aspectRatio?: string;
}): CliSnapshotDimensions {
  const baseWaterfallH = options.waterfall ? options.waterfallHeight : 0;
  const totalH = options.spectrumHeight + baseWaterfallH;
  let width = options.baseWidth;
  let height = totalH;
  let spectrumHeight = options.spectrumHeight;
  let waterfallHeight = baseWaterfallH;

  if (options.aspectRatio && options.aspectRatio !== "default") {
    const targetRatio =
      options.aspectRatio === "4:3"
        ? 4 / 3
        : options.aspectRatio === "16:10"
          ? 16 / 10
          : options.aspectRatio === "16:9"
            ? 16 / 9
            : 19.5 / 9;
    const currentRatio = options.baseWidth / totalH;
    if (currentRatio > targetRatio) {
      height = Math.round(options.baseWidth / targetRatio);
      if (options.waterfall) {
        const spectrumRatio =
          options.spectrumHeight /
          (options.spectrumHeight + options.waterfallHeight);
        spectrumHeight = Math.round(height * spectrumRatio);
        waterfallHeight = height - spectrumHeight;
      } else {
        spectrumHeight = height;
      }
    } else {
      width = Math.round(totalH * targetRatio);
      if (options.waterfall) {
        spectrumHeight = options.spectrumHeight;
        waterfallHeight = options.waterfallHeight;
      } else {
        spectrumHeight = totalH;
      }
    }
  }

  return { width, height, spectrumHeight, waterfallHeight };
}

/** Returns an error message for an invalid value, or null when it parses. */
export function validateCliGeolocationArg(value: string): string | null {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) {
    return "Option --geolocation must be 'lat,lon'";
  }
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return "Option --geolocation latitude and longitude must be finite numbers";
  }
  if (Math.abs(lat) > 90) {
    return "Option --geolocation latitude must be within ±90";
  }
  if (Math.abs(lon) > 180) {
    return "Option --geolocation longitude must be within ±180";
  }
  return null;
}

/** Parses a validated --geolocation value into the UI's fixed-precision shape. */
export function parseCliGeolocationArg(value: string): {
  lat: string;
  lon: string;
} {
  const [latRaw, lonRaw] = value.split(",").map((part) => part.trim());
  return {
    lat: Number(latRaw).toFixed(6),
    lon: Number(lonRaw).toFixed(6),
  };
}

/** Returns an error message for an invalid absolute frequency range. */
export function validateCliFrequencyRangeArg(value: string): string | null {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) {
    return "Option --frequency-range must be 'minHz,maxHz'";
  }
  const min = Number(parts[0]);
  const max = Number(parts[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return "Option --frequency-range values must be finite numbers";
  }
  if (min >= max) {
    return "Option --frequency-range minimum must be less than maximum";
  }
  return null;
}

export function parseCliFrequencyRangeArg(value: string): {
  min: number;
  max: number;
} {
  const [min, max] = value.split(",").map((part) => Number(part.trim()));
  return { min, max };
}

export function validateCliFftColorArg(value: string): string | null {
  return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
    ? null
    : "Option --fft-color must be a hex color such as #00d4ff";
}
