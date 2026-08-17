/** @jest-environment jsdom */
import {
  getZoomedSlice,
  dbToColor,
  getWholeChannelRenderRange,
  buildSnapshotStatsLines,
  buildFastSpectrumCanvas,
  buildFastWaterfallCanvas,
  createFastFrameScratch,
  pinFastRecordingOptions,
  renderSpectrumSnapshotCanvas,
  renderWaterfallSnapshotCanvas,
  renderStatsRowCanvas,
  useSnapshot,
} from "@n-apt/capture/hooks/useSnapshot";
import { fmtFreq } from "@n-apt/layout/rendering/formatters";
import { fmtFreqTick } from "@n-apt/layout/rendering/formatters";
import { formatTimestampWithTimezone } from "@n-apt/math/formatters";
import { renderHook, act } from "@testing-library/react";
import { TestWrapper } from "./testUtils";

jest.mock("@n-apt/ui/Theme", () => ({
  ...jest.requireActual("@n-apt/ui/Theme"),
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

describe("fmtFreqTick", () => {
  it("keeps three decimal places in GHz", () => {
    expect(fmtFreqTick(1_001_000_000, 250_000)).toBe("1.001GHz");
  });

  it("keeps sub-MHz GHz ticks distinct", () => {
    expect(fmtFreqTick(1_000_500_000, 250_000)).toBe("1.0005GHz");
  });
});

describe("formatTimestampWithTimezone", () => {
  it("wraps the timezone in parentheses for snapshot labels", () => {
    expect(formatTimestampWithTimezone("2026-05-18T16:05:26.000Z")).toBe(
      "2026-05-18 09:05:26 (America/Los_Angeles)",
    );
  });
});

describe("pinFastRecordingOptions", () => {
  it("freezes channel labels and bounds without freezing the frame axis", () => {
    let area = "first";
    let bounds = { min: 100, max: 200 };
    const pinned = pinFastRecordingOptions({
      activeSignalArea: area,
      activeSignalAreaBounds: bounds,
      signalAreaBounds: { first: bounds },
      getActiveSignalArea: () => area,
      getActiveSignalAreaBounds: () => bounds,
    });

    area = "second";
    bounds = { min: 300, max: 400 };

    expect(pinned.activeSignalArea).toBe("first");
    expect(pinned.activeSignalAreaBounds).toEqual({ min: 100, max: 200 });
    expect(pinned.getActiveSignalArea).toBeUndefined();
    expect(pinned.getActiveSignalAreaBounds).toBeUndefined();
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

describe("renderSpectrumSnapshotCanvas", () => {
  it("uses the explicit dBm power scale for axis labels", () => {
    global.clearCanvasCalls?.();

    renderSpectrumSnapshotCanvas(
      {
        frequencyRange: { min: 18_000, max: 3_218_000 },
        waveform: new Float32Array([-100, -95, -90, -85]),
        fullChannelWaveform: null,
        dbMin: -120,
        dbMax: -10,
        powerScale: "dBm",
        centerFrequencyHz: 1_618_000,
        isDeviceConnected: true,
        vizZoom: 1,
        vizPanOffset: 0,
        waterfallTextureSnapshot: null,
        waterfallTextureMeta: null,
        waterfallBuffer: null,
        waterfallDims: null,
        webgpuEnabled: false,
        colormap: [],
      } as any,
      { min: 18_000, max: 3_218_000 },
      true,
      320,
      180,
      undefined,
      [],
      undefined,
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
    );

    const fillTextCalls = (global as any).__CANVAS_CALLS__.filter(
      (call: any) => call.name === "fillText",
    );
    expect(
      fillTextCalls.some((call: any) => String(call.args[0]).includes("dBm")),
    ).toBe(true);
  });

  it("shows the exact top dBm bound when it is not on a 10dB marker", () => {
    global.clearCanvasCalls?.();

    renderSpectrumSnapshotCanvas(
      {
        frequencyRange: { min: 4_750_000, max: 23_000_000 },
        waveform: new Float32Array([-55, -48, -60, -42]),
        fullChannelWaveform: null,
        dbMin: -70,
        dbMax: -25,
        powerScale: "dBm",
        centerFrequencyHz: 13_875_000,
        isDeviceConnected: true,
        vizZoom: 1,
        vizPanOffset: 0,
        waterfallTextureSnapshot: null,
        waterfallTextureMeta: null,
        waterfallBuffer: null,
        waterfallDims: null,
        webgpuEnabled: false,
        colormap: [],
      } as any,
      { min: 4_750_000, max: 23_000_000 },
      true,
      1506,
      750,
      undefined,
      [],
      undefined,
      {
        bg: "#000000",
        grid: "#333333",
        line: "#00d5ff",
        shadow: "#063b44",
        text: "#777777",
        hwLine: "#999999",
        hwText: "#aaaaaa",
        cfText: "#fefefe",
      },
    );

    const fillTextCalls = (global as any).__CANVAS_CALLS__.filter(
      (call: any) => call.name === "fillText",
    );
    expect(fillTextCalls.map((call: any) => call.args[0])).toContain("-25dBm");
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

  it("builds fast FFT snapshots from the live canvas without the VFO overlay", () => {
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
    const drawImageCalls = (global as any).__CANVAS_CALLS__.filter(
      (call: any) => call.name === "drawImage",
    );
    expect(drawImageCalls.length).toBe(0);
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

  it("prefers the persisted waterfall buffer for fast waterfall snapshots", () => {
    global.clearCanvasCalls?.();

    const canvas = buildFastWaterfallCanvas(
      {
        frequencyRange: { min: 18_000, max: 3_218_000 },
        vizZoom: 1,
        vizPanOffset: 0,
        dbMin: -120,
        dbMax: 0,
        waterfallBuffer: new Uint8ClampedArray([
          10, 20, 30, 255, 40, 50, 60, 255,
        ]),
        waterfallDims: { width: 1, height: 2 },
      } as any,
      320,
      180,
      { min: 18_000, max: 3_218_000 },
      null,
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
          call.args.length >= 3 &&
          call.args[0] !== undefined,
      ),
    ).toBe(true);
  });

  it("blits the live waterfall instead of recoloring the texture while recording", () => {
    const waterfallGpu = document.createElement("canvas");
    waterfallGpu.width = 320;
    waterfallGpu.height = 180;
    const scratch = createFastFrameScratch();

    global.clearCanvasCalls?.();
    buildFastWaterfallCanvas(
      {
        frequencyRange: { min: 18_000, max: 3_218_000 },
        vizZoom: 1,
        vizPanOffset: 0,
        dbMin: -120,
        dbMax: 0,
        waterfallTextureSnapshot: new Uint8Array(
          new Float32Array([-30, -40]).buffer,
        ),
        waterfallTextureMeta: { width: 1, height: 2, writeRow: 1 },
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
      { scratch },
    );

    expect(
      (global as any).__CANVAS_CALLS__.some(
        (call: any) => call.name === "putImageData",
      ),
    ).toBe(false);
  });

  it("reuses scratch canvases across recorded frames", () => {
    const scratch = createFastFrameScratch();
    const snapshotData = {
      frequencyRange: { min: 18_000, max: 3_218_000 },
      waveform: new Float32Array([-90, -60, -70, -50]),
      vizZoom: 1,
      vizPanOffset: 0,
      dbMin: -120,
      dbMax: 0,
    } as any;
    const theme = {
      bg: "#000000",
      grid: "#333333",
      line: "#ffffff",
      shadow: "#111111",
      text: "#777777",
      hwLine: "#999999",
      hwText: "#aaaaaa",
      cfText: "#fefefe",
    };

    const first = buildFastSpectrumCanvas(snapshotData, 320, 180, theme, null, {
      scratch,
    });
    const second = buildFastSpectrumCanvas(
      snapshotData,
      320,
      180,
      theme,
      null,
      { scratch },
    );

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("uses the snapshot colormap when recoloring raw waterfall textures", () => {
    const canvas = renderWaterfallSnapshotCanvas(
      {
        dbMin: 0,
        dbMax: 10,
        colormap: [
          [0, 0, 255],
          [255, 0, 0],
        ],
        waterfallTextureSnapshot: new Uint8Array(new Float32Array([30]).buffer),
        waterfallTextureMeta: {
          width: 1,
          height: 1,
          writeRow: 1,
        },
        waterfallBuffer: null,
        waterfallDims: null,
      } as any,
      1,
      1,
      { marginX: 0, marginY: 0, noBackground: true },
    );

    expect(canvas).toBeTruthy();
    const putImageCall = (global as any).__CANVAS_CALLS__.find(
      (call: any) => call.name === "putImageData",
    );
    expect(putImageCall).toBeTruthy();
    const imageData = putImageCall.args[0];
    expect(imageData.data[0]).toBeGreaterThan(200);
    expect(imageData.data[1]).toBe(0);
    expect(imageData.data[2]).toBeLessThan(60);
  });

  it("renders the demod channel band on fast spectrum snapshots", () => {
    const spectrumGpu = document.createElement("canvas");
    spectrumGpu.width = 640;
    spectrumGpu.height = 360;

    const canvas = buildFastSpectrumCanvas(
      {
        frequencyRange: { min: 24_720_000, max: 29_920_000 },
        waveform: new Float32Array([0, 1, 2, 3]),
        vizZoom: 1,
        vizPanOffset: 0,
        demodFocusOverlay: {
          centerFrequencyHz: 27_320_000,
          halfBandwidthHz: 2_600_000,
          alignment: "centered",
        },
      } as any,
      640,
      360,
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
      null,
    );

    expect(canvas).toBeTruthy();
    expect(
      (global as any).__CANVAS_CALLS__.some(
        (call: any) => call.name === "fillRect" && call.args[2] > 0,
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

  it("uses the live spectrum canvas for regular onscreen PNG snapshots", async () => {
    global.clearCanvasCalls?.();
    const liveSpectrum = document.createElement("canvas");
    const liveOverlay = document.createElement("canvas");
    const { result } = renderHook(() => useSnapshot(null, true), {
      wrapper: TestWrapper,
    });

    await act(async () => {
      await result.current.handleSnapshot({
        whole: false,
        showWaterfall: false,
        showStats: false,
        showGeolocation: false,
        showGrid: true,
        format: "png",
        getSnapshotData: () =>
          ({
            frequencyRange: { min: 24_720_000, max: 29_880_000 },
            waveform: new Float32Array([-80, -75, -82, -70]),
            fullChannelWaveform: null,
            vizZoom: 1,
            vizPanOffset: 0,
            dbMin: -120,
            dbMax: 0,
            hardwareSampleRateHz: 5_120_000,
          }) as any,
        getVideoSourceCanvases: () => ({
          spectrum: liveSpectrum,
          spectrumOverlay: liveOverlay,
          waterfall: null,
        }),
      });
    });

    const canvasCalls = (global as any).__CANVAS_CALLS__ ?? [];
    expect(
      canvasCalls.some(
        (call: any) =>
          call.name === "drawImage" &&
          (call.args[0] === liveOverlay || call.args[0] === liveSpectrum),
      ),
    ).toBe(false);
  });
});

describe("buildSnapshotStatsLines", () => {
  it("orders stats lines and truncates frequencies", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 (America/Los_Angeles)",
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
      "2026-05-18 09:05:26 (America/Los_Angeles)",
      "Device Name: Mock APT SDR",
      "Onscreen / partial Channel A",
      "FFT size (# of points): 2048",
      "Gain: 49.6dB | PPM: 1",
    ]);
  });

  it("uses trimmed MHz formatting for snapshot ranges", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 2_201_269, max: 2_206_731 },
      timestampLabel: "2026-05-18 09:05:26 (America/Los_Angeles)",
      deviceName: "Mock APT SDR",
      channelName: "A",
      whole: false,
      fftSize: 2048,
      fftWindow: "Rectangular",
      gain: 49.6,
      ppm: 1,
    });

    expect(lines[0]).toBe("2.2013MHz – 2.2067MHz");
  });

  it("uses whole-channel label when whole is true", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 (America/Los_Angeles)",
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
      timestampLabel: "2026-05-18 09:05:26 (America/Los_Angeles)",
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
      timestampLabel: "2026-05-28 16:16:06 (America/Los_Angeles)",
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

  it("lists each channel visible in the snapshot range", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 20_500_000, max: 30_000_000 },
      timestampLabel: "2026-06-29 12:00:00 (America/Los_Angeles)",
      deviceName: "HackRF One",
      channelName: "C",
      activeSignalAreaBounds: { min: 20_000_000, max: 25_000_000 },
      signalAreaBounds: {
        c: { min: 20_000_000, max: 25_000_000 },
        b: { min: 25_000_000, max: 30_000_000 },
        a: { min: 30_000_000, max: 35_000_000 },
      },
      whole: false,
      fftSize: 262144,
      fftWindow: "Rectangular",
      gainLabel: "Gain: LNA 0dB | VGA 0dB | AMP off | PPM: 1",
    });

    expect(lines[3]).toBe("Channels C (partial), B (whole)");
  });

  it("marks a straddled channel partial when only part of it is visible", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 22_000_000, max: 27_000_000 },
      timestampLabel: "2026-06-29 12:00:00 (America/Los_Angeles)",
      deviceName: "HackRF One",
      channelName: "C",
      signalAreaBounds: {
        c: { min: 20_000_000, max: 25_000_000 },
        b: { min: 25_000_000, max: 30_000_000 },
      },
      whole: false,
      fftSize: 262144,
      fftWindow: "Rectangular",
      gainLabel: "Gain: LNA 0dB | VGA 0dB | AMP off | PPM: 1",
    });

    expect(lines[3]).toBe("Channels C (partial), B (partial)");
  });

  it("does not infer whole-channel just because an RTL-SDR snapshot spans the hardware sample rate", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 100_000_000, max: 103_200_000 },
      timestampLabel: "2026-06-03 12:00:00 (America/Los_Angeles)",
      deviceName: "RTL-SDR Blog V4",
      channelName: "A",
      activeSignalAreaBounds: { min: 18_000, max: 4_390_000 },
      hardwareSampleRateHz: 3_200_000,
      whole: false,
      modeLabel: "Onscreen",
      fftSize: 262144,
      fftWindow: "Rectangular",
      gain: 49.6,
      ppm: 1,
    });

    expect(lines[3]).toBe("Onscreen / partial Channel A");
  });

  it("falls back to Onscreen when no channel name is present", () => {
    const lines = buildSnapshotStatsLines({
      range: { min: 4_380_001, max: 4_389_999 },
      timestampLabel: "2026-05-18 09:05:26 (America/Los_Angeles)",
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
      timestampLabel: "2026-05-18 09:05:26 (America/Los_Angeles)",
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
      timestampLabel: "2026-05-18 09:05:26 (America/Los_Angeles)",
      whole: false,
      fftSize: 2048,
      fftWindow: "Rectangular",
      gainLabel: "Gain: Auto | PPM: 0",
    });

    expect(lines[5]).toBe("Gain: Auto | PPM: 0");
  });
});

