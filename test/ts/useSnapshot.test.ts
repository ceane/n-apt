/** @jest-environment jsdom */
import {
  getZoomedSlice,
  dbToColor,
  getWholeChannelRenderRange,
  useSnapshot,
} from "@n-apt/hooks/useSnapshot";
import { fmtFreq } from "@n-apt/utils/rendering/formatters";
import { renderHook, act } from "@testing-library/react";
import { TestWrapper } from "./testUtils";

jest.mock("@n-apt/components/ui/Theme", () => ({
  ...jest.requireActual("@n-apt/components/ui/Theme"),
  useResolvedThemeMode: jest.fn(() => "dark"),
}));

// ────────────────────────────────────────────────────────────────────────────
// fmtFreq
// ────────────────────────────────────────────────────────────────────────────

describe("fmtFreq", () => {
  it("formats values >= 1 MHz with unit", () => {
    expect(fmtFreq(3e6)).toBe("3MHz");
    expect(fmtFreq(1.6e6)).toBe("1.6MHz");
  });

  it("formats values < 1 MHz as kHz", () => {
    expect(fmtFreq(0.5e6)).toBe("500kHz");
    expect(fmtFreq(0.12345e6)).toBe("123.5kHz");
  });

  it("trims trailing zeros", () => {
    expect(fmtFreq(3.0e6)).toBe("3MHz");
    expect(fmtFreq(0.5e6)).toBe("500kHz");
  });

  it("handles zero", () => {
    expect(fmtFreq(0)).toBe("0Hz");
  });

  it("handles negative values < 1", () => {
    const result = fmtFreq(-0.5e6);
    expect(result).toContain("kHz");
    expect(result).toContain("-500");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getZoomedSlice
// ────────────────────────────────────────────────────────────────────────────

describe("getZoomedSlice", () => {
  const fullWaveform = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const fullRange = { min: 0, max: 10 };

  it("returns full waveform when zoom <= 1", () => {
    const { slicedWaveform, visualRange } = getZoomedSlice(
      fullWaveform,
      fullRange,
      1,
      0,
    );
    expect(slicedWaveform).toBe(fullWaveform); // same reference
    expect(visualRange).toEqual(fullRange);
  });

  it("returns a smaller slice when zoom > 1", () => {
    const { slicedWaveform } = getZoomedSlice(fullWaveform, fullRange, 2, 0);
    expect(slicedWaveform.length).toBeLessThan(fullWaveform.length);
    expect(slicedWaveform.length).toBe(5); // 10 / 2
  });

  it("adjusts visual range based on zoom", () => {
    const { visualRange } = getZoomedSlice(fullWaveform, fullRange, 2, 0);
    const span = visualRange.max - visualRange.min;
    expect(span).toBeCloseTo(5, 1); // half the full span
  });

  it("pans correctly within bounds", () => {
    const { visualRange } = getZoomedSlice(fullWaveform, fullRange, 2, 1);
    // Center should shift right from 5
    expect(visualRange.min).toBeGreaterThan(0);
    expect(visualRange.max).toBeLessThanOrEqual(10);
  });

  it("clamps pan to prevent going out of bounds", () => {
    const { visualRange } = getZoomedSlice(fullWaveform, fullRange, 2, 100);
    // Even extreme pan should stay within bounds
    expect(visualRange.min).toBeGreaterThanOrEqual(0);
    expect(visualRange.max).toBeLessThanOrEqual(10 + 0.01); // floating point tolerance
  });
});

// ────────────────────────────────────────────────────────────────────────────
// dbToColor
// ────────────────────────────────────────────────────────────────────────────

describe("dbToColor", () => {
  const mockColormap = [[0, 0, 0], [255, 255, 255]];

  it("returns [r, g, b] tuple", () => {
    const color = dbToColor(-60, -120, 0, mockColormap);
    expect(color).toHaveLength(3);
    color.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    });
  });

  it("returns different colors for different dB values", () => {
    const low = dbToColor(-120, -120, 0, mockColormap);
    const high = dbToColor(0, -120, 0, mockColormap);
    // At least one channel should differ
    const differs = low.some((v, i) => Math.abs(v - high[i]) > 1);
    expect(differs).toBe(true);
  });

  it("handles boundary values", () => {
    expect(() => dbToColor(-120, -120, 0, mockColormap)).not.toThrow();
    expect(() => dbToColor(0, -120, 0, mockColormap)).not.toThrow();
  });

  it("clamps out-of-range dB values gracefully", () => {
    expect(() => dbToColor(-200, -120, 0, mockColormap)).not.toThrow();
    expect(() => dbToColor(50, -120, 0, mockColormap)).not.toThrow();
  });
});

describe("getWholeChannelRenderRange", () => {
  it("uses the captured segment span when whole-channel segments are available", () => {
    const range = getWholeChannelRenderRange(
      {
        frequencyRange: { min: 10, max: 12 },
      } as any,
      {
        activeSignalArea: undefined,
        signalAreaBounds: null,
      },
      [
        {
          data: {} as any,
          visualRange: { min: 0, max: 2 },
        },
        {
          data: {} as any,
          visualRange: { min: 2, max: 6 },
        },
      ],
    );

    expect(range).toEqual({ min: 0, max: 6 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// useSnapshot Hook
// ────────────────────────────────────────────────────────────────────────────

describe("useSnapshot", () => {
  beforeEach(() => {
    // Mock URL.createObjectURL
    global.URL.createObjectURL = jest.fn(() => "mock-url");
    // Mock document.createElement for download link
    const mockAnchor = {
      click: jest.fn(),
      download: "",
      href: "",
    } as any;
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "a") return mockAnchor;
      return originalCreateElement(tagName);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should return handleSnapshot function", () => {
    const { result } = renderHook(() => useSnapshot(null, false), {
      wrapper: TestWrapper,
    });

    expect(result.current.handleSnapshot).toBeInstanceOf(Function);
  });

  it("should handle snapshot when no data is available", async () => {
    const { result } = renderHook(() => useSnapshot(null, false), {
      wrapper: TestWrapper,
    });

    const options = {
      whole: true,
      showWaterfall: false,
      showStats: true,
      showGrid: true,
      format: "png" as const,
      getSnapshotData: () => null,
    };

    await act(async () => {
      await result.current.handleSnapshot(options);
    });
    
    // Should not crash even if data is null
  });
});
