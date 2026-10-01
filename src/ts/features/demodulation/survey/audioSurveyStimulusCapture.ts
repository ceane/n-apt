import { createDemodProcessor } from "@n-apt/demodulation/utils/demodProcessors";
import { createAudioSurveyChannelizer } from "@n-apt/demodulation/survey/audioSurveyDsp";
import {
  buildAudioSurveyViews,
  AUDIO_SURVEY_SAMPLE_RATE_HZ,
  type AudioSurveyReferenceLabel,
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
  startedAtMs?: number;
  centerFrequencyHz: number;
  bandwidthHz: number;
  channelId: string;
  baselineAlgorithm: "am" | "fm" | "apt";
  audioSignalLabel?: AudioSurveyReferenceLabel;
  storageCapBytes: number;
}

const concatBytes = (chunks: readonly Uint8Array[]) => {
  const output = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

const concatFloats = (chunks: readonly Float32Array[]) => {
  const output = new Float32Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

/** Estimate the stored narrowband IQ and paired PCM before collecting a file. */
export const estimateAudioSurveyStimulusPairBytes = ({
  durationMs,
  bandwidthHz,
  inputSampleRateHz = AUDIO_SURVEY_SAMPLE_RATE_HZ,
  pcmSampleRateHz = 48_000,
}: {
  durationMs: number;
  bandwidthHz: number;
  inputSampleRateHz?: number;
  pcmSampleRateHz?: number;
}): number => {
  const targetIqRateHz = Math.min(
    inputSampleRateHz,
    Math.max(48_000, Math.min(600_000, bandwidthHz * 2.5)),
  );
  const decimation = Math.max(
    1,
    Math.floor(inputSampleRateHz / targetIqRateHz),
  );
  const channelizedRateHz = inputSampleRateHz / decimation;
  const bytesPerSecond = channelizedRateHz * 2 + pcmSampleRateHz * 8;
  return Math.ceil((durationMs / 1_000) * bytesPerSecond * 1.1 + 4_096);
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
    /** Start the reference only after a fresh, tuned I/Q frame is available. */
    startPlayback?: () => Promise<number> | number;
  },
): Promise<AudioSurveyArtifact | null> => {
  const channel = options.channels.find((item) => item.id === input.channelId);
  if (!channel)
    throw new Error(`Configured channel ${input.channelId} is unavailable`);
  if (
    input.pcmData.length < 8 ||
    !Number.isFinite(input.pcmSampleRateHz) ||
    input.pcmSampleRateHz <= 0 ||
    (!options.startPlayback && !Number.isFinite(input.startedAtMs)) ||
    !Number.isFinite(input.centerFrequencyHz) ||
    !Number.isFinite(input.bandwidthHz) ||
    input.bandwidthHz <= 0
  ) {
    throw new Error(
      "Stimulus reference audio or selected RF channel is invalid",
    );
  }

  const surveyView = buildAudioSurveyViews(options.channels).find(
    (view) =>
      view.channelId === channel.id &&
      input.centerFrequencyHz >= view.minHz &&
      input.centerFrequencyHz <= view.maxHz,
  );
  if (!surveyView) {
    throw new Error(
      "Selected demodulation frequency is outside the A/B survey views",
    );
  }
  const referenceDurationMs =
    (input.pcmData.length / input.pcmSampleRateHz) * 1_000;
  const estimatedArtifactBytes = estimateAudioSurveyStimulusPairBytes({
    durationMs: referenceDurationMs,
    bandwidthHz: input.bandwidthHz,
    pcmSampleRateHz: input.pcmSampleRateHz,
  });
  const storageUsage = await options.repository.getStorageUsage(
    input.storageCapBytes,
  );
  const remainingStorageBytes = Math.max(
    0,
    storageUsage.capBytes - storageUsage.usedBytes,
  );
  if (estimatedArtifactBytes > remainingStorageBytes) {
    throw new Error(
      `This media needs about ${Math.ceil(estimatedArtifactBytes / 1_000_000)} MB for its aligned pair; ${Math.floor(remainingStorageBytes / 1_000_000)} MB remain under the local storage cap`,
    );
  }
  await options.source.tune?.(surveyView);

  let referenceStartedAtMs = input.startedAtMs;
  let referenceEndMs =
    referenceStartedAtMs === undefined
      ? Number.POSITIVE_INFINITY
      : referenceStartedAtMs + referenceDurationMs;

  const channelizer = createAudioSurveyChannelizer({
    centerFrequencyHz: input.centerFrequencyHz,
    bandwidthHz: input.bandwidthHz,
  });
  const baselineProcessor = createDemodProcessor(
    input.baselineAlgorithm === "apt" ? "aptImage" : input.baselineAlgorithm,
    {
      targetSampleRate: input.pcmSampleRateHz,
      centerFrequency: input.centerFrequencyHz,
      bandwidth: input.bandwidthHz,
    },
  );
  const byteChunks: Uint8Array[] = [];
  const baselineChunks: Float32Array[] = [];
  let firstIqSampleAtMs: number | null = null;
  let lastIqSampleAtMs: number | null = null;
  let cursor: string | null = null;
  let lastFrameEndMs: number | null = null;
  let previousFrame: SurveyIqFrame | null = null;
  let inputSampleRateHz = 0;
  let frame: SurveyIqFrame | null = null;
  let requests = 0;
  const now = options.now ?? Date.now;
  const maxFrameRequests = Math.max(
    256,
    Math.min(36_000, Math.ceil((referenceDurationMs / 1_000) * 1_000 + 30)),
  );
  const waitLimit = Math.max(
    1_000,
    options.maximumWaitMs ?? Math.max(12_000, referenceDurationMs + 10_000),
  );
  const startedWaitingAt = now();

  // Wait for a frame from the tuned view before starting playback, then retain
  // it as the first possible overlap frame. Live sources reject pre-tune frames.
  let pendingFrame: SurveyIqFrame | null = null;
  if (options.startPlayback) {
    while (
      !pendingFrame &&
      requests < maxFrameRequests &&
      now() - startedWaitingAt < waitLimit
    ) {
      requests++;
      pendingFrame = await options.source.nextFrame(cursor, 750, surveyView);
      if (pendingFrame?.frameKey === cursor) pendingFrame = null;
      if (!pendingFrame) continue;
      cursor = pendingFrame.frameKey;
      const complexSamples = Math.floor(pendingFrame.iqData.length / 2);
      if (
        complexSamples < 2 ||
        !Number.isFinite(pendingFrame.timestampMs) ||
        !Number.isFinite(pendingFrame.sampleRateHz) ||
        pendingFrame.sampleRateHz <= 0 ||
        pendingFrame.discontinuityBefore
      ) {
        pendingFrame = null;
      }
    }
    if (!pendingFrame) return null;
    referenceStartedAtMs = await options.startPlayback();
    if (!Number.isFinite(referenceStartedAtMs)) {
      throw new Error("Stimulus playback returned an invalid start timestamp");
    }
    referenceEndMs = referenceStartedAtMs + referenceDurationMs;
  }
  if (referenceStartedAtMs === undefined) {
    throw new Error(
      "Stimulus playback start time is required for I/Q alignment",
    );
  }

  while (
    requests < maxFrameRequests &&
    now() - startedWaitingAt < waitLimit &&
    (lastIqSampleAtMs === null || lastIqSampleAtMs < referenceEndMs)
  ) {
    if (pendingFrame) {
      frame = pendingFrame;
      pendingFrame = null;
    } else {
      requests++;
      frame = await options.source.nextFrame(cursor, 750, surveyView);
    }
    if (!frame) break;
    if (frame.frameKey === cursor) continue;
    cursor = frame.frameKey;
    if (frame.discontinuityBefore) {
      throw new Error(
        "I/Q timeline contains a gap during the stimulus reference",
      );
    }
    if (
      previousFrame &&
      frame.sequence !== undefined &&
      previousFrame.sequence !== undefined &&
      (frame.sequence !== previousFrame.sequence + 1 ||
        frame.streamEpoch !== previousFrame.streamEpoch ||
        frame.sourceId !== previousFrame.sourceId)
    ) {
      throw new Error(
        "I/Q timeline contains a gap during the stimulus reference",
      );
    }
    if (
      previousFrame?.sampleStartIndex !== undefined &&
      frame.sampleStartIndex !== undefined &&
      frame.sampleStartIndex !==
        previousFrame.sampleStartIndex +
          Math.floor(previousFrame.iqData.length / 2)
    ) {
      throw new Error(
        "I/Q timeline contains a gap during the stimulus reference",
      );
    }
    const complexSamples = Math.floor(frame.iqData.length / 2);
    const frameStartMs = frame.timestampMs;
    const frameEndMs =
      frameStartMs + (complexSamples / frame.sampleRateHz) * 1_000;
    if (
      complexSamples < 2 ||
      !Number.isFinite(frameStartMs) ||
      !Number.isFinite(frame.sampleRateHz) ||
      frame.sampleRateHz <= 0 ||
      frameEndMs <= referenceStartedAtMs ||
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
    const actualStartMs = Math.max(frameStartMs, referenceStartedAtMs);
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
        Math.floor(
          ((actualStartMs - frameStartMs) / 1_000) * channelized.sampleRateHz,
        ),
      ),
    );
    const endIndex = Math.max(
      startIndex,
      Math.min(
        sampleCount,
        Math.floor(
          ((actualEndMs - frameStartMs) / 1_000) * channelized.sampleRateHz,
        ),
      ),
    );
    if (endIndex <= startIndex) continue;
    byteChunks.push(channelized.iqData.slice(startIndex * 2, endIndex * 2));
    const baselinePcm = baselineProcessor.process(
      frame.iqData,
      frame.sampleRateHz,
      frame.centerFrequencyHz,
    );
    const baselineStart = Math.max(
      0,
      Math.min(
        baselinePcm.length,
        Math.floor(
          ((actualStartMs - frameStartMs) / 1_000) * input.pcmSampleRateHz,
        ),
      ),
    );
    const baselineEnd = Math.max(
      baselineStart,
      Math.min(
        baselinePcm.length,
        Math.ceil(
          ((actualEndMs - frameStartMs) / 1_000) * input.pcmSampleRateHz,
        ),
      ),
    );
    if (baselineEnd > baselineStart) {
      baselineChunks.push(baselinePcm.slice(baselineStart, baselineEnd));
    }
    if (firstIqSampleAtMs === null) {
      firstIqSampleAtMs =
        frameStartMs + (startIndex / channelized.sampleRateHz) * 1_000;
      inputSampleRateHz = channelized.sampleRateHz;
    }
    lastIqSampleAtMs =
      frameStartMs + (endIndex / channelized.sampleRateHz) * 1_000;
    lastFrameEndMs = frameEndMs;
    previousFrame = frame;
  }

  if (
    firstIqSampleAtMs === null ||
    lastIqSampleAtMs === null ||
    inputSampleRateHz <= 0
  ) {
    return null;
  }
  const alignedStartMs = Math.max(referenceStartedAtMs, firstIqSampleAtMs);
  const alignedEndMs = Math.min(referenceEndMs, lastIqSampleAtMs);
  const expectedDurationMs = referenceEndMs - referenceStartedAtMs;
  const alignedDurationMs = alignedEndMs - alignedStartMs;
  if (alignedDurationMs < expectedDurationMs * 0.8) return null;

  const pcmStart = Math.max(
    0,
    Math.min(
      input.pcmData.length,
      Math.floor(
        ((alignedStartMs - referenceStartedAtMs) / 1_000) *
          input.pcmSampleRateHz,
      ),
    ),
  );
  const pcmEnd = Math.max(
    pcmStart,
    Math.min(
      input.pcmData.length,
      Math.ceil(
        ((alignedEndMs - referenceStartedAtMs) / 1_000) * input.pcmSampleRateHz,
      ),
    ),
  );
  const iqData = concatBytes(byteChunks);
  const pcmData = input.pcmData.slice(pcmStart, pcmEnd);
  if (iqData.length < 4 || pcmData.length < 8) return null;

  const baselinePcmData = concatFloats(baselineChunks);
  const baselinePcmDataByAlgorithm = {
    [input.baselineAlgorithm]: baselinePcmData,
  };
  const payload = {
    aligned: true,
    alignmentMethod: "shared-wall-clock-frame-timestamps",
    alignmentErrorMs: Math.max(
      Math.abs(alignedStartMs - referenceStartedAtMs),
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
    referenceStartedAtMs,
    ...(input.audioSignalLabel
      ? { audioSignalLabel: input.audioSignalLabel }
      : {}),
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
