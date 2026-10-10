/** @jest-environment node */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VisionTrainingExample } from "@n-apt/demodulation/vision/visionDataset";
import {
  predictVisionDecoder,
  trainVisionDecoder,
} from "@n-apt/demodulation/vision/visionML";
import { serializeVisionDecoderToOnnx } from "@n-apt/demodulation/vision/visionOnnx";
import {
  createVisionOnnxRuntimeFromPythonArtifact,
  type VisionPythonDecoderManifest,
} from "@n-apt/demodulation/vision/visionPythonArtifact";
import {
  createVisionOnnxRuntime,
  visionOnnxOutputToDecodedFrame,
  validateVisionOnnxBatch,
} from "@n-apt/demodulation/vision/visionOnnxRuntime";
import { VISION_FEATURE_COUNT } from "@n-apt/demodulation/vision/visionPreprocessing";

const frequencyGrid = {
  centerFrequencyHz: 100_000_000,
  sampleRateHz: 3_200_000,
};
const examples: VisionTrainingExample[] = [0, 1].map((index) => ({
  sessionId: "train-session",
  trialId: `trial-${index}`,
  artifactChecksum: String(index).padStart(64, "0"),
  split: "train",
  timestampBackendMs: 1000 + index * 100,
  frameIndex: index,
  frequencyGrid,
  calibrationSeed: null,
  features: new Float32Array(VISION_FEATURE_COUNT).fill(index),
  rgb: new Uint8Array(768).fill(index * 255),
  opponent: new Float32Array(768).fill(index * 0.5),
  colorClassIndex: index === 0 ? 0 : 3,
}));

describe("vision ONNX export and local inference", () => {
  test("exports dynamic batches with CPU/ONNX parity", async () => {
    const { model } = trainVisionDecoder(examples, {
      epochs: 1,
      seed: 19,
      sessionSplits: { "train-session": "train" },
    });
    const rows = [
      new Float32Array(VISION_FEATURE_COUNT).fill(0.2),
      new Float32Array(VISION_FEATURE_COUNT).fill(0.8),
    ];
    const windows = Float32Array.from(rows.flatMap((row) => Array.from(row)));
    const onnx = serializeVisionDecoderToOnnx(model);
    const manifest: VisionPythonDecoderManifest = {
      format: "napt-vision-decoder",
      artifactVersion: 1,
      modelVersion: 2,
      modelId: "vision-decoder-test",
      architecture: "freq-conv-temporal-v2",
      modelFile: "vision_decoder.onnx",
      modelSha256: createHash("sha256").update(onnx).digest("hex"),
      datasetSha256: "a".repeat(64),
      preprocessingVersion: 2,
      featureShape: [10, 1024, 2],
      referenceVersion: 1,
      colorTransform: "linear-srgb-lms-opponent-v1",
      frequencyGrid,
      output: { width: 16, height: 16, fps: 10, coordinates: "opponent" },
      sessionSplits: { "train-session": "train" },
      trainingTrialIds: ["trial-0"],
      status: "experimental",
      promotionAllowed: false,
    };
    const directory = mkdtempSync(join(tmpdir(), "napt-vision-onnx-"));
    writeFileSync(join(directory, "model.onnx"), onnx);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(
      join(directory, "input.f32"),
      Buffer.from(windows.buffer, windows.byteOffset, windows.byteLength),
    );
    let runtimeResults: {
      opponent: number[];
      colorLogits: number[];
      checksumRejected: boolean;
    };
    try {
      runtimeResults = JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "-e",
            `
            (async () => {
              const { createVisionOnnxRuntimeFromPythonArtifact } = await import("./src/ts/features/demodulation/vision/visionPythonArtifact.ts");
              const { readFileSync } = await import("node:fs");
              const { join } = await import("node:path");
              const directory = process.env.NAPT_VISION_ONNX_DIR;
              const model = Uint8Array.from(readFileSync(join(directory, "model.onnx")));
              const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
              const input = readFileSync(join(directory, "input.f32"));
              const windows = new Float32Array(input.buffer, input.byteOffset, input.byteLength / 4);
              const frequencyGrid = { centerFrequencyHz: 100000000, sampleRateHz: 3200000 };
              const runtime = await createVisionOnnxRuntimeFromPythonArtifact(model, manifest, { executionProvider: "wasm" });
              try {
                const output = await runtime.predict(windows, 2, frequencyGrid);
                let checksumRejected = false;
                try {
                  await createVisionOnnxRuntimeFromPythonArtifact(model, { ...manifest, modelSha256: "b".repeat(64) }, { executionProvider: "wasm" });
                } catch (error) {
                  checksumRejected = String(error).includes("checksum mismatch");
                }
                process.stdout.write(JSON.stringify({
                  opponent: Array.from(output.opponent),
                  colorLogits: Array.from(output.colorLogits),
                  checksumRejected,
                }));
              } finally {
                await runtime.release();
              }
            })().catch((error) => {
              console.error(error);
              process.exitCode = 1;
            });
          `,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              NAPT_VISION_ONNX_DIR: directory,
            },
          },
        ),
      ) as {
        opponent: number[];
        colorLogits: number[];
        checksumRejected: boolean;
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    const expected = rows.map((features) =>
      predictVisionDecoder(model, features, {
        sourceId: "rx",
        timestampBackendMs: 1234,
        frequencyGrid,
      }),
    );
    expect(runtimeResults.opponent).toHaveLength(2 * 768);
    expect(runtimeResults.colorLogits).toHaveLength(2 * 4);
    expect(runtimeResults.checksumRejected).toBe(true);
    expected.forEach((prediction, index) => {
      for (let output = 0; output < 768; output++)
        expect(runtimeResults.opponent[index * 768 + output]).toBeCloseTo(
          prediction.opponent[output],
          4,
        );
      for (let color = 0; color < 4; color++)
        expect(runtimeResults.colorLogits[index * 4 + color]).toBeCloseTo(
          prediction.colorLogits[color],
          4,
        );
    });
  });

  test("rejects empty models and malformed feature batches", async () => {
    await expect(
      createVisionOnnxRuntime(new Uint8Array(), { frequencyGrid }),
    ).rejects.toThrow(/non-empty/i);
    expect(() => validateVisionOnnxBatch(new Float32Array(2), 1)).toThrow(
      /feature batch/i,
    );
  });

  test("converts opponent outputs into validated, explicitly uncalibrated RGB frames", () => {
    const frame = visionOnnxOutputToDecodedFrame(new Float32Array(768), {
      modelId: "vision-decoder-v2-19",
      sourceId: "receiver-1",
      timestampBackendMs: 1234,
      frequencyGrid,
    });
    expect(frame.rgb).toHaveLength(768);
    expect(frame.rgb.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(frame.modelId).toBe("vision-decoder-v2-19");
    expect(frame.sourceId).toBe("receiver-1");
    expect(frame.timestampBackendMs).toBe(1234);
    expect(frame.confidence).toBeNull();
    expect(() =>
      visionOnnxOutputToDecodedFrame(new Float32Array([Number.NaN]), {
        modelId: "vision-decoder-v2-19",
        sourceId: "receiver-1",
        timestampBackendMs: 1234,
        frequencyGrid,
      }),
    ).toThrow(/opponent/i);
  });
});
