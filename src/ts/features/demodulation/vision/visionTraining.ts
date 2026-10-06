import {
  VISION_COLOR_CLASS_COUNT,
  predictVisionDecoder,
  trainVisionDecoder,
  type VisionDecoderModel,
} from "./visionMl";
import {
  evaluateVisionFrames,
  type VisionTrainingDataset,
  type VisionTrainingExample,
} from "./visionDataset";
import {
  VISION_HEIGHT,
  VISION_PREPROCESSING,
  VISION_WIDTH,
  type VisionSplit,
} from "./visionModel";
import { serializeVisionDecoderToOnnx } from "./visionOnnx";

export const VISION_TRAINING_CHECKPOINT_VERSION = 1 as const;

export interface VisionTrainingState {
  jobId: string;
  status: "running" | "paused" | "stopped" | "completed" | "failed";
  epoch: number;
  totalEpochs: number;
  trainingExampleCount: number;
  validationExampleCount: number;
  testExampleCount: number;
  validationMse: number | null;
  testMse: number | null;
  testMeanBaselineMse: number | null;
  testConstantColorBaselineMse: number | null;
  spatialMse: number | null;
  spatialBaselineMse: number | null;
  testColorAccuracy: number | null;
  testColorCount: number;
  testSessionCount: number;
  calibrationSeedCount: number;
  modelStatus: "experimental";
  error: string | null;
  updatedAt: number;
}

/** Checkpoints deliberately omit training examples, targets, and captured I/Q. */
export interface VisionTrainingCheckpoint {
  version: typeof VISION_TRAINING_CHECKPOINT_VERSION;
  jobId: string;
  sourceArtifactIds: string[];
  datasetFingerprint: string;
  sessionSplits: Record<string, VisionSplit>;
  seed: number;
  learningRate: number;
  totalEpochs: number;
  earlyStoppingPatience: number;
  state: VisionTrainingState;
  model: VisionDecoderModel | null;
  bestModel: VisionDecoderModel | null;
  bestValidationMse: number | null;
  staleEpochs: number;
  /** Serialized inference artifact for the best validation checkpoint. */
  onnxModelData: Uint8Array | null;
}

export interface VisionTrainingRepository {
  load(jobId: string): Promise<VisionTrainingCheckpoint | null | undefined>;
  save(checkpoint: VisionTrainingCheckpoint): Promise<void>;
}

export interface VisionTrainerOptions {
  repository: VisionTrainingRepository;
  totalEpochs?: number;
  seed?: number;
  learningRate?: number;
  earlyStoppingPatience?: number;
  onStateUpdated?: (state: Readonly<VisionTrainingState>) => void;
  now?: () => number;
  yieldControl?: () => Promise<void>;
}

type VisionPartitions = {
  train: VisionTrainingExample[];
  validation: VisionTrainingExample[];
  test: VisionTrainingExample[];
};

const emptyMetrics = {
  validationMse: null,
  testMse: null,
  testMeanBaselineMse: null,
  testConstantColorBaselineMse: null,
  spatialMse: null,
  spatialBaselineMse: null,
  testColorAccuracy: null,
  testColorCount: 0,
  testSessionCount: 0,
  calibrationSeedCount: 0,
} as const;

const createState = (
  jobId: string,
  status: VisionTrainingState["status"],
  epoch: number,
  totalEpochs: number,
  counts: { train: number; validation: number; test: number },
  now: () => number,
  extra: Partial<VisionTrainingState> = {},
): VisionTrainingState => ({
  jobId,
  status,
  epoch,
  totalEpochs,
  trainingExampleCount: counts.train,
  validationExampleCount: counts.validation,
  testExampleCount: counts.test,
  ...emptyMetrics,
  modelStatus: "experimental",
  error: null,
  updatedAt: now(),
  ...extra,
});

const sortedRecord = (record: Readonly<Record<string, VisionSplit>>) =>
  Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, VisionSplit>;

