import {
  audioSurveyRepository,
  estimateAudioSurveyArtifactBytes,
  type AudioSurveyArtifact,
  type AudioSurveyRepository,
} from "@n-apt/demodulation/survey/audioSurveyStorage";
import {
  predictTimeDomainAudio,
  trainTimeDomainDemodModel,
  type PairedAudioTrainingExample,
  type TimeDomainDemodModel,
} from "@n-apt/demodulation/survey/audioSurveyMl";

const TRAINING_CHECKPOINT_SUFFIX = ":audio-demod-training";

export interface AudioSurveyTrainingState {
  jobId: string;
  status: "ready" | "running" | "paused" | "completed" | "stopped" | "failed";
  epoch: number;
  totalEpochs: number;
  trainingPairCount: number;
  holdoutPairCount: number;
  modelRmse?: number;
  dspRmse?: number;
  modelPreferred?: boolean;
  error?: string;
}

interface PairedArtifactPayload {
  aligned?: boolean;
  iqData?: Uint8Array;
  iqSampleRateHz?: number;
  pcmData?: Float32Array;
  pcmSampleRateHz?: number;
  baselinePcmData?: Float32Array;
  baselinePcmSampleRateHz?: number;
  baselinePcmDataByAlgorithm?: { am?: Float32Array; fm?: Float32Array };
}

interface TrainingCheckpointPayload {
  artifactType: "audio-survey-training-checkpoint" | "audio-survey-trained-model";
  state: AudioSurveyTrainingState;
  model: TimeDomainDemodModel;
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
    .map((artifact) => ({ artifact, payload: artifact.payload as PairedArtifactPayload }))
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
    .map(({ artifact, payload }) => ({
      id: artifact.id,
      example: {
        iqData: payload.iqData!,
        sampleRateHz: payload.iqSampleRateHz!,
        pcmSamples: payload.pcmData!,
        pcmSampleRateHz: payload.pcmSampleRateHz!,
      },
      baselines: [
        ...(payload.baselinePcmDataByAlgorithm?.am instanceof Float32Array
          ? [payload.baselinePcmDataByAlgorithm.am]
          : []),
        ...(payload.baselinePcmDataByAlgorithm?.fm instanceof Float32Array
          ? [payload.baselinePcmDataByAlgorithm.fm]
          : []),
        ...(payload.baselinePcmData instanceof Float32Array
          ? [payload.baselinePcmData]
          : []),
      ],
    }))
    .sort((left, right) => {
      const a = artifacts.find((item) => item.id === left.id)?.createdAt ?? 0;
      const b = artifacts.find((item) => item.id === right.id)?.createdAt ?? 0;
      return a - b || left.id.localeCompare(right.id);
    });

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
      (sumY * sumY + gain * gain * sumXX + count * bias * bias - 2 * gain * sumXY - 2 * bias * sumY + 2 * gain * bias * sumX) / count,
    );
    if (mse < bestMse) bestMse = mse;
  }

  return Math.sqrt(bestMse);
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
    this.learningRate = options.learningRate ?? 0.01;
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
        return Promise.reject(new Error("Another audio survey training job is running"));
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
    if (pairs.length < 3) {
      const state: AudioSurveyTrainingState = {
        jobId,
        status: "failed",
        epoch: 0,
        totalEpochs: this.totalEpochs,
        trainingPairCount: 0,
        holdoutPairCount: 0,
        error: "At least three timestamp-aligned reference pairs are required for training and held-out evaluation",
      };
      this.options.onStateUpdated?.(state);
      return state;
    }
    const holdoutCount = Math.max(1, Math.ceil(pairs.length * 0.2));
    const trainingPairs = pairs.slice(0, pairs.length - holdoutCount);
    const holdoutPairs = pairs.slice(pairs.length - holdoutCount);
    const sourceArtifactIds = pairs.map((pair) => pair.id);
    const checkpointArtifact = await this.repository.getArtifact(checkpointId(jobId));
    const checkpoint = checkpointArtifact?.payload as TrainingCheckpointPayload | undefined;
    const sameCorpus =
      JSON.stringify(checkpoint?.sourceArtifactIds ?? []) ===
      JSON.stringify(sourceArtifactIds);
    const startingModel = sameCorpus ? checkpoint?.model : undefined;
    const initialEpoch = startingModel?.trainingEpochs ?? 0;
    const capBytes = this.storageCapBytes;
    let state: AudioSurveyTrainingState = {
      jobId,
      status: "running",
      epoch: initialEpoch,
      totalEpochs: this.totalEpochs,
      trainingPairCount: trainingPairs.length,
      holdoutPairCount: holdoutPairs.length,
    };
    let model = startingModel;

    if (sameCorpus && checkpoint?.artifactType === "audio-survey-trained-model") {
      this.options.onStateUpdated?.(checkpoint.state);
      return checkpoint.state;
    }

    try {
      while (state.epoch < this.totalEpochs) {
        if (this.stopRequested) {
          state = { ...state, status: "stopped" };
          if (model) await this.saveCheckpoint(state, model, sourceArtifactIds, undefined, capBytes);
          return state;
        }
        if (this.pauseRequested) {
          state = { ...state, status: "paused" };
          if (model) await this.saveCheckpoint(state, model, sourceArtifactIds, undefined, capBytes);
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
        await this.saveCheckpoint(state, model, sourceArtifactIds, undefined, capBytes);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      let modelSquaredError = 0;
      let baselineSquaredError = 0;
      let modelCount = 0;
      let baselineCount = 0;
      for (const pair of holdoutPairs) {
        const prediction = predictTimeDomainAudio(model!, {
          iqData: pair.example.iqData,
          sampleRateHz: pair.example.sampleRateHz,
          pcmSampleRateHz: pair.example.pcmSampleRateHz,
          outputSampleCount: pair.example.pcmSamples.length,
        });
        const modelRmse = bestAlignedWaveformRmse(
          prediction.samples,
          pair.example.pcmSamples,
        );
        if (Number.isFinite(modelRmse)) {
          modelSquaredError += modelRmse * modelRmse;
          modelCount++;
        }
        const baselineRmse = pair.baselines
          .map((baseline) =>
            bestAlignedWaveformRmse(baseline, pair.example.pcmSamples),
          )
          .filter(Number.isFinite)
          .reduce((best, value) => Math.min(best, value), Number.POSITIVE_INFINITY);
        if (Number.isFinite(baselineRmse)) {
          baselineSquaredError += baselineRmse * baselineRmse;
          baselineCount++;
        }
      }
      const modelRmse = modelCount ? Math.sqrt(modelSquaredError / modelCount) : undefined;
      const dspRmse = baselineCount ? Math.sqrt(baselineSquaredError / baselineCount) : undefined;
      state = {
        ...state,
        status: "completed",
        modelRmse,
        dspRmse,
        modelPreferred:
          modelRmse !== undefined && dspRmse !== undefined && modelRmse <= dspRmse,
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
      if (model) await this.saveCheckpoint(state, model, sourceArtifactIds, undefined, capBytes);
      else this.options.onStateUpdated?.(state);
      return state;
    }
  }
}
