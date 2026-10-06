import type {
  VisionTrainingDataset,
  VisionTrainingExample,
} from "@n-apt/demodulation/vision/visionDataset";
import {
  VisionTrainer,
  type VisionTrainingCheckpoint,
  type VisionTrainingRepository,
} from "@n-apt/demodulation/vision/visionTraining";

const example = (
  split: VisionTrainingExample["split"],
  sessionId: string,
  trialId: string,
  index: number,
  calibrationSeed: number | null,
  colorClassIndex: number | null,
): VisionTrainingExample => ({
  sessionId,
  trialId,
  artifactChecksum: index.toString(16).repeat(64).slice(0, 64),
  split,
  timestampBackendMs: 1000 + index * 100,
  frameIndex: index,
  calibrationSeed,
  features: new Float32Array(20_480).fill((index + 1) / 4),
  rgb: new Uint8Array(768).fill(index * 30),
  opponent: new Float32Array(768).fill(index / 10),
  colorClassIndex,
});

const dataset: VisionTrainingDataset = {
  train: [
    example("train", "train-session", "train-a", 0, 11, null),
    example("train", "train-session", "train-b", 1, null, 1),
  ],
  validation: [
    example("validation", "validation-session", "validation-a", 2, 22, null),
  ],
  test: [
    example("test", "test-session", "test-a", 3, 33, null),
    example("test", "test-session", "test-b", 4, null, 1),
  ],
  excludedTransitionCount: 0,
};
const assignments = {
  "train-session": "train",
  "validation-session": "validation",
  "test-session": "test",
} as const;

class MemoryVisionTrainingRepository implements VisionTrainingRepository {
  checkpoints = new Map<string, VisionTrainingCheckpoint>();
  async load(jobId: string) {
    return this.checkpoints.get(jobId);
  }
  async save(checkpoint: VisionTrainingCheckpoint) {
    this.checkpoints.set(checkpoint.jobId, checkpoint);
  }
}

describe("checkpointed vision training and held-out evaluation", () => {
  test("pauses, resumes, exports ONNX, and evaluates separate color/spatial holdouts", async () => {
    const repository = new MemoryVisionTrainingRepository();
    let trainer!: VisionTrainer;
    let pauseRequested = false;
    trainer = new VisionTrainer({
      repository,
      totalEpochs: 2,
      seed: 73,
      learningRate: 0.005,
      earlyStoppingPatience: 4,
      onStateUpdated(state) {
        if (
          state.status === "running" &&
          state.epoch === 1 &&
          !pauseRequested
        ) {
          pauseRequested = true;
          trainer.pause();
        }
      },
    });

    const paused = await trainer.start("vision-job-1", dataset, assignments);
    expect(paused.status).toBe("paused");
    expect(repository.checkpoints.get("vision-job-1")?.state.epoch).toBe(1);

    const resumed = await new VisionTrainer({
      repository,
      totalEpochs: 2,
      seed: 73,
      learningRate: 0.005,
      earlyStoppingPatience: 4,
    }).resume("vision-job-1", dataset, assignments);
    const checkpoint = repository.checkpoints.get("vision-job-1");
    expect(resumed.status).toBe("completed");
    expect(resumed.epoch).toBe(2);
    expect(resumed.testSessionCount).toBe(1);
    expect(Number.isFinite(resumed.testMse)).toBe(true);
    expect(Number.isFinite(resumed.testMeanBaselineMse)).toBe(true);
    expect(Number.isFinite(resumed.spatialMse)).toBe(true);
    expect(resumed.testColorAccuracy).toBeGreaterThanOrEqual(0);
    expect(resumed.testColorAccuracy).toBeLessThanOrEqual(1);
    expect(resumed.modelStatus).toBe("experimental");
    expect(checkpoint?.onnxModelData?.byteLength).toBeGreaterThan(0);
    expect(checkpoint?.state.calibrationSeedCount).toBe(1);
  });

  test("does not reuse a checkpoint for a changed source corpus", async () => {
    const repository = new MemoryVisionTrainingRepository();
    const options = {
      repository,
      totalEpochs: 1,
      seed: 91,
      learningRate: 0.005,
    };
    await new VisionTrainer(options).start(
      "vision-job-2",
      dataset,
      assignments,
    );
    const changed: VisionTrainingDataset = {
      ...dataset,
      train: dataset.train.map((item, index) =>
        index === 0 ? { ...item, artifactChecksum: "f".repeat(64) } : item,
      ),
    };
    const restarted = await new VisionTrainer(options).start(
      "vision-job-2",
      changed,
      assignments,
    );
    expect(restarted.status).toBe("completed");
    expect(restarted.epoch).toBe(1);
    expect(
      repository.checkpoints.get("vision-job-2")?.sourceArtifactIds,
    ).toContain(`train-a:${"f".repeat(64)}`);
  });

  test("does not resume when timeline labels change under the same capture checksum", async () => {
    const repository = new MemoryVisionTrainingRepository();
    const options = {
      repository,
      totalEpochs: 1,
      seed: 24,
      learningRate: 0.005,
    };
    await new VisionTrainer(options).start(
      "vision-job-labels",
      dataset,
      assignments,
    );
    const changedDataset: VisionTrainingDataset = {
      ...dataset,
      validation: dataset.validation.map((item) => ({
        ...item,
        rgb: item.rgb.slice().fill(17),
      })),
    };
    const resumed = await new VisionTrainer(options).resume(
      "vision-job-labels",
      changedDataset,
      assignments,
    );
    expect(resumed.status).toBe("failed");
    expect(resumed.error).toMatch(/corpus|labels/i);
  });

  test("prevents two concurrent resumes from advancing one job", async () => {
    const repository = new MemoryVisionTrainingRepository();
    let trainer!: VisionTrainer;
    let pauseRequested = false;
    trainer = new VisionTrainer({
      repository,
      totalEpochs: 2,
      seed: 36,
      learningRate: 0.005,
      onStateUpdated(state) {
        if (
          state.status === "running" &&
          state.epoch === 1 &&
          !pauseRequested
        ) {
          pauseRequested = true;
          trainer.pause();
        }
      },
    });
    const paused = await trainer.start(
      "vision-job-concurrent",
      dataset,
      assignments,
    );
    expect(paused.status).toBe("paused");

    const resumes = await Promise.all([
      trainer.resume("vision-job-concurrent", dataset, assignments),
      trainer.resume("vision-job-concurrent", dataset, assignments),
    ]);
    expect(resumes.map((state) => state.status).sort()).toEqual([
      "completed",
      "failed",
    ]);
    expect(resumes.find((state) => state.status === "failed")?.error).toMatch(
      /active job/i,
    );
  });

  test("fails closed when required splits are absent or calibration seeds leak", async () => {
    const repository = new MemoryVisionTrainingRepository();
    const missingSplit = await new VisionTrainer({
      repository,
      totalEpochs: 1,
    }).start("vision-job-3", { ...dataset, test: [] }, assignments);
    expect(missingSplit.status).toBe("failed");
    expect(missingSplit.error).toMatch(/train, validation, and test/i);

    const leakingDataset = {
      ...dataset,
      test: [{ ...dataset.test[0], calibrationSeed: 11 }, dataset.test[1]],
    };
    const leak = await new VisionTrainer({
      repository,
      totalEpochs: 1,
    }).start("vision-job-4", leakingDataset, assignments);
    expect(leak.status).toBe("failed");
    expect(leak.error).toMatch(/seed/i);
  });
});
