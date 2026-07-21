type Point = { x: number; y: number };

// These are normalized spike-top coordinates, not RF frequencies. The shape
// must remain valid when the same signal is panned through the VFO.
const GOOD_STAIRCASE_HAT: Point[] = [
  0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0,
].map((y, index, points) => ({ x: index / (points.length - 1), y }));

const GOOD_PARTIAL_EDGE_HAT: Point[] = [
  1, 1, 2, 2, 3, 3, 4, 4, 5,
].map((y, index, points) => ({ x: index / (points.length - 1), y }));

const GOOD_DOUBLE_HAT: Point[] = [
  0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0,
  0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0,
].map((y, index, points) => ({ x: index / (points.length - 1), y }));

const BAD_RANDOM_COMB: Point[] = [
  0, 5, 0, 1, 4, 0, 3, 0, 5, 1, 0, 4, 0, 2, 0, 5,
].map((y, index, points) => ({ x: index / (points.length - 1), y }));

const BAD_ISOLATED_SPIKE: Point[] = [
  0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0,
].map((y, index, points) => ({ x: index / (points.length - 1), y }));

const BAD_FLAT_DC: Point[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9,
].map((y, index, points) => ({ x: index / (points.length - 1), y }));

const monotonicity = (values: number[]) => {
  if (values.length < 2) return 0;
  return values.slice(1).filter((value, index) => value >= values[index]).length /
    (values.length - 1);
};

// Small CPU oracle for the intended geometry. The production implementation
// must reproduce this ordering in WGSL; this is deliberately independent from
// the current shader so a shader regression cannot redefine “good”.
const referenceBridgeScore = (points: Point[]) => {
  return Math.max(...points.map((point, apex) => {
    if (point.y <= (points[apex - 1]?.y ?? -Infinity) ||
        point.y < (points[apex + 1]?.y ?? -Infinity)) return 0;
    const left = points.slice(Math.max(0, apex - 5), apex)
      .reverse().filter((neighbor) => neighbor.y < point.y)
      .map((neighbor) => point.y - neighbor.y);
    const right = points.slice(apex + 1, apex + 6)
      .filter((neighbor) => neighbor.y < point.y)
      .map((neighbor) => point.y - neighbor.y);
    if (left.length < 3 || right.length < 3) return 0;
    if (left.some((drop) => drop < 0) || right.some((drop) => drop < 0)) return 0;
    const prominence = Math.min(
      left.reduce((sum, drop) => sum + drop, 0) / left.length,
      right.reduce((sum, drop) => sum + drop, 0) / right.length,
    );
    const ordered = Math.min(monotonicity(left), monotonicity(right)) >= 0.9
      ? 1
      : 0;
    const depthVariation = Math.min(
      Math.max(...left) - Math.min(...left),
      Math.max(...right) - Math.min(...right),
    );
    return ordered * Math.max(0, Math.min(1, depthVariation / 2)) *
      Math.max(0, Math.min(1, prominence / 2));
  }));
};

describe("N-APT suspension_bridge shader fixtures", () => {
  it("scores ordered staircase/hat geometry as bridge-like", () => {
    expect(referenceBridgeScore(GOOD_STAIRCASE_HAT)).toBeGreaterThanOrEqual(0.6);
    expect(referenceBridgeScore(GOOD_DOUBLE_HAT)).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps a clipped partial edge feature available for scoring", () => {
    // The visible capture can end before the descending shoulder arrives.
    expect(GOOD_PARTIAL_EDGE_HAT[GOOD_PARTIAL_EDGE_HAT.length - 1]?.y).toBe(5);
    expect(GOOD_PARTIAL_EDGE_HAT.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects random combs, isolated peaks, and DC-only shapes", () => {
    expect(referenceBridgeScore(BAD_RANDOM_COMB)).toBeLessThan(0.4);
    expect(referenceBridgeScore(BAD_ISOLATED_SPIKE)).toBeLessThan(0.4);
    expect(referenceBridgeScore(BAD_FLAT_DC)).toBeLessThan(0.4);
  });
});
