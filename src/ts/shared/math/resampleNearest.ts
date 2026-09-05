export const resampleNearestInto = (
  input: ArrayLike<number>,
  targetLength: number,
  fallbackValue: number,
  output?: Float32Array,
): Float32Array => {
  const safeLength = Math.max(0, Math.floor(targetLength));
  const result =
    output && output.length === safeLength
      ? output
      : new Float32Array(safeLength);
  if (safeLength === 0) return result;

  const inputLength = input.length;
  if (inputLength === 0) {
    result.fill(fallbackValue);
    return result;
  }
  if (inputLength === safeLength) {
    for (let i = 0; i < safeLength; i++) {
      const value = input[i];
      result[i] = Number.isFinite(value) ? value : fallbackValue;
    }
    return result;
  }

  const inputMaxIndex = inputLength - 1;
  const outputMaxIndex = Math.max(1, safeLength - 1);
  const sourceScale = inputMaxIndex / outputMaxIndex;
  for (let i = 0; i < safeLength; i++) {
    const sourceIndex = Math.min(inputMaxIndex, Math.floor(i * sourceScale));
    const value = input[sourceIndex];
    result[i] = Number.isFinite(value) ? value : fallbackValue;
  }
  return result;
};
