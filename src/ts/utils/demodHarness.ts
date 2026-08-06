import { DEMOD_MIN_FFT_SIZE } from "./demodQuality";
import { createDemodProcessor } from "./demodProcessors";

export type DemodAlgorithm = "fm" | "aptAudio" | "aptImage";
export type DemodHarnessInput = {
  centerFrequencyHz: number;
  frequencyRangeHz: [number, number];
  sampleRateHz: number;
  algorithm: DemodAlgorithm;
  targetFps?: number;
  fftSize?: number;
};
export type DemodPlan = DemodHarnessInput & {
  fftSize: number;
  temporalResolution: "lossless";
  bandwidthHz: number;
  trailer: { processing: { operation: "demodulate"; algorithm: DemodAlgorithm; parameters: Record<string, unknown> } };
};

function nextPowerOfTwo(value: number): number {
  let n = 1;
  while (n < value) n *= 2;
  return n;
}

export function prepareDemodulation(input: DemodHarnessInput): DemodPlan {
  if (!Number.isFinite(input.centerFrequencyHz) || input.frequencyRangeHz[1] <= input.frequencyRangeHz[0]) throw new Error("invalid demod frequency area");
  const targetFps = input.targetFps ?? 60;
  const fftSize = Math.max(DEMOD_MIN_FFT_SIZE, nextPowerOfTwo(input.fftSize ?? input.sampleRateHz / targetFps));
  return {
    ...input,
    fftSize,
    temporalResolution: "lossless",
    bandwidthHz: input.frequencyRangeHz[1] - input.frequencyRangeHz[0],
    trailer: { processing: { operation: "demodulate", algorithm: input.algorithm, parameters: { targetFps } } },
  };
}

export function runDemodulationAlgorithm(
  algorithm: string,
  iq: Uint8Array,
  options: { sampleRateHz?: number; targetSampleRate?: number; centerFrequencyHz?: number; bandwidthHz?: number } = {},
): Float32Array {
  if (
    algorithm !== "fm" &&
    algorithm !== "aptAudio" &&
    algorithm !== "aptImage"
  ) {
    throw new Error(`Unsupported demodulation algorithm: ${algorithm}`);
  }
  return createDemodProcessor(algorithm, {
    targetSampleRate: options.targetSampleRate ?? 48_000,
    centerFrequency: options.centerFrequencyHz,
    bandwidth: options.bandwidthHz,
  }).process(iq, options.sampleRateHz ?? 2_400_000, options.centerFrequencyHz);
}
