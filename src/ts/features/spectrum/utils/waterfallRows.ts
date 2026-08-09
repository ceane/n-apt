export const DEFAULT_WATERFALL_FLOOR_DB = -200;

export const peakResampleWaterfallRow = (
  source: ArrayLike<number>,
  target: Float32Array,
  floorDb = DEFAULT_WATERFALL_FLOOR_DB,
): Float32Array => {
  const sourceLength = source.length;
  const targetLength = target.length;

  if (targetLength <= 0) {
    return target;
  }

  if (sourceLength <= 0) {
    target.fill(floorDb);
    return target;
  }

  const ratio = sourceLength / targetLength;
  for (let i = 0; i < targetLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let maxVal = floorDb;
    const exclusiveEnd = Math.max(end, start + 1);
    for (let j = start; j < exclusiveEnd; j++) {
      const val = source[j] ?? floorDb;
      if (Number.isFinite(val) && val > maxVal) {
        maxVal = val;
      }
    }
    target[i] = maxVal;
  }

  return target;
};

export const copyValidWaterfallRow = (
  source: Float32Array,
  target: Float32Array,
  fallback?: Float32Array | null,
  floorDb = DEFAULT_WATERFALL_FLOOR_DB,
): Float32Array => {
  if (source.length === target.length) {
    let validCount = 0;
    for (let i = 0; i < source.length; i++) {
      if (Number.isFinite(source[i])) {
        validCount++;
      }
    }

    if (validCount > 0) {
      for (let i = 0; i < source.length; i++) {
        const value = source[i];
        target[i] = Number.isFinite(value) ? value : floorDb;
      }
      return target;
    }
  }

  if (fallback?.length === target.length) {
    target.set(fallback);
  } else {
    target.fill(floorDb);
  }

  return target;
};

const smootherStep = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const sampleShiftedRow = (
  row: Float32Array,
  index: number,
  fallbackDb: number,
) => {
  if (index < 0 || index > row.length - 1) {
    return fallbackDb;
  }

  if (index >= row.length - 1) {
    const edgeValue = row[row.length - 1];
    return Number.isFinite(edgeValue) ? edgeValue : fallbackDb;
  }

  const lowerIndex = Math.floor(index);
  const upperIndex = lowerIndex + 1;
  const fraction = index - lowerIndex;
  const lower = row[lowerIndex];
  const upper = row[upperIndex];
  const safeLower = Number.isFinite(lower) ? lower : fallbackDb;
  const safeUpper = Number.isFinite(upper) ? upper : safeLower;

  return safeLower + (safeUpper - safeLower) * fraction;
};

export const synthesizeWaterfallTransitionRow = ({
  previous,
  current,
  target,
  driftBins,
  progress,
  floorDb = DEFAULT_WATERFALL_FLOOR_DB,
}: {
  previous: Float32Array;
  current: Float32Array;
  target: Float32Array;
  driftBins: number;
  progress: number;
  floorDb?: number;
}): Float32Array => {
  if (
    previous.length !== current.length ||
    target.length !== current.length ||
    current.length === 0
  ) {
    return copyValidWaterfallRow(current, target, previous, floorDb);
  }

  const blend = smootherStep(progress);
  const shift = driftBins * progress;

  for (let i = 0; i < target.length; i++) {
    const currentValue = Number.isFinite(current[i]) ? current[i] : floorDb;
    const previousValue = sampleShiftedRow(previous, i + shift, currentValue);
    target[i] = previousValue + (currentValue - previousValue) * blend;
  }

  return target;
};
