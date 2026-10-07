import {
  visionPairSchema,
  VISION_HEIGHT,
  VISION_PREPROCESSING,
  VISION_WIDTH,
  sameVisionFrequencyGrid,
  visionFrequencyGridSchema,
  type VisionPair,
  type VisionSplit,
  type VisionFrequencyGrid,
} from "./visionModel";
import { rgbToOpponent, visionTargetForInterval } from "./visionReference";
import {
  VISION_FEATURE_COUNT,
  visionFeatureSampleMatchesConfig,
  type VisionFeatureSample,
} from "./visionPreprocessing";

export interface VisionTrainingExample {
  sessionId: string;
  trialId: string;
  artifactChecksum: string;
  split: VisionSplit;
  timestampBackendMs: number;
  frameIndex: number;
  frequencyGrid: VisionFrequencyGrid;
  calibrationSeed: number | null;
  features: Float32Array;
  rgb: Uint8Array;
  opponent: Float32Array;
  /** S, M, L, Red index; calibration targets have no single-color class. */
  colorClassIndex: number | null;
}

export interface VisionTrainingDataset {
  train: VisionTrainingExample[];
  validation: VisionTrainingExample[];
  test: VisionTrainingExample[];
  excludedTransitionCount: number;
}

export const VISION_TRAINING_DATASET_FORMAT =
  "napt-vision-training-jsonl" as const;
export const VISION_TRAINING_DATASET_VERSION = 1 as const;

/**
 * Serialize already paired, transition-filtered feature/reference examples for
 * offline Python training. This contains derived features and RGB targets, not
 * raw I/Q or decryption material.
 */
export function serializeVisionTrainingDataset(
  dataset: VisionTrainingDataset,
  assignments: Readonly<Record<string, VisionSplit>>,
): string {
  const partitions = {
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
      "Offline vision training requires train, validation, and test examples",
    );
  if (
    !Number.isSafeInteger(dataset.excludedTransitionCount) ||
    dataset.excludedTransitionCount < 0
  )
    throw new Error("Invalid excluded vision transition count");

  const sessionSplits = Object.fromEntries(
    Object.entries(assignments).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ) as Record<string, VisionSplit>;
  if (
    !Object.entries(sessionSplits).length ||
    Object.entries(sessionSplits).some(
      ([sessionId, split]) =>
        !sessionId || !["train", "validation", "test"].includes(split),
    )
  )
    throw new Error("Explicit session assignments are required");

  const rows: Array<Record<string, unknown>> = [];
  const trialIdentity = new Map<
    string,
    { sessionId: string; artifactChecksum: string; split: VisionSplit }
  >();
  const captureIdentity = new Map<
    string,
    { trialId: string; sessionId: string; split: VisionSplit }
  >();
  const calibrationSeeds = new Map<number, VisionSplit>();
  const seenContexts = new Set<string>();
  let frequencyGrid: VisionFrequencyGrid | null = null;
  for (const split of ["train", "validation", "test"] as const) {
    for (const example of partitions[split]) {
      if (
        !example.sessionId ||
        !Object.prototype.hasOwnProperty.call(
          sessionSplits,
          example.sessionId,
        ) ||
        sessionSplits[example.sessionId] !== split ||
        example.split !== split
      )
        throw new Error("Every vision example must match its session split");
      if (
        !example.trialId ||
        !/^[a-f0-9]{64}$/.test(example.artifactChecksum) ||
        !Number.isFinite(example.timestampBackendMs) ||
        !Number.isSafeInteger(example.frameIndex) ||
        example.frameIndex < 0
      )
        throw new Error("Invalid vision training example identity");
      const grid = visionFrequencyGridSchema.parse(example.frequencyGrid);
      if (frequencyGrid && !sameVisionFrequencyGrid(frequencyGrid, grid))
        throw new Error(
          "Offline vision dataset must share one RF frequency grid",
        );
      frequencyGrid = grid;
      if (
        !(example.features instanceof Float32Array) ||
        example.features.length !== VISION_FEATURE_COUNT ||
        !example.features.every(Number.isFinite) ||
        !(example.opponent instanceof Float32Array) ||
        example.opponent.length !== VISION_WIDTH * VISION_HEIGHT * 3 ||
        !example.opponent.every(Number.isFinite) ||
        !(example.rgb instanceof Uint8Array) ||
        example.rgb.length !== VISION_WIDTH * VISION_HEIGHT * 3
      )
        throw new Error("Invalid vision training tensor shape or values");
      if (
        example.colorClassIndex !== null &&
        (!Number.isInteger(example.colorClassIndex) ||
          example.colorClassIndex < 0 ||
          example.colorClassIndex >= 4)
      )
        throw new Error("Invalid vision solid-color class label");
      if (example.calibrationSeed !== null) {
        if (
          !Number.isSafeInteger(example.calibrationSeed) ||
          example.calibrationSeed < 0 ||
          example.calibrationSeed > 0xffffffff
        )
          throw new Error("Invalid vision calibration seed");
        const priorSplit = calibrationSeeds.get(example.calibrationSeed);
        if (priorSplit && priorSplit !== split)
          throw new Error("Calibration seed leaked across session splits");
        calibrationSeeds.set(example.calibrationSeed, split);
      }

      const priorTrial = trialIdentity.get(example.trialId);
      if (
        priorTrial &&
        (priorTrial.sessionId !== example.sessionId ||
          priorTrial.artifactChecksum !== example.artifactChecksum ||
          priorTrial.split !== split)
      )
        throw new Error("A trial cannot identify multiple captures or splits");
      trialIdentity.set(example.trialId, {
        sessionId: example.sessionId,
        artifactChecksum: example.artifactChecksum,
        split,
      });
      const priorCapture = captureIdentity.get(example.artifactChecksum);
      if (
        priorCapture &&
        (priorCapture.trialId !== example.trialId ||
          priorCapture.sessionId !== example.sessionId ||
          priorCapture.split !== split)
      )
        throw new Error("Capture artifact is reused across trials or splits");
      captureIdentity.set(example.artifactChecksum, {
        trialId: example.trialId,
        sessionId: example.sessionId,
        split,
      });
      const contextId = `${example.trialId}:${example.frameIndex}:${example.timestampBackendMs}`;
      if (seenContexts.has(contextId))
        throw new Error("Duplicate vision feature context");
      seenContexts.add(contextId);

      rows.push({
        type: "example",
        sessionId: example.sessionId,
        trialId: example.trialId,
        artifactChecksum: example.artifactChecksum,
        split,
        timestampBackendMs: example.timestampBackendMs,
        frameIndex: example.frameIndex,
        frequencyGrid: grid,
        calibrationSeed: example.calibrationSeed,
        features: Array.from(example.features),
        opponent: Array.from(example.opponent),
        rgb: Array.from(example.rgb),
        colorClassIndex: example.colorClassIndex,
      });
    }
  }
  if (!frequencyGrid)
    throw new Error("Offline vision dataset requires an RF frequency grid");

  const manifest = {
    type: "manifest",
    format: VISION_TRAINING_DATASET_FORMAT,
    version: VISION_TRAINING_DATASET_VERSION,
    preprocessing: VISION_PREPROCESSING,
    target: {
      width: VISION_WIDTH,
      height: VISION_HEIGHT,
      fps: 10,
      coordinates: "opponent",
      colorTransform: "linear-srgb-lms-opponent-v1",
    },
    frequencyGrid,
    sessionSplits,
    exampleCount: rows.length,
    excludedTransitionCount: dataset.excludedTransitionCount,
  };
  return (
    [manifest, ...rows].map((row) => JSON.stringify(row)).join("\n") + "\n"
  );
}