const makePartitions = (
  dataset: VisionTrainingDataset,
  assignments: Readonly<Record<string, VisionSplit>>,
): VisionPartitions => {
  const partitions: VisionPartitions = {
    train: dataset.train,
    validation: dataset.validation,
    test: dataset.test,
  };
  if (
    !partitions.train.length ||
    !partitions.validation.length ||
    !partitions.test.length
  )
    throw new Error(
      "Vision training requires train, validation, and test examples",
    );
  if (
    !Number.isSafeInteger(dataset.excludedTransitionCount) ||
    dataset.excludedTransitionCount < 0
  )
    throw new Error("Invalid transition-exclusion count");

  const trialIdentity = new Map<
    string,
    { checksum: string; split: VisionSplit }
  >();
  const calibrationSeeds = new Map<number, VisionSplit>();
  const seenExamples = new Set<string>();
  for (const split of ["train", "validation", "test"] as const) {
    for (const example of partitions[split]) {
      if (
        !example.sessionId ||
        !Object.prototype.hasOwnProperty.call(assignments, example.sessionId) ||
        assignments[example.sessionId] !== split ||
        example.split !== split
      )
        throw new Error(
          "Every vision example must match an explicit session split",
        );
      if (
        !example.trialId ||
        !/^[a-f0-9]{64}$/.test(example.artifactChecksum) ||
        !Number.isFinite(example.timestampBackendMs) ||
        !Number.isSafeInteger(example.frameIndex) ||
        example.frameIndex < 0
      )
        throw new Error("Vision example identity or timestamp is invalid");
      if (
        !(example.features instanceof Float32Array) ||
        example.features.length !==
          VISION_PREPROCESSING.tensorShape.reduce(
            (product, dimension) => product * dimension,
            1,
          ) ||
        !example.features.every(Number.isFinite) ||
        !(example.opponent instanceof Float32Array) ||
        example.opponent.length !== VISION_WIDTH * VISION_HEIGHT * 3 ||
        !example.opponent.every(Number.isFinite) ||
        !(example.rgb instanceof Uint8Array) ||
        example.rgb.length !== VISION_WIDTH * VISION_HEIGHT * 3
      )
        throw new Error("Vision example tensor shape or values are invalid");
      if (
        example.colorClassIndex !== null &&
        (!Number.isInteger(example.colorClassIndex) ||
          example.colorClassIndex < 0 ||
          example.colorClassIndex >= VISION_COLOR_CLASS_COUNT)
      )
        throw new Error("Vision solid-color label is invalid");

      const priorTrial = trialIdentity.get(example.trialId);
      if (
        priorTrial &&
        (priorTrial.checksum !== example.artifactChecksum ||
          priorTrial.split !== split)
      )
        throw new Error(
          "A vision trial cannot identify multiple artifacts or splits",
        );
      trialIdentity.set(example.trialId, {
        checksum: example.artifactChecksum,
        split,
      });

      if (example.calibrationSeed !== null) {
        if (
          !Number.isSafeInteger(example.calibrationSeed) ||
          example.calibrationSeed < 0 ||
          example.calibrationSeed > 0xffffffff
        )
          throw new Error("Calibration seed is invalid");
        const previousSplit = calibrationSeeds.get(example.calibrationSeed);
        if (previousSplit && previousSplit !== split)
          throw new Error("Calibration seed leaked across session splits");
        calibrationSeeds.set(example.calibrationSeed, split);
      }
      const exampleKey =
        example.trialId +
        ":" +
        example.frameIndex +
        ":" +
        example.timestampBackendMs;
      if (seenExamples.has(exampleKey))
        throw new Error("Duplicate vision training example");
      seenExamples.add(exampleKey);
    }
  }
  return partitions;
};

const getSourceArtifactIds = (partitions: VisionPartitions) =>
  Array.from(
    new Set(
      [...partitions.train, ...partitions.validation, ...partitions.test].map(
        (example) => example.trialId + ":" + example.artifactChecksum,
      ),
    ),
  ).sort();

/** Stable resume guard for derived labels and opponent targets under each capture. */
const fingerprintDataset = (partitions: VisionPartitions) => {
  let firstHash = 0x811c9dc5;
  let secondHash = 0x9e3779b9;
  const updateByte = (byte: number) => {
    firstHash = Math.imul(firstHash ^ byte, 0x01000193) >>> 0;
    secondHash =
      Math.imul(secondHash ^ ((byte + 0x9d) & 0xff), 0x01000193) >>> 0;
  };
  const updateText = (value: string) => {
    for (const byte of new TextEncoder().encode(value)) updateByte(byte);
    updateByte(0xff);
  };
  updateText("vision-dataset-v1-preprocessing-" + VISION_PREPROCESSING.version);
  const examples = (
    [...partitions.train, ...partitions.validation, ...partitions.test] as const
  )
    .slice()
    .sort((left, right) =>
      [
        left.split,
        left.sessionId,
        left.trialId,
        left.frameIndex,
        left.timestampBackendMs,
      ]
        .join("|")
        .localeCompare(
          [
            right.split,
            right.sessionId,
            right.trialId,
            right.frameIndex,
            right.timestampBackendMs,
          ].join("|"),
        ),
    );
  const floatView = new DataView(
    new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT),
  );
  for (const example of examples) {
    updateText(
      JSON.stringify([
        example.split,
        example.sessionId,
        example.trialId,
        example.artifactChecksum,
        example.timestampBackendMs,
        example.frameIndex,
        example.calibrationSeed,
        example.colorClassIndex,
      ]),
    );
    for (const value of example.rgb) updateByte(value);
    for (const value of example.opponent) {
      floatView.setFloat32(0, value, true);
      const bits = floatView.getUint32(0, true);
      updateByte(bits & 0xff);
      updateByte((bits >>> 8) & 0xff);
      updateByte((bits >>> 16) & 0xff);
      updateByte((bits >>> 24) & 0xff);
    }
  }
  return (
    firstHash.toString(16).padStart(8, "0") +
    secondHash.toString(16).padStart(8, "0")
  );
};

