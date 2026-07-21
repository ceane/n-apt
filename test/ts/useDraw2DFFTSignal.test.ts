import { renderHook } from "@testing-library/react";
import {
  formatLiveCanvasStatusRow,
  useDraw2DFFTSignal,
} from "../../src/ts/hooks/useDraw2DFFTSignal";

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

describe("useDraw2DFFTSignal", () => {
  const createMockContext = () =>
    ({
      save: jest.fn(),
      restore: jest.fn(),
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      beginPath: jest.fn(),
      closePath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      fillText: jest.fn(),
      measureText: jest.fn((text: string) => ({ width: text.length * 8 })),
      setTransform: jest.fn(),
      setLineDash: jest.fn(),
      roundRect: jest.fn(),
      rect: jest.fn(),
      arc: jest.fn(),
    }) as any;

  it("draws Tx instead of the status stats row when Tx is visible", () => {
    const ctx = createMockContext();
    const canvas = document.createElement("canvas");
    const parent = document.createElement("div");
    parent.appendChild(canvas);
    jest.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 600,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    jest.spyOn(canvas, "getContext").mockReturnValue(ctx);

    const { result } = renderHook(() => useDraw2DFFTSignal());
    const rendered = result.current.draw2DFFTSignal({
      canvas,
      waveform: new Float32Array([0, -20, -40, -60]),
      frequencyRange: { min: 0, max: 4_372_000 },
      fftMin: -120,
      fftMax: 0,
      hardwareSampleRateHz: 4_372_000,
      fftSize: 16_384,
      fftWindow: "Rectangular",
      temporalResolution: "medium",
      txSlider: {
        visible: true,
        signalLabel: "APT",
        powerDbm: -18,
        visibleMinHz: 0,
        visibleMaxHz: 4_372_000,
        txCenterHz: 2_186_000,
        txSampleRateHz: 1_000_000,
      },
    });

    expect(rendered).toBe(true);
    const labels = ctx.fillText.mock.calls.map((call: any[]) => call[0]);
    expect(labels).toContain("Tx");
    expect(labels).toContain("APT");
    expect(labels).toContain("-18 dBm");
    expect(labels).not.toContain("FFT Size: 16,384");
    expect(labels).not.toContain("FFT Window: Rectangular");
  });
});
