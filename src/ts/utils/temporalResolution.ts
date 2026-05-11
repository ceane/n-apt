export type TemporalResolution = "low" | "medium" | "high";

export function getTemporalResolutionAlpha(
  temporalResolution: TemporalResolution,
): number {
  switch (temporalResolution) {
    case "low":
      return 0.01;
    case "medium":
      return 0.05;
    case "high":
      return 1.0;
  }
}

export function blendTemporalWaveform(
  previous: Float32Array | null,
  current: Float32Array,
  temporalResolution: TemporalResolution,
): Float32Array {
  if (!previous || previous.length !== current.length) {
    return new Float32Array(current);
  }

  const alpha = getTemporalResolutionAlpha(temporalResolution);
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
): number {
  switch (temporalResolution) {
    case "low":
      return 24;
    case "medium":
      return 8;
    case "high":
      return 1;
  }
}

export function averageTemporalWaveforms(
  frames: Float32Array[],
  fallback: Float32Array | null,
): Float32Array {
  if (frames.length === 0) {
    return fallback ? new Float32Array(fallback) : new Float32Array();
  }

  const length = frames[0].length;
  const output = new Float32Array(length);
  for (const frame of frames) {
    for (let i = 0; i < length; i++) {
      output[i] += frame[i];
    }
  }
  for (let i = 0; i < length; i++) {
    output[i] /= frames.length;
  }
  return output;
}
