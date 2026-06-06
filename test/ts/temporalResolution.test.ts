import {
  averageTemporalWaveforms,
  blendTemporalWaveform,
  getTemporalResolutionLabel,
  getTemporalResolutionAlpha,
  getTemporalResolutionWindow,
} from "../../src/ts/utils/temporalResolution";

describe("temporalResolution", () => {
  it("uses a direct copy for high temporal resolution", () => {
    const previous = new Float32Array([1, 2, 3]);
    const current = new Float32Array([4, 5, 6]);

    const next = blendTemporalWaveform(previous, current, "high");

    expect(Array.from(next)).toEqual([4, 5, 6]);
    expect(next).toBe(previous);
  });

  it("blends medium temporal resolution against the previous frame", () => {
    const previous = new Float32Array([10, 10, 10]);
    const current = new Float32Array([20, 30, 40]);

    const next = blendTemporalWaveform(previous, current, "medium");

    expect(Array.from(next)).toEqual([10.5, 11, 11.5]);
  });

  it("blends low temporal resolution more heavily than medium", () => {
    expect(getTemporalResolutionAlpha("low")).toBeLessThan(
      getTemporalResolutionAlpha("medium"),
    );
    expect(getTemporalResolutionAlpha("high")).toBe(1);
  });

  it("makes low resolution much slower to follow the current frame", () => {
    const previous = new Float32Array([100, 100]);
    const current = new Float32Array([0, 0]);

    const low = blendTemporalWaveform(previous, current, "low");
    const medium = blendTemporalWaveform(
      new Float32Array([100, 100]),
      current,
      "medium",
    );

    expect(low[0]).toBeGreaterThan(medium[0]);
  });

  it("uses a longer rolling window for low temporal resolution", () => {
    expect(getTemporalResolutionWindow("low")).toBeGreaterThan(
      getTemporalResolutionWindow("medium"),
    );
    expect(getTemporalResolutionWindow("high")).toBe(1);
  });

  it("exposes user-facing labels for the reordered temporal resolution options", () => {
    expect(getTemporalResolutionLabel("high")).toBe("Lossless");
    expect(getTemporalResolutionLabel("medium")).toBe("Reduced");
    expect(getTemporalResolutionLabel("low")).toBe("Slow");
  });

  it("averages multiple frames", () => {
    const avg = averageTemporalWaveforms(
      [new Float32Array([0, 10]), new Float32Array([10, 20])],
      null,
    );

    expect(Array.from(avg)).toEqual([5, 15]);
  });
});