/**
 * Turn producer-verified feature contexts into labels derived from the paired
 * reference timeline. Raw feature extraction and capture-file hash verification
 * remain the responsibility of the source reader.
 */
export function buildVisionTrainingDataset(
  pairs: readonly VisionPair[],
  featureSamples: readonly VisionFeatureSample[],
  assignments: Readonly<Record<string, VisionSplit>>,
): VisionTrainingDataset {
  const partitions = partitionVisionPairs(pairs, assignments);
  const byTrial = new Map<string, VisionPair>();
  for (const split of ["train", "validation", "test"] as const)
    for (const pair of partitions[split])
      byTrial.set(pair.config.trialId, pair);

  const result: VisionTrainingDataset = {
    train: [],
    validation: [],
    test: [],
    excludedTransitionCount: 0,
  };
  const seenContexts = new Set<string>();
  const presetNames = ["S", "M", "L", "Red"] as const;

  for (const sample of featureSamples) {
    const pair = byTrial.get(sample.trialId);
    if (!pair)
      throw new Error("Feature context has no complete reference trial");
    if (sample.artifactChecksum !== pair.artifact.checksum)
      throw new Error(
        "Feature context artifact checksum does not match its reference",
      );
    if (!visionFeatureSampleMatchesConfig(sample, pair.config)) {
      if (sample.optionsRevision !== pair.config.optionsRevision)
        throw new Error("Feature context options revision mismatch");
      if (sample.sourceId !== pair.config.sourceId)
        throw new Error("Feature context source mismatch");
      if (sample.streamEpoch !== pair.config.streamEpoch)
        throw new Error("Feature context stream epoch mismatch");
      if (sample.sampleRateHz !== pair.config.sampleRateHz)
        throw new Error("Feature context sample rate mismatch");
      throw new Error("Feature context tuning mismatch");
    }
    if (
      !(sample.features instanceof Float32Array) ||
      sample.features.length !== VISION_FEATURE_COUNT ||
      !sample.features.every(Number.isFinite)
    )
      throw new Error("Invalid vision feature tensor");
    if (
      !Number.isSafeInteger(sample.firstSampleIndex) ||
      sample.firstSampleIndex < pair.acquisition.firstSampleIndex
    )
      throw new Error("Feature context sample range begins before acquisition");

    const contextSamples =
      (sample.sampleRateHz * VISION_PREPROCESSING.contextMs) / 1000;
    if (!Number.isSafeInteger(contextSamples))
      throw new Error("Feature context sample rate is not frame aligned");
    const acquisitionEnd =
      pair.acquisition.firstSampleIndex + pair.acquisition.sampleCount;
    const contextEnd = sample.firstSampleIndex + contextSamples;
    if (contextEnd > acquisitionEnd || contextEnd <= sample.firstSampleIndex)
      throw new Error("Feature context sample range exceeds acquisition");

    const contextStartBackendMs =
      pair.acquisition.startBackendMs +
      ((sample.firstSampleIndex - pair.acquisition.firstSampleIndex) * 1000) /
        pair.config.sampleRateHz;
    const expectedTimestamp =
      contextStartBackendMs + VISION_PREPROCESSING.contextMs;
    if (
      !Number.isFinite(sample.timestampBackendMs) ||
      Math.abs(sample.timestampBackendMs - expectedTimestamp) > 1
    )
      throw new Error(
        "Feature context timestamp does not match producer sample range",
      );

    const contextKey = `${sample.trialId}:${sample.firstSampleIndex}`;
    if (seenContexts.has(contextKey))
      throw new Error("Duplicate feature context in vision dataset");
    seenContexts.add(contextKey);

    const target = visionTargetForInterval(
      pair,
      contextStartBackendMs,
      expectedTimestamp,
    );
    if (!target) {
      result.excludedTransitionCount++;
      continue;
    }
    const { rgb } = target;
    const opponent = new Float32Array(VISION_WIDTH * VISION_HEIGHT * 3);
    for (let pixel = 0; pixel < VISION_WIDTH * VISION_HEIGHT; pixel++) {
      const offset = pixel * 3;
      opponent.set(
        rgbToOpponent([rgb[offset], rgb[offset + 1], rgb[offset + 2]]),
        offset,
      );
    }
    result[assignments[pair.config.sessionId]].push({
      sessionId: pair.config.sessionId,
      trialId: pair.config.trialId,
      artifactChecksum: pair.artifact.checksum,
      split: assignments[pair.config.sessionId],
      timestampBackendMs: sample.timestampBackendMs,
      frameIndex: target.frameIndex,
      frequencyGrid: {
        centerFrequencyHz: sample.centerFrequencyHz,
        sampleRateHz: sample.sampleRateHz,
      },
      calibrationSeed:
        pair.config.stimulus.kind === "calibration"
          ? pair.config.stimulus.seed
          : null,
      features: sample.features,
      rgb,
      opponent,
      colorClassIndex:
        pair.config.stimulus.kind === "solid"
          ? presetNames.indexOf(pair.config.stimulus.preset)
          : null,
    });
  }
  return result;
}

