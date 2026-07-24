import { renderHook } from "@testing-library/react";
import {
  invalidateOverlayThemeColorCache,
  useOverlayRenderer,
} from "@n-apt/hooks/useOverlayRenderer";

describe("useOverlayRenderer Hook", () => {
  const mockCtx = {
    measureText: jest.fn(() => ({ width: 50 })),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fillText: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    setLineDash: jest.fn(),
    clearRect: jest.fn(),
    rect: jest.fn(),
    roundRect: jest.fn(),
    clip: jest.fn(),
    fill: jest.fn(),
    strokeRect: jest.fn(),
    fillRect: jest.fn(),
    arc: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    invalidateOverlayThemeColorCache();
  });

  it("caches parsed theme colors across draw calls", () => {
    const computedStyleSpy = jest.spyOn(window, "getComputedStyle");
    const { result } = renderHook(() => useOverlayRenderer());
    const frequencyRange = { min: 90e6, max: 110e6 };

    result.current.drawGridOnContext(
      mockCtx,
      1000,
      600,
      frequencyRange,
      -120,
      0,
    );
    const firstCallCount = computedStyleSpy.mock.calls.length;
    result.current.drawGridOnContext(
      mockCtx,
      1000,
      600,
      frequencyRange,
      -120,
      0,
    );

    expect(firstCallCount).toBeGreaterThan(0);
    expect(computedStyleSpy).toHaveBeenCalledTimes(firstCallCount);
    computedStyleSpy.mockRestore();
  });

  it("should draw hardware sample rate lines when appropriate", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    const frequencyRange = { min: 90e6, max: 110e6 }; // 20MHz span
    const hardwareSampleRateHz = 10000000; // 10MHz
    // Span > SampleRate, so it should draw lines

    result.current.drawGridOnContext(
      mockCtx,
      1000,
      600,
      frequencyRange,
      -120,
      0,
      "dB",
      hardwareSampleRateHz,
      undefined,
      true,
    );

    // Should have called setLineDash for dashed lines
    expect(mockCtx.setLineDash).toHaveBeenCalledWith([4, 4]);

    // Should draw labels "Hardware Sample Rate"
    const labels = mockCtx.fillText.mock.calls.map((c: any) => c[0]);
    expect(labels).toContain("Hardware Sample Rate");
  });

  it("should draw 'Next Sample' for partial blocks at the end", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    const frequencyRange = { min: 90e6, max: 105e6 }; // 15MHz span
    const hardwareSampleRateHz = 10000000; // 10MHz
    // First block: 90-100 (Full), Second block: 100-105 (Partial)

    result.current.drawGridOnContext(
      mockCtx,
      1000,
      600,
      frequencyRange,
      -120,
      0,
      "dB",
      hardwareSampleRateHz,
      undefined,
      true,
    );

    const labels = mockCtx.fillText.mock.calls.map((c: any) => c[0]);
    expect(labels).toContain("Hardware Sample Rate");
    expect(labels).toContain("Next Sample");
  });

  it("should not draw hardware lines if span is smaller than sample rate", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    const frequencyRange = { min: 95e6, max: 100e6 }; // 5MHz span
    const hardwareSampleRateHz = 10000000; // 10MHz

    jest.clearAllMocks();
    result.current.drawGridOnContext(
      mockCtx,
      1000,
      600,
      frequencyRange,
      -120,
      0,
      "dB",
      hardwareSampleRateHz,
    );

    const labels = mockCtx.fillText.mock.calls.map((c: any) => c[0]);
    expect(labels).not.toContain("Hardware Sample Rate");
  });

  it("should draw frequency grid ticks in MHz with Hz input", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    const frequencyRange = { min: 90e6, max: 92e6 }; // 2MHz span

    jest.clearAllMocks();
    result.current.drawGridOnContext(
      mockCtx,
      1000,
      600,
      frequencyRange,
      -120,
      0,
      "dB",
    );

    const labels = mockCtx.fillText.mock.calls.map((c: any) => c[0]);
    // With 2MHz span, step should be 250kHz (250,000 Hz)
    // Ticks: 90.25, 90.50, 90.75, 91.00, etc.
    // 91MHz will collide with the center label and be filtered out, which is expected.
    // 90.25MHz -> 90.25MHz (precise)
    // 90.75MHz -> 90.75MHz (precise)
    expect(labels).toContain("90.25MHz");
    expect(labels).toContain("90.75MHz");
    expect(labels).not.toContain("91MHz"); // Collides with center
  });

  it("draws the Tx slider without labels", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    result.current.drawTxSliderOnContext(mockCtx, 1000, 600, {
      visible: true,
      signalLabel: "APT",
      powerDbm: -18,
      visibleMinHz: 136_000_000,
      visibleMaxHz: 138_000_000,
      txCenterHz: 137_100_000,
      txSampleRateHz: 240_000,
    });

    expect(mockCtx.fillText).not.toHaveBeenCalled();
  });

  it("draws the Tx backdrop as a bandwidth by power rectangle", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    result.current.drawTxSliderBackdropOnContext(
      mockCtx,
      1000,
      600,
      {
        visible: true,
        isTransmitting: true,
        powerDbm: -60,
        visibleMinHz: 136_000_000,
        visibleMaxHz: 138_000_000,
        txCenterHz: 137_000_000,
        txSampleRateHz: 200_000,
      },
      { min: 136_000_000, max: 138_000_000 },
      -120,
      0,
    );

    expect(mockCtx.rect).toHaveBeenCalled();
    const [x, y, width, height] = mockCtx.rect.mock.calls.at(-1);
    expect(x).toBeCloseTo(459.5, 1);
    expect(width).toBeCloseTo(91, 0);
    expect(y).toBeCloseTo(504, 0);
    expect(height).toBeCloseTo(96, 0);
  });

  it("leaves the FFT node status row out of the spectrum canvas", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    result.current.drawSelectionOverlayOnContext(
      mockCtx,
      1000,
      600,
      { min: 136_000_000, max: 138_000_000 },
      {
        minFrequencyHz: 135_900_000,
        maxFrequencyHz: 138_300_000,
      },
      true,
    );

    const labels = mockCtx.fillText.mock.calls.map((call: any[]) => call[0]);
    expect(labels).toEqual([]);
    expect(mockCtx.lineTo).not.toHaveBeenCalledWith(expect.any(Number), 572);
  });

  it("can suppress the live status row when another overlay owns the bottom band", () => {
    const { result } = renderHook(() => useOverlayRenderer());

    result.current.drawMarkersOnContext(
      mockCtx,
      1000,
      600,
      { min: 136_000_000, max: 138_000_000 },
      137_000_000,
      true,
      2_400_000,
      { min: 136_000_000, max: 138_000_000 },
      false,
      [],
      16_384,
      "Rectangular",
      "reduced",
      false,
    );

    const labels = mockCtx.fillText.mock.calls.map((c: any) => c[0]);
    expect(labels).not.toContain("FFT Size: 16,384");
    expect(labels).not.toContain("FFT Window: Rectangular");
    expect(labels).not.toContain("Timing: Lossless");
  });
});
