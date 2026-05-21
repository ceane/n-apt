import {
  WATERFALL_ONSCREEN_COLOR_MAX,
  getWaterfallOverRangeHeadroomDb,
  normalizeWaterfallDbForColor,
} from "@n-apt/utils/waterfallColor";

describe("waterfallColor", () => {
  it("keeps onscreen peaks below the hot red color band", () => {
    const normalized = normalizeWaterfallDbForColor(-45, -100, -35);

    expect(normalized).toBeLessThan(WATERFALL_ONSCREEN_COLOR_MAX);
    expect(normalized).toBeCloseTo(0.4908, 3);
  });

  it("maps the visible dB ceiling to the onscreen color ceiling", () => {
    expect(normalizeWaterfallDbForColor(-35, -100, -35)).toBeCloseTo(
      WATERFALL_ONSCREEN_COLOR_MAX,
      5,
    );
  });

  it("preserves onscreen contrast instead of flattening visible peaks", () => {
    const lower = normalizeWaterfallDbForColor(-55, -100, -35);
    const higher = normalizeWaterfallDbForColor(-45, -100, -35);

    expect(higher - lower).toBeCloseTo((10 / 65) * WATERFALL_ONSCREEN_COLOR_MAX, 5);
  });

  it("reserves the hottest colors for above-ceiling peaks", () => {
    const headroom = getWaterfallOverRangeHeadroomDb(-100, -35);

    expect(normalizeWaterfallDbForColor(-35 + headroom, -100, -35)).toBe(1);
    expect(normalizeWaterfallDbForColor(-35 + headroom / 2, -100, -35)).toBeGreaterThan(
      WATERFALL_ONSCREEN_COLOR_MAX,
    );
  });
});
