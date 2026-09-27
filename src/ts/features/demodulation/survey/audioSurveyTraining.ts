import {
  audioSurveyRepository,
  estimateAudioSurveyArtifactBytes,
  type AudioSurveyArtifact,
  type AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import {
  predictTimeDomainAudioRange,
  trainTimeDomainDemodModel,
  TIME_DOMAIN_HIDDEN_SIZE,
  TIME_DOMAIN_INPUT_SIZE,
  type PairedAudioTrainingExample,
  type TimeDomainDemodModel,
} from "@n-apt/demodulation/survey/audioSurveyMl";
import { serializeTimeDomainModelToOnnx } from "@n-apt/demodulation/survey/audioSurveyOnnx";

const TRAINING_CHECKPOINT_SUFFIX = ":audio-demod-training";

export interface AudioSurveyTrainingState {
  jobId: string;
  status: "ready" | "running" | "paused" | "completed" | "stopped" | "failed";
  epoch: number;
  totalEpochs: number;
  trainingPairCount: number;
  holdoutPairCount: number;
  validationPairCount?: number;
  testPairCount?: number;
  validationRmse?: number;
  modelRmse?: number;
  dspRmse?: number;
  modelPreferred?: boolean;
  error?: string;
}

export interface AudioSurveySampleRange {
  startSample: number;
  endSample: number;
}

export interface AudioSurveySplitRanges {
  training: AudioSurveySampleRange;
  validation: AudioSurveySampleRange;
  test: AudioSurveySampleRange;
  guardSamples: number;
}

/** Split time order into disjoint 70/15/15 blocks with a guard at each seam. */
export const getContiguousAudioSurveySplitRanges = (
  sampleCount: number,
  sampleRateHz: number,
  guardMs = 250,
): AudioSurveySplitRanges | null => {
  if (
    !Number.isInteger(sampleCount) ||
    sampleCount < 8 ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0 ||
    !Number.isFinite(guardMs) ||
    guardMs < 0
  ) {
    return null;
  }

  const trainBoundary = Math.floor(sampleCount * 0.7);
  const validationBoundary = Math.floor(sampleCount * 0.85);
  const guardSamples = Math.ceil((sampleRateHz * guardMs) / 1_000);
  const minimumSplitSamples = Math.max(8, Math.ceil(sampleRateHz * 0.05));
  const ranges = {
    training: { startSample: 0, endSample: trainBoundary - guardSamples },
    validation: {
      startSample: trainBoundary + guardSamples,
      endSample: validationBoundary - guardSamples,
    },
    test: {
      startSample: validationBoundary + guardSamples,
      endSample: sampleCount,
    },
    guardSamples,
  } satisfies AudioSurveySplitRanges;

  return [ranges.training, ranges.validation, ranges.test].every(
    (range) => range.endSample - range.startSample >= minimumSplitSamples,
  )
    ? ranges
    : null;
};

interface PairedArtifactPayload {
  aligned?: boolean;
  iqData?: Uint8Array;
  iqSampleRateHz?: number;
  pcmData?: Float32Array;
  pcmSampleRateHz?: number;
  baselinePcmData?: Float32Array;
  baselinePcmSampleRateHz?: number;
  baselinePcmDataByAlgorithm?: {
    am?: Float32Array;
    fm?: Float32Array;
    apt?: Float32Array;
  };
}

interface TrainingCheckpointPayload {
  artifactType:
    | "audio-survey-training-checkpoint"
    | "audio-survey-trained-model";
  state: AudioSurveyTrainingState;
  model: TimeDomainDemodModel;
  /** Self-contained binary weights and graph for deployment. */
  onnxModelData?: Uint8Array;
  sourceArtifactIds: string[];
  seed: number;
  maxTrainingSamples: number;
  learningRate: number;
}

const checkpointId = (jobId: string) => `${jobId}${TRAINING_CHECKPOINT_SUFFIX}`;

const getExamples = (
  artifacts: readonly AudioSurveyArtifact[],
): Array<{
  id: string;
  example: PairedAudioTrainingExample;
  baselines: Float32Array[];
}> =>
  artifacts
    .filter((artifact) => artifact.kind === "reference-pair")
    .map((artifact) => ({
      artifact,
      payload: artifact.payload as PairedArtifactPayload,
    }))
    .filter(
      ({ payload }) =>
        payload.aligned === true &&
        payload.iqData instanceof Uint8Array &&
        payload.iqData.length >= 4 &&
        payload.pcmData instanceof Float32Array &&
        payload.pcmData.length >= 8 &&
        Number.isFinite(payload.iqSampleRateHz) &&
        (payload.iqSampleRateHz ?? 0) > 0 &&
        Number.isFinite(payload.pcmSampleRateHz) &&
        (payload.pcmSampleRateHz ?? 0) > 0,
    )
    .map(({ artifact, payload }) => {
      const namedBaselines = [
        ...(payload.baselinePcmDataByAlgorithm?.am instanceof Float32Array
          ? [payload.baselinePcmDataByAlgorithm.am]
          : []),
        ...(payload.baselinePcmDataByAlgorithm?.fm instanceof Float32Array
          ? [payload.baselinePcmDataByAlgorithm.fm]
          : []),
        ...(payload.baselinePcmDataByAlgorithm?.apt instanceof Float32Array
          ? [payload.baselinePcmDataByAlgorithm.apt]
          : []),
      ];
      return {
        id: artifact.id,
        example: {
          iqData: payload.iqData!,
          sampleRateHz: payload.iqSampleRateHz!,
          pcmSamples: payload.pcmData!,
          pcmSampleRateHz: payload.pcmSampleRateHz!,
        },
        baselines:
          namedBaselines.length > 0
            ? namedBaselines
            : payload.baselinePcmData instanceof Float32Array
              ? [payload.baselinePcmData]
              : [],
      };
    })
    .sort((left, right) => {
      const a = artifacts.find((item) => item.id === left.id)?.createdAt ?? 0;
      const b = artifacts.find((item) => item.id === right.id)?.createdAt ?? 0;
      return a - b || left.id.localeCompare(right.id);
    });

type AudioSurveyTrainingPair = ReturnType<typeof getExamples>[number];
type AudioSurveySplitName = "training" | "validation" | "test";

const AUDIO_SURVEY_EVALUATION_BUDGET = 6_000;
const AUDIO_SURVEY_EVALUATION_SEGMENT_SIZE = 2_000;

/** Bound inference during evaluation while sampling the start, middle, and end. */
export const getAudioSurveyEvaluationRanges = (
  sampleCount: number,
): AudioSurveySampleRange[] => {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) return [];
  if (sampleCount <= AUDIO_SURVEY_EVALUATION_BUDGET) {
    return [{ startSample: 0, endSample: sampleCount }];
  }

  const segmentSize = AUDIO_SURVEY_EVALUATION_SEGMENT_SIZE;
  const lastStart = sampleCount - segmentSize;
  const starts = Array.from(
    new Set([0, Math.floor(lastStart / 2), lastStart]),
  ).sort((left, right) => left - right);
  return starts.map((startSample) => ({
    startSample,
    endSample: startSample + segmentSize,
  }));
};

