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
      dbMin: -60,
      dbMax: 0,
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
    expect(labels).toContain("0dBm");
    expect(labels).toContain("-10");

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
      52 * dpr,
      0,
      referencePlotWidth,
      visibleContentHeight,
    ]);

    const dbMaxLabel = calls.find(
      (call) => call.name === "fillText" && call.args[0] === "0dBm",
    );
    const dbMinLabel = calls.find(
      (call) => call.name === "fillText" && call.args[0] === "-60",
    );
    const sourceWaterfallCanvas = plotCopy?.args[0] as HTMLCanvasElement;
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
});
