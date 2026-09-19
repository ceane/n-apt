import { drawFrequencyGrid } from "@n-apt/layout/rendering/frequencyGrid";

/** Recording canvas context: captures path ops and drawn labels. */
function createRecordingContext(charWidth = 2) {
  const ops: string[] = [];
  const drawn: { text: string; x: number; y: number }[] = [];
  const alphas: number[] = [];
  let alpha = 1;

  const ctx = {
    textAlign: "left" as CanvasTextAlign,
    fillStyle: "",
    strokeStyle: "",
    beginPath() {
      ops.push("beginPath");
    },
    moveTo(x: number, y: number) {
      ops.push(`moveTo(${x},${y})`);
    },
    lineTo(x: number, y: number) {
      ops.push(`lineTo(${x},${y})`);
    },
    stroke() {
      ops.push("stroke");
    },
    save() {
      ops.push("save");
    },
    restore() {
      ops.push("restore");
    },
    measureText(text: string) {
      return { width: text.length * charWidth } as TextMetrics;
    },
    fillText(text: string, x: number, y: number) {
      drawn.push({ text, x, y });
    },
  };

  Object.defineProperty(ctx, "globalAlpha", {
    get: () => alpha,
    set: (value: number) => {
      alpha = value;
      alphas.push(value);
    },
  });

  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, drawn, alphas };
}

const baseOptions = {
  minFreq: 90e6,
  maxFreq: 92e6,
  stepHz: 250_000,
  plotLeft: 50,
  plotRight: 960,
  canvasWidth: 1000,
  top: 20,
  bottom: 600,
  gridColor: "#111111",
  tickColor: "#222222",
  labelColor: "#333333",
  formatEdgeLabel: (freq: number) => `E${freq}`,
  formatTickLabel: (freq: number) => `T${freq}`,
  centerLabelText: "c",
};

describe("drawFrequencyGrid", () => {
  it("draws edge labels with the edge formatter and interior ticks with the tick formatter", () => {
    const { ctx, drawn } = createRecordingContext();
    drawFrequencyGrid({ ...baseOptions, ctx });

    const labels = drawn.map((d) => d.text);
    expect(labels).toContain("E90000000");
    expect(labels).toContain("E92000000");
    expect(labels).toContain("T90250000");
  });

  it("drops tick labels that collide with the reserved center span", () => {
    const { ctx, drawn } = createRecordingContext();
    drawFrequencyGrid({
      ...baseOptions,
      ctx,
      centerLabelText: "x".repeat(20),
    });

    const labels = drawn.map((d) => d.text);
    // 91MHz maps to x = 505, inside the reserved center span.
    expect(labels).not.toContain("T91000000");
    expect(labels).toContain("T90750000");
    expect(labels).toContain("T91250000");
  });

  it("keeps geometry fractional unless roundX is set", () => {
    const geometry = { ...baseOptions, minFreq: 0, maxFreq: 1000, stepHz: 250, plotLeft: 0, plotRight: 333 };

    const fractional = createRecordingContext();
    drawFrequencyGrid({ ...geometry, ctx: fractional.ctx });
    expect(fractional.ops).toContain("moveTo(83.25,20)");

    const snapped = createRecordingContext();
    drawFrequencyGrid({ ...geometry, ctx: snapped.ctx, roundX: true });
    expect(snapped.ops).toContain("moveTo(83,20)");
    expect(snapped.ops).not.toContain("moveTo(83.25,20)");
  });

  it("isolates grid lines in save/restore only when gridOpacity is set", () => {
    const opaque = createRecordingContext();
    drawFrequencyGrid({ ...baseOptions, ctx: opaque.ctx });
    expect(opaque.ops).not.toContain("save");

    const translucent = createRecordingContext();
    drawFrequencyGrid({ ...baseOptions, ctx: translucent.ctx, gridOpacity: 0.5 });
    expect(translucent.ops.filter((op) => op === "save").length).toBeGreaterThan(0);
    expect(translucent.alphas).toContain(0.5);
  });

  it("clamps gridOpacity into the 0..1 range", () => {
    const above = createRecordingContext();
    drawFrequencyGrid({ ...baseOptions, ctx: above.ctx, gridOpacity: 5 });
    expect(above.alphas.every((value) => value === 1)).toBe(true);

    const below = createRecordingContext();
    drawFrequencyGrid({ ...baseOptions, ctx: below.ctx, gridOpacity: -3 });
    expect(below.alphas.every((value) => value === 0)).toBe(true);
  });

  it("draws nothing when the range or step is degenerate", () => {
    const empty = createRecordingContext();
    drawFrequencyGrid({ ...baseOptions, ctx: empty.ctx, stepHz: 0 });
    expect(empty.drawn).toHaveLength(0);
    expect(empty.ops).toHaveLength(0);

    const inverted = createRecordingContext();
    drawFrequencyGrid({ ...baseOptions, ctx: inverted.ctx, maxFreq: 90e6 });
    expect(inverted.drawn).toHaveLength(0);
  });
});
