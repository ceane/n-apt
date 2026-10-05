import {
  visionPairSchema,
  type VisionPair,
  type VisionSplit,
} from "./visionModel";

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
const vector = (values: readonly number[], length: number) => {
  if (!length || values.length !== length || !values.every(Number.isFinite))
    throw new Error("Invalid feature shape or value");
};
export function fitVisionNormalization(
  rows: readonly { split: VisionSplit; features: readonly number[] }[],
) {
  const training = rows.filter((row) => row.split === "train");
  if (!training.length) throw new Error("Training rows required");
  const size = training[0].features.length;
  const mean = Array<number>(size).fill(0),
    m2 = Array<number>(size).fill(0);
  training.forEach(({ features }, n) => {
    vector(features, size);
    features.forEach((x, i) => {
      const delta = x - mean[i];
      mean[i] += delta / (n + 1);
      m2[i] += delta * (x - mean[i]);
    });
  });
  return {
    mean,
    scale: m2.map((x) => Math.max(1e-6, Math.sqrt(x / training.length))),
  };
}
export function normalizeVisionFeatures(
  features: readonly number[],
  stats: { mean: number[]; scale: number[] },
) {
  vector(features, stats.mean.length);
  vector(stats.mean, features.length);
  vector(stats.scale, features.length);
  if (stats.scale.some((x) => x <= 0))
    throw new Error("Invalid normalization scale");
  return features.map((x, i) => (x - stats.mean[i]) / stats.scale[i]);
}
/** Inputs are normalized sRGB. Baseline MUST be fitted on training sessions only.
 * No automatic promotion: mean-image MSE alone cannot establish spatial decoding. */
export function evaluateVisionFrames(
  frames: readonly {
    expected: readonly number[];
    predicted: readonly number[];
  }[],
  trainingMeanImage: readonly number[],
) {
  if (!frames.length) throw new Error("Held-out frames required");
  vector(trainingMeanImage, 768);
  let model = 0,
    baseline = 0;
  for (const frame of frames) {
    vector(frame.expected, 768);
    vector(frame.predicted, 768);
    if (
      [...frame.expected, ...frame.predicted, ...trainingMeanImage].some(
        (x) => x < 0 || x > 1,
      )
    )
      throw new Error("Expected normalized RGB");
    frame.expected.forEach((x, i) => {
      model += (x - frame.predicted[i]) ** 2;
      baseline += (x - trainingMeanImage[i]) ** 2;
    });
  }
  return {
    frameCount: frames.length,
    modelMse: model / (frames.length * 768),
    baselineMse: baseline / (frames.length * 768),
  };
}
