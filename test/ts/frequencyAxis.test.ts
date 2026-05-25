import { composeCanvasWithFrequencyAxis } from "@n-apt/utils/rendering/frequencyAxis";
import {
  drawVfoAxis,
  type VfoAxisContext,
} from "@n-apt/utils/rendering/vfoAxis";

describe("frequency axis rendering", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockCanvasContext(
    textWidth: (text: string) => number = (text) => text.length * 8,
  ) {
    const fillTextCalls: Array<{
      text: string;
      x: number;
      align: CanvasTextAlign;
    }> = [];

    const context = {
      imageSmoothingEnabled: false,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textBaseline: "alphabetic" as CanvasTextBaseline,
      textAlign: "start" as CanvasTextAlign,
      fillRect: jest.fn(),
      drawImage: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      setTransform: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      measureText: jest.fn((text: string) => ({
        width: textWidth(text),
      })),
      fillText: jest.fn((text: string, x: number) => {
        fillTextCalls.push({
          text,
          x,
          align: context.textAlign,
        });
      }),
    };

    jest
      .spyOn(HTMLCanvasElement.prototype as any, "getContext")
      .mockImplementation((...args: unknown[]) => {
        const [contextId] = args;
        return contextId === "2d" ? context : null;
      });

    return fillTextCalls;
  }

  it("centers the fast snapshot VFO label on the waterfall frequency plot", () => {
    const fillTextCalls = mockCanvasContext();

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = 1464;
    baseCanvas.height = 734;

    composeCanvasWithFrequencyAxis({
      baseCanvas,
      frequencyRange: { min: 496_000, max: 3_700_000 },
      centerFrequencyHz: 2_096_000,
      detail: "dense",
      theme: {
        background: "#000",
        grid: "#111",
        tick: "#333",
        label: "#777",
        center: "#fff",
      },
      devicePixelRatio: 2,
    });

    const centerLabelCall = fillTextCalls.find((call) =>
      call.text.startsWith("○"),
    );
    const plotLeft = 50 * 2;
    const plotWidth = baseCanvas.width - plotLeft - 40 * 2;
    const expectedCenterX =
      plotLeft + ((2_096_000 - 496_000) / (3_700_000 - 496_000)) * plotWidth;

    expect(centerLabelCall).toBeDefined();
    expect(centerLabelCall?.align).toBe("center");
    expect(centerLabelCall?.x).toBeCloseTo(expectedCenterX, 2);
  });

  it("keeps edge frequency labels visible and drops colliding interior ticks", () => {
    const fillTextCalls = mockCanvasContext((text) => {
      if (text === "3.5MHz" || text === "3.7MHz") return 80;
      return text.length * 8;
    });

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = 2048;
    baseCanvas.height = 160;

    composeCanvasWithFrequencyAxis({
      baseCanvas,
      frequencyRange: { min: 496_000, max: 3_700_000 },
      centerFrequencyHz: 2_096_000,
      detail: "dense",
      theme: {
        background: "#000",
        grid: "#111",
        tick: "#333",
        label: "#777",
        center: "#fff",
      },
      devicePixelRatio: 1,
    });

    expect(fillTextCalls.some((call) => call.text === "496kHz")).toBe(true);
    expect(fillTextCalls.some((call) => call.text === "3.7MHz")).toBe(true);
    expect(fillTextCalls.some((call) => call.text === "3.5MHz")).toBe(false);
  });

  it("can align waterfall snapshot labels to a full-width plot", () => {
    const fillTextCalls = mockCanvasContext();

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = 2048;
    baseCanvas.height = 734;

    composeCanvasWithFrequencyAxis({
      baseCanvas,
      frequencyRange: { min: 2_200_000, max: 2_600_000 },
      centerFrequencyHz: 2_392_000,
      detail: "dense",
      plotInsets: { left: 0, right: 0 },
      theme: {
        background: "#000",
        grid: "#111",
        tick: "#333",
        label: "#777",
        center: "#fff",
      },
      devicePixelRatio: 2,
    });

    const startLabelCall = fillTextCalls.find((call) => call.text === "2.2MHz");

    expect(startLabelCall).toBeDefined();
    expect(startLabelCall?.align).toBe("left");
    expect(startLabelCall?.x).toBe(0);
  });

  it("can align waterfall snapshot labels to inset waterfall content", () => {
    const fillTextCalls = mockCanvasContext();

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = 2048;
    baseCanvas.height = 734;

    composeCanvasWithFrequencyAxis({
      baseCanvas,
      frequencyRange: { min: 2_200_000, max: 2_600_000 },
      centerFrequencyHz: 2_392_000,
      detail: "dense",
      plotInsets: { left: 40, right: 40 },
      theme: {
        background: "#000",
        grid: "#111",
        tick: "#333",
        label: "#777",
        center: "#fff",
      },
      devicePixelRatio: 2,
    });

    const startLabelCall = fillTextCalls.find((call) => call.text === "2.2MHz");
    const centerLabelCall = fillTextCalls.find(
      (call) => call.text.startsWith("○") && call.text.includes("2.392MHz"),
    );
    const expectedCenterX =
      80 + ((2_392_000 - 2_200_000) / 400_000) * (baseCanvas.width - 160);

    expect(startLabelCall).toBeDefined();
    expect(startLabelCall?.x).toBe(80);
    expect(centerLabelCall).toBeDefined();
    expect(centerLabelCall?.x).toBeCloseTo(expectedCenterX, 2);
  });

  it("draws a center-colored tick for snapshot VFOs without a center line", () => {
    const strokes: Array<{
      color: string;
      from?: { x: number; y: number };
      to?: { x: number; y: number };
    }> = [];
    const context: VfoAxisContext & {
      strokeStyle: string;
      currentFrom?: { x: number; y: number };
      currentTo?: { x: number; y: number };
    } = {
      strokeStyle: "",
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn((x: number, y: number) => {
        context.currentFrom = { x, y };
      }),
      lineTo: jest.fn((x: number, y: number) => {
        context.currentTo = { x, y };
      }),
      stroke: jest.fn(() => {
        strokes.push({
          color: context.strokeStyle,
          from: context.currentFrom,
          to: context.currentTo,
        });
      }),
      fillText: jest.fn(),
      measureTextWidth: jest.fn((text: string) => text.length * 8),
      setStroke: jest.fn((color: string) => {
        context.strokeStyle = color;
      }),
      setFill: jest.fn(),
      setFont: jest.fn(),
      setTextAlign: jest.fn(),
      setTextBaseline: jest.fn(),
    };

    drawVfoAxis({
      ctx: context,
      frequencyRange: { min: 0, max: 100 },
      centerFrequencyHz: 50,
      bounds: { left: 10, right: 210, top: 0, bottom: 100 },
      y: 20,
      labelY: 10,
      showAxisLine: false,
      icon: "circle",
      theme: {
        tick: "#777",
        label: "#777",
        center: "#fff",
        centerLine: "#dfff00",
      },
      tickLength: 6,
      centerTickLength: 9,
    });

    expect(strokes).toContainEqual({
      color: "#dfff00",
      from: { x: 110, y: 20 },
      to: { x: 110, y: 29 },
    });
  });
});
