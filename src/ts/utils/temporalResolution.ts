export type TemporalResolution = "low" | "medium" | "high";

export function getTemporalResolutionAlpha(
  temporalResolution: TemporalResolution,
  fps: number = 60,
): number {
  if (fps === 60) {
    switch (temporalResolution) {
      case "low":
        return 0.01;
      case "medium":
        return 0.05;
      case "high":
        return 1.0;
    }
  }

  const targetFps = Math.max(1, fps);
  const dt = 1 / targetFps;
  switch (temporalResolution) {
    case "low":
      // At 60 FPS, alpha was 0.01 -> tau = 1.66s.
      // 1 - exp(-dt / tau)
      return 1 - Math.exp(-dt / 1.66);
    case "medium":
      // At 60 FPS, alpha was 0.05 -> tau = 0.326s.
      // 1 - exp(-dt / tau)
      return 1 - Math.exp(-dt / 0.326);
    case "high":
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
  if (fps === 60) {
    switch (temporalResolution) {
      case "low":
        return 24;
      case "medium":
        return 8;
      case "high":
        return 1;
    }
  }

  const targetFps = Math.max(1, fps);
  switch (temporalResolution) {
    case "low":
      // At 60 FPS, this was 24 frames (0.4s). Let's scale it.
      return Math.max(1, Math.round(0.4 * targetFps));
    case "medium":
      // At 60 FPS, this was 8 frames (0.133s). Let's scale it.
      return Math.max(1, Math.round(0.133 * targetFps));
    case "high":
      return 1;
  }
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
