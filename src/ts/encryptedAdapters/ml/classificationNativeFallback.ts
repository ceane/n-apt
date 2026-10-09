import type {
  FeatureSummary,
  FrameMetadata,
  NativeFrame,
  NativeModel,
  WindowKind,
} from "@n-apt/classification/native/core";

export type { WindowKind };
export type { FeatureSummary, FrameMetadata, NativeFrame, NativeModel };

export type TemporalClassifierUpdate =
  | {
      frameCount: number;
      evidenceMs: number;
      ruleScore: null;
      values: number[];
      status: "ready" | "insufficient_evidence";
      available: { narrow: boolean; bridge: boolean; envelope: boolean };
      resolution: ReturnType<typeof describeFrame>;
      diagnostics: {
        floorDb: number;
        widthHz: number;
        widthBins: number;
        spacingHz: number | null;
        peakCount: number;
      };
    }
  | {
      values: number[];
      frameCount: number;
      evidenceMs: number;
      ruleScore: number;
      status: "ready" | "insufficient_evidence";
      available: { narrow: boolean; bridge: boolean; envelope: boolean };
      resolution: ReturnType<typeof describeFrame>;
      diagnostics: {
        floorDb: number;
        widthHz: number;
        widthBins: number;
        spacingHz: number | null;
        peakCount: number;
      };
    }
  | null;

export const PREPROCESSING = "native-morphology-v1";
export const NATIVE_CLASSIFIER_UPDATE_INTERVAL_MS = 250;
export const FEATURE_NAMES = [
  "bridge",
  "partialBridge",
  "uDip",
  "occupancy",
  "peakDensity",
  "spacingRegularity",
  "width",
  "prominence",
  "envelopeVariation",
  "quality",
  "narrowAvailable",
  "bridgeAvailable",
  "envelopeAvailable",
  "visibleFraction",
  "validFraction",
  "persistence",
  "meanBridge",
  "meanUDip",
] as const;

export function normalizeNativeWindowKind(windowType?: string): WindowKind {
  switch (windowType?.toLowerCase().replace(/[^a-z]/g, "")) {
    case "hann":
    case "hanning":
      return "hann";
    case "hamming":
      return "hamming";
    case "blackman":
      return "blackman";
    case "blackmanharris":
      return "blackman-harris";
    case "nuttall":
      return "nuttall";
    default:
      return "rectangular";
  }
}

const emptyFrameDescription = {
  binHz: 0,
  resolutionHz: 0,
  firstBinHz: 0,
  cropped: false,
  incomplete: true,
  visibleFraction: 0,
  validFraction: 0,
};

export function describeFrame(_frame: NativeFrame) {
  return { ...emptyFrameDescription };
}

export function extractionParams(_frame: NativeFrame) {
  return {
    floor: 0,
    step: 0,
    broad: 0,
    ...emptyFrameDescription,
  };
}

export function extractReference(_frame: NativeFrame): Float32Array {
  return new Float32Array(0);
}

export function summarizeFeatures(_frame: NativeFrame, _bins: Float32Array): FeatureSummary {
  return {
    values: [],
    status: "insufficient_evidence",
    available: { narrow: false, bridge: false, envelope: false },
    resolution: { ...emptyFrameDescription },
    diagnostics: {
      floorDb: 0,
      widthHz: 0,
      widthBins: 0,
      spacingHz: null,
      peakCount: 0,
    },
  };
}

export function deterministicScore(_values: number[]): number {
  return 0;
}

export class TemporalClassifier {
  reset() {}

  update(
    _metadata: FrameMetadata,
    _summary: FeatureSummary,
    _minimumIntervalMs?: number,
  ): TemporalClassifierUpdate {
    return null;
  }
}

export function validateModel(_input: unknown): NativeModel {
  throw new Error("Encrypted native classifier modules are unavailable.");
}

export function inferModel(_model: NativeModel, _values: number[]): number {
  return 0;
}

export class NativeGpuExtractor {
  constructor(_device: GPUDevice) {}

  dispose() {}

  async extract(_frame: NativeFrame): Promise<Float32Array> {
    return new Float32Array(0);
  }

  async infer(_model: NativeModel, _features: number[]): Promise<number> {
    return 0;
  }
}
