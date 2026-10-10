import {
  serializeVisionTrainingDataset,
  type VisionTrainingDataset,
  type VisionTrainingExample,
} from "@n-apt/demodulation/vision/visionDataset";
import { VISION_FEATURE_COUNT } from "@n-apt/demodulation/vision/visionPreprocessing";

const frequencyGrid = {
  centerFrequencyHz: 100_000_000,
  sampleRateHz: 3_200_000,
};

const example = (
  sessionId: string,
  split: "train" | "validation" | "test",
  trialId: string,
): VisionTrainingExample => ({
  sessionId,
  trialId,
  artifactChecksum: (trialId === "train-trial"
    ? "1"
    : trialId === "validation-trial"
      ? "2"
      : "3"
  ).padStart(64, "0"),
  split,
  timestampBackendMs: 1_000,
  frameIndex: 0,
  frequencyGrid,
  calibrationSeed: null,
  features: new Float32Array(VISION_FEATURE_COUNT).fill(0.25),
  rgb: new Uint8Array(768).fill(127),
  opponent: new Float32Array(768).fill(0.1),
  colorClassIndex: null,
});

const dataset: VisionTrainingDataset = {
  train: [example("train-session", "train", "train-trial")],
  validation: [example("validation-session", "validation", "validation-trial")],
  test: [example("test-session", "test", "test-trial")],
  excludedTransitionCount: 2,
};

const sessionSplits = {
  "train-session": "train",
  "validation-session": "validation",
  "test-session": "test",
} as const;

describe("offline vision training interchange", () => {
  test("exports versioned paired features with explicit whole-session splits", () => {
    const lines = serializeVisionTrainingDataset(dataset, sessionSplits)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({
      type: "manifest",
      format: "napt-vision-training-jsonl",
      version: 1,
      preprocessing: {
        version: 2,
        fftSize: 1024,
        hopSamples: 512,
        window: "hann-periodic",
        temporalSlices: 10,
        contextMs: 30,
        featureOrder: ["logPower", "phaseDelta"],
        iqEncoding: "u8-interleaved",
        normalization: "(value-128)/127",
        binOrder: "fftshift",
        phaseUnit: "radians",
        tensorShape: [10, 1024, 2],
        power: "log1p(magnitudeSquared/windowEnergy)",
        phaseDelta:
          "arg(current*conjugate(previous)); zero for first or zero-power bin",
        aggregation: "mean logPower and circular-mean phaseDelta per 3ms slice",
        context: "preceding 30ms; reject missing slices and discontinuities",
      },
      target: {
        width: 16,
        height: 16,
        fps: 10,
        coordinates: "opponent",
        colorTransform: "linear-srgb-lms-opponent-v1",
      },
      sessionSplits,
      exampleCount: 3,
      excludedTransitionCount: 2,
    });
    expect(lines[1]).toMatchObject({
      type: "example",
      sessionId: "train-session",
      split: "train",
      trialId: "train-trial",
      frequencyGrid,
      colorClassIndex: null,
    });
    expect(lines[1].features).toHaveLength(VISION_FEATURE_COUNT);
    expect(lines[1].opponent).toHaveLength(768);
    expect(lines[1].rgb).toHaveLength(768);
  });

  test("refuses incomplete partitions, split mismatches, and mixed RF grids", () => {
    expect(() =>
      serializeVisionTrainingDataset({ ...dataset, test: [] }, sessionSplits),
    ).toThrow(/train, validation, and test/i);
    expect(() =>
      serializeVisionTrainingDataset(
        {
          ...dataset,
          train: [example("test-session", "train", "other-trial")],
        },
        sessionSplits,
      ),
    ).toThrow(/session split/i);
    expect(() =>
      serializeVisionTrainingDataset(
        {
          ...dataset,
          test: [
            {
              ...dataset.test[0],
              frequencyGrid: {
                ...frequencyGrid,
                centerFrequencyHz: 101_000_000,
              },
            },
          ],
        },
        sessionSplits,
      ),
    ).toThrow(/frequency grid/i);
    expect(() =>
      serializeVisionTrainingDataset(
        {
          ...dataset,
          train: [
            ...dataset.train,
            {
              ...example("train-session", "train", "other-trial"),
              artifactChecksum: dataset.train[0].artifactChecksum,
              timestampBackendMs: 1_100,
            },
          ],
        },
        sessionSplits,
      ),
    ).toThrow(/capture artifact/i);
  });
});
