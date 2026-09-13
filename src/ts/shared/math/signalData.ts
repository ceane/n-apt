export const BYTES_PER_IQ_SAMPLE = {
  u8: 2,
  u16: 4,
} as const;

export const nextPowerOfTwo = (value: number): number =>
  2 ** Math.ceil(Math.log2(value));

export const getIfftSizeForTargetHz = (
  sampleRateHz: number,
  targetHz: number,
): number => nextPowerOfTwo(sampleRateHz / targetHz);

export const getRawIfftModel = (
  sampleRateHz: number,
  targetHz: number,
  bytesPerIqBin: number,
) => {
  const fftSize = getIfftSizeForTargetHz(sampleRateHz, targetHz);
  const frameBytes = fftSize * bytesPerIqBin;
  const framesPerSecond = sampleRateHz / fftSize;

  return {
    fftSize,
    frameBytes,
    framesPerSecond,
    rateBytesPerSecond: frameBytes * framesPerSecond,
  };
};
