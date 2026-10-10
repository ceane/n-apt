import type { CaptureQualityFrame } from "@n-apt/capture/quality";

describe("capture quality history during Fast Refresh", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("retains recent frame history when the quality module is re-evaluated", () => {
    const scopeKey = `quality-hmr-${Math.random()}`;
    const frame: CaptureQualityFrame = {
      sourceId: "rtl-1",
      streamEpoch: 4,
      sequence: 18,
      timestampMs: 1_000,
      status: "receiving",
      sampleRateHz: 3_200_000,
      centerFrequencyHz: 1_600_000,
      fftSize: 32_768,
      window: "hann",
      acquiredSampleCount: 32_768,
    };

    jest.isolateModules(() => {
      const quality = require("@n-apt/capture/quality") as typeof import("@n-apt/capture/quality");
      quality.rememberCaptureQualityFrameWindow(scopeKey, [frame]);
    });

    jest.resetModules();
    let reloadedQuality: typeof import("@n-apt/capture/quality") | undefined;
    jest.isolateModules(() => {
      reloadedQuality = require("@n-apt/capture/quality");
    });

    expect(
      reloadedQuality!.getCaptureQualityFrameWindow(scopeKey),
    ).toEqual([frame]);
    reloadedQuality!.rememberCaptureQualityFrameWindow(scopeKey, []);
  });
});