describe("renderStatsRowCanvas", () => {
  it("leaves six pixels of vertical breathing room between metadata rows", () => {
    clearCanvasCalls();
    renderStatsRowCanvas(
      ["left one", "left two", "right one", "right two"],
      800,
      {
        bg: "#000",
        grid: "#333",
        line: "#0ff",
        shadow: "#000",
        text: "#777",
        hwLine: "#999",
        hwText: "#aaa",
        cfText: "#fff",
      },
    );

    const textYPositions: number[] = Array.from(
      new Set<number>(
        (global as any).__CANVAS_CALLS__
          .filter((call: any) => call.name === "fillText" && call.args[0] !== "-")
          .map((call: any) => call.args[2] as number),
      ),
    );

    expect(textYPositions[1] - textYPositions[0]).toBeCloseTo(30, 5);
  });

  it("adds a separate top gap before the full-width location row", () => {
    clearCanvasCalls();
    renderStatsRowCanvas(
      [
        "left one",
        "left two",
        "right one",
        "right two",
        "left three",
        "right three",
        "Location: 37.774900, -122.419400 – San Francisco, California",
      ],
      800,
      {
        bg: "#000",
        grid: "#333",
        line: "#0ff",
        shadow: "#000",
        text: "#777",
        hwLine: "#999",
        hwText: "#aaa",
        cfText: "#fff",
      },
    );

    const textYPositions: number[] = Array.from(
      new Set<number>(
        (global as any).__CANVAS_CALLS__
          .filter((call: any) => call.name === "fillText" && call.args[0] !== "-")
          .map((call: any) => call.args[2] as number),
      ),
    );

    expect(textYPositions[3] - textYPositions[2]).toBeCloseTo(36, 5);
  });
});
