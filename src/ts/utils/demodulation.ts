export interface ShiftState {
  phase: number;
}

export const shiftIqToBaseband = (
  iqData: Uint8Array,
  sampleRateHz: number,
  frequencyOffsetHz: number,
  state: ShiftState = { phase: 0 },
): Float32Array => {
  const samples = Math.floor(iqData.length / 2);
  const shifted = new Float32Array(samples * 2);

  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    return shifted;
  }

  const angularStep = (-2 * Math.PI * frequencyOffsetHz) / sampleRateHz;

  for (let j = 0; j < samples; j++) {
    const cos = Math.cos(state.phase);
    const sin = Math.sin(state.phase);
    const i = (iqData[j * 2] - 128) / 128;
    const q = (iqData[j * 2 + 1] - 128) / 128;

    shifted[j * 2] = i * cos - q * sin;
    shifted[j * 2 + 1] = i * sin + q * cos;

    state.phase += angularStep;
  }

  // Keep phase in [-PI, PI] to prevent precision issues over long runs
  state.phase = ((state.phase + Math.PI) % (2 * Math.PI)) - Math.PI;

  return shifted;
};

export interface LowPassState {
  prevI: number;
  prevQ: number;
}

export const applyComplexLowPass = (
  iqData: Float32Array,
  sampleRateHz: number,
  bandwidthHz: number,
  state: LowPassState = { prevI: 0, prevQ: 0 },
): Float32Array => {
  const samples = Math.floor(iqData.length / 2);
  const filtered = new Float32Array(iqData.length);

  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    filtered.set(iqData);
    return filtered;
  }

  const cutoffHz = Math.max(0, bandwidthHz) / 2;
  const rc =
    cutoffHz > 0 ? 1 / (2 * Math.PI * cutoffHz) : Number.POSITIVE_INFINITY;
  const dt = 1 / sampleRateHz;
  const alpha = rc === Number.POSITIVE_INFINITY ? 0 : dt / (rc + dt);

  for (let j = 0; j < samples; j++) {
    const i = iqData[j * 2];
    const q = iqData[j * 2 + 1];
    state.prevI = state.prevI + alpha * (i - state.prevI);
    state.prevQ = state.prevQ + alpha * (q - state.prevQ);
    filtered[j * 2] = state.prevI;
    filtered[j * 2 + 1] = state.prevQ;
  }

  return filtered;
};

export const computeFrequencyOffsetHz = (
  selectedFrequencyHz: number | null | undefined,
  frameCenterFrequencyHz: number | null | undefined,
): number => {
  if (!Number.isFinite(selectedFrequencyHz ?? NaN)) return 0;
  if (!Number.isFinite(frameCenterFrequencyHz ?? NaN)) return 0;
  return (selectedFrequencyHz as number) - (frameCenterFrequencyHz as number);
};
