/** @jest-environment jsdom */
import {
  getZoomedSlice,
  dbToColor,
  getWholeChannelRenderRange,
  buildSnapshotStatsLines,
  buildFastSpectrumCanvas,
  buildFastWaterfallCanvas,
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
    expect(fmtFreq(0.12345e6)).toBe("123kHz");
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
  const mockColormap = [
    [0, 0, 0],
    [255, 255, 255],
  ];

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
          waveformHistory: [],
        },
        {
          data: {} as any,
          visualRange: { min: 2, max: 6 },
          waveformHistory: [],
        },
      ],
    );

    expect(range).toEqual({ min: 0, max: 6 });
  });
});

describe("fast snapshot canvases", () => {
  beforeEach(() => {
    global.clearCanvasCalls?.();
  });

  it("builds fast FFT snapshots from live canvases and replaces only the center icon", () => {
    const spectrumGpu = document.createElement("canvas");
    spectrumGpu.width = 320;
    spectrumGpu.height = 180;
    const spectrumOverlay = document.createElement("canvas");
    spectrumOverlay.width = 320;
    spectrumOverlay.height = 180;

    const canvas = buildFastSpectrumCanvas(
      {
        frequencyRange: { min: 18_000, max: 3_218_000 },
        waveform: new Float32Array([0, 1, 2]),
        vizZoom: 1,
        vizPanOffset: 0,
      } as any,
      320,
      180,
      {
        bg: "#000000",
        grid: "#333333",
        line: "#ffffff",
        shadow: "#111111",
        text: "#777777",
        hwLine: "#999999",
        hwText: "#aaaaaa",
        cfText: "#fefefe",
      },
      { spectrumGpu, spectrumOverlay },
    );

    expect(canvas).toBeTruthy();
    expect(
      (global as any).__CANVAS_CALLS__.filter(
        (call: any) => call.name === "drawImage",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (global as any).__CANVAS_CALLS__.some(
        (call: any) =>
          call.name === "fillText" &&
          typeof call.args[0] === "string" &&
          call.args[0].startsWith("○"),
      ),
    ).toBe(true);
  });

  it("trims the live waterfall render inset before adding the fast VFO axis", () => {
    const waterfallGpu = document.createElement("canvas");
    waterfallGpu.width = 320;
    waterfallGpu.height = 180;

    const canvas = buildFastWaterfallCanvas(
      {
        frequencyRange: { min: 18_000, max: 3_218_000 },
        vizZoom: 1,
        vizPanOffset: 0,
      } as any,
      320,
      180,
      { min: 18_000, max: 3_218_000 },
      { waterfallGpu, waterfallOverlay: null },
      {
        background: "#000000",
        grid: "#333333",
        tick: "#777777",
        label: "#777777",
        center: "#fefefe",
      },
    );

    expect(canvas).toBeTruthy();
    expect(
      (global as any).__CANVAS_CALLS__.some(
        (call: any) =>
          call.name === "drawImage" &&
          call.args.length >= 9 &&
          call.args[2] === 8,
      ),
    ).toBe(true);
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
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useSnapshot(null, false), {
      wrapper: TestWrapper,
    });

    const options = {
      whole: true,
      showWaterfall: false,
      showStats: true,
      showGrid: true,
      showGeolocation: false,
      format: "png" as const,
      getSnapshotData: () => null,
    };

    await act(async () => {
      await result.current.handleSnapshot(options);
    });

    // Should not crash even if data is null
  });

  it("should export a provided canvas without building snapshot stats", async () => {
    const click = jest.fn();
    const toDataURL = jest.fn(() => "data:image/png;base64,mock");
    const mockCanvas = {
      width: 12,
      height: 8,
      toDataURL,
    } as any;
    const mockAnchor = {
      click,
      download: "",
      href: "",
    } as any;
    const originalCreateElementNS = document.createElementNS.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "a") return mockAnchor;
      return originalCreateElementNS("http://www.w3.org/1999/xhtml", tagName);
    });

    const { result } = renderHook(() => useSnapshot(null, false), {
      wrapper: TestWrapper,
    });

    await act(async () => {
      await result.current.handleSnapshot({
        whole: false,
        showWaterfall: false,
        showStats: false,
        showGeolocation: false,
        showGrid: false,
        format: "png",
        getSnapshotData: () => null,
        canvasOnly: {
          getCanvas: () => mockCanvas,
          filenamePrefix: "fast-fft-snapshot",
        },
      });
    });

    expect(toDataURL).toHaveBeenCalledWith("image/png");
    expect(click).toHaveBeenCalled();
    expect(mockAnchor.download).toContain("fast-fft-snapshot");
  });
});

