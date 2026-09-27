import {
  applyComplexLowPass,
  shiftIqToBaseband,
  type LowPassState,
  type ShiftState,
} from "./demodulation";

/** Peak deviation of an FM broadcast carrier, used as the full-scale audio reference. */
const FM_BROADCAST_PEAK_DEVIATION_HZ = 75_000;

/** Algorithms available to the live demodulation pipeline. */
export type DemodAlgorithm =
  | "am"
  | "fm"
  | "fmDiscriminator"
  | "aptAudio"
  | "aptImage";

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

/** Builds an envelope detector for amplitude-modulated audio. */
function amProcessor(options: DemodProcessorOptions): DemodProcessor {
  const shiftState: ShiftState = { phase: 0 };
  const filterState: LowPassState = { prevI: 0, prevQ: 0 };
  const resampler = createStreamingResampler();
  let dcBias = 0;
  let lp1 = 0;
  let lp2 = 0;

  const reset = () => {
    shiftState.phase = 0;
    filterState.prevI = 0;
    filterState.prevQ = 0;
    dcBias = 0;
    lp1 = 0;
    lp2 = 0;
    resampler.reset();
  };

  return {
    reset,
    process(iqData, inputRate, frameCenterFrequencyHz) {
      const samples = Math.floor(iqData.length / 2);
      if (!samples || !Number.isFinite(inputRate) || inputRate <= 0) {
        return new Float32Array();
      }
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
        options.bandwidth ?? 25_000,
        filterState,
      );
      const audio = new Float32Array(samples);
      const audioCutoffHz = Math.min(12_000, options.targetSampleRate / 2.2);
      const alpha =
        1 /
        inputRate /
        (1 / (2 * Math.PI * audioCutoffHz) + 1 / inputRate);

      for (let i = 0; i < samples; i++) {
        const inPhase = filtered[i * 2];
        const quadrature = filtered[i * 2 + 1];
        const envelope = Math.hypot(inPhase, quadrature);
        dcBias += 0.0005 * (envelope - dcBias);
        const centered = envelope - dcBias;
        lp1 += alpha * (centered - lp1);
        lp2 += alpha * (lp1 - lp2);
        audio[i] = Math.max(-1, Math.min(1, lp2 * 4));
      }

      return resampler.process(audio, inputRate, options.targetSampleRate);
    },
  };
}

/**
 * Extracts the live APT-style amplitude envelope from one selected RF channel.
 *
 * The returned samples are the subcarrier's amplitude over time. Their levels,
 * including peaks and valleys, remain intact across frames; this does not
 * assemble image lines or apply per-frame peak normalization.
 */
function imageProcessor(options: DemodProcessorOptions): DemodProcessor {
  const shiftState: ShiftState = { phase: 0 };
  const rfFilterState: LowPassState = { prevI: 0, prevQ: 0 };
  const subcarrierFilterState: LowPassState = { prevI: 0, prevQ: 0 };
  const resampler = createStreamingResampler();
  let previousI = 0;
  let previousQ = 0;
  let hasPreviousIq = false;
  let subcarrierPhase = 0;
  let inputRateHz = 0;
  let subcarrierStepCos = 1;
  let subcarrierStepSin = 0;

  const reset = () => {
    shiftState.phase = 0;
    rfFilterState.prevI = 0;
    rfFilterState.prevQ = 0;
    subcarrierFilterState.prevI = 0;
    subcarrierFilterState.prevQ = 0;
    resampler.reset();
    previousI = 0;
    previousQ = 0;
    hasPreviousIq = false;
    subcarrierPhase = 0;
    inputRateHz = 0;
    subcarrierStepCos = 1;
    subcarrierStepSin = 0;
  };

  return {
    reset,
    process(iqData, inputRate, frameCenterFrequencyHz) {
      const samples = Math.floor(iqData.length / 2);
      if (!samples || !Number.isFinite(inputRate) || inputRate <= 0) {
        return new Float32Array();
      }
      if (inputRateHz !== inputRate) {
        reset();
        inputRateHz = inputRate;
        const step = (2 * Math.PI * 2_400) / inputRate;
        subcarrierStepCos = Math.cos(step);
        subcarrierStepSin = Math.sin(step);
      }

      const selectedFrequencyHz =
        options.centerFrequency === undefined || options.centerFrequency === 0
          ? frameCenterFrequencyHz ?? options.centerFrequency ?? 0
          : options.centerFrequency;
      const frameCenterHz = frameCenterFrequencyHz ?? selectedFrequencyHz;
      const shifted = shiftIqToBaseband(
        iqData,
        inputRate,
        selectedFrequencyHz - frameCenterHz,
        shiftState,
      );
      const rfBandwidthHz = Math.max(
        2_000,
        Math.min(inputRate * 0.9, options.bandwidth ?? 200_000),
      );
      const filtered = applyComplexLowPass(
        shifted,
        inputRate,
        rfBandwidthHz,
        rfFilterState,
      );
      const subcarrierIq = new Float32Array(samples * 2);
      let oscillatorCos = Math.cos(subcarrierPhase);
      let oscillatorSin = Math.sin(subcarrierPhase);
      for (let i = 0; i < samples; i++) {
        const currentI = filtered[i * 2];
        const currentQ = filtered[i * 2 + 1];
        let phaseDelta = 0;
        if (hasPreviousIq) {
          phaseDelta = Math.atan2(
            currentQ * previousI - currentI * previousQ,
            currentI * previousI + currentQ * previousQ,
          );
        }
        previousI = currentI;
        previousQ = currentQ;
        hasPreviousIq = true;

        // Convert phase change back to frequency deviation, then quadrature
        // mix the APT subcarrier to baseband. The fixed deviation scale keeps
        // relative amplitude stable instead of renormalizing every frame.
        const deviation = (phaseDelta * inputRate) / (2 * Math.PI * 17_000);
        subcarrierIq[i * 2] = 2 * deviation * oscillatorCos;
        subcarrierIq[i * 2 + 1] = -2 * deviation * oscillatorSin;

        const nextCos =
          oscillatorCos * subcarrierStepCos -
          oscillatorSin * subcarrierStepSin;
        const nextSin =
          oscillatorSin * subcarrierStepCos +
          oscillatorCos * subcarrierStepSin;
        oscillatorCos = nextCos;
        oscillatorSin = nextSin;
        if ((i & 4095) === 4095) {
          const magnitude = Math.hypot(oscillatorCos, oscillatorSin) || 1;
          oscillatorCos /= magnitude;
          oscillatorSin /= magnitude;
        }
      }
      subcarrierPhase =
        (subcarrierPhase + (samples * 2 * Math.PI * 2_400) / inputRate) %
        (2 * Math.PI);

      const envelopeIq = applyComplexLowPass(
        subcarrierIq,
        inputRate,
        9_000,
        subcarrierFilterState,
      );
      const envelope = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        // Keep over-range peaks too; callers may clip for playback, but stored
        // samples retain the measured amplitude instead of flattening peaks.
        envelope[i] = Math.hypot(envelopeIq[i * 2], envelopeIq[i * 2 + 1]);
      }
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
    case "am":
      return amProcessor(options);
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
