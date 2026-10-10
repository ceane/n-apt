import { z } from "zod";
import {
  VISION_PREPROCESSING,
  visionFrequencyGridSchema,
  visionIdSchema,
} from "./visionModel";
import {
  createVisionOnnxRuntime,
  type VisionOnnxExecutionProvider,
  type VisionOnnxRuntime,
} from "./visionOnnxRuntime";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** Sidecar emitted beside a Python-trained ONNX model. */
export const visionPythonDecoderManifestSchema = z
  .object({
    format: z.literal("napt-vision-decoder"),
    artifactVersion: z.literal(1),
    modelVersion: z.literal(2),
    modelId: visionIdSchema,
    architecture: z.literal("freq-conv-temporal-v2"),
    modelFile: z.string().regex(/^[A-Za-z0-9_.-]{1,200}\.onnx$/),
    modelSha256: sha256Schema,
    datasetSha256: sha256Schema,
    preprocessingVersion: z.literal(VISION_PREPROCESSING.version),
    featureShape: z.tuple([z.literal(10), z.literal(1024), z.literal(2)]),
    referenceVersion: z.literal(1),
    colorTransform: z.literal("linear-srgb-lms-opponent-v1"),
    frequencyGrid: visionFrequencyGridSchema,
    output: z
      .object({
        width: z.literal(16),
        height: z.literal(16),
        fps: z.literal(10),
        coordinates: z.literal("opponent"),
      })
      .strict(),
    sessionSplits: z.record(
      z.string(),
      z.enum(["train", "validation", "test"]),
    ),
    trainingTrialIds: z.array(visionIdSchema),
    status: z.literal("experimental"),
    promotionAllowed: z.literal(false),
  })
  .strict();

export type VisionPythonDecoderManifest = z.infer<
  typeof visionPythonDecoderManifestSchema
>;

export interface VisionPythonArtifactRuntimeOptions {
  executionProvider?: VisionOnnxExecutionProvider;
}

const sha256 = async (modelData: Uint8Array) => {
  const webCrypto = globalThis.crypto?.subtle;
  if (!webCrypto)
    throw new Error("SHA-256 verification is unavailable in this runtime");
  const copy = Uint8Array.from(modelData);
  const digest = await webCrypto.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

/** Verify the Python sidecar and bytes before opening the model in ONNX Runtime. */
export async function createVisionOnnxRuntimeFromPythonArtifact(
  modelData: Uint8Array,
  inputManifest: VisionPythonDecoderManifest,
  options: VisionPythonArtifactRuntimeOptions = {},
): Promise<VisionOnnxRuntime> {
  if (!(modelData instanceof Uint8Array) || !modelData.byteLength)
    throw new Error("A Python vision artifact requires ONNX model bytes");
  const manifest = visionPythonDecoderManifestSchema.parse(inputManifest);
  if ((await sha256(modelData)) !== manifest.modelSha256)
    throw new Error("Python vision artifact checksum mismatch");
  return createVisionOnnxRuntime(modelData, {
    executionProvider: options.executionProvider,
    frequencyGrid: manifest.frequencyGrid,
  });
}
