import { createDemodProcessor } from "@n-apt/demodulation/utils/demodProcessors";
import {
  createAudioSurveyChannelizer,
} from "@n-apt/demodulation/survey/audioSurveyDsp";
import {
  buildAudioSurveyViews,
  AUDIO_SURVEY_SAMPLE_RATE_HZ,
  type SurveyChannelRange,
} from "@n-apt/demodulation/survey/audioSurveyModel";
import {
  estimateAudioSurveyArtifactBytes,
  type AudioSurveyArtifact,
  type AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import type {
  AudioSurveyFrameSource,
  SurveyIqFrame,
} from "@n-apt/demodulation/survey/audioSurveyRunner";

export interface AudioSurveyStimulusReference {
  jobId: string;
  captureId: string;
  pcmData: Float32Array;
  pcmSampleRateHz: number;
  startedAtMs: number;
  centerFrequencyHz: number;
  bandwidthHz: number;
  channelId: string;
  baselineAlgorithm: "am" | "fm";
  storageCapBytes: number;
}

const concatBytes = (chunks: readonly Uint8Array[]) => {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const concatFloats = (chunks: readonly Float32Array[]) => {
  const output = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

/** Capture narrowband I/Q during stimulus playback and align its time span to PCM. */
export const captureAudioSurveyStimulusPair = async (
  input: AudioSurveyStimulusReference,
  options: {
    source: AudioSurveyFrameSource;
    channels: readonly SurveyChannelRange[];
    repository: AudioSurveyRepository;
    now?: () => number;
    maximumWaitMs?: number;
  },
): Promise<AudioSurveyArtifact | null> => {
  const channel = options.channels.find((item) => item.id === input.channelId);
  if (!channel) throw new Error(`Configured channel ${input.channelId} is unavailable`);
  if (
    input.pcmData.length < 8 ||
    !Number.isFinite(input.pcmSampleRateHz) ||
    input.pcmSampleRateHz <= 0 ||
    !Number.isFinite(input.centerFrequencyHz) ||
    !Number.isFinite(input.bandwidthHz) ||
    input.bandwidthHz <= 0
  ) {
    throw new Error("Stimulus reference audio or selected RF channel is invalid");
  }

  const surveyView = buildAudioSurveyViews(options.channels).find(
    (view) =>
      view.channelId === channel.id &&
      input.centerFrequencyHz >= view.minHz &&
      input.centerFrequencyHz <= view.maxHz,
  );
  if (!surveyView) {
    throw new Error("Selected demodulation frequency is outside the A/B survey views");
  }
  await options.source.tune?.(surveyView);

  const channelizer = createAudioSurveyChannelizer({
    centerFrequencyHz: input.centerFrequencyHz,
    bandwidthHz: input.bandwidthHz,
  });
  const baselines = {
    am: createDemodProcessor("am", {
      targetSampleRate: input.pcmSampleRateHz,
      centerFrequency: input.centerFrequencyHz,
      bandwidth: input.bandwidthHz,
    }),
    fm: createDemodProcessor("fm", {
      targetSampleRate: input.pcmSampleRateHz,
      centerFrequency: input.centerFrequencyHz,
      bandwidth: input.bandwidthHz,
    }),
  };
  const referenceEndMs =
    input.startedAtMs + (input.pcmData.length / input.pcmSampleRateHz) * 1_000;
  const byteChunks: Uint8Array[] = [];
  const baselineChunks: Record<"am" | "fm", Float32Array[]> = {
    am: [],
    fm: [],
  };
  let firstIqSampleAtMs: number | null = null;
  let lastIqSampleAtMs: number | null = null;
  let cursor: string | null = null;
  let lastFrameEndMs: number | null = null;
  let inputSampleRateHz = 0;
  let frame: SurveyIqFrame | null = null;
  let requests = 0;
  const now = options.now ?? Date.now;
  const waitLimit = Math.max(1_000, options.maximumWaitMs ?? 12_000);
  const startedWaitingAt = now();

  while (
    requests < 256 &&
    now() - startedWaitingAt < waitLimit &&
    (lastIqSampleAtMs === null || lastIqSampleAtMs < referenceEndMs)
  ) {
    requests++;
    frame = await options.source.nextFrame(cursor, 750, surveyView);
    if (!frame) break;
    if (frame.frameKey === cursor) continue;
    cursor = frame.frameKey;
    const complexSamples = Math.floor(frame.iqData.length / 2);
    const frameStartMs = frame.timestampMs;
    const frameEndMs = frameStartMs + (complexSamples / frame.sampleRateHz) * 1_000;
    if (
      complexSamples < 2 ||
      !Number.isFinite(frameStartMs) ||
      !Number.isFinite(frame.sampleRateHz) ||
      frame.sampleRateHz <= 0 ||
      frameEndMs <= input.startedAtMs ||
      frameStartMs >= referenceEndMs
    ) {
      continue;
    }
    if (
      Math.abs(frame.sampleRateHz - AUDIO_SURVEY_SAMPLE_RATE_HZ) >
      AUDIO_SURVEY_SAMPLE_RATE_HZ * 0.005
    ) {
      throw new Error(
        `Stimulus pairing requires ${AUDIO_SURVEY_SAMPLE_RATE_HZ} samples/s; received ${frame.sampleRateHz}`,
      );
    }
    const actualStartMs = Math.max(frameStartMs, input.startedAtMs);
    const actualEndMs = Math.min(frameEndMs, referenceEndMs);
    if (lastFrameEndMs !== null && frameStartMs - lastFrameEndMs > 80) {
      throw new Error("I/Q frame gap exceeds the stimulus alignment tolerance");
    }

    const channelized = channelizer.process(
      frame.iqData,
      frame.sampleRateHz,
      frame.centerFrequencyHz,
    );
    const sampleCount = Math.floor(channelized.iqData.length / 2);
    const startIndex = Math.max(
      0,
      Math.min(
        sampleCount,
        Math.floor(((actualStartMs - frameStartMs) / 1_000) * channelized.sampleRateHz),
      ),
    );
    const endIndex = Math.max(
      startIndex,
      Math.min(
        sampleCount,
        Math.floor(((actualEndMs - frameStartMs) / 1_000) * channelized.sampleRateHz),
      ),
    );
    if (endIndex <= startIndex) continue;
    byteChunks.push(channelized.iqData.slice(startIndex * 2, endIndex * 2));
    for (const algorithm of ["am", "fm"] as const) {
      const baselinePcm = baselines[algorithm].process(
        frame.iqData,
        frame.sampleRateHz,
        frame.centerFrequencyHz,
      );
      if (baselinePcm.length > 0) baselineChunks[algorithm].push(baselinePcm);
    }
    if (firstIqSampleAtMs === null) {
      firstIqSampleAtMs = frameStartMs + (startIndex / channelized.sampleRateHz) * 1_000;
      inputSampleRateHz = channelized.sampleRateHz;
    }
    lastIqSampleAtMs = frameStartMs + (endIndex / channelized.sampleRateHz) * 1_000;
    lastFrameEndMs = frameEndMs;
  }

  if (firstIqSampleAtMs === null || lastIqSampleAtMs === null || inputSampleRateHz <= 0) {
    return null;
  }
  const alignedStartMs = Math.max(input.startedAtMs, firstIqSampleAtMs);
  const alignedEndMs = Math.min(referenceEndMs, lastIqSampleAtMs);
  const expectedDurationMs = referenceEndMs - input.startedAtMs;
  const alignedDurationMs = alignedEndMs - alignedStartMs;
  if (alignedDurationMs < expectedDurationMs * 0.8) return null;

  const pcmStart = Math.max(
    0,
    Math.min(input.pcmData.length, Math.floor(((alignedStartMs - input.startedAtMs) / 1_000) * input.pcmSampleRateHz)),
  );
  const pcmEnd = Math.max(
    pcmStart,
    Math.min(input.pcmData.length, Math.ceil(((alignedEndMs - input.startedAtMs) / 1_000) * input.pcmSampleRateHz)),
  );
  const iqData = concatBytes(byteChunks);
  const pcmData = input.pcmData.slice(pcmStart, pcmEnd);
  if (iqData.length < 4 || pcmData.length < 8) return null;

  const baselinePcmDataByAlgorithm = {
    am: concatFloats(baselineChunks.am),
    fm: concatFloats(baselineChunks.fm),
  };
  const baselinePcmData = baselinePcmDataByAlgorithm[input.baselineAlgorithm];
  const payload = {
    aligned: true,
    alignmentMethod: "shared-wall-clock-frame-timestamps",
    alignmentErrorMs: Math.max(
      Math.abs(alignedStartMs - input.startedAtMs),
      Math.abs(alignedEndMs - referenceEndMs),
    ),
    captureId: input.captureId,
    channelId: channel.id,
    centerFrequencyHz: input.centerFrequencyHz,
    bandwidthHz: input.bandwidthHz,
    iqData,
    iqSampleRateHz: inputSampleRateHz,
    pcmData,
    pcmSampleRateHz: input.pcmSampleRateHz,
    baselineAlgorithm: input.baselineAlgorithm,
    baselinePcmData,
    baselinePcmDataByAlgorithm,
    baselinePcmSampleRateHz: input.pcmSampleRateHz,
    referenceStartedAtMs: input.startedAtMs,
    iqStartedAtMs: alignedStartMs,
    iqEndedAtMs: alignedEndMs,
  };
  const artifact: AudioSurveyArtifact = {
    id: `${input.jobId}:reference-pair:${input.captureId}`,
    jobId: input.jobId,
    kind: "reference-pair",
    sizeBytes: estimateAudioSurveyArtifactBytes(payload),
    score: 1,
    createdAt: now(),
    payload,
  };
  await options.repository.saveArtifact(artifact, input.storageCapBytes);
  return artifact;
};
