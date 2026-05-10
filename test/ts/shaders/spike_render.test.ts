import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPIKE_RENDER_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/spike_render.wgsl"),
  "utf8",
);

describe("spike_render.wgsl", () => {
  it("stays non-empty", () => {
    expect(SPIKE_RENDER_WGSL.trim()).not.toHaveLength(0);
  });

  it("exports the expected spike render entry points", () => {
    expect(SPIKE_RENDER_WGSL).toContain("fn vs_line");
    expect(SPIKE_RENDER_WGSL).toContain("fn fs_line");
    expect(SPIKE_RENDER_WGSL).toContain("fn vs_circle");
    expect(SPIKE_RENDER_WGSL).toContain("fn fs_circle");
  });
});
