import { composeWaterfallCanvasWithDbAxis } from "@n-apt/layout/rendering/waterfallDbAxis";

describe("waterfall dB axis composition", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("matches the FFT grid bounds and leaves a small blank bottom gutter", () => {
    const labels: Array<{ text: string; x: number; y: number }> = [];
    const fills: Array<{ color: string; args: number[] }> = [];
    const context = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "start" as CanvasTextAlign,
      textBaseline: "alphabetic" as CanvasTextBaseline,
      fillRect: jest.fn((...args: number[]) => {
        fills.push({ color: context.fillStyle, args });
      }),
      drawImage: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillText: jest.fn((text: string, x: number, y: number) => {
        labels.push({ text, x, y });
      }),
    };

    const setCanvasSize = (
      canvas: HTMLCanvasElement,
      initialWidth: number,
      initialHeight: number,
    ) => {
      let width = initialWidth;
      let height = initialHeight;
      Object.defineProperties(canvas, {
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
    };

    const createElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = createElement(tagName);
        if (element instanceof HTMLCanvasElement) {
          setCanvasSize(element, 800, 600);
        }
        return element;
      }) as typeof document.createElement,
    );

    jest
      .spyOn(HTMLCanvasElement.prototype as any, "getContext")
      .mockImplementation((contextId: unknown) =>
        contextId === "2d" ? context : null,
      );

    const waterfall = document.createElement("canvas");
    if (!(waterfall instanceof HTMLCanvasElement)) {
      throw new Error("Expected a canvas");
    }
    setCanvasSize(waterfall, 640, 400);

    const composed = composeWaterfallCanvasWithDbAxis({
      waterfallCanvas: waterfall,
      dbMin: -60,
      dbMax: 0,
      unit: "dBm",
      devicePixelRatio: 2,
      plotInsets: { left: 80, right: 80, top: 100 },
      referencePlotWidth: 456,
      referencePlotHeight: 280,
      theme: {
        background: "#101010",
        grid: "#303030",
        text: "#b0b0b0",
      },
    });

    expect(composed.width).toBe(640);
    expect(composed.height).toBe(396);
    expect(context.drawImage).toHaveBeenCalledWith(
      waterfall,
      80,
      0,
      480,
      380,
      104,
      0,
      456,
      380,
    );
    expect(labels.map(({ text }) => text)).toEqual([
      "0dBm",
      "-10",
      "-20",
      "-30",
      "-40",
      "-50",
      "-60",
    ]);
    expect(labels[0]).toEqual({ text: "0dBm", x: 84, y: 100 });
    expect(labels[3]?.y).toBe(240);
    expect(labels[labels.length - 1]?.y).toBe(380);
    expect(context.font).toBe("20px 'JetBrains Mono', monospace");
    expect(fills[0]).toEqual({ color: "#101010", args: [0, 0, 640, 396] });
    expect(context.moveTo).toHaveBeenNthCalledWith(1, 96, 100);
    expect(context.lineTo).toHaveBeenNthCalledWith(1, 104, 100);
  });

  it("keeps explicit zero-inset waterfall data intact before blank gutters", () => {
    const labels: Array<{ text: string; y: number }> = [];
    const fills: Array<{ color: string; args: number[] }> = [];
    const context = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "start" as CanvasTextAlign,
      textBaseline: "alphabetic" as CanvasTextBaseline,
      fillRect: jest.fn((...args: number[]) => {
        fills.push({ color: context.fillStyle, args });
      }),
      drawImage: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillText: jest.fn((text: string, _x: number, y: number) => {
        labels.push({ text, y });
      }),
    };

    jest
      .spyOn(HTMLCanvasElement.prototype as any, "getContext")
      .mockImplementation((contextId: unknown) =>
        contextId === "2d" ? context : null,
      );
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
    const waterfall = document.createElement("canvas");
    Object.defineProperty(waterfall, "width", { value: 640 });
    Object.defineProperty(waterfall, "height", { value: 400 });

    const composed = composeWaterfallCanvasWithDbAxis({
      waterfallCanvas: waterfall,
      dbMin: -60,
      dbMax: 0,
      unit: "dB",
      devicePixelRatio: 2,
      plotInsets: { left: 0, right: 0, top: 0, bottom: 0 },
      theme: {
        background: "#101010",
        grid: "#303030",
        text: "#b0b0b0",
      },
    });

    expect(composed.width).toBe(824);
    expect(composed.height).toBe(416);
    expect(context.drawImage).toHaveBeenCalledWith(
      waterfall,
      0,
      0,
      640,
      400,
      104,
      0,
      640,
      400,
    );
    expect(labels[0]?.y).toBe(0);
    expect(labels[labels.length - 1]?.y).toBe(400);
    expect(fills[0]).toEqual({ color: "#101010", args: [0, 0, 824, 416] });
  });
});