export function partitionVisionPairs(
  pairs: readonly VisionPair[],
  assignments: Readonly<Record<string, VisionSplit>>,
) {
  const result: Record<VisionSplit, VisionPair[]> = {
    train: [],
    validation: [],
    test: [],
  };
  const captures = new Set<string>(),
    trials = new Set<string>();
  const seedSplits = new Map<number, VisionSplit>();
  for (const input of pairs) {
    const pair = visionPairSchema.parse(input);
    if (pair.status !== "complete")
      throw new Error("Cannot train on an incomplete reference");
    const split = assignments[pair.config.sessionId];
    if (!["train", "validation", "test"].includes(split))
      throw new Error("Explicit session assignment required");
    if (captures.has(pair.artifact.checksum))
      throw new Error("Duplicate capture across dataset");
    if (trials.has(pair.config.trialId))
      throw new Error("Duplicate trial across dataset");
    if (pair.config.stimulus.kind === "calibration") {
      const seed = pair.config.stimulus.seed;
      const previous = seedSplits.get(seed);
      if (previous && previous !== split)
        throw new Error("Calibration seed reused across splits");
      seedSplits.set(seed, split);
    }
    captures.add(pair.artifact.checksum);
    trials.add(pair.config.trialId);
    result[split].push(pair);
  }
  return result;
}
const vector = (values: ArrayLike<number>, length: number) => {
  if (!length || values.length !== length)
    throw new Error("Invalid feature shape or value");
  for (let index = 0; index < length; index++)
    if (!Number.isFinite(values[index]))
      throw new Error("Invalid feature shape or value");
};
export function fitVisionNormalization(
  rows: readonly { sessionId: string; features: ArrayLike<number> }[],
  sessionSplits: Readonly<Record<string, VisionSplit>>,
) {
  const training = rows.filter((row) => {
    const assigned =
      row.sessionId &&
      Object.prototype.hasOwnProperty.call(sessionSplits, row.sessionId)
        ? sessionSplits[row.sessionId]
        : undefined;
    if (!assigned || !["train", "validation", "test"].includes(assigned))
      throw new Error("Explicit session assignment required");
    return assigned === "train";
  });
  if (!training.length) throw new Error("Training rows required");
  const size = training[0].features.length;
  const mean = Array<number>(size).fill(0),
    m2 = Array<number>(size).fill(0);
  training.forEach(({ features }, n) => {
    vector(features, size);
    for (let i = 0; i < size; i++) {
      const x = features[i];
      const delta = x - mean[i];
      mean[i] += delta / (n + 1);
      m2[i] += delta * (x - mean[i]);
    }
  });
  return {
    mean,
    scale: m2.map((x) => Math.max(1e-6, Math.sqrt(x / training.length))),
  };
}
export function normalizeVisionFeatures(
  features: ArrayLike<number>,
  stats: { mean: number[]; scale: number[] },
) {
  vector(features, stats.mean.length);
  vector(stats.mean, features.length);
  vector(stats.scale, features.length);
  if (stats.scale.some((x) => x <= 0))
    throw new Error("Invalid normalization scale");
  return Array.from(
    { length: features.length },
    (_, index) => (features[index] - stats.mean[index]) / stats.scale[index],
  );
}
/** Inputs are normalized sRGB. The baseline is computed from assigned train sessions.
 * No automatic promotion: mean-image MSE alone cannot establish spatial decoding. */
