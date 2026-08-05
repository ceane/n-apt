import {
  applyComplexLowPass,
  shiftIqToBaseband,
  type LowPassState,
  type ShiftState,
} from "./demodulation";

export type DemodAlgorithm = "fm" | "apt" | "napt";
export type DemodProcessorOptions = {
  targetSampleRate: number;
  centerFrequency?: number;
  bandwidth?: number;
};
export type DemodProcessor = {
  process(
    iqData: Uint8Array,
    sampleRateHz: number,
    frameCenterFrequencyHz?: number | null,
  ): Float32Array;
  reset: () => void;
};

type StreamingResampler = {
  process: (
    audio: Float32Array,
    fromRate: number,
    toRate: number,
  ) => Float32Array;
  reset: () => void;
};

function createStreamingResampler(): StreamingResampler {
  // The position is relative to the current input chunk. Keeping it across
  // chunks prevents the interpolation phase from restarting at zero for every
  // IQ frame.
  let sourcePosition = 0;
  let previousFromRate = 0;
  let previousToRate = 0;

  const reset = () => {
    sourcePosition = 0;
    previousFromRate = 0;
    previousToRate = 0;
  };

  return {
    reset,
    process(audio, fromRate, toRate) {
      if (
        audio.length === 0 ||
        !Number.isFinite(fromRate) ||
        fromRate <= 0 ||
        !Number.isFinite(toRate) ||
        toRate <= 0
      ) {
        return new Float32Array();
      }
      if (fromRate === toRate) {
        reset();
        return audio;
      }
      if (fromRate !== previousFromRate || toRate !== previousToRate) {
        sourcePosition = 0;
        previousFromRate = fromRate;
        previousToRate = toRate;
      }

      const ratio = fromRate / toRate;
      const output: number[] = [];
      while (sourcePosition < audio.length - 1) {
        const index = Math.floor(sourcePosition);
        const fraction = sourcePosition - index;
        output.push(
          audio[index] * (1 - fraction) + audio[index + 1] * fraction,
        );
        sourcePosition += ratio;
      }

      // Retain the unconsumed phase relative to the next chunk. The last
      // sample is intentionally left for the next chunk so interpolation can
      // span the frame boundary.
      sourcePosition -= audio.length;
      return new Float32Array(output);
    },
  };
}

function fmProcessor(options: DemodProcessorOptions): DemodProcessor {
  const shiftState: ShiftState = { phase: 0 };
  const filterState: LowPassState = { prevI: 0, prevQ: 0 };
  const resampler = createStreamingResampler();
  let previousI = 0,
    previousQ = 0,
    dcBias = 0,
    lp1 = 0,
    lp2 = 0,
    deemphasis = 0;
  const reset = () => {
    shiftState.phase = 0;
    filterState.prevI = 0;
    filterState.prevQ = 0;
    previousI = 0;
    previousQ = 0;
    dcBias = 0;
    lp1 = 0;
    lp2 = 0;
    deemphasis = 0;
    resampler.reset();
  };
  return {
    reset,
    process(iqData, inputRate, frameCenterFrequencyHz) {
      const samples = Math.floor(iqData.length / 2);
      if (!samples) return new Float32Array();
      const offsetHz =
        (options.centerFrequency ?? 0) -
        (frameCenterFrequencyHz ?? options.centerFrequency ?? 0);
      const shifted = shiftIqToBaseband(
        iqData,
        inputRate,
        offsetHz,
        shiftState,
      );
      const filtered = applyComplexLowPass(
        shifted,
        inputRate,
        options.bandwidth ?? 200_000,
        filterState,
      );
      const output = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        const currentI = filtered[i * 2];
        const currentQ = filtered[i * 2 + 1];
        if (i > 0)
          output[i] = Math.atan2(
            currentQ * previousI - currentI * previousQ,
            currentI * previousI + currentQ * previousQ,
          );
        previousI = currentI;
        previousQ = currentQ;
      }
      for (let i = 0; i < samples; i++) {
        dcBias = 0.999 * dcBias + 0.001 * output[i];
        output[i] -= dcBias;
        const alpha =
          1 / inputRate / (1 / (2 * Math.PI * 15500) + 1 / inputRate);
        lp1 += alpha * (output[i] - lp1);
        lp2 += alpha * (lp1 - lp2);
        output[i] = lp2;
        const deAlpha = Math.exp(-1 / (75e-6 * inputRate));
        deemphasis = (1 - deAlpha) * output[i] + deAlpha * deemphasis;
        output[i] = Math.max(-1.1, Math.min(1.1, (deemphasis / Math.PI) * 2.5));
      }
      return resampler.process(output, inputRate, options.targetSampleRate);
    },
  };
}

function imageProcessor(options: DemodProcessorOptions): DemodProcessor {
  let shiftState: ShiftState = { phase: 0 };
  let filterState: LowPassState = { prevI: 0, prevQ: 0 };
  const resampler = createStreamingResampler();
  const reset = () => {
    shiftState.phase = 0;
    filterState.prevI = 0;
    filterState.prevQ = 0;
    resampler.reset();
  };
  return {
    reset,
    process(iqData, inputRate) {
      const samples = Math.floor(iqData.length / 2);
      const shifted = shiftIqToBaseband(iqData, inputRate, 0, shiftState);
      const filtered = applyComplexLowPass(
        shifted,
        inputRate,
        200_000,
        filterState,
      );
      const fm = new Float32Array(samples);
      let previousI = 0,
        previousQ = 0;
      for (let i = 0; i < samples; i++) {
        const currentI = filtered[i * 2];
        const currentQ = filtered[i * 2 + 1];
        if (i)
          fm[i] = Math.atan2(
            currentQ * previousI - currentI * previousQ,
            currentI * previousI + currentQ * previousQ,
          );
        previousI = currentI;
        previousQ = currentQ;
      }
      const envelope = new Float32Array(samples);
      const phi = (2 * Math.PI * 2400) / inputRate;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      for (let i = 1; i < samples; i++)
        envelope[i] =
          Math.sqrt(
            Math.max(
              0,
              fm[i] * fm[i] +
                fm[i - 1] * fm[i - 1] -
                2 * fm[i] * fm[i - 1] * cosPhi,
            ),
          ) / sinPhi;
      if (samples > 1) envelope[0] = envelope[1];
      let peak = 0;
      for (const value of envelope) peak = Math.max(peak, value);
      if (peak) for (let i = 0; i < envelope.length; i++) envelope[i] /= peak;
      return resampler.process(envelope, inputRate, options.targetSampleRate);
    },
  };
}

export function createDemodProcessor(
  algorithm: DemodAlgorithm,
  options: DemodProcessorOptions,
): DemodProcessor {
  if (algorithm === "fm") return fmProcessor(options);
  if (algorithm === "apt" || algorithm === "napt")
    return imageProcessor(options);
  throw new Error(`Unsupported demodulation algorithm: ${algorithm}`);
}
