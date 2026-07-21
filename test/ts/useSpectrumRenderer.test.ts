/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useSpectrumRenderer } from "@n-apt/hooks/useSpectrumRenderer";

const drawWebGPUFFTSignalMock = jest.fn(() => true);
const draw3DWaterfallSignalMock = jest.fn(() => true);
const drawMarkersOnContextMock = jest.fn();
const drawTxSliderOnContextMock = jest.fn();
const drawTxSliderBackdropOnContextMock = jest.fn();

jest.mock("@n-apt/hooks/useDrawWebGPUFFTSignal", () => ({
  useDrawWebGPUFFTSignal: () => ({
    drawWebGPUFFTSignal: drawWebGPUFFTSignalMock,
    cleanup: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useDraw3DWaterfallSignal", () => ({
  useDraw3DWaterfallSignal: () => ({
    draw3DWaterfallSignal: draw3DWaterfallSignalMock,
    cleanup: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useOverlayRenderer", () => ({
  useOverlayRenderer: () => ({
    drawGridOnContext: jest.fn(),
    drawMarkersOnContext: drawMarkersOnContextMock,
    drawDemodFocusOnContext: jest.fn(),
    drawSelectionOverlayOnContext: jest.fn(),
    drawTxSliderOnContext: drawTxSliderOnContextMock,
    drawTxSliderBackdropOnContext: drawTxSliderBackdropOnContextMock,
  }),
}));

describe("useSpectrumRenderer", () => {
  const ctx = {
    clearRect: jest.fn(),
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    clientWidth: 1000,
    clientHeight: 600,
  } as HTMLCanvasElement;

  const markersOverlayRenderer = {
    beginDraw: jest.fn(() => ctx),
    endDraw: jest.fn(),
  };

  const baseOptions = {
    canvas,
    webgpuEnabled: true,
    device: {} as GPUDevice,
    format: "rgba8unorm" as GPUTextureFormat,
    waveform: new Float32Array([1, 2, 3]),
    frequencyRange: { min: 0, max: 4_372_000 },
    fftMin: -120,
    fftMax: 0,
    centerFrequencyHz: 2_186_000,
    isDeviceConnected: true,
    markersOverlayRenderer: markersOverlayRenderer as any,
    overlayDirty: { grid: false, markers: true, spikes: false },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(performance, "now").mockReturnValue(1_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uploads the marker overlay when Tx becomes visible inside the throttle window", () => {
    const { result } = renderHook(() => useSpectrumRenderer());

    expect(result.current.drawSpectrum(baseOptions)).toBe(true);

    expect(markersOverlayRenderer.beginDraw).toHaveBeenCalledTimes(1);
    expect(drawTxSliderOnContextMock).toHaveBeenLastCalledWith(
      expect.anything(),
      1000,
      600,
      undefined,
      { min: 0, max: 4_372_000 },
      1,
    );

    (performance.now as jest.Mock).mockReturnValue(1_001);
    baseOptions.overlayDirty.markers = false;

    expect(
      result.current.drawSpectrum({
        ...baseOptions,
        txSlider: {
          visible: true,
          signalLabel: "APT",
          powerDbm: -18,
          visibleMinHz: 0,
          visibleMaxHz: 4_372_000,
          txCenterHz: 2_186_000,
          txSampleRateHz: 1_000_000,
        },
      }),
    ).toBe(true);

    expect(markersOverlayRenderer.beginDraw).toHaveBeenCalledTimes(2);
    expect(drawMarkersOnContextMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
      expect.any(Number),
      true,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      false,
      0,
      undefined,
      1,
      false,
    );
    expect(drawTxSliderOnContextMock).toHaveBeenLastCalledWith(
      expect.anything(),
      1000,
      600,
      expect.objectContaining({
        visible: true,
        signalLabel: "APT",
        txCenterHz: 2_186_000,
      }),
      expect.any(Object),
      1,
    );
    expect(drawTxSliderBackdropOnContextMock).toHaveBeenLastCalledWith(
      expect.anything(),
      1000,
      600,
      expect.objectContaining({
        visible: true,
        signalLabel: "APT",
        txCenterHz: 2_186_000,
      }),
      { min: 0, max: 4_372_000 },
      -120,
      0,
    );
  });
});