export function evaluateVisionFrames(
  trainingFrames: readonly {
    sessionId: string;
    expected: readonly number[];
  }[],
  testFrames: readonly {
    sessionId: string;
    expected: readonly number[];
    predicted: readonly number[];
  }[],
  sessionSplits: Readonly<Record<string, VisionSplit>>,
  evaluationSplit: "validation" | "test" = "test",
) {
  if (!trainingFrames.length)
    throw new Error("Training reference frames required");
  if (!testFrames.length) throw new Error("Held-out test frames required");
  const assertRgb = (values: readonly number[]) => {
    vector(values, 768);
    if (values.some((x) => x < 0 || x > 1))
      throw new Error("Expected normalized RGB");
  };
  const trainingSessions = new Set<string>();
  const testSessions = new Set<string>();
  const trainingMeanImage = Array<number>(768).fill(0);
  const trainingMeanColor = Array<number>(3).fill(0);
  trainingFrames.forEach((frame, row) => {
    if (
      !frame.sessionId ||
      !Object.prototype.hasOwnProperty.call(sessionSplits, frame.sessionId) ||
      sessionSplits[frame.sessionId] !== "train"
    )
      throw new Error(
        "Training reference must belong to an assigned training session",
      );
    assertRgb(frame.expected);
    trainingSessions.add(frame.sessionId);
    frame.expected.forEach((value, i) => {
      trainingMeanImage[i] += (value - trainingMeanImage[i]) / (row + 1);
      trainingMeanColor[i % 3] += value;
    });
  });
  for (let channel = 0; channel < 3; channel++)
    trainingMeanColor[channel] /= trainingFrames.length * 256;
  let model = 0,
    baseline = 0,
    constantColor = 0;
  for (const frame of testFrames) {
    if (
      !frame.sessionId ||
      !Object.prototype.hasOwnProperty.call(sessionSplits, frame.sessionId) ||
      sessionSplits[frame.sessionId] !== evaluationSplit
    )
      throw new Error(
        `Held-out frame must belong to an assigned ${evaluationSplit} session`,
      );
    if (trainingSessions.has(frame.sessionId))
      throw new Error("Training and test sessions must be disjoint");
    assertRgb(frame.expected);
    assertRgb(frame.predicted);
    testSessions.add(frame.sessionId);
    frame.expected.forEach((x, i) => {
      model += (x - frame.predicted[i]) ** 2;
      baseline += (x - trainingMeanImage[i]) ** 2;
      constantColor += (x - trainingMeanColor[i % 3]) ** 2;
    });
  }
  return {
    frameCount: testFrames.length,
    sessionCount: testSessions.size,
    evaluationSplit,
    modelMse: model / (testFrames.length * 768),
    baselineMse: baseline / (testFrames.length * 768),
    constantColorMse: constantColor / (testFrames.length * 768),
  };
}