const asUnitRgb = (values: Uint8Array) =>
  Array.from(values, (value) => value / 255);
const trainingReferences = (examples: readonly VisionTrainingExample[]) =>
  examples.map((example) => ({
    sessionId: example.sessionId,
    expected: asUnitRgb(example.rgb),
  }));

const predictExamples = (
  model: VisionDecoderModel,
  examples: readonly VisionTrainingExample[],
) =>
  examples.map((example) => {
    const prediction = predictVisionDecoder(model, example.features, {
      sourceId: example.trialId,
      timestampBackendMs: example.timestampBackendMs,
    });
    return {
      example,
      rgb: Array.from(prediction.frame.rgb),
      colorLogits: prediction.colorLogits,
    };
  });

const classificationAccuracy = (
  model: VisionDecoderModel,
  examples: readonly VisionTrainingExample[],
) => {
  const labeled = examples.filter(
    (example) => example.colorClassIndex !== null,
  );
  if (!labeled.length) return { accuracy: null, count: 0 };
  let correct = 0;
  for (const prediction of predictExamples(model, labeled)) {
    let bestClass = 0;
    for (let index = 1; index < prediction.colorLogits.length; index++)
      if (prediction.colorLogits[index] > prediction.colorLogits[bestClass])
        bestClass = index;
    if (bestClass === prediction.example.colorClassIndex) correct++;
  }
  return { accuracy: correct / labeled.length, count: labeled.length };
};

export class VisionTrainer {
  private readonly options: Required<
    Pick<
      VisionTrainerOptions,
      "totalEpochs" | "seed" | "learningRate" | "earlyStoppingPatience"
    >
  > &
    VisionTrainerOptions;
  private pauseRequested = false;
  private stopRequested = false;
  private active = false;

  constructor(options: VisionTrainerOptions) {
    this.options = {
      ...options,
      totalEpochs: options.totalEpochs ?? 20,
      seed: (options.seed ?? 1337) >>> 0,
      learningRate: options.learningRate ?? 0.005,
      earlyStoppingPatience: options.earlyStoppingPatience ?? 5,
    };
  }

  pause() {
    if (this.active) this.pauseRequested = true;
  }

  stop() {
    if (this.active) this.stopRequested = true;
  }

  async start(
    jobId: string,
    dataset: VisionTrainingDataset,
    assignments: Readonly<Record<string, VisionSplit>>,
  ): Promise<VisionTrainingState> {
    const now = this.options.now ?? Date.now;
    let partitions: VisionPartitions;
    try {
      this.assertOptions();
      if (!/^[A-Za-z0-9_-]{1,96}$/.test(jobId))
        throw new Error("Vision training job id is invalid");
      if (this.active)
        throw new Error("Vision trainer already has an active job");
      partitions = makePartitions(dataset, assignments);
    } catch (error) {
      const state = createState(
        jobId,
        "failed",
        0,
        this.options.totalEpochs,
        {
          train: dataset.train.length,
          validation: dataset.validation.length,
          test: dataset.test.length,
        },
        now,
        { error: error instanceof Error ? error.message : String(error) },
      );
      this.publish(state);
      return state;
    }

    this.pauseRequested = false;
    this.stopRequested = false;
    const checkpoint: VisionTrainingCheckpoint = {
      version: VISION_TRAINING_CHECKPOINT_VERSION,
      jobId,
      sourceArtifactIds: getSourceArtifactIds(partitions),
      datasetFingerprint: fingerprintDataset(partitions),
      sessionSplits: sortedRecord(assignments),
      seed: this.options.seed,
      learningRate: this.options.learningRate,
      totalEpochs: this.options.totalEpochs,
      earlyStoppingPatience: this.options.earlyStoppingPatience,
      state: createState(
        jobId,
        "running",
        0,
        this.options.totalEpochs,
        {
          train: partitions.train.length,
          validation: partitions.validation.length,
          test: partitions.test.length,
        },
        now,
      ),
      model: null,
      bestModel: null,
      bestValidationMse: null,
      staleEpochs: 0,
      onnxModelData: null,
    };
    return this.execute(checkpoint, partitions);
  }

