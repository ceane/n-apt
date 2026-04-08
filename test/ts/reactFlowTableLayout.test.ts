import {
  computeBitstreamLayout,
  computeSymbolsLayout,
  deriveIQPoints,
  resolveSampleCount,
} from "@n-apt/components/react-flow/nodes/tableLayout";

describe("react flow table layout helpers", () => {
  it("increases bitstream bytes per row when width allows it", () => {
    const narrow = computeBitstreamLayout({ width: 360, height: 320 });
    const wide = computeBitstreamLayout({ width: 1100, height: 320 });

    expect(wide.bytesPerRow).toBeGreaterThan(narrow.bytesPerRow);
    expect(wide.iqPairsPerRow).toBe(wide.bytesPerRow / 2);
  });

  it("increases symbol rows when height grows", () => {
    const short = computeSymbolsLayout({ width: 700, height: 240 });
    const tall = computeSymbolsLayout({ width: 700, height: 720 });

    expect(tall.rowsCount).toBeGreaterThan(short.rowsCount);
  });

  it("prefers live buffer sample count over fft size", () => {
    expect(resolveSampleCount(32768, 4096)).toBe(4096);
    expect(resolveSampleCount(32768, 0)).toBe(32768);
  });

  it("derives IQ points directly from the sample buffer", () => {
    const points = deriveIQPoints(new Uint8Array([255, 0, 128, 160]), 2, 0);

    expect(points).toHaveLength(2);
    expect(points[0]?.i).toBe(255);
    expect(points[0]?.q).toBe(0);
    expect(points[0]?.symbol).toBe("(+, -)");
    expect(points[1]?.i).toBe(128);
    expect(points[1]?.q).toBe(160);
  });
});