const slicePairedAudioExample = (
  example: PairedAudioTrainingExample,
  range: AudioSurveySampleRange,
): PairedAudioTrainingExample => {
  const pcmLength = example.pcmSamples.length;
  const complexLength = Math.floor(example.iqData.length / 2);
  const startFraction = range.startSample / pcmLength;
  const endFraction = range.endSample / pcmLength;
  const iqStart = Math.floor(startFraction * complexLength);
  const iqEnd = Math.min(complexLength, Math.ceil(endFraction * complexLength));
  return {
    ...example,
    iqData: example.iqData.subarray(iqStart * 2, iqEnd * 2),
    pcmSamples: example.pcmSamples.subarray(range.startSample, range.endSample),
  };
};

const sliceAudioSurveyTrainingPair = (
  pair: AudioSurveyTrainingPair,
  range: AudioSurveySampleRange,
): AudioSurveyTrainingPair => {
  const sourceLength = pair.example.pcmSamples.length;
  const startFraction = range.startSample / sourceLength;
  const endFraction = range.endSample / sourceLength;
  return {
    id: pair.id,
    example: slicePairedAudioExample(pair.example, range),
    baselines: pair.baselines.map((baseline) =>
      baseline.subarray(
        Math.floor(startFraction * baseline.length),
        Math.min(baseline.length, Math.ceil(endFraction * baseline.length)),
      ),
    ),
  };
};