  async resume(
    jobId: string,
    dataset: VisionTrainingDataset,
    assignments: Readonly<Record<string, VisionSplit>>,
  ): Promise<VisionTrainingState> {
    const now = this.options.now ?? Date.now;
    let partitions: VisionPartitions;
    try {
      this.assertOptions();
      if (this.active)
        throw new Error("Vision trainer already has an active job");
      partitions = makePartitions(dataset, assignments);
      const checkpoint = await this.options.repository.load(jobId);
      if (!checkpoint)
        throw new Error("Vision training checkpoint was not found");
      if (checkpoint.version !== VISION_TRAINING_CHECKPOINT_VERSION)
        throw new Error("Vision training checkpoint version is incompatible");
      if (
        checkpoint.jobId !== jobId ||
        JSON.stringify(checkpoint.sourceArtifactIds) !==
          JSON.stringify(getSourceArtifactIds(partitions)) ||
        checkpoint.datasetFingerprint !== fingerprintDataset(partitions) ||
        JSON.stringify(checkpoint.sessionSplits) !==
          JSON.stringify(sortedRecord(assignments)) ||
        checkpoint.seed !== this.options.seed ||
        checkpoint.learningRate !== this.options.learningRate ||
        checkpoint.totalEpochs !== this.options.totalEpochs ||
        checkpoint.earlyStoppingPatience !== this.options.earlyStoppingPatience
      )
        throw new Error(
          "Vision checkpoint corpus or training configuration changed",
        );
      if (checkpoint.state.status === "completed") return checkpoint.state;
      if (
        checkpoint.state.status !== "paused" &&
        checkpoint.state.status !== "running"
      )
        throw new Error("Only a paused or interrupted vision job can resume");
      if (
        checkpoint.state.epoch > 0 &&
        (!checkpoint.model || !checkpoint.bestModel)
      )
        throw new Error("Vision checkpoint is missing model weights");
      if (this.active)
        throw new Error("Vision trainer already has an active job");
      this.pauseRequested = false;
      this.stopRequested = false;
      return this.execute(checkpoint, partitions);
    } catch (error) {
      const state = createState(
        jobId,
        "failed",
        0,
        this.options.totalEpochs,
        {
          train: dataset.train.length,
          validation: dataset.validation.length,
          test: dataset.test.length,
        },
        now,
        { error: error instanceof Error ? error.message : String(error) },
      );
      this.publish(state);
      return state;
    }
  }

  private assertOptions() {
    if (
      !Number.isInteger(this.options.totalEpochs) ||
      this.options.totalEpochs < 1 ||
      this.options.totalEpochs > 1000
    )
      throw new Error("Vision training epochs must be from 1 through 1000");
    if (
      !Number.isFinite(this.options.learningRate) ||
      this.options.learningRate <= 0 ||
      this.options.learningRate > 0.1
    )
      throw new Error(
        "Vision learning rate must be greater than 0 and at most 0.1",
      );
    if (
      !Number.isInteger(this.options.earlyStoppingPatience) ||
      this.options.earlyStoppingPatience < 1
    )
      throw new Error(
        "Vision early-stopping patience must be a positive integer",
      );
  }

  private publish(state: VisionTrainingState) {
    try {
      this.options.onStateUpdated?.(state);
    } catch {
      // UI observers must not corrupt or interrupt an already checkpointed run.
    }
  }

