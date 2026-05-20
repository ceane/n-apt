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
