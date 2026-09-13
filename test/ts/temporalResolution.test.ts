import {
  averageTemporalWaveforms,
  blendTemporalWaveform,
  ensureTemporalFrameSlot,
  clampTemporalActiveCount,
  getTemporalResolutionLabel,
  getTemporalResolutionAlpha,
  getTemporalResolutionWindow,
  normalizeTemporalResolution,
} from "@n-apt/math/temporalResolution";
import { resetWebGpuStreamTemporalHistory } from "@n-apt/app/infrastructure/visualization/webgpuStreamReset";

describe("temporalResolution", () => {
  it("uses a direct copy for lossless temporal resolution", () => {
    const previous = new Float32Array([1, 2, 3]);
    const current = new Float32Array([4, 5, 6]);
    const next = blendTemporalWaveform(previous, current, "lossless");
    expect(Array.from(next)).toEqual([4, 5, 6]);
    expect(next).toBe(previous);
  });

  it("blends reduced temporal resolution against the previous frame", () => {
    const next = blendTemporalWaveform(new Float32Array([10, 10, 10]), new Float32Array([20, 30, 40]), "reduced");
    expect(Array.from(next)).toEqual([10.5, 11, 11.5]);
  });

  it("blends slow temporal resolution more heavily than reduced", () => {
    expect(getTemporalResolutionAlpha("slow")).toBeLessThan(getTemporalResolutionAlpha("reduced"));
    expect(getTemporalResolutionAlpha("lossless")).toBe(1);
  });

  it("uses a longer rolling window for slow temporal resolution", () => {
    expect(getTemporalResolutionWindow("slow")).toBeGreaterThan(getTemporalResolutionWindow("reduced"));
    expect(getTemporalResolutionWindow("lossless")).toBe(1);
  });

  it("keeps the temporal window finite when FPS is unavailable", () => {
    expect(getTemporalResolutionWindow("reduced", Number.NaN)).toBe(8);
  });

  it("clamps an invalid active-frame count to a valid array length", () => {
    expect(clampTemporalActiveCount(Number.NaN, 8)).toBe(0);
    expect(clampTemporalActiveCount(99, 8)).toBe(8);
  });

  it("exposes user-facing labels", () => {
    expect(getTemporalResolutionLabel("lossless")).toBe("Lossless");
    expect(getTemporalResolutionLabel("reduced")).toBe("Reduced");
    expect(getTemporalResolutionLabel("slow")).toBe("Slow");
  });

  it("normalizes legacy or invalid persisted resolution values", () => {
    expect(normalizeTemporalResolution("medium")).toBe("reduced");
    expect(normalizeTemporalResolution("high")).toBe("lossless");
    expect(normalizeTemporalResolution("bad-value")).toBe("reduced");
  });

  it("averages multiple frames", () => {
    expect(Array.from(averageTemporalWaveforms([new Float32Array([0, 10]), new Float32Array([10, 20])], null))).toEqual([5, 15]);
  });

  it("drops every retained frame at a source boundary", () => {
    const framePool = [new Float32Array([1, 2]), new Float32Array([3, 4])];
    resetWebGpuStreamTemporalHistory(framePool, [framePool[1]]);
    expect(framePool).toHaveLength(0);
  });

  it("repairs a stale write index instead of returning an undefined frame", () => {
    const pool = [new Float32Array(4), new Float32Array(4)];
    const writeIndex = ensureTemporalFrameSlot(pool, 2, 4);
    expect(writeIndex).toBe(0);
    expect(pool[writeIndex]).toBeInstanceOf(Float32Array);
  });
});