  private async execute(
    checkpoint: VisionTrainingCheckpoint,
    partitions: VisionPartitions,
  ): Promise<VisionTrainingState> {
    const now = this.options.now ?? Date.now;
    const yieldControl =
      this.options.yieldControl ??
      (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    this.active = true;
    const counts = {
      train: partitions.train.length,
      validation: partitions.validation.length,
      test: partitions.test.length,
    };

    const saveState = async (state: VisionTrainingState) => {
      checkpoint.state = state;
      await this.options.repository.save(checkpoint);
      this.publish(state);
    };
    const interruption = async (status: "paused" | "stopped") => {
      const state = createState(
        checkpoint.jobId,
        status,
        checkpoint.model?.trainingEpochs ?? 0,
        checkpoint.totalEpochs,
        counts,
        now,
        { validationMse: checkpoint.bestValidationMse },
      );
      await saveState(state);
      return state;
    };

    try {
      await this.options.repository.save(checkpoint);
      this.publish(checkpoint.state);
      while ((checkpoint.model?.trainingEpochs ?? 0) < checkpoint.totalEpochs) {
        if (this.stopRequested) return await interruption("stopped");
        if (this.pauseRequested) return await interruption("paused");
        const result = trainVisionDecoder(partitions.train, {
          epochs: 1,
          learningRate: checkpoint.learningRate,
          seed: checkpoint.seed,
          sessionSplits: checkpoint.sessionSplits,
          initialModel: checkpoint.model ?? undefined,
          now,
        });
        checkpoint.model = result.model;

        const trainRows = trainingReferences(partitions.train);
        const validationPredictions = predictExamples(
          result.model,
          partitions.validation,
        );
        const validation = evaluateVisionFrames(
          trainRows,
          validationPredictions.map(({ example, rgb }) => ({
            sessionId: example.sessionId,
            expected: asUnitRgb(example.rgb),
            predicted: rgb,
          })),
          checkpoint.sessionSplits,
          "validation",
        );
        if (
          checkpoint.bestValidationMse === null ||
          validation.modelMse < checkpoint.bestValidationMse
        ) {
          checkpoint.bestValidationMse = validation.modelMse;
          checkpoint.bestModel = result.model;
          checkpoint.staleEpochs = 0;
        } else {
          checkpoint.staleEpochs++;
        }
        checkpoint.state = createState(
          checkpoint.jobId,
          "running",
          result.model.trainingEpochs,
          checkpoint.totalEpochs,
          counts,
          now,
          { validationMse: validation.modelMse },
        );
        await this.options.repository.save(checkpoint);
        this.publish(checkpoint.state);
        await yieldControl();
        if (this.stopRequested) return await interruption("stopped");
        if (this.pauseRequested) return await interruption("paused");
        if (checkpoint.staleEpochs >= checkpoint.earlyStoppingPatience) break;
      }

      const bestModel = checkpoint.bestModel ?? checkpoint.model;
      if (!bestModel)
        throw new Error("Vision training finished without a model");
      const testPredictions = predictExamples(bestModel, partitions.test);
      const evaluation = evaluateVisionFrames(
        trainingReferences(partitions.train),
        testPredictions.map(({ example, rgb }) => ({
          sessionId: example.sessionId,
          expected: asUnitRgb(example.rgb),
          predicted: rgb,
        })),
        checkpoint.sessionSplits,
        "test",
      );
      const spatialPredictions = testPredictions.filter(
        ({ example }) => example.calibrationSeed !== null,
      );
      const spatialEvaluation = spatialPredictions.length
        ? evaluateVisionFrames(
            trainingReferences(partitions.train),
            spatialPredictions.map(({ example, rgb }) => ({
              sessionId: example.sessionId,
              expected: asUnitRgb(example.rgb),
              predicted: rgb,
            })),
            checkpoint.sessionSplits,
            "test",
          )
        : null;
      const classification = classificationAccuracy(bestModel, partitions.test);
      const calibrationSeedCount = new Set(
        partitions.test
          .map((example) => example.calibrationSeed)
          .filter((seed): seed is number => seed !== null),
      ).size;
      checkpoint.onnxModelData = serializeVisionDecoderToOnnx(bestModel);
      const completed = createState(
        checkpoint.jobId,
        "completed",
        bestModel.trainingEpochs,
        checkpoint.totalEpochs,
        counts,
        now,
        {
          validationMse: checkpoint.bestValidationMse,
          testMse: evaluation.modelMse,
          testMeanBaselineMse: evaluation.baselineMse,
          testConstantColorBaselineMse: evaluation.constantColorMse,
          spatialMse: spatialEvaluation?.modelMse ?? null,
          spatialBaselineMse: spatialEvaluation?.baselineMse ?? null,
          testColorAccuracy: classification.accuracy,
          testColorCount: classification.count,
          testSessionCount: evaluation.sessionCount,
          calibrationSeedCount,
        },
      );
      await saveState(completed);
      return completed;
    } catch (error) {
      const failed = createState(
        checkpoint.jobId,
        "failed",
        checkpoint.model?.trainingEpochs ?? 0,
        checkpoint.totalEpochs,
        counts,
        now,
        {
          validationMse: checkpoint.bestValidationMse,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      try {
        await saveState(failed);
      } catch {
        this.publish(failed);
      }
      return failed;
    } finally {
      this.active = false;
    }
  }
}
