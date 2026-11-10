import { act, renderHook } from "@testing-library/react";
import { FFT_AREA_MIN } from "@n-apt/consts";
import { useSnapshot } from "@n-apt/capture/hooks/useSnapshot";
import { getFrequencyAxisHeight } from "@n-apt/layout/rendering/frequencyAxis";
import { TestWrapper } from "./testUtils";

describe("standalone waterfall fast snapshot", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("includes the dB scale in the exported waterfall canvas", async () => {
    global.clearCanvasCalls?.();

    const createElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = createElement(tagName);
        if (element instanceof HTMLCanvasElement) {
          let width = 800;
          let height = 600;
          Object.defineProperties(element, {
            width: {
              configurable: true,
              get: () => width,
              set: (value: number) => {
                width = value;
              },
            },
            height: {
              configurable: true,
              get: () => height,
              set: (value: number) => {
                height = value;
              },
            },
          });
        }
        return element;
      }) as typeof document.createElement,
    );

    const waterfallGpu = document.createElement("canvas");
    const spectrumGpu = document.createElement("canvas");
    const snapshotData = {
      frequencyRange: { min: 18_000, max: 3_218_000 },
      dbMin: -55.75,
      dbMax: -44.25,
      powerScale: "dBm" as const,
      vizZoom: 1,
      vizPanOffset: 0,
      isDeviceConnected: true,
    } as any;
    const { result } = renderHook(
      () => useSnapshot(snapshotData.frequencyRange, true),
      { wrapper: TestWrapper },
    );

    await act(async () => {
      await result.current.takeFastSnapshot(
        "waterfall",
        () => snapshotData,
        waterfallGpu.width,
        waterfallGpu.height,
        () => ({
          spectrumGpu,
          spectrumOverlay: null,
          waterfallGpu,
          waterfallOverlay: null,
        }),
        { showStats: true },
      );
    });

    const labels = (global as any).__CANVAS_CALLS__
      .filter((call: any) => call.name === "fillText")
      .map((call: any) => call.args[0]);
    expect(labels).toContain("-44.25dBm");
    expect(labels).toContain("-55.75");

    const calls = (global as any).__CANVAS_CALLS__ as Array<{
      name: string;
      args: any[];
    }>;
    const plotCopy = calls.find(
      (call) =>
        call.name === "drawImage" &&
        call.args.length === 9 &&
        call.args[1] === 40,
    );
    const dpr = window.devicePixelRatio || 1;
    const sourceWidth = waterfallGpu.width - 80 * dpr;
    const referencePlotWidth =
      spectrumGpu.width - (Math.max(FFT_AREA_MIN.x, 52) + 40) * dpr;
    const referencePlotHeight =
      spectrumGpu.height - (FFT_AREA_MIN.y + 40) * dpr;
    const visibleContentHeight = plotCopy?.args[4] ?? 0;
    expect(plotCopy?.args.slice(1)).toEqual([
      40 * dpr,
      0,
      sourceWidth,
      visibleContentHeight,
      73 * dpr,
      0,
      referencePlotWidth,
      visibleContentHeight,
    ]);

    const dbMaxLabel = calls.find(
      (call) => call.name === "fillText" && call.args[0] === "-44.25dBm",
    );
    const dbMinLabel = calls.find(
      (call) => call.name === "fillText" && call.args[0] === "-55.75",
    );
    const sourceWaterfallCanvas = plotCopy?.args[0] as HTMLCanvasElement;
    const fullWidthHeaderCopy = calls.find(
      (call) =>
        call.name === "drawImage" &&
        call.args[0] === sourceWaterfallCanvas &&
        call.args.length === 9 &&
        call.args[1] === 0 &&
        call.args[2] === 0 &&
        call.args[5] === 0 &&
        call.args[6] === 0 &&
        call.args[4] > 0,
    );
    expect(fullWidthHeaderCopy?.args[3]).toBe(sourceWaterfallCanvas.width);
    const waterfallPlotTop = dbMaxLabel?.args[2] ?? 0;
    const sourcePlotHeight =
      sourceWaterfallCanvas.height - waterfallPlotTop;
    const visiblePlotHeight = Math.min(
      sourcePlotHeight,
      referencePlotHeight,
    );
    expect(waterfallPlotTop).toBeGreaterThan(getFrequencyAxisHeight("dense"));
    expect(dbMinLabel?.args[2]).toBe(
      waterfallPlotTop + visiblePlotHeight,
    );
    expect(visibleContentHeight).toBe(
      waterfallPlotTop + visiblePlotHeight,
    );
  });

  it("records retained waterfall history with its dB scale", () => {
    global.clearCanvasCalls?.();

    const originalMediaRecorder = Object.getOwnPropertyDescriptor(
      globalThis,
      "MediaRecorder",
    );
    const originalCaptureStream = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "captureStream",
    );
    const originalSetTimeout = window.setTimeout;
    const scheduledFrames: Array<() => void> = [];
    const stream = {
      getTracks: () => [{ stop: jest.fn() }],
      getVideoTracks: () => [{}],
    };
    class MockMediaRecorder {
      static isTypeSupported = jest.fn(() => true);
      state = "inactive";
      ondataavailable: ((event: any) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: MediaStream, _options: MediaRecorderOptions) {}

      start() {
        this.state = "recording";
      }

      requestData() {}

      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }

    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      writable: true,
      value: jest.fn(() => stream),
    });

    const createElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = createElement(tagName);
        if (element instanceof HTMLCanvasElement) {
          let width = 800;
          let height = 600;
          Object.defineProperties(element, {
            width: {
              configurable: true,
              get: () => width,
              set: (value: number) => {
                width = value;
              },
            },
            height: {
              configurable: true,
              get: () => height,
              set: (value: number) => {
                height = value;
              },
            },
          });
        }
        return element;
      }) as typeof document.createElement,
    );

    const waterfallGpu = document.createElement("canvas");
    const spectrumGpu = document.createElement("canvas");
    const waterfallData = {
      frequencyRange: { min: 18_000, max: 3_218_000 },
      waveform: new Float32Array([-45, -30, -38, -24]),
      dbMin: -55.75,
      dbMax: -44.25,
      powerScale: "dBm" as const,
      vizZoom: 1,
      vizPanOffset: 0,
      isDeviceConnected: true,
      waterfallTextureSnapshot: new Uint8Array(
        new Float32Array([-30, -40]).buffer,
      ),
      waterfallTextureMeta: { width: 1, height: 2, writeRow: 1 },
      waterfallBuffer: null,
      waterfallDims: null,
      colormap: [],
    } as any;
    const getSnapshotData = jest.fn(
      (options?: { includeWaterfall?: boolean }) =>
        options?.includeWaterfall
          ? waterfallData
          : {
              ...waterfallData,
              waterfallTextureSnapshot: null,
              waterfallTextureMeta: null,
            },
    );
    const canvases = {
      spectrumGpu,
      spectrumOverlay: null,
      waterfallGpu,
      waterfallOverlay: null,
    };
    const { result, unmount } = renderHook(
      () => useSnapshot(waterfallData.frequencyRange, true),
      { wrapper: TestWrapper },
    );

    try {
      window.setTimeout = ((callback: TimerHandler) => {
        if (typeof callback === "function") {
          scheduledFrames.push(callback as () => void);
        }
        return 1;
      }) as typeof window.setTimeout;

      act(() => {
        result.current.startFastRecording(
          "waterfall",
          getSnapshotData,
          () => ({ width: waterfallGpu.width, height: waterfallGpu.height }),
          "waterfall-test",
          () => canvases,
          { showStats: true },
        );
      });
      act(() => scheduledFrames[0]?.());

      expect(getSnapshotData).toHaveBeenCalledWith({
        includeWaterfall: true,
        copyWaveforms: false,
      });
      expect(getSnapshotData).toHaveBeenNthCalledWith(2, {
        includeWaterfall: true,
        copyWaveforms: false,
      });
      expect(
        (global as any).__CANVAS_CALLS__.some(
          (call: any) => call.name === "putImageData",
        ),
      ).toBe(true);
      const labels = (global as any).__CANVAS_CALLS__
        .filter((call: any) => call.name === "fillText")
        .map((call: any) => call.args[0]);
      expect(labels).toContain("-44.25dBm");
      expect(labels).toContain("-55.75");
      const calls = (global as any).__CANVAS_CALLS__ as Array<{
        name: string;
        args: any[];
      }>;
      const plotCopy = calls.find(
        (call) =>
          call.name === "drawImage" &&
          call.args.length === 9 &&
          call.args[1] === 40 * (window.devicePixelRatio || 1),
      );
      const sourceWaterfallCanvas = plotCopy?.args[0];
      expect(
        calls.some(
          (call) =>
            call.name === "drawImage" &&
            call.args[0] === sourceWaterfallCanvas &&
            call.args.length === 9 &&
            call.args[1] === 0 &&
            call.args[2] === 0 &&
            call.args[5] === 0 &&
            call.args[6] === 0 &&
            call.args[4] > 0 &&
            call.args[3] === sourceWaterfallCanvas?.width,
        ),
      ).toBe(true);
    } finally {
      act(() => result.current.stopFastRecording());
      unmount();
      if (originalMediaRecorder) {
        Object.defineProperty(
          globalThis,
          "MediaRecorder",
          originalMediaRecorder,
        );
      } else {
        delete (globalThis as any).MediaRecorder;
      }
      if (originalCaptureStream) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "captureStream",
          originalCaptureStream,
        );
      } else {
        delete (HTMLCanvasElement.prototype as any).captureStream;
      }
      window.setTimeout = originalSetTimeout;
    }
  });
});
