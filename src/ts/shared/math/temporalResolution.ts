export type TemporalResolution = "slow" | "reduced" | "lossless";

const TEMPORAL_RESOLUTION_LABELS: Record<TemporalResolution, string> = {
  slow: "Slow",
  reduced: "Reduced",
  lossless: "Lossless",
};

export function normalizeTemporalResolution(value: unknown): TemporalResolution {
  switch (value) {
    case "slow":
    case "low":
      return "slow";
    case "lossless":
    case "high":
      return "lossless";
    case "reduced":
    case "medium":
      return "reduced";
    default:
      return "reduced";
  }
}

export function getTemporalResolutionLabel(
  temporalResolution: TemporalResolution,
): string {
  return TEMPORAL_RESOLUTION_LABELS[normalizeTemporalResolution(temporalResolution)];
}

export function getTemporalResolutionAlpha(
  temporalResolution: TemporalResolution,
  fps: number = 60,
): number {
  temporalResolution = normalizeTemporalResolution(temporalResolution);
  if (fps === 60) {
    switch (temporalResolution) {
      case "slow":
        return 0.01;
      case "reduced":
        return 0.05;
      case "lossless":
        return 1.0;
    }
  }

  const targetFps = Number.isFinite(fps) ? Math.max(1, fps) : 60;
  const dt = 1 / targetFps;
  switch (temporalResolution) {
    case "slow":
      // At 60 FPS, alpha was 0.01 -> tau = 1.66s.
      // 1 - exp(-dt / tau)
      return 1 - Math.exp(-dt / 1.66);
    case "reduced":
      // At 60 FPS, alpha was 0.05 -> tau = 0.326s.
      // 1 - exp(-dt / tau)
      return 1 - Math.exp(-dt / 0.326);
    case "lossless":
      return 1.0;
  }
}

export function blendTemporalWaveform(
  previous: Float32Array | null,
  current: Float32Array,
  temporalResolution: TemporalResolution,
  fps: number = 60,
): Float32Array {
  if (!previous || previous.length !== current.length) {
    return new Float32Array(current);
  }

  const alpha = getTemporalResolutionAlpha(temporalResolution, fps);
  if (alpha >= 1) {
    previous.set(current);
    return previous;
  }

  for (let i = 0; i < current.length; i++) {
    previous[i] = alpha * current[i] + (1 - alpha) * previous[i];
  }

  return previous;
}

export function getTemporalResolutionWindow(
  temporalResolution: TemporalResolution,
  fps: number = 60,
): number {
  temporalResolution = normalizeTemporalResolution(temporalResolution);
  if (fps === 60) {
    switch (temporalResolution) {
      case "slow":
        return 24;
      case "reduced":
        return 8;
      case "lossless":
        return 1;
    }
  }

  const targetFps = Number.isFinite(fps) ? Math.max(1, fps) : 60;
  switch (temporalResolution) {
    case "slow":
      // At 60 FPS, this was 24 frames (0.4s). Let's scale it.
      return Math.max(1, Math.round(0.4 * targetFps));
    case "reduced":
      // At 60 FPS, this was 8 frames (0.133s). Let's scale it.
      return Math.max(1, Math.round(0.133 * targetFps));
    case "lossless":
      return 1;
  }
}

export function ensureTemporalFrameSlot(
  pool: Float32Array[],
  writeIndex: number,
  frameLength: number,
): number {
  const safeIndex =
    pool.length > 0 && writeIndex >= 0 && writeIndex < pool.length
      ? writeIndex
      : 0;
  if (!pool[safeIndex] || pool[safeIndex].length !== frameLength) {
    pool[safeIndex] = new Float32Array(frameLength);
  }
  return safeIndex;
}

export function clampTemporalActiveCount(count: number, window: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(window) || window <= 0) {
    return 0;
  }
  return Math.min(Math.floor(window), Math.max(0, Math.floor(count)));
}

export function averageTemporalWaveforms(
  frames: Float32Array[],
  fallback: Float32Array | null,
  outputBuffer?: Float32Array | null,
): Float32Array {
  if (frames.length === 0) {
    return fallback ? new Float32Array(fallback) : new Float32Array();
  }

  const length = frames[0].length;
  // Reuse the provided output buffer when possible to avoid per-frame allocation
  const output =
    outputBuffer && outputBuffer.length === length
      ? outputBuffer
      : new Float32Array(length);
  output.fill(0);
  for (const frame of frames) {
    for (let i = 0; i < length; i++) {
      output[i] += frame[i];
    }
  }
  const invCount = 1 / frames.length;
  for (let i = 0; i < length; i++) {
    output[i] *= invCount;
  }
  return output;
}
