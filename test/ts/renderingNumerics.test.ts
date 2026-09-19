import { maxInBinRange, maxPoolDecimateInto } from "@n-apt/layout/rendering/maxPool";
import { resizeCanvasBackingStore } from "@n-apt/layout/rendering/canvasSize";

describe("max-pool rendering semantics", () => {
  it("pools maxima rather than sampling every other bin", () => {
    const output = new Float32Array(2);
    maxPoolDecimateInto([1, 5, 3, 9], output, 2);
    expect(Array.from(output)).toEqual([5, 9]);
  });
  it("keeps every bin peak, floor boundaries and caller-owned output", () => {
    const input = [-100, -20, -80, -30, -70, -10, -90];
    const output = new Float32Array(3);
    maxPoolDecimateInto(input, output, 3);
    expect(Array.from(output)).toEqual([-20, -30, -10]);
    expect(input).toEqual([-100, -20, -80, -30, -70, -10, -90]);
    maxPoolDecimateInto([-1, -2, -3, -4, -5, -6, -7], output, 3);
    expect(Array.from(output)).toEqual([-1, -3, -5]);
  });

  it("keeps non-finite decimation and scalar filtering distinct", () => {
    const input = [NaN, -Infinity, Infinity, -40, NaN, -50];
    const output: number[] = Array.from({ length: 3 }, () => -120);
    maxPoolDecimateInto(input, output, -120);
    expect(output).toEqual([-120, Infinity, -50]);
    expect(maxInBinRange(input, 0, 2, true)).toBe(-Infinity);
    expect(maxInBinRange(input, 2, 4, true)).toBe(-40);
    expect(maxInBinRange(input, 2, 4, false)).toBe(Infinity);
  });

  it("does not replace ratio-first floor boundaries with multiply-first ones", () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    const output = new Float32Array(22);
    maxPoolDecimateInto(input, output, 22);
    expect(output[10]).toBe(13);
    expect(Math.floor((11 * 30) / 22)).toBe(15);
    expect(Math.floor(11 * (30 / 22))).toBe(14);
  });

  it("preserves Float32 conversion versus diagnostic number-array precision", () => {
    const value = -1.123456789;
    const input = [value, -50, value, -60, -70];
    const float = new Float32Array(2);
    const array: number[] = Array.from({ length: 2 }, () => 0);
    maxPoolDecimateInto(input, float, 2);
    maxPoolDecimateInto(input, array, 2);
    expect(float[0]).toBe(Math.fround(value));
    expect(array[0]).toBe(value);
    expect(maxInBinRange([], 0, 1, true)).toBe(-Infinity);
  });
});

describe("canvas backing-store resize", () => {
  const makeCanvas = (width: number, height: number) => {
    const canvas = document.createElement("canvas");
    const state = { width, height };
    let writes = 0;
    for (const key of ["width", "height"] as const) {
      Object.defineProperty(canvas, key, {
        configurable: true,
        get: () => state[key],
        set: (value: number) => {
          writes += 1;
          state[key] = value;
        },
      });
    }
    return { canvas, state, writes: () => writes };
  };

  it("writes both dimensions only on mismatch and leaves CSS alone", () => {
    const { canvas, state, writes } = makeCanvas(100, 50);
    canvas.style.width = "80px";
    expect(resizeCanvasBackingStore(canvas, 100, 50)).toBe(false);
    expect(writes()).toBe(0);
    expect(resizeCanvasBackingStore(canvas, 101, 50)).toBe(true);
    expect(writes()).toBe(2);
    expect(state.width).toBe(101);
    expect(state.height).toBe(50);
    expect(canvas.style.width).toBe("80px");
  });

  it("preserves caller floor, round and fractional assignment comparisons", () => {
    const a = makeCanvas(0, 0);
    expect(resizeCanvasBackingStore(a.canvas, Math.floor(10.6 * 1.5), 0)).toBe(true);
    expect(a.state.width).toBe(15);
    const b = makeCanvas(0, 0);
    expect(resizeCanvasBackingStore(b.canvas, Math.round(10.6 * 1.5), 1)).toBe(true);
    expect(b.state.width).toBe(16);
    const c = makeCanvas(15.9, 1);
    expect(resizeCanvasBackingStore(c.canvas, 15.9, 1)).toBe(false);
    expect(resizeCanvasBackingStore(c.canvas, 15, 1)).toBe(true);
    expect(c.state.width).toBe(15);
  });
});
