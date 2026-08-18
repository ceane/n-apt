import {
  computeMaxFrameRate,
  getLogicalMaxFrameRate,
} from "@n-apt/math/signals";

describe("computeMaxFrameRate", () => {
  it("computes floor(sampleRate / fftSize)", () => {
    // 3.2 MHz / 262144 = 12.207… → 12
    expect(computeMaxFrameRate(3_200_000, 262_144)).toBe(12);
  });

  it("uses the theoretical rate when no configured limit is provided", () => {
    // The physical rate is 1562, but the WebSocket protocol permits at most 100.
    expect(computeMaxFrameRate(3_200_000, 2048)).toBe(100);
  });

  it("caps whole-channel physical rates at the WebSocket protocol maximum", () => {
    // 4.372 MHz / 32768 = 133.4..., which previously produced the rejected 133.
    expect(computeMaxFrameRate(4_372_000, 32_768)).toBe(100);
  });

  it("caps an oversized configured ceiling at the WebSocket protocol maximum", () => {
    expect(computeMaxFrameRate(20_000_000, 32_768, 120)).toBe(100);
  });

  it("respects explicit max frame rate limit below 60", () => {
    expect(computeMaxFrameRate(3_200_000, 2048, 30)).toBe(30);
  });

  it("returns 0 when fftSize is 0", () => {
    expect(computeMaxFrameRate(3_200_000, 0)).toBe(0);
  });

  it("never returns less than 1 for valid fftSize", () => {
    // very large FFT relative to sample rate
    expect(computeMaxFrameRate(100, 262_144)).toBe(1);
  });
});

describe("getLogicalMaxFrameRate", () => {
  it("uses actual sample rate, not channel bandwidth", () => {
    // Regression: whole-channel bandwidth (4.45 MHz) was incorrectly used
    // instead of the SDR sample rate (3.2 MHz).
    // floor(4_452_000 / 262_144) = 16  (WRONG)
    // floor(3_200_000 / 262_144) = 12  (CORRECT)
    const sdrSettings = {
      fft: {
        max_frame_rate: 60,
        size_to_frame_rate: { "262144": 12, "2048": 60 },
      },
    };
    expect(getLogicalMaxFrameRate(3_200_000, 262_144, sdrSettings)).toBe(12);
    // Confirm that the stale channel-bandwidth value would give the wrong answer
    expect(getLogicalMaxFrameRate(4_452_000, 262_144, sdrSettings)).toBe(16);
  });

  it("falls back to computeMaxFrameRate when no sdrSettings", () => {
    expect(getLogicalMaxFrameRate(3_200_000, 262_144)).toBe(12);
  });
});
