import type { VisionTrainingExample } from "@n-apt/demodulation/vision/visionDataset";
import {
  predictVisionDecoder,
  trainVisionDecoder,
} from "@n-apt/demodulation/vision/visionMl";
import { VISION_FEATURE_COUNT } from "@n-apt/demodulation/vision/visionPreprocessing";

const examples: VisionTrainingExample[] = Array.from(
  { length: 4 },
  (_, index) => ({
    sessionId: index < 2 ? "train-a" : "train-b",
    trialId: `trial-${index}`,
    artifactChecksum: String(index).padStart(64, "0"),
    split: "train",
    timestampBackendMs: 1000 + index * 100,
    frameIndex: index,
    calibrationSeed: null,
    features: new Float32Array(VISION_FEATURE_COUNT).fill(index / 3),
    rgb: new Uint8Array(768).fill(index * 32),
    opponent: new Float32Array(768).fill(index / 10),
    colorClassIndex: index,
  }),
);
const sessionSplits = { "train-a": "train", "train-b": "train" } as const;
const train = (
  epochs: number,
  initialModel?: Parameters<typeof trainVisionDecoder>[1]["initialModel"],
) =>
  trainVisionDecoder(examples, {
    epochs,
    learningRate: 0.01,
    seed: 31,
    sessionSplits,
    initialModel,
  });

describe("compact vision neural decoder", () => {
  test("trains deterministically and resumes from an equivalent epoch checkpoint", () => {
    const complete = train(2);
    const repeat = train(2);
    const resumed = train(1, train(1).model);

    expect(complete.model.trainingEpochs).toBe(2);
    expect(complete.model.inputMean).toHaveLength(VISION_FEATURE_COUNT);
    expect(complete.model.inputScale.every((value) => value > 0)).toBe(true);
    expect(
      complete.model.temporalWeights.every(
        (value, index) => value === repeat.model.temporalWeights[index],
      ),
    ).toBe(true);
    expect(
      complete.model.opponentWeights.every(
        (value, index) => value === repeat.model.opponentWeights[index],
      ),
    ).toBe(true);
    expect(
      complete.model.colorWeights.every(
        (value, index) => value === repeat.model.colorWeights[index],
      ),
    ).toBe(true);
    expect(
      complete.model.opponentWeights.every(
        (value, index) => value === resumed.model.opponentWeights[index],
      ),
    ).toBe(true);
    expect(Number.isFinite(complete.metrics.imageMse)).toBe(true);
    expect(Number.isFinite(complete.metrics.colorCrossEntropy)).toBe(true);
    expect(complete.metrics.exampleCount).toBe(examples.length);
  });

  test("predicts a validated RGB reconstruction and leaves confidence uncalibrated", () => {
    const { model } = train(1);
    const result = predictVisionDecoder(model, examples[0].features, {
      sourceId: "rx",
      timestampBackendMs: 1234,
    });
    expect(result.frame.rgb).toHaveLength(768);
    expect(result.frame.rgb.every((value) => value >= 0 && value <= 1)).toBe(
      true,
    );
    expect(result.frame.confidence).toBeNull();
    expect(result.colorLogits).toHaveLength(4);
  });

  test("rejects held-out sessions, malformed tensors, and incompatible checkpoints", () => {
    expect(() =>
      trainVisionDecoder([{ ...examples[0], split: "test" }], {
        sessionSplits: { "train-a": "test" },
      }),
    ).toThrow(/training session/i);
    expect(() =>
      trainVisionDecoder([{ ...examples[0], features: new Float32Array(2) }], {
        sessionSplits,
      }),
    ).toThrow(/feature tensor/i);
    const { model } = train(1);
    expect(() =>
      train(examples.length, {
        ...model,
        version: 0,
      } as never),
    ).toThrow(/checkpoint/i);
  });
});
