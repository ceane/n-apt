import { formatLiveCanvasStatusRow } from "../../src/ts/hooks/useDraw2DFFTSignal";

describe("formatLiveCanvasStatusRow", () => {
  it("renders the live canvas status row with explicit gain-free labels", () => {
    expect(
      formatLiveCanvasStatusRow({
        sampleRateHz: 5_160_000,
        fftSize: 131_072,
        fftWindow: "Hamming",
        temporalResolution: "high",
      }),
    ).toEqual({
      sampleRateLabel: "5.16MHz sample rate",
      fftSizeLabel: "FFT Size: 131,072",
      fftWindowLabel: "FFT Window: Hamming",
      timingLabel: "Timing: Lossless",
    });
  });
});