const buildContiguousTrainingSplits = (
  pairs: readonly AudioSurveyTrainingPair[],
) => {
  const splits: Record<AudioSurveySplitName, AudioSurveyTrainingPair[]> = {
    training: [],
    validation: [],
    test: [],
  };
  const sourceArtifactIds: string[] = [];

  for (const pair of pairs) {
    const ranges = getContiguousAudioSurveySplitRanges(
      pair.example.pcmSamples.length,
      pair.example.pcmSampleRateHz,
    );
    if (!ranges) continue;
    sourceArtifactIds.push(pair.id);
    for (const splitName of ["training", "validation", "test"] as const) {
      splits[splitName].push(
        sliceAudioSurveyTrainingPair(pair, ranges[splitName]),
      );
    }
  }

  return { splits, sourceArtifactIds };
};

/** Compare waveforms after fitting gain/DC and searching a small timing offset. */
export const bestAlignedWaveformRmse = (
  prediction: Float32Array,
  target: Float32Array,
  maxLagSamples = 2_400,
): number => {
  const length = Math.min(prediction.length, target.length);
  if (length < 8) return Number.POSITIVE_INFINITY;
  const stride = Math.max(1, Math.ceil(length / 6_000));
  const lagStep = Math.max(1, Math.floor(stride));
  const maxLag = Math.min(maxLagSamples, Math.floor(length / 4));
  let bestMse = Number.POSITIVE_INFINITY;

  for (let lag = -maxLag; lag <= maxLag; lag += lagStep) {
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    let count = 0;
    const first = Math.max(0, -lag);
    const last = Math.min(length, length - lag);
    for (let index = first; index < last; index += stride) {
      const x = prediction[index + lag];
      const y = target[index];
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
      count++;
    }
    if (count < 8) continue;
    const variance = sumXX - (sumX * sumX) / count;
    const covariance = sumXY - (sumX * sumY) / count;
    const gain = variance > 1e-12 ? covariance / variance : 0;
    const bias = (sumY - gain * sumX) / count;
    const mse = Math.max(
      0,
      (sumYY +
        gain * gain * sumXX +
        count * bias * bias -
        2 * gain * sumXY -
        2 * bias * sumY +
        2 * gain * bias * sumX) /
        count,
    );
    if (mse < bestMse) bestMse = mse;
  }

  return Math.sqrt(bestMse);
};

const evaluateModelRmse = (
  model: TimeDomainDemodModel,
  pairs: readonly AudioSurveyTrainingPair[],
): number | undefined => {
  let squaredError = 0;
  let count = 0;
  for (const pair of pairs) {
    for (const range of getAudioSurveyEvaluationRanges(
      pair.example.pcmSamples.length,
    )) {
      const prediction = predictTimeDomainAudioRange(
        model,
        pair.example,
        range,
      );
      const target = pair.example.pcmSamples.subarray(
        range.startSample,
        range.endSample,
      );
      const rmse = bestAlignedWaveformRmse(prediction.samples, target);
      if (!Number.isFinite(rmse)) continue;
      squaredError += rmse * rmse * target.length;
      count += target.length;
    }
  }
  return count > 0 ? Math.sqrt(squaredError / count) : undefined;
};

const evaluateBestDspRmse = (
  pairs: readonly AudioSurveyTrainingPair[],
): number | undefined => {
  let squaredError = 0;
  let count = 0;
  for (const pair of pairs) {
    const ranges = getAudioSurveyEvaluationRanges(
      pair.example.pcmSamples.length,
    );
    const rmse = pair.baselines
      .map((baseline) => {
        let baselineSquaredError = 0;
        let baselineCount = 0;
        for (const range of ranges) {
          const target = pair.example.pcmSamples.subarray(
            range.startSample,
            range.endSample,
          );
          const reference = baseline.subarray(
            range.startSample,
            range.endSample,
          );
          const segmentRmse = bestAlignedWaveformRmse(reference, target);
          if (!Number.isFinite(segmentRmse)) continue;
          baselineSquaredError += segmentRmse * segmentRmse * target.length;
          baselineCount += target.length;
        }
        return baselineCount > 0
          ? Math.sqrt(baselineSquaredError / baselineCount)
          : Number.POSITIVE_INFINITY;
      })
      .reduce((best, value) => Math.min(best, value), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(rmse)) continue;
    squaredError +=
      rmse *
      rmse *
      ranges.reduce(
        (total, range) => total + range.endSample - range.startSample,
        0,
      );
    count += ranges.reduce(
      (total, range) => total + range.endSample - range.startSample,
      0,
    );
  }
  return count > 0 ? Math.sqrt(squaredError / count) : undefined;
};

