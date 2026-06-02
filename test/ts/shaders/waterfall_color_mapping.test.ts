import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WATERFALL_ONSCREEN_COLOR_MAX,
  normalizeWaterfallDbForColor,
} from "@n-apt/utils/waterfallColor";

describe("waterfall WebGPU color mapping", () => {
  const source = readFileSync(
    join(process.cwd(), "src/ts/shaders/waterfall_fifo.wgsl"),
    "utf8",
  );

  it("keeps the shader's onscreen color ceiling aligned with the TS reference", () => {
    expect(source).toContain(
      `let onscreenColorMax = ${WATERFALL_ONSCREEN_COLOR_MAX}`,
    );
    expect(source).toContain("rawDb > dbMax");
  });

  it("keeps onscreen visible peaks out of the hottest colormap range", () => {
    expect(normalizeWaterfallDbForColor(-45, -100, -35)).toBeLessThan(0.5);
    expect(normalizeWaterfallDbForColor(-35, -100, -35)).toBe(
      WATERFALL_ONSCREEN_COLOR_MAX,
    );
  });
});
