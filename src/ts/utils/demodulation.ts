export const shiftIqToBaseband = (
  iqData: Uint8Array,
  sampleRateHz: number,
  frequencyOffsetHz: number,
): Float32Array => {
  const samples = Math.floor(iqData.length / 2);
  const shifted = new Float32Array(samples * 2);

  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    return shifted;
  }

  const angularStep = (-2 * Math.PI * frequencyOffsetHz) / sampleRateHz;

  for (let j = 0; j < samples; j++) {
    const phase = angularStep * j;
    const cos = Math.cos(phase);
    const sin = Math.sin(phase);
    const i = (iqData[j * 2] - 128) / 128;
    const q = (iqData[j * 2 + 1] - 128) / 128;

    shifted[j * 2] = i * cos - q * sin;
    shifted[j * 2 + 1] = i * sin + q * cos;
  }

  return shifted;
};

export const computeFrequencyOffsetHz = (
  selectedFrequencyHz: number | null | undefined,
  frameCenterFrequencyHz: number | null | undefined,
): number => {
  if (!Number.isFinite(selectedFrequencyHz ?? NaN)) return 0;
  if (!Number.isFinite(frameCenterFrequencyHz ?? NaN)) return 0;
  return (selectedFrequencyHz as number) - (frameCenterFrequencyHz as number);
};
