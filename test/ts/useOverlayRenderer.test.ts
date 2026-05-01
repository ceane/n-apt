import { renderHook } from "@testing-library/react";
import { useOverlayRenderer } from "@n-apt/hooks/useOverlayRenderer";

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
    clip: jest.fn(),
  } as any;

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
      hardwareSampleRateHz
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
      hardwareSampleRateHz
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
      hardwareSampleRateHz
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
      "dB"
    );

    const labels = mockCtx.fillText.mock.calls.map((c: any) => c[0]);
    // With 2MHz span, step should be 250kHz (250,000 Hz)
    // Ticks: 90.25, 90.50, 90.75, 91.00, etc.
    // 91MHz will collide with the center label and be filtered out, which is expected.
    // 90.25MHz -> 90.3MHz (rounded to 1 decimal)
    // 90.75MHz -> 90.8MHz (rounded to 1 decimal)
    expect(labels).toContain("90.3MHz");
    expect(labels).toContain("90.8MHz");
    expect(labels).not.toContain("91MHz"); // Collides with center
  });
});
