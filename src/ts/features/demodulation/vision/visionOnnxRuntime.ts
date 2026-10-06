import { VISION_COLOR_CLASS_COUNT } from "./visionMl";
import { VISION_FEATURE_COUNT } from "./visionPreprocessing";
import {
  VISION_HEIGHT,
  VISION_WIDTH,
  visionDecodedFrameSchema,
  type VisionDecodedFrame,
} from "./visionModel";
import { opponentToRgb } from "./visionReference";

export const VISION_ONNX_MAX_BATCH_SIZE = 16;

export type VisionOnnxExecutionProvider = "auto" | "wasm" | "webgpu";

export interface VisionOnnxRuntimeOptions {
  executionProvider?: VisionOnnxExecutionProvider;
}

export interface VisionOnnxPredictionBatch {
  opponent: Float32Array;
  colorLogits: Float32Array;
}

export interface VisionOnnxFrameMetadata {
  modelId: string;
  sourceId: string;
  timestampBackendMs: number;
}

export interface VisionOnnxRuntime {
  readonly executionProvider: Exclude<VisionOnnxExecutionProvider, "auto">;
  predict(
    features: Float32Array,
    batchSize: number,
  ): Promise<VisionOnnxPredictionBatch>;
  predictFrame(
    features: Float32Array,
    metadata: VisionOnnxFrameMetadata,
  ): Promise<{ frame: VisionDecodedFrame; colorLogits: Float32Array }>;
  release(): Promise<void>;
}

interface OrtTensor {
  data: Float32Array;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}
interface OrtModule {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(
      model: Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<OrtSession>;
  };
}

const hasWebGpu = () => typeof navigator !== "undefined" && "gpu" in navigator;
const loadOrtModule = async (
  executionProvider: "wasm" | "webgpu",
): Promise<OrtModule> =>
  executionProvider === "webgpu"
    ? ((await import("onnxruntime-web/webgpu")) as unknown as OrtModule)
    : ((await import("onnxruntime-web")) as unknown as OrtModule);

export function validateVisionOnnxBatch(
  features: Float32Array,
  batchSize: number,
) {
  if (
    !(features instanceof Float32Array) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > VISION_ONNX_MAX_BATCH_SIZE ||
    features.length !== batchSize * VISION_FEATURE_COUNT ||
    !features.every(Number.isFinite)
  )
    throw new Error("Invalid vision feature batch");
}

/** Convert one model-head row from [Y, R_G, B_Y] to validated normalized sRGB. */
export function visionOnnxOutputToDecodedFrame(
  opponent: Float32Array,
  metadata: VisionOnnxFrameMetadata,
): VisionDecodedFrame {
  const imageSize = VISION_WIDTH * VISION_HEIGHT * 3;
  if (
    !(opponent instanceof Float32Array) ||
    opponent.length !== imageSize ||
    !opponent.every(Number.isFinite)
  )
    throw new Error("Invalid opponent image output");
  const rgb = new Float32Array(imageSize);
  for (let pixel = 0; pixel < VISION_WIDTH * VISION_HEIGHT; pixel++) {
    const offset = pixel * 3;
    const decoded = opponentToRgb([
      opponent[offset],
      opponent[offset + 1],
      opponent[offset + 2],
    ]);
    rgb[offset] = decoded[0] / 255;
    rgb[offset + 1] = decoded[1] / 255;
    rgb[offset + 2] = decoded[2] / 255;
  }
  return visionDecodedFrameSchema.parse({
    ...metadata,
    version: 1,
    rgb,
    confidence: null,
  });
}

const createRuntimeForProvider = async (
  modelData: Uint8Array,
  executionProvider: "wasm" | "webgpu",
): Promise<VisionOnnxRuntime> => {
  const ort = await loadOrtModule(executionProvider);
  const session = await ort.InferenceSession.create(modelData, {
    executionProviders: [executionProvider],
  });
  if (
    session.inputNames.length !== 1 ||
    session.inputNames[0] !== "vision_features" ||
    session.outputNames.length !== 2 ||
    !session.outputNames.includes("opponent") ||
    !session.outputNames.includes("color_logits")
  ) {
    await session.release();
    throw new Error(
      "ONNX vision model must expose vision_features, opponent, and color_logits",
    );
  }

  const predict = async (
    features: Float32Array,
    batchSize: number,
  ): Promise<VisionOnnxPredictionBatch> => {
    validateVisionOnnxBatch(features, batchSize);
    const outputs = await session.run({
      vision_features: new ort.Tensor("float32", features, [
        batchSize,
        VISION_FEATURE_COUNT,
      ]),
    });
    const opponent = outputs.opponent?.data;
    const colorLogits = outputs.color_logits?.data;
    if (
      !(opponent instanceof Float32Array) ||
      opponent.length !== batchSize * 16 * 16 * 3 ||
      !(colorLogits instanceof Float32Array) ||
      colorLogits.length !== batchSize * VISION_COLOR_CLASS_COUNT ||
      !opponent.every(Number.isFinite) ||
      !colorLogits.every(Number.isFinite)
    )
      throw new Error("ONNX vision model returned invalid output tensors");
    return { opponent: opponent.slice(), colorLogits: colorLogits.slice() };
  };

  return {
    executionProvider,
    predict,
    async predictFrame(features, metadata) {
      const prediction = await predict(features, 1);
      return {
        frame: visionOnnxOutputToDecodedFrame(prediction.opponent, metadata),
        colorLogits: prediction.colorLogits,
      };
    },
    release: () => session.release(),
  };
};

/** Load a versioned local model, preferring WebGPU and falling back to WASM. */
export async function createVisionOnnxRuntime(
  modelData: Uint8Array,
  options: VisionOnnxRuntimeOptions = {},
): Promise<VisionOnnxRuntime> {
  if (!(modelData instanceof Uint8Array) || modelData.byteLength === 0)
    throw new Error("An ONNX vision model must contain non-empty binary data");
  const requestedProvider = options.executionProvider ?? "auto";
  const providers: Array<"wasm" | "webgpu"> =
    requestedProvider === "auto"
      ? hasWebGpu()
        ? ["webgpu", "wasm"]
        : ["wasm"]
      : [requestedProvider];
  let lastError: unknown;
  for (const executionProvider of providers) {
    try {
      return await createRuntimeForProvider(modelData, executionProvider);
    } catch (error) {
      lastError = error;
      if (requestedProvider !== "auto" || executionProvider === "wasm") break;
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Could not load the local ONNX vision runtime${detail}`);
}
