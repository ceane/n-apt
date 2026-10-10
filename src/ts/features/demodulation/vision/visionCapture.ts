import {
  visionConfigSchema,
  visionPairSchema,
  type VisionArtifact,
  type VisionConfig,
  type VisionPair,
} from "./visionModel";

/** Acquisition timestamps must describe FIRST samples, not browser receipt times.
 * Adapter must supply producer sample indices; never synthesize missing continuity. */
export interface VisionAcquisitionFrame {
  sourceId: string;
  streamEpoch: number;
  optionsRevision: number;
  sequence: number;
  timestampMs: number;
  sampleStartIndex: number;
  sampleCount: number;
  sampleRateHz: number;
  centerFrequencyHz: number;
  discontinuityBefore: boolean;
}

/** Event-driven coordinator. Owns no device, timer, raw I/Q buffer, or DOM. */
export class VisionCaptureCoordinator {
  private readonly config: VisionConfig;
  private first: VisionAcquisitionFrame | null = null;
  private last: VisionAcquisitionFrame | null = null;
  private timeline: VisionPair["timeline"] = [];
  private reasons = new Set<string>();
  private finished = false;
  constructor(config: VisionConfig) {
    this.config = visionConfigSchema.parse(config);
  }
  private active() {
    if (this.finished) throw new Error("Capture already finished");
  }
  interrupt(reason: string) {
    this.active();
    this.reasons.add(reason.slice(0, 200) || "interrupted");
  }
  observe(frame: VisionAcquisitionFrame) {
    this.active();
    if (this.reasons.size) return;
    const c = this.config;
    if (
      ![frame.timestampMs, frame.centerFrequencyHz, frame.sampleRateHz].every(
        Number.isFinite,
      ) ||
      ![
        frame.sequence,
        frame.sampleStartIndex,
        frame.sampleCount,
        frame.streamEpoch,
        frame.optionsRevision,
      ].every((x) => Number.isSafeInteger(x) && x >= 0) ||
      frame.sampleCount === 0 ||
      frame.sourceId !== c.sourceId ||
      frame.streamEpoch !== c.streamEpoch ||
      frame.optionsRevision !== c.optionsRevision ||
      frame.sampleRateHz !== c.sampleRateHz ||
      frame.centerFrequencyHz !== c.centerFrequencyHz ||
      frame.discontinuityBefore
    ) {
      this.interrupt("source-or-continuity-changed");
      return;
    }
    if (
      this.last &&
      (frame.sequence !== this.last.sequence + 1 ||
        frame.sampleStartIndex !==
          this.last.sampleStartIndex + this.last.sampleCount ||
        Math.abs(
          frame.timestampMs -
            this.last.timestampMs -
            (this.last.sampleCount * 1000) / c.sampleRateHz,
        ) > 1)
    ) {
      this.interrupt("acquisition-gap");
      return;
    }
    if (!this.first) this.first = { ...frame };
    this.last = { ...frame };
  }
  present(frameIndex: number, browserEpochMs: number) {
    this.active();
    if (this.reasons.size) throw new Error("Capture interrupted");
    const onsetBackendMs =
      browserEpochMs + this.config.clock.backendMinusBrowserMs;
    const expectedCount =
      this.config.stimulus.kind === "solid" ? 1 : this.config.durationMs / 100;
    if (
      !Number.isFinite(onsetBackendMs) ||
      frameIndex !== this.timeline.length ||
      frameIndex >= expectedCount
    )
      throw new Error("Invalid presentation event");
    if (
      !this.last ||
      onsetBackendMs < this.last.timestampMs ||
      onsetBackendMs -
        (this.last.timestampMs +
          (this.last.sampleCount * 1000) / this.config.sampleRateHz) >
        100
    )
      throw new Error("Presentation requires fresh RF");
    if (
      this.timeline.length &&
      onsetBackendMs <= this.timeline[this.timeline.length - 1].onsetBackendMs
    )
      throw new Error("Nonmonotonic presentation");
    this.timeline.push({ frameIndex, onsetBackendMs });
  }
  finish(browserEpochMs: number, artifact: VisionArtifact): VisionPair {
    this.active();
    if (!this.first || !this.last)
      throw new Error("No valid acquisition to pair");
    const endBackendMs =
      browserEpochMs + this.config.clock.backendMinusBrowserMs;
    const acquisition = {
      startBackendMs: this.first.timestampMs,
      endBackendMs:
        this.last.timestampMs +
        (this.last.sampleCount * 1000) / this.config.sampleRateHz,
      firstSampleIndex: this.first.sampleStartIndex,
      sampleCount:
        this.last.sampleStartIndex +
        this.last.sampleCount -
        this.first.sampleStartIndex,
    };
    const candidate = {
      version: 1 as const,
      config: this.config,
      artifact,
      status: "complete" as const,
      reasons: [] as string[],
      timeline: this.timeline,
      endBackendMs,
      acquisition,
    };
    const validation = visionPairSchema.safeParse(candidate);
    if (!validation.success)
      this.reasons.add("incomplete-reference-or-coverage");
    const result = visionPairSchema.parse({
      ...candidate,
      status: this.reasons.size ? "incomplete" : "complete",
      reasons: [...this.reasons].slice(0, 32),
    });
    this.finished = true;
    return result;
  }
}
