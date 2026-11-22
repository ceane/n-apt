import {
  configureCanvasForDpr,
  formatSampleRate,
  projectIqSamples,
  resolveIqPlaneMetadata,
} from "@n-apt/demodulation/react-flow/nodes/iqPlanePlot";

describe("I/Q plane plotting", () => {
  it("auto-scales low-amplitude samples into a visible cloud", () => {
    const points = projectIqSamples(
      new Uint8Array([129, 127, 127, 129, 128, 128]),
    );

    expect(points).toHaveLength(3);
    expect(Math.hypot(points[0]!.i, points[0]!.q)).toBeCloseTo(0.82);
    expect(Math.hypot(points[1]!.i, points[1]!.q)).toBeCloseTo(0.82);
    expect(
      points.every(({ i, q }) => Number.isFinite(i) && Number.isFinite(q)),
    ).toBe(true);
  });

  it("allocates a device-pixel-ratio canvas and draws in CSS pixels", () => {
    const canvas = { width: 0, height: 0 };
    const setTransform = jest.fn();

    configureCanvasForDpr(canvas, { setTransform }, 240, 180, 2);

    expect(canvas).toEqual({ width: 480, height: 360 });
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  it("prefers current frame metadata over source defaults", () => {
    expect(
      resolveIqPlaneMetadata(
        { sample_rate: 2_400_000, center_frequency_hz: 137_100_000 },
        { sampleRateHz: 3_200_000, centerFrequencyHz: 144_000_000 },
      ),
    ).toEqual({
      sampleRateHz: 2_400_000,
      centerFrequencyHz: 137_100_000,
    });
  });

  it("formats sample rate with samples-per-second units", () => {
    expect(formatSampleRate(3_200_000)).toBe("3.2 MS/s");
    expect(formatSampleRate(256_000)).toBe("256 kS/s");
    expect(formatSampleRate(null)).toBe("—");
  });
});
