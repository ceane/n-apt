import { z } from "zod";

export const VISION_PRESETS = Object.freeze({
  S: Object.freeze([102, 51, 255]),
  M: Object.freeze([0, 255, 0]),
  L: Object.freeze([191, 255, 0]),
  Red: Object.freeze([255, 0, 0]),
});
export const VISION_WIDTH = 16;
export const VISION_HEIGHT = 16;
export const VISION_FRAME_MS = 100;
export const VISION_PREPROCESSING = Object.freeze({
  version: 1,
  fftSize: 1024,
  hopSamples: 512,
  window: "hann-periodic",
  temporalSlices: 10,
  contextMs: 100,
  featureOrder: ["logPower", "phaseDelta"],
  iqEncoding: "u8-interleaved",
  normalization: "(value-128)/127",
  binOrder: "fftshift",
  phaseUnit: "radians",
  tensorShape: [10, 1024, 2],
  power: "log1p(magnitudeSquared/windowEnergy)",
  phaseDelta:
    "arg(current*conjugate(previous)); zero for first or zero-power bin",
  aggregation: "mean logPower and circular-mean phaseDelta per 10ms slice",
  context: "preceding 100ms; reject missing slices and discontinuities",
} as const);
const finite = z.number().finite();
export const visionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
export const visionStimulusSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("solid"),
      preset: z.enum(["S", "M", "L", "Red"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("calibration"),
      seed: z.number().int().min(0).max(0xffffffff),
    })
    .strict(),
]);
export type VisionStimulus = z.infer<typeof visionStimulusSchema>;
export const visionConfigSchema = z
  .object({
    version: z.literal(1),
    trialId: visionIdSchema,
    sessionId: visionIdSchema,
    stimulus: visionStimulusSchema,
    durationMs: z.number().int().min(100).max(60_000).multipleOf(100),
    display: z
      .object({
        label: z.string().min(1).max(200),
        width: finite.positive(),
        height: finite.positive(),
        devicePixelRatio: finite.positive(),
      })
      .strict(),
    sourceId: z.string().min(1).max(200),
    streamEpoch: z.number().int().nonnegative(),
    optionsRevision: z.number().int().nonnegative(),
    centerFrequencyHz: finite.nonnegative(),
    sampleRateHz: finite.min(3_200_000),
    // Both timestamps are epoch milliseconds. Offset must be measured, not assumed zero.
    clock: z
      .object({
        backendMinusBrowserMs: finite,
        uncertaintyMs: finite.min(0).max(25),
      })
      .strict(),
  })
  .strict();
export type VisionConfig = z.infer<typeof visionConfigSchema>;
export const visionArtifactSchema = z
  .object({
    jobId: visionIdSchema,
    filename: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type VisionArtifact = z.infer<typeof visionArtifactSchema>;
export const visionPairSchema = z
  .object({
    version: z.literal(1),
    config: visionConfigSchema,
    artifact: visionArtifactSchema,
    status: z.enum(["complete", "incomplete"]),
    reasons: z.array(z.string().min(1).max(200)).max(32),
    timeline: z
      .array(
        z
          .object({
            frameIndex: z.number().int().min(0).max(599),
            onsetBackendMs: finite,
          })
          .strict(),
      )
      .max(600),
    endBackendMs: finite,
    acquisition: z
      .object({
        startBackendMs: finite,
        endBackendMs: finite,
        firstSampleIndex: z.number().int().nonnegative(),
        sampleCount: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((pair, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      Math.abs(
        pair.acquisition.endBackendMs -
          pair.acquisition.startBackendMs -
          (pair.acquisition.sampleCount * 1000) / pair.config.sampleRateHz,
      ) > 1
    )
      error("Inconsistent acquisition sample count");
    if (pair.acquisition.endBackendMs <= pair.acquisition.startBackendMs)
      error("Invalid acquisition range");
    if (
      pair.timeline.some(
        (event, i) =>
          event.frameIndex !== i ||
          (i > 0 &&
            event.onsetBackendMs <= pair.timeline[i - 1].onsetBackendMs),
      )
    )
      error("Invalid reference ordering");
    if (pair.status === "complete") {
      const first = pair.timeline[0]?.onsetBackendMs;
      const count =
        pair.config.stimulus.kind === "solid"
          ? 1
          : pair.config.durationMs / VISION_FRAME_MS;
      const guard = pair.config.clock.uncertaintyMs;
      if (
        pair.reasons.length ||
        first === undefined ||
        pair.timeline.length !== count
      )
        error("Incomplete reference timeline");
      if (
        first !== undefined &&
        (pair.acquisition.startBackendMs > first - guard ||
          pair.acquisition.endBackendMs < pair.endBackendMs + guard ||
          Math.abs(pair.endBackendMs - first - pair.config.durationMs) > 25)
      )
        error("Insufficient acquisition coverage or duration");
      if (
        pair.timeline.some(
          (event, i) =>
            Math.abs(event.onsetBackendMs - first! - i * VISION_FRAME_MS) > 25,
        )
      )
        error("Reference timing drift");
    } else if (!pair.reasons.length) error("Incomplete pairs require a reason");
  });
export type VisionPair = z.infer<typeof visionPairSchema>;
export type VisionSplit = "train" | "validation" | "test";
export interface VisionModelManifest {
  version: 1;
  modelId: string;
  referenceVersion: 1;
  colorTransform: "linear-srgb-lms-opponent-v1";
  preprocessing: typeof VISION_PREPROCESSING;
  output: { width: 16; height: 16; fps: 10; coordinates: "opponent" };
  normalization: { mean: number[]; scale: number[] };
  sessionSplits: Record<string, VisionSplit>;
  trainingTrialIds: string[];
  status: "experimental";
}
export interface VisionDecodedFrame {
  version: 1;
  modelId: string;
  sourceId: string;
  timestampBackendMs: number;
  rgb: Float32Array; // 16*16*3, normalized sRGB; never a reference input
  confidence: number | null; // null until calibrated on held-out sessions
}
