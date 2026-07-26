import { renderHook } from "@testing-library/react";
import {
  formatLiveCanvasStatusRow,
  drawLiveCanvasStatusRow,
  useDraw2DFFTSignal,
} from "../../src/ts/hooks/useDraw2DFFTSignal";

describe("formatLiveCanvasStatusRow", () => {
  it("renders the live canvas status row with explicit gain-free labels", () => {
    expect(
      formatLiveCanvasStatusRow({
        sampleRateHz: 5_160_000,
        fftSize: 131_072,
        fftWindow: "Hamming",
        temporalResolution: "lossless",
      }),
    ).toEqual({
      sampleRateLabel: "5.16MHz sample rate",
      fftSizeLabel: "FFT Size: 131,072",
      fftWindowLabel: "FFT Window: Hamming",
      timingLabel: "Timing: Lossless",
    });
  });

  it("draws Tx stats with bandwidth centered and sample rate at the right", () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), clearRect: jest.fn(), fillRect: jest.fn(),
      beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
      fillText: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 8 })),
    } as any;

    drawLiveCanvasStatusRow(ctx, 1000, 600, {
      statusRow: {
        sampleRateLabel: "6.27MHz sample rate",
        bandwidthLabel: "4MHz Bandwidth",
        txModeLabel: "Mock Tx SDR > Mock WiFi",
        fftSizeLabel: "FFT Size: 65,536",
        ifftSizeLabel: "IFFT Size: 65,536",
        fftWindowLabel: "FFT Window: Rectangular",
        timingLabel: "Timing: Lossless",
      },
    });

    const labels = ctx.fillText.mock.calls.map((call: any[]) => call[0]);
    expect(labels).toEqual([
      "⌞ 4MHz Bandwidth ⌟",
      "Mock Tx SDR > Mock WiFi",
      "Timing: Lossless",
      "IFFT Size: 65,536",
      "FFT Size: 65,536",
      "6.27MHz sample rate",
    ]);
  });
});

describe("useDraw2DFFTSignal", () => {
  const fn = (impl?: any) =>
    typeof jest !== "undefined"
      ? jest.fn(impl)
      : (globalThis as any).vi?.fn(impl);
  const spyOn = (...args: any[]) =>
    typeof jest !== "undefined"
      ? (jest.spyOn as any)(...args)
      : (globalThis as any).vi?.spyOn(...args);

  const createMockContext = () =>
    ({
      save: fn(),
      restore: fn(),
      clearRect: fn(),
      fillRect: fn(),
      strokeRect: fn(),
      beginPath: fn(),
      closePath: fn(),
      moveTo: fn(),
      lineTo: fn(),
      stroke: fn(),
      fill: fn(),
      fillText: fn(),
      measureText: fn((text: string) => ({ width: text.length * 8 })),
      setTransform: fn(),
      setLineDash: fn(),
      roundRect: fn(),
      rect: fn(),
      arc: fn(),
    }) as any;

  it("draws Tx instead of the status stats row when Tx is visible", () => {
    const ctx = createMockContext();
    const canvas = document.createElement("canvas");
    const parent = document.createElement("div");
    parent.appendChild(canvas);
    spyOn(parent, "getBoundingClientRect").mockReturnValue({
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
    spyOn(canvas, "getContext").mockReturnValue(ctx);

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
      temporalResolution: "reduced",
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

  it("renders a dotted spectrum trace line ([2, 5]) for preview frames", () => {
    const ctx = createMockContext();
    const canvas = document.createElement("canvas");
    const parent = document.createElement("div");
    parent.appendChild(canvas);
    spyOn(parent, "getBoundingClientRect").mockReturnValue({
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
    spyOn(canvas, "getContext").mockReturnValue(ctx);

    const { result } = renderHook(() => useDraw2DFFTSignal());
    result.current.draw2DFFTSignal({
      canvas,
      waveform: new Float32Array([0, -20, -40, -60]),
      frequencyRange: { min: 0, max: 4_000_000 },
      isStandby: true,
    });

    expect(ctx.setLineDash).toHaveBeenCalledWith([2, 5]);
  });
});