describe("buildSnapshotStatsLines", () => {
  it("orders stats lines and truncates frequencies", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 America/Los_Angeles",
      deviceName: "Mock APT SDR",
      channelName: "A",
      whole: false,
      fftSize: 2048,
      fftWindow: "Rectangular",
      gain: 49.6,
      ppm: 1,
    });

    expect(lines).toEqual([
      "4.38MHz – 4.39MHz",
      "2026-05-18 09:05:26 America/Los_Angeles",
      "Device Name: Mock APT SDR",
      "Onscreen / partial Channel A",
      "FFT size (# of points): 2048",
      "Gain: 49.6dB | PPM: 1",
    ]);
  });

  it("uses whole-channel label when whole is true", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 America/Los_Angeles",
      deviceName: "Mock APT SDR",
      channelName: "X",
      whole: true,
      modeLabel: "Whole Channel",
      fftSize: 2048,
      fftWindow: "Rectangular",
      gain: 49.6,
      ppm: 1,
    });

    expect(lines[3]).toBe("Whole Channel X");
  });

  it("uses whole-channel label when modeLabel says Whole Channel", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 America/Los_Angeles",
      deviceName: "Mock APT SDR",
      channelName: "X",
      whole: false,
      modeLabel: "Whole Channel",
      fftSize: 2048,
      fftWindow: "Rectangular",
      gain: 49.6,
      ppm: 1,
    });

    expect(lines[3]).toBe("Whole Channel X");
  });

  it("uses whole-channel label when the rendered span covers the active channel", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 24_720_000, max: 29_880_000 },
      timestampLabel: "2026-05-28 16:16:06 America/Los_Angeles",
      deviceName: "HackRF One",
      channelName: "B",
      activeSignalAreaBounds: { min: 25_000_000, max: 29_800_000 },
      hardwareSampleRateHz: 5_120_000,
      whole: false,
      fftSize: 262144,
      fftWindow: "Rectangular",
      gainLabel: "Gain: LNA 0dB | VGA 0dB | AMP off | PPM: 1",
    });

    expect(lines[3]).toBe("Whole Channel B");
  });

  it("falls back to Onscreen when no channel name is present", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 America/Los_Angeles",
      deviceName: "Mock APT SDR",
      whole: false,
      fftSize: 2048,
      fftWindow: "Rectangular",
      gain: 49.6,
      ppm: 1,
    });

    expect(lines[3]).toBe("Onscreen");
  });

  it("shows non-rectangular FFT windows", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 America/Los_Angeles",
      deviceName: "Mock APT SDR",
      channelName: "A",
      whole: false,
      fftSize: 2048,
      fftWindow: "Hann",
      gain: 49.6,
      ppm: 1,
    });

    expect(lines[4]).toBe("FFT size (# of points): 2048 | Window: Hann");
  });

  it("falls back to the legacy gain label when numbers are unavailable", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 America/Los_Angeles",
      whole: false,
      fftSize: 2048,
      fftWindow: "Rectangular",
      gainLabel: "Gain: Auto | PPM: 0",
    });

    expect(lines[5]).toBe("Gain: Auto | PPM: 0");
  });
});