export interface AudioSurveyTrainerOptions {
  repository?: AudioSurveyRepository;
  now?: () => number;
  totalEpochs?: number;
  seed?: number;
  maxTrainingSamples?: number;
  learningRate?: number;
  storageCapBytes?: number;
  onStateUpdated?: (state: AudioSurveyTrainingState) => void;
}

/** Checkpointed, local, epoch-at-a-time training for verified stimulus pairs. */
export class AudioSurveyTrainer {
  private readonly repository: AudioSurveyRepository;
  private readonly now: () => number;
  private readonly totalEpochs: number;
  private readonly seed: number;
  private readonly maxTrainingSamples: number;
  private readonly learningRate: number;
  private readonly storageCapBytes: number;
  private activeRun: Promise<AudioSurveyTrainingState> | null = null;
  private activeJobId: string | null = null;
  private pauseRequested = false;
  private stopRequested = false;

  constructor(private readonly options: AudioSurveyTrainerOptions = {}) {
    this.repository = options.repository ?? audioSurveyRepository;
    this.now = options.now ?? Date.now;
    this.totalEpochs = Math.max(1, Math.floor(options.totalEpochs ?? 30));
    this.seed = options.seed ?? 2718;
    this.maxTrainingSamples = options.maxTrainingSamples ?? 4096;
    this.learningRate = options.learningRate ?? 0.005;
    this.storageCapBytes = options.storageCapBytes ?? 1_000_000_000;
  }

  pause() {
    this.pauseRequested = true;
  }

  stop() {
    this.stopRequested = true;
  }

  start(jobId: string) {
    if (this.activeRun) {
      if (this.activeJobId !== jobId) {
        return Promise.reject(
          new Error("Another audio survey training job is running"),
        );
      }
      return this.activeRun;
    }
    this.pauseRequested = false;
    this.stopRequested = false;
    this.activeJobId = jobId;
    this.activeRun = this.run(jobId).finally(() => {
      this.activeRun = null;
      this.activeJobId = null;
    });
    return this.activeRun;
  }

  resume(jobId: string) {
    return this.start(jobId);
  }

  private async saveCheckpoint(
    state: AudioSurveyTrainingState,
    model: TimeDomainDemodModel,
    sourceArtifactIds: string[],
    artifactType: TrainingCheckpointPayload["artifactType"] = "audio-survey-training-checkpoint",
    capBytes = 1_000_000_000,
  ) {
    const payload: TrainingCheckpointPayload = {
      artifactType,
      state,
      model,
      ...(artifactType === "audio-survey-trained-model"
        ? { onnxModelData: serializeTimeDomainModelToOnnx(model) }
        : {}),
      sourceArtifactIds,
      seed: this.seed,
      maxTrainingSamples: this.maxTrainingSamples,
      learningRate: this.learningRate,
    };
    const artifact: AudioSurveyArtifact = {
      id: checkpointId(state.jobId),
      jobId: state.jobId,
      kind: "model",
      sizeBytes: estimateAudioSurveyArtifactBytes(payload),
      score: state.modelPreferred ? 1 : 0.5,
      createdAt: this.now(),
      payload,
    };
    await this.repository.saveArtifact(artifact, capBytes);
    this.options.onStateUpdated?.(state);
  }

