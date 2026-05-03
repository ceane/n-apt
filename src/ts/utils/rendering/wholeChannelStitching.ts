import type { Range } from "@n-apt/utils/rendering/CoordinateMapper";

export type WholeChannelWaveformSegment = {
  waveform: Float32Array | number[];
  visualRange: Range;
  dbMin?: number;
};

export type WholeChannelStitchOptions = {
  minimumBins?: number;
  seamBins?: number;
  smoothingRadius?: number;
  maxPositiveFloorShiftDb?: number;
};

const DEFAULT_MINIMUM_BINS = 2048;
const DEFAULT_SEAM_BINS = 96;
const DEFAULT_SMOOTHING_RADIUS = 1;
const DEFAULT_MAX_POSITIVE_FLOOR_SHIFT_DB = 0;

function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function sampleLinear(waveform: Float32Array | number[], ratio: number): number {
  if (waveform.length === 0) return Number.NaN;
  if (waveform.length === 1) return waveform[0];

  const x = Math.max(0, Math.min(1, ratio)) * (waveform.length - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(waveform.length - 1, i0 + 1);
  return lerp(waveform[i0], waveform[i1], x - i0);
}

function mean(values: ArrayLike<number>, start: number, end: number): number {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, start); i < Math.min(values.length, end); i++) {
    const value = values[i];
    if (Number.isFinite(value)) {
      sum += value;
      count++;
    }
  }
  return count > 0 ? sum / count : Number.NaN;
}

export function calculateNoiseFloorDeltaDb(
  reference: ArrayLike<number>,
  target: ArrayLike<number>,
  edgeBins: number,
  maxPositiveShiftDb = DEFAULT_MAX_POSITIVE_FLOOR_SHIFT_DB,
): number {
  if (!reference.length || !target.length) return 0;

  const bins = Math.max(1, Math.min(edgeBins, reference.length, target.length));
  const referenceFloor = mean(reference, reference.length - bins, reference.length);
  const targetFloor = mean(target, 0, bins);
  if (!Number.isFinite(referenceFloor) || !Number.isFinite(targetFloor)) {
    return 0;
  }

  const delta = referenceFloor - targetFloor;
  return Math.min(delta, Math.max(0, maxPositiveShiftDb));
}

export function matchNoiseFloorDb(
  reference: ArrayLike<number>,
  target: Float32Array,
  edgeBins: number,
  maxPositiveShiftDb = DEFAULT_MAX_POSITIVE_FLOOR_SHIFT_DB,
): void {
  const delta = calculateNoiseFloorDeltaDb(
    reference,
    target,
    edgeBins,
    maxPositiveShiftDb,
  );
  if (delta === 0) return;

  for (let i = 0; i < target.length; i++) {
    if (Number.isFinite(target[i])) target[i] += delta;
  }
}

function smoothWaveform(input: Float32Array, radius: number): Float32Array {
  if (radius <= 0 || input.length < 3) return input;

  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let sum = 0;
    let weightSum = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(input.length - 1, i + radius); j++) {
      const distance = Math.abs(i - j);
      const weight = radius + 1 - distance;
      sum += input[j] * weight;
      weightSum += weight;
    }
    output[i] = sum / weightSum;
  }
  return output;
}

export function stitchWholeChannelWaveform(
  segments: WholeChannelWaveformSegment[],
  fullRange: Range,
  options: WholeChannelStitchOptions = {},
): Float32Array {
  const validSegments = segments
    .filter((segment) => {
      const span = segment.visualRange.max - segment.visualRange.min;
      return segment.waveform.length > 0 && span > 0;
    })
    .sort((a, b) => a.visualRange.min - b.visualRange.min);

  const totalSpan = fullRange.max - fullRange.min;
  if (!validSegments.length || !(totalSpan > 0)) return new Float32Array();

  const baseBins = Math.max(
    options.minimumBins ?? DEFAULT_MINIMUM_BINS,
    ...validSegments.map((segment) => segment.waveform.length),
  );
  const stitchedBins = Math.max(
    baseBins,
    Math.round(
      baseBins *
        validSegments.reduce((maxRatio, segment) => {
          const segSpan = segment.visualRange.max - segment.visualRange.min;
          return Math.max(maxRatio, segSpan > 0 ? totalSpan / segSpan : 1);
        }, 1),
    ),
  );

  const fallbackDb = validSegments[0].dbMin ?? -120;
  const stitched = new Float32Array(stitchedBins).fill(fallbackDb);
  const weights = new Float32Array(stitchedBins);
  const seamBins = Math.max(0, options.seamBins ?? DEFAULT_SEAM_BINS);
  const maxPositiveFloorShiftDb =
    options.maxPositiveFloorShiftDb ?? DEFAULT_MAX_POSITIVE_FLOOR_SHIFT_DB;
  let lastEnd = 0;

  for (const segment of validSegments) {
    const startRatio = Math.max(0, (segment.visualRange.min - fullRange.min) / totalSpan);
    const endRatio = Math.min(1, (segment.visualRange.max - fullRange.min) / totalSpan);
    const destStart = Math.max(0, Math.min(stitchedBins - 1, Math.round(startRatio * stitchedBins)));
    const destEnd = Math.max(destStart + 1, Math.min(stitchedBins, Math.round(endRatio * stitchedBins)));
    const destCount = destEnd - destStart;
    const sampled = new Float32Array(destCount);

    for (let i = 0; i < destCount; i++) {
      sampled[i] = sampleLinear(segment.waveform, i / Math.max(1, destCount - 1));
    }

    const seam = Math.min(seamBins, lastEnd, destCount);
    if (destStart < lastEnd && seam > 0) {
      const overlapStart = Math.max(destStart, lastEnd - seam);
      matchNoiseFloorDb(
        stitched.subarray(overlapStart, lastEnd),
        sampled,
        Math.min(seam, lastEnd - destStart),
        maxPositiveFloorShiftDb,
      );
    } else if (destStart === lastEnd && seam > 0) {
      matchNoiseFloorDb(
        stitched.subarray(Math.max(0, lastEnd - seam), lastEnd),
        sampled,
        seam,
        maxPositiveFloorShiftDb,
      );
    }

    for (let i = 0; i < destCount; i++) {
      const dst = destStart + i;
      let weight = 1;
      if (destStart < lastEnd && dst < lastEnd && seam > 0) {
        const t = Math.max(0, Math.min(1, (dst - destStart + 1) / (lastEnd - destStart + 1)));
        weight = 0.5 - 0.5 * Math.cos(Math.PI * t);
      }

      stitched[dst] = weights[dst] > 0
        ? (stitched[dst] * weights[dst] + sampled[i] * weight) / (weights[dst] + weight)
        : sampled[i];
      weights[dst] += weight;
    }

    lastEnd = Math.max(lastEnd, destEnd);
  }

  return smoothWaveform(stitched, Math.max(0, options.smoothingRadius ?? DEFAULT_SMOOTHING_RADIUS));
}
