import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("waterfall_fifo.wgsl immutable history zoom", () => {
  const shader = readFileSync(
    join(process.cwd(), "src/ts/shaders/waterfall_fifo.wgsl"),
    "utf8",
  );

  it("samples a centered horizontal window at render time", () => {
    expect(shader).toContain("let historyZoom = max(uniforms[2].w, 1.0);");
    expect(shader).toContain("let sourceX = 0.5 + (displayX - 0.5) / historyZoom;");
  });
});
