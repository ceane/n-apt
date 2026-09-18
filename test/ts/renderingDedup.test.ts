import { readCssColor } from "@n-apt/layout/rendering/cssColor";
import { drawHardwareSampleRateBlocks } from "@n-apt/layout/rendering/hardwareSampleRateGrid";
import { getTxBandGeometry } from "@n-apt/layout/rendering/txBandGeometry";
import { renderHook } from "@testing-library/react";
import { CoordinateMapper } from "@n-apt/layout/rendering/CoordinateMapper";
import { CanvasDrawingContext, SnapshotRenderer } from "@n-apt/layout/rendering/SnapshotRenderer";
import { useDraw2DFFTSignal } from "@n-apt/spectrum/hooks/useDraw2DFFTSignal";
import { useOverlayRenderer } from "@n-apt/spectrum/hooks/useOverlayRenderer";

describe("rendering dedup helpers", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--test-render-color");
  });

  it("reads trimmed CSS values without caching fallbacks or theme changes", () => {
    expect(readCssColor("--test-render-color", "#123")).toBe("#123");
    document.documentElement.style.setProperty("--test-render-color", "  #456  ");
    expect(readCssColor("--test-render-color", "#123")).toBe("#456");
    document.documentElement.style.setProperty("--test-render-color", "#789");
    expect(readCssColor("--test-render-color", "#123")).toBe("#789");
    document.documentElement.style.setProperty("--test-render-color", " ");
    expect(readCssColor("--test-render-color", "#abc")).toBe("#abc");
  });

  it.each([true, false])("preserves duplicate boundaries only when requested: %s", (drawRightBoundary) => {
    const ctx = {
      beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(),
      stroke: jest.fn(), fillText: jest.fn(),
    };
    drawHardwareSampleRateBlocks(ctx, {
      anchorRange: { min: 0, max: 25 },
      visibleRange: { min: 7, max: 23 },
      sampleSpan: 10,
      blockEpsilon: 1,
      boundaryEpsilon: 0.0001,
      drawRightBoundary,
      toX: (frequency) => (frequency - 7) * 1.25,
      top: 20, bottom: 200, labelY: 55, subLabelY: 52,
      formatWidth: (span) => `${span}Hz`,
    });
    expect(ctx.moveTo.mock.calls).toEqual(drawRightBoundary
      ? [[3.75, 20], [3.75, 20], [16.25, 20], [16.25, 20]]
      : [[3.75, 20], [16.25, 20]]);
    expect(ctx.lineTo.mock.calls).toEqual(ctx.moveTo.mock.calls.map(([x]) => [x, 200]));
    expect(ctx.fillText.mock.calls).toEqual([
      ["Hardware Sample Rate", 1.875, 55], ["10Hz", 1.875, 52],
      ["Hardware Sample Rate", 10, 55], ["10Hz", 10, 52],
      ["Next Sample", 18.125, 55], ["5Hz", 18.125, 52],
    ]);
  });

  it("keeps MHz epsilon, full-block tolerance and caller rounding", () => {
    const ctx = {
      beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(),
      stroke: jest.fn(), fillText: jest.fn(),
    };
    drawHardwareSampleRateBlocks(ctx, {
      anchorRange: { min: 0, max: 1.9995 },
      visibleRange: { min: 0, max: 1.9995 },
      sampleSpan: 1,
      blockEpsilon: 0.001,
      boundaryEpsilon: 0.0001,
      drawRightBoundary: true,
      toX: (frequency) => Math.round(frequency * 7.3),
      top: 0, bottom: 100, labelY: 19, subLabelY: 16,
      formatWidth: (span) => span.toFixed(1),
    });
    expect(ctx.moveTo.mock.calls).toEqual([[7, 0], [7, 0]]);
    expect(ctx.fillText.mock.calls).toEqual([
      ["Hardware Sample Rate", 4, 19], ["1.0", 4, 16],
      ["Hardware Sample Rate", 11, 19], ["1.0", 11, 16],
    ]);
  });

  it.each(["snapshot", "overlay", "2d"])("preserves %s grid coordinates, units, styles and recording gate", (path) => {
    const moves: number[][] = [];
    const labels: unknown[][] = [];
    const states: { strokeStyle: string; fillStyle: string; globalAlpha: number; lineWidth: number; font: string }[] = [];
    const ctx = {
      strokeStyle: "", fillStyle: "", globalAlpha: 1, lineWidth: 0, font: "",
      beginPath: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
      save: jest.fn((): void => {
        states.push({
          strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle,
          globalAlpha: ctx.globalAlpha, lineWidth: ctx.lineWidth, font: ctx.font,
        });
      }),
      restore: jest.fn((): void => { Object.assign(ctx, states.pop()); }),
      clearRect: jest.fn(), fillRect: jest.fn(),
      setTransform: jest.fn(), setLineDash: jest.fn(), closePath: jest.fn(), fill: jest.fn(),
      measureText: jest.fn(() => ({ width: 10 })),
      moveTo: (x: number, y: number) => {
        if (ctx.strokeStyle === "rgba(255, 48, 48, 0.95)") moves.push([x, y]);
      },
      fillText: (text: string, x: number, y: number) => {
        if (ctx.fillStyle === "rgba(255, 48, 48, 0.98)")
          labels.push([text, x, y, ctx.lineWidth, ctx.globalAlpha, ctx.font]);
      },
    };
    const view = { min: 7, max: 23 };
    const anchor = { min: 0, max: 25 };
    const overlay = renderHook(() => useOverlayRenderer());
    const cpu = renderHook(() => useDraw2DFFTSignal());
    const oldDpr = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    const canvas = document.createElement("canvas");
    const parent = document.createElement("div");
    parent.appendChild(canvas);
    const sizeSpy = jest.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 600 } as DOMRect);
    const contextSpy = jest.spyOn(canvas, "getContext").mockReturnValue(ctx as any);
    try {
      if (path === "snapshot") {
        const renderer = new SnapshotRenderer(
          new CoordinateMapper({ x: 50, y: 20, width: 910, height: 484 }, view, { min: -120, max: 0 }, 2),
          { bg: "#000", grid: "#111", line: "#222", shadow: "#333", text: "#fff", hwLine: "rgba(255, 48, 48, 0.95)", hwText: "rgba(255, 48, 48, 0.98)", cfText: "#666" },
        );
        renderer.drawHardwareGrid(new CanvasDrawingContext(ctx as unknown as CanvasRenderingContext2D), 10, anchor);
      } else if (path === "overlay") {
        overlay.result.current.drawGridOnContext(ctx as any, 1000, 600, view, -120, 0, "dB", 10, anchor, false);
        expect(labels).toEqual([]);
        overlay.result.current.drawGridOnContext(ctx as any, 1000, 600, view, -120, 0, "dB", 10, anchor, true, 56, 0.4);
      } else {
        expect(cpu.result.current.draw2DFFTSignal({ canvas, waveform: new Float32Array([-50]), frequencyRange: view, fullCaptureRange: anchor, hardwareSampleRateHz: 10e6, isIqRecordingActive: false })).toBe(true);
      }
      const x1 = path === "2d" ? 221 : 220.625;
      const x2 = path === "2d" ? 789 : 789.375;
      expect(moves).toEqual(path === "snapshot" ? [[x1, 20], [x2, 20]] : [[x1, 20], [x1, 20], [x2, 20], [x2, 20]]);
      const labelY = path === "snapshot" ? 27 : path === "overlay" ? 55 : 39;
      const subY = path === "snapshot" ? 39 : path === "overlay" ? 52 : 36;
      const xs = path === "2d" ? [135, 505, 875] : [135.3125, 505, 874.6875];
      const alpha = path === "overlay" ? 0.4 : 1;
      const font = path === "snapshot" ? "10px JetBrains Mono" : "10px 'JetBrains Mono', monospace";
      expect(labels).toEqual([
        ["Hardware Sample Rate", xs[0], labelY, 0.5, alpha, font],
        [path === "2d" ? "10.0MHz" : "10Hz", xs[0], subY, 0.5, alpha, font],
        ["Hardware Sample Rate", xs[1], labelY, 0.5, alpha, font],
        [path === "2d" ? "10.0MHz" : "10Hz", xs[1], subY, 0.5, alpha, font],
        ["Next Sample", xs[2], labelY, 0.5, alpha, font],
        [path === "2d" ? "5.0MHz" : "5Hz", xs[2], subY, 0.5, alpha, font],
      ]);
      if (path === "2d") expect(ctx.setLineDash).not.toHaveBeenCalledWith([4, 4]);
      else expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    } finally {
      sizeSpy.mockRestore();
      contextSpy.mockRestore();
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: oldDpr });
      overlay.unmount();
      cpu.unmount();
    }
  });

  it("projects TX bands without imposing a bandwidth cap or span validation", () => {
    expect(getTxBandGeometry(50, 150, { min: 0, max: 100 }, 20, 200)).toEqual({
      rawBandLeft: -30, rawBandRight: 170, bandLeft: 50, bandRight: 150, centerX: 70,
    });
    expect(getTxBandGeometry(50, 150, { min: 0, max: 100 }, 20, 100)).toEqual({
      rawBandLeft: 20, rawBandRight: 120, bandLeft: 50, bandRight: 120, centerX: 70,
    });
    expect(getTxBandGeometry(50, 150, { min: 0, max: 0 }, 0, 1)).toEqual({
      rawBandLeft: -Infinity, rawBandRight: Infinity, bandLeft: 50, bandRight: 150, centerX: NaN,
    });
  });
});
