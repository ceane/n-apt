import {
  drawDiagonalStripePatternOnCanvas,
  getSpectrumFillPolygon,
  getDiagonalStripeSegments,
  NON_HARDWARE_PATTERN_SPACING,
  NON_HARDWARE_PATTERN_STROKE,
  type PatternBounds,
} from "@n-apt/layout/rendering/nonHardwarePattern";

describe("non-hardware device pattern", () => {
  it("uses 8px orange stripes with enough spacing to keep them distinct", () => {
    expect(NON_HARDWARE_PATTERN_SPACING).toBe(22);
  });

  it("draws 45-degree stripes clipped to the plot bounds", () => {
    const bounds: PatternBounds = { x: 10, y: 20, width: 80, height: 40 };

    const segments = getDiagonalStripeSegments(bounds, 10);

    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.x1).toBeGreaterThanOrEqual(bounds.x);
      expect(segment.x2).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(segment.y1).toBeGreaterThanOrEqual(bounds.y);
      expect(segment.y2).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(segment.x2 - segment.x1).toBeCloseTo(segment.y2 - segment.y1);
    }
  });

  it("starts the hatch pattern on the top-left plot edge", () => {
    const bounds = { x: 40, y: 8, width: 80, height: 40 };
    const segments = getDiagonalStripeSegments(bounds);

    expect(
      segments.some(
        ({ x1, y1, x2, y2 }) =>
          (x1 === bounds.x && y1 === bounds.y) ||
          (x2 === bounds.x && y2 === bounds.y),
      ),
    ).toBe(true);
  });

  it("limits FFT stripes to the filled waveform region", () => {
    const bounds: PatternBounds = { x: 10, y: 20, width: 80, height: 40 };
    const polygon = getSpectrumFillPolygon({
      bounds,
      waveform: new Float32Array([-20, -10, 0]),
      dbMin: -20,
      dbMax: 0,
    });

    expect(polygon).toEqual([
      { x: 10, y: 60 },
      { x: 10, y: 56 },
      { x: 50, y: 36 },
      { x: 90, y: 20 },
      { x: 90, y: 60 },
    ]);
  });

  it("returns no stripes for empty or invalid bounds", () => {
    expect(
      getDiagonalStripeSegments({ x: 0, y: 0, width: 0, height: 10 }),
    ).toEqual([]);
    expect(
      getDiagonalStripeSegments({ x: 0, y: 0, width: 10, height: -1 }),
    ).toEqual([]);
  });

  it("blends a lighter orange stroke over the plot and extends through its border", () => {
    let strokeState: {
      color: string | CanvasRenderingContext2D["strokeStyle"];
      width: number;
      blend: GlobalCompositeOperation;
      alpha: number;
    } | null = null;
    const context = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      rect: jest.fn(),
      closePath: jest.fn(),
      clip: jest.fn(),
      stroke: jest.fn(
        function (this: {
          strokeStyle: string | CanvasRenderingContext2D["strokeStyle"];
          lineWidth: number;
          globalCompositeOperation: GlobalCompositeOperation;
          globalAlpha: number;
        }) {
          strokeState = {
            color: this.strokeStyle,
            width: this.lineWidth,
            blend: this.globalCompositeOperation,
            alpha: this.globalAlpha,
          };
        },
      ),
      strokeStyle: "#000000" as CanvasRenderingContext2D["strokeStyle"],
      lineWidth: 1,
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      globalAlpha: 1,
    };

    const bounds = {
      x: 40,
      y: 8,
      width: 80,
      height: 40,
    };
    drawDiagonalStripePatternOnCanvas(context, bounds);

    expect(context.rect).toHaveBeenCalledWith(40, 8, 80, 40);
    expect(strokeState).toEqual({
      color: NON_HARDWARE_PATTERN_STROKE,
      width: 8,
      blend: "difference",
      alpha: 0.266,
    });
    expect(context.restore).toHaveBeenCalledTimes(1);
  });

  it("overdraws past each edge before clipping to the exact plot bounds", () => {
    const endpoints: Array<{ x: number; y: number }> = [];
    const context = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn((x: number, y: number) => endpoints.push({ x, y })),
      lineTo: jest.fn((x: number, y: number) => endpoints.push({ x, y })),
      rect: jest.fn(),
      closePath: jest.fn(),
      clip: jest.fn(),
      stroke: jest.fn(),
      strokeStyle: "#000000" as CanvasRenderingContext2D["strokeStyle"],
      lineWidth: 1,
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      globalAlpha: 1,
    };
    const bounds = { x: 40, y: 8, width: 80, height: 40 };

    drawDiagonalStripePatternOnCanvas(context, bounds);

    expect(context.rect).toHaveBeenCalledWith(40, 8, 80, 40);
    expect(endpoints.some(({ x }) => x < bounds.x)).toBe(true);
    expect(endpoints.some(({ x }) => x > bounds.x + bounds.width)).toBe(true);
    expect(endpoints.some(({ y }) => y < bounds.y)).toBe(true);
    expect(endpoints.some(({ y }) => y > bounds.y + bounds.height)).toBe(true);
  });

  it("keeps the stripe phase anchored to the plot while over drawing", () => {
    const drawnPoints: Array<{ x: number; y: number }> = [];
    const context = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn((x: number, y: number) => drawnPoints.push({ x, y })),
      lineTo: jest.fn((x: number, y: number) => drawnPoints.push({ x, y })),
      rect: jest.fn(),
      closePath: jest.fn(),
      clip: jest.fn(),
      stroke: jest.fn(),
      strokeStyle: "#000000" as CanvasRenderingContext2D["strokeStyle"],
      lineWidth: 1,
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      globalAlpha: 1,
    };
    const bounds = { x: 40, y: 8, width: 80, height: 40 };

    drawDiagonalStripePatternOnCanvas(context, bounds);

    const expectedOffsets = getDiagonalStripeSegments(bounds)
      .map(({ x1, y1 }) => Math.round((x1 - y1) * 1000) / 1000)
      .sort((left, right) => left - right);
    const drawnOffsets = [];
    for (let index = 0; index < drawnPoints.length; index += 2) {
      const start = drawnPoints[index];
      const end = drawnPoints[index + 1];
      if (start && end) {
        drawnOffsets.push(Math.round((start.x - start.y) * 1000) / 1000);
      }
    }

    expect(drawnOffsets.sort((left, right) => left - right)).toEqual(
      expectedOffsets,
    );
  });

  it("keeps stripe segments within the requested data region", () => {
    const bounds = {
      x: 0,
      y: 0,
      width: 80,
      height: 40,
    };
    const segments = getDiagonalStripeSegments(bounds);

    expect(
      segments.every(
        ({ x1, x2, y1, y2 }) => x1 >= 0 && x2 <= 80 && y1 >= 0 && y2 <= 40,
      ),
    ).toBe(true);
    const edgeEndpoints = segments.flatMap(({ x1, y1, x2, y2 }) => [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ]);
    expect(edgeEndpoints.some(({ x }) => x === bounds.x)).toBe(true);
    expect(edgeEndpoints.some(({ x }) => x === bounds.x + bounds.width)).toBe(
      true,
    );
    expect(edgeEndpoints.some(({ y }) => y === bounds.y)).toBe(true);
    expect(edgeEndpoints.some(({ y }) => y === bounds.y + bounds.height)).toBe(
      true,
    );
  });
});
