import { DEMOD_MIN_FFT_SIZE } from "./demodQuality";

export type DemodAlgorithm = "fm" | "apt" | "napt";
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

export function runDemodulationAlgorithm(algorithm: string, iq: Uint8Array): Uint8Array {
  switch (algorithm) {
    // The harness owns selection and artifact provenance; DSP implementations
    // can be added behind this stable dispatch boundary.
    case "fm":
    case "apt":
    case "napt":
      return iq.slice();
    default:
      throw new Error(`Unsupported demodulation algorithm: ${algorithm}`);
  }
}
