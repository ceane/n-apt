import {
  applyComplexLowPass,
  shiftIqToBaseband,
  type LowPassState,
  type ShiftState,
} from "./demodulation";

/** Peak deviation of an FM broadcast carrier, used as the full-scale audio reference. */
const FM_BROADCAST_PEAK_DEVIATION_HZ = 75_000;

/** Algorithms available to the live demodulation pipeline. */
export type DemodAlgorithm = "fm" | "fmDiscriminator" | "aptAudio" | "aptImage";

/** Configuration shared by the streaming demodulator implementations. */
export type DemodProcessorOptions = {
  targetSampleRate: number;
  centerFrequency?: number;
  bandwidth?: number;
};
/** Stateful processor that converts raw I/Q frames into target-rate samples. */
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

/**
 * Creates a linear resampler whose interpolation phase and tail sample survive
 * across frames, preventing repeated frame-start clicks or timing drift.
 */
function createStreamingResampler(): StreamingResampler {
  // The position is relative to the current input chunk. Keeping it across
  // chunks prevents the interpolation phase from restarting at zero for every
  // IQ frame. It can be negative, in which case the interpolation window
  // straddles the frame boundary and reads `previousTail`.
  let sourcePosition = 0;
  let previousTail = 0;
  let hasPreviousTail = false;
  let previousFromRate = 0;
  let previousToRate = 0;

  const reset = () => {
    sourcePosition = 0;
    previousTail = 0;
    hasPreviousTail = false;
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
        hasPreviousTail = false;
        previousFromRate = fromRate;
        previousToRate = toRate;
      }

      const ratio = fromRate / toRate;
      // Index -1 is the retained last sample of the previous chunk, so a
      // carried-over negative position still interpolates across real data.
      const sampleAt = (index: number) => {
        if (index < 0) return hasPreviousTail ? previousTail : audio[0];
        return audio[index];
      };

      const output: number[] = [];
      while (sourcePosition < audio.length - 1) {
        const index = Math.floor(sourcePosition);
        const fraction = sourcePosition - index;
        output.push(
          sampleAt(index) * (1 - fraction) + sampleAt(index + 1) * fraction,
        );
        sourcePosition += ratio;
      }

      // Retain the unconsumed phase relative to the next chunk. The last
      // sample is intentionally left for the next chunk so interpolation can
      // span the frame boundary.
      sourcePosition -= audio.length;
      previousTail = audio[audio.length - 1];
      hasPreviousTail = true;
      return new Float32Array(output);
    },
  };
}

/**
 * Builds the FM broadcast processor: tune, channel-filter, discriminate phase,
 * remove DC, low-pass audio, de-emphasize, normalize deviation, and resample.
 */
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
      const alpha = 1 / inputRate / (1 / (2 * Math.PI * 15500) + 1 / inputRate);
      const deAlpha = Math.exp(-1 / (75e-6 * inputRate));
      // The discriminator emits radians of phase change per sample, so its
      // amplitude shrinks as the IQ rate rises. Convert to deviation in Hz
      // before normalizing, otherwise the level depends on the SDR's sample
      // rate and a 3.2 MS/s stream plays ~19 dB quieter than a 256 kS/s one.
      const fullScalePerRadian =
        inputRate / (2 * Math.PI * FM_BROADCAST_PEAK_DEVIATION_HZ);
      for (let i = 0; i < samples; i++) {
        dcBias = 0.999 * dcBias + 0.001 * output[i];
        output[i] -= dcBias;
        lp1 += alpha * (output[i] - lp1);
        lp2 += alpha * (lp1 - lp2);
        output[i] = lp2;
        deemphasis = (1 - deAlpha) * output[i] + deAlpha * deemphasis;
        output[i] = Math.max(
          -1,
          Math.min(1, deemphasis * fullScalePerRadian),
        );
      }
      return resampler.process(output, inputRate, options.targetSampleRate);
    },
  };
}

/**
 * Builds a discriminator-only probe: tune, channel-filter, phase-discriminate,
 * remove DC, light audio LPF, clamp. No WFM de-emphasis or 75 kHz broadcast
 * full-scale normalization — intended for N-APT valley listening experiments.
 */
function fmDiscriminatorProcessor(options: DemodProcessorOptions): DemodProcessor {
  const shiftState: ShiftState = { phase: 0 };
  const filterState: LowPassState = { prevI: 0, prevQ: 0 };
  const resampler = createStreamingResampler();
  let previousI = 0;
  let previousQ = 0;
  let dcBias = 0;
  let lp1 = 0;
  let lp2 = 0;

  const reset = () => {
    shiftState.phase = 0;
    filterState.prevI = 0;
    filterState.prevQ = 0;
    previousI = 0;
    previousQ = 0;
    dcBias = 0;
    lp1 = 0;
    lp2 = 0;
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
        if (i > 0) {
          output[i] = Math.atan2(
            currentQ * previousI - currentI * previousQ,
            currentI * previousI + currentQ * previousQ,
          );
        }
        previousI = currentI;
        previousQ = currentQ;
      }
      // ~15 kHz audio LPF without broadcast de-emphasis or deviation scaling.
      const alpha = 1 / inputRate / (1 / (2 * Math.PI * 15500) + 1 / inputRate);
      for (let i = 0; i < samples; i++) {
        dcBias = 0.999 * dcBias + 0.001 * output[i];
        output[i] -= dcBias;
        lp1 += alpha * (output[i] - lp1);
        lp2 += alpha * (lp1 - lp2);
        output[i] = Math.max(-1, Math.min(1, lp2));
      }
      return resampler.process(output, inputRate, options.targetSampleRate);
    },
  };
}

/**
 * Builds the APT processor shared by APTAudio and APTImage.
 *
 * Both variants first FM-demodulate the 2.4 kHz APT subcarrier and apply the
 * discrete envelope detector. APTAudio additionally feeds the result through
 * NAPT-specific detection in its hook; APTImage is the traditional image path.
 */
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

/** Creates the requested stateful FM or APT-family processor. */
export function createDemodProcessor(
  algorithm: DemodAlgorithm,
  options: DemodProcessorOptions,
): DemodProcessor {
  switch (algorithm) {
    case "fm":
      return fmProcessor(options);
    case "fmDiscriminator":
      return fmDiscriminatorProcessor(options);
    case "aptAudio":
    case "aptImage":
      return imageProcessor(options);
    default: {
      const _exhaustive: never = algorithm;
      throw new Error(`Unsupported demodulation algorithm: ${_exhaustive}`);
    }
  }
}
