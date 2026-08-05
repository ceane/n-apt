import { applyComplexLowPass, shiftIqToBaseband, type LowPassState, type ShiftState } from "./demodulation";

export type DemodAlgorithm = "fm" | "apt" | "napt";
export type DemodProcessorOptions = {
  targetSampleRate: number;
  centerFrequency?: number;
  bandwidth?: number;
};
export type DemodProcessor = {
  process(iqData: Uint8Array, sampleRateHz: number, frameCenterFrequencyHz?: number | null): Float32Array;
};

function resample(audio: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return audio;
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(audio.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const source = i * ratio;
    const index = Math.floor(source);
    const fraction = source - index;
    output[i] = index < audio.length - 1 ? audio[index] * (1 - fraction) + audio[index + 1] * fraction : audio[index] ?? 0;
  }
  return output;
}

function fmProcessor(options: DemodProcessorOptions): DemodProcessor {
  const shiftState: ShiftState = { phase: 0 };
  const filterState: LowPassState = { prevI: 0, prevQ: 0 };
  let previousI = 0, previousQ = 0, dcBias = 0, lp1 = 0, lp2 = 0, deemphasis = 0;
  return { process(iqData, inputRate, frameCenterFrequencyHz) {
    const samples = Math.floor(iqData.length / 2);
    if (!samples) return new Float32Array();
    const offsetHz = (options.centerFrequency ?? 0) - (frameCenterFrequencyHz ?? options.centerFrequency ?? 0);
    const shifted = shiftIqToBaseband(iqData, inputRate, offsetHz, shiftState);
    const filtered = applyComplexLowPass(shifted, inputRate, options.bandwidth ?? 200_000, filterState);
    const output = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const currentI = filtered[i * 2]; const currentQ = filtered[i * 2 + 1];
      if (i > 0) output[i] = Math.atan2(currentQ * previousI - currentI * previousQ, currentI * previousI + currentQ * previousQ);
      previousI = currentI; previousQ = currentQ;
    }
    for (let i = 0; i < samples; i++) {
      dcBias = 0.999 * dcBias + 0.001 * output[i]; output[i] -= dcBias;
      const alpha = (1 / inputRate) / (1 / (2 * Math.PI * 15500) + 1 / inputRate);
      lp1 += alpha * (output[i] - lp1); lp2 += alpha * (lp1 - lp2); output[i] = lp2;
      const deAlpha = Math.exp(-1 / (75e-6 * inputRate)); deemphasis = (1 - deAlpha) * output[i] + deAlpha * deemphasis; output[i] = Math.max(-1.1, Math.min(1.1, (deemphasis / Math.PI) * 2.5));
    }
    return resample(output, inputRate, options.targetSampleRate);
  } };
}

function imageProcessor(options: DemodProcessorOptions): DemodProcessor {
  let shiftState: ShiftState = { phase: 0 };
  let filterState: LowPassState = { prevI: 0, prevQ: 0 };
  return { process(iqData, inputRate) {
    const samples = Math.floor(iqData.length / 2);
    const shifted = shiftIqToBaseband(iqData, inputRate, 0, shiftState);
    const filtered = applyComplexLowPass(shifted, inputRate, 200_000, filterState);
    const fm = new Float32Array(samples);
    let previousI = 0, previousQ = 0;
    for (let i = 0; i < samples; i++) { const currentI = filtered[i * 2]; const currentQ = filtered[i * 2 + 1]; if (i) fm[i] = Math.atan2(currentQ * previousI - currentI * previousQ, currentI * previousI + currentQ * previousQ); previousI = currentI; previousQ = currentQ; }
    const envelope = new Float32Array(samples); const phi = 2 * Math.PI * 2400 / inputRate; const cosPhi = Math.cos(phi); const sinPhi = Math.sin(phi);
    for (let i = 1; i < samples; i++) envelope[i] = Math.sqrt(Math.max(0, fm[i] * fm[i] + fm[i - 1] * fm[i - 1] - 2 * fm[i] * fm[i - 1] * cosPhi)) / sinPhi;
    if (samples > 1) envelope[0] = envelope[1];
    let peak = 0; for (const value of envelope) peak = Math.max(peak, value); if (peak) for (let i = 0; i < envelope.length; i++) envelope[i] /= peak;
    return resample(envelope, inputRate, options.targetSampleRate);
  } };
}

export function createDemodProcessor(algorithm: DemodAlgorithm, options: DemodProcessorOptions): DemodProcessor {
  if (algorithm === "fm") return fmProcessor(options);
  if (algorithm === "apt" || algorithm === "napt") return imageProcessor(options);
  throw new Error(`Unsupported demodulation algorithm: ${algorithm}`);
}