  private async run(jobId: string): Promise<AudioSurveyTrainingState> {
    const allArtifacts = await this.repository.listArtifacts(jobId);
    const pairs = getExamples(allArtifacts);
    const { splits, sourceArtifactIds } = buildContiguousTrainingSplits(pairs);
    const trainingPairs = splits.training;
    const validationPairs = splits.validation;
    const testPairs = splits.test;
    if (
      trainingPairs.length === 0 ||
      validationPairs.length === 0 ||
      testPairs.length === 0
    ) {
      const state: AudioSurveyTrainingState = {
        jobId,
        status: "failed",
        epoch: 0,
        totalEpochs: this.totalEpochs,
        trainingPairCount: 0,
        holdoutPairCount: 0,
        validationPairCount: 0,
        testPairCount: 0,
        error:
          "No timestamp-aligned reference capture is long enough for guarded 70/15/15 training, validation, and test blocks",
      };
      this.options.onStateUpdated?.(state);
      return state;
    }
    const checkpointArtifact = await this.repository.getArtifact(
      checkpointId(jobId),
    );
    const checkpoint = checkpointArtifact?.payload as
      | TrainingCheckpointPayload
      | undefined;
    const sameCorpus =
      JSON.stringify(checkpoint?.sourceArtifactIds ?? []) ===
      JSON.stringify(sourceArtifactIds);
    const checkpointModel = checkpoint?.model as
      | TimeDomainDemodModel
      | undefined;
    const compatibleCheckpoint =
      checkpointModel?.version === 2 &&
      checkpointModel.inputSize === TIME_DOMAIN_INPUT_SIZE &&
      checkpointModel.hiddenSize === TIME_DOMAIN_HIDDEN_SIZE;
    const startingModel =
      sameCorpus && compatibleCheckpoint ? checkpointModel : undefined;
    const initialEpoch = startingModel?.trainingEpochs ?? 0;
    const capBytes = this.storageCapBytes;
    let state: AudioSurveyTrainingState = {
      jobId,
      status: "running",
      epoch: initialEpoch,
      totalEpochs: this.totalEpochs,
      trainingPairCount: sourceArtifactIds.length,
      holdoutPairCount: sourceArtifactIds.length,
      validationPairCount: validationPairs.length,
      testPairCount: testPairs.length,
    };
    let model = startingModel;

    if (
      sameCorpus &&
      compatibleCheckpoint &&
      checkpoint?.artifactType === "audio-survey-trained-model" &&
      checkpoint.onnxModelData instanceof Uint8Array
    ) {
      this.options.onStateUpdated?.(checkpoint.state);
      return checkpoint.state;
    }

    try {
      while (state.epoch < this.totalEpochs) {
        if (this.stopRequested) {
          state = { ...state, status: "stopped" };
          if (model)
            await this.saveCheckpoint(
              state,
              model,
              sourceArtifactIds,
              undefined,
              capBytes,
            );
          return state;
        }
        if (this.pauseRequested) {
          state = { ...state, status: "paused" };
          if (model)
            await this.saveCheckpoint(
              state,
              model,
              sourceArtifactIds,
              undefined,
              capBytes,
            );
          else this.options.onStateUpdated?.(state);
          return state;
        }

        model = trainTimeDomainDemodModel(
          trainingPairs.map((pair) => pair.example),
          {
            epochs: 1,
            startEpoch: state.epoch,
            initialModel: model,
            maxTrainingSamples: this.maxTrainingSamples,
            learningRate: this.learningRate,
            seed: this.seed,
          },
        );
        state = { ...state, epoch: model.trainingEpochs, status: "running" };
        await this.saveCheckpoint(
          state,
          model,
          sourceArtifactIds,
          undefined,
          capBytes,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      const validationRmse = evaluateModelRmse(model!, validationPairs);
      const modelRmse = evaluateModelRmse(model!, testPairs);
      const dspRmse = evaluateBestDspRmse(testPairs);
      state = {
        ...state,
        status: "completed",
        validationRmse,
        modelRmse,
        dspRmse,
        modelPreferred:
          modelRmse !== undefined &&
          dspRmse !== undefined &&
          modelRmse <= dspRmse,
      };
      await this.saveCheckpoint(
        state,
        model!,
        sourceArtifactIds,
        "audio-survey-trained-model",
        capBytes,
      );
      return state;
    } catch (error) {
      state = {
        ...state,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      if (model)
        await this.saveCheckpoint(
          state,
          model,
          sourceArtifactIds,
          undefined,
          capBytes,
        );
      else this.options.onStateUpdated?.(state);
      return state;
    }
  }
}
