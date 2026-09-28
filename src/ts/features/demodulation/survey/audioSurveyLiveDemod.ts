import {
  createAudioSurveyChannelizer,
  getAudioSurveyChannelizedSampleRateHz,
} from "@n-apt/demodulation/survey/audioSurveyDsp";
import {
  TimeDomainDemodStream,
  type TimeDomainDemodModel,
} from "@n-apt/demodulation/survey/audioSurveyMl";
import type { AudioSurveyTrainingState } from "@n-apt/demodulation/survey/audioSurveyTraining";

export interface AudioSurveyNeuralFrameIdentity {
  sourceId?: string;
  streamEpoch?: number;
  sequence?: number;
  optionsRevision?: number;
  centerFrequencyHz: number | null;
  sampleRateHz: number;
}

export interface AudioSurveyNeuralLiveProfile {
  inputSampleRateHz: number;
  channelBandwidthHz: number;
}

const matchesProfileValue = (trained: number, requested: number) =>
  Number.isFinite(trained) &&
  Number.isFinite(requested) &&
  Math.abs(trained - requested) <= Math.max(1, Math.abs(requested) * 0.005);

export const shouldResetAudioSurveyNeuralStream = (
  previous: AudioSurveyNeuralFrameIdentity | null,
  next: AudioSurveyNeuralFrameIdentity,
): boolean => {
  if (!previous) return true;
  return (
    previous.sourceId !== next.sourceId ||
    previous.streamEpoch !== next.streamEpoch ||
    previous.optionsRevision !== next.optionsRevision ||
    previous.centerFrequencyHz !== next.centerFrequencyHz ||
    previous.sampleRateHz !== next.sampleRateHz ||
    (previous.sequence === undefined) !== (next.sequence === undefined) ||
    (previous.sequence !== undefined &&
      next.sequence !== undefined &&
      next.sequence !== previous.sequence + 1)
  );
};

export const isAudioSurveyNeuralModelReady = (
  model: TimeDomainDemodModel | null | undefined,
  training: Pick<AudioSurveyTrainingState, "status" | "modelPreferred"> | null,
  liveProfile?: AudioSurveyNeuralLiveProfile,
): model is TimeDomainDemodModel =>
  training?.status === "completed" &&
  training.modelPreferred === true &&
  model?.version === 3 &&
  model.inputSize === 128 &&
  model.hiddenSize === 12 &&
  Number.isFinite(model.inputSampleRateHz) &&
  model.inputSampleRateHz > 0 &&
  Number.isFinite(model.channelBandwidthHz) &&
  (model.channelBandwidthHz ?? 0) > 0 &&
  model.inputWeights.length === 128 * 12 &&
  model.hiddenBias.length === 12 &&
  model.outputWeights.length === 12 &&
  Number.isFinite(model.outputBias) &&
  (!liveProfile ||
    (matchesProfileValue(
      model.channelBandwidthHz!,
      liveProfile.channelBandwidthHz,
    ) &&
      matchesProfileValue(
        model.inputSampleRateHz,
        getAudioSurveyChannelizedSampleRateHz(
          liveProfile.inputSampleRateHz,
          liveProfile.channelBandwidthHz,
        ),
      )));

export interface AudioSurveyNeuralDemodulator {
  /** Channelize raw receiver I/Q and decode the resulting narrowband stream. */
  process(
    iqData: Uint8Array,
    inputSampleRateHz: number,
    frameCenterFrequencyHz?: number | null,
  ): Float32Array;
  /** Clear filter and temporal state at a retune or receive discontinuity. */
  reset(): void;
}

/** Compose the training-time channelizer with the incremental waveform model. */
export const createAudioSurveyNeuralDemodulator = ({
  model,
  centerFrequencyHz,
  bandwidthHz,
}: {
  model: TimeDomainDemodModel;
  centerFrequencyHz: number;
  bandwidthHz: number;
}): AudioSurveyNeuralDemodulator => {
  if (
    !Number.isFinite(centerFrequencyHz) ||
    !Number.isFinite(bandwidthHz) ||
    bandwidthHz <= 0
  ) {
    throw new Error("Neural demodulation requires a valid RF center and width");
  }

  const channelizer = createAudioSurveyChannelizer({
    centerFrequencyHz,
    bandwidthHz,
  });
  let inputSampleRateHz = 0;
  let channelizedSampleRateHz = 0;
  let stream: TimeDomainDemodStream | null = null;

  const reset = () => {
    channelizer.reset();
    stream?.reset();
    stream = null;
    inputSampleRateHz = 0;
    channelizedSampleRateHz = 0;
  };

  return {
    reset,
    process(iqData, sampleRateHz, frameCenterFrequencyHz) {
      if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
        return new Float32Array();
      }
      if (iqData.length === 0) return new Float32Array();
      if (
        !matchesProfileValue(
          model.channelBandwidthHz ?? Number.NaN,
          bandwidthHz,
        ) ||
        !matchesProfileValue(
          model.inputSampleRateHz,
          getAudioSurveyChannelizedSampleRateHz(sampleRateHz, bandwidthHz),
        )
      ) {
        reset();
        return new Float32Array();
      }

      const frameCenterHz = frameCenterFrequencyHz ?? centerFrequencyHz;
      const channelized = channelizer.process(
        iqData,
        sampleRateHz,
        frameCenterHz,
      );
      if (channelized.iqData.length === 0 || channelized.sampleRateHz <= 0) {
        return new Float32Array();
      }
      if (
        !matchesProfileValue(
          model.inputSampleRateHz,
          channelized.sampleRateHz,
        )
      ) {
        reset();
        return new Float32Array();
      }

      if (
        !stream ||
        inputSampleRateHz !== sampleRateHz ||
        channelizedSampleRateHz !== channelized.sampleRateHz
      ) {
        stream?.reset();
        inputSampleRateHz = sampleRateHz;
        channelizedSampleRateHz = channelized.sampleRateHz;
        stream = new TimeDomainDemodStream(model, {
          inputSampleRateHz: channelized.sampleRateHz,
          pcmSampleRateHz: model.pcmSampleRateHz,
        });
      }

      return stream.processIqChunk(channelized.iqData);
    },
  };
};
