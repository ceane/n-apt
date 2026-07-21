import { resampleNearestInto } from "../../src/ts/utils/resampleNearest";

describe("resampleNearestInto", () => {
  it("reuses the provided typed output buffer", () => {
    const output = new Float32Array(5);
    const result = resampleNearestInto(
      new Float32Array([10, 20, 30]),
      5,
      -100,
      output,
    );

    expect(result).toBe(output);
    expect(Array.from(result)).toEqual([10, 10, 20, 20, 30]);
  });

  it("fills empty input with the fallback value", () => {
    const result = resampleNearestInto(new Float32Array(0), 3, -80);

    expect(Array.from(result)).toEqual([-80, -80, -80]);
  });
});
