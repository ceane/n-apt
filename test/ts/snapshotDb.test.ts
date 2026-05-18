import { roundSnapshotDbValue } from "../../src/ts/utils/snapshotDb";

describe("roundSnapshotDbValue", () => {
  it("rounds positive and negative fractional dB values", () => {
    expect(roundSnapshotDbValue(10.4)).toBe(10);
    expect(roundSnapshotDbValue(-89.6)).toBe(-90);
  });

  it("normalizes negative zero to zero", () => {
    expect(Object.is(roundSnapshotDbValue(-0.2), -0)).toBe(false);
    expect(roundSnapshotDbValue(-0.2)).toBe(0);
  });
});
