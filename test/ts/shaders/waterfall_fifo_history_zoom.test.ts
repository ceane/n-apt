import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("waterfall_fifo.wgsl immutable history zoom", () => {
  const shader = readFileSync(
    join(process.cwd(), "src/ts/shaders/waterfall_fifo.wgsl"),
    "utf8",
  );

  it("samples a centered horizontal window at render time", () => {
    expect(shader).toContain("let historyZoom = max(uniforms[2].w, 1.0);");
    expect(shader).toContain(
      "let sourceX = 0.5 + (displayX - 0.5) / historyZoom;",
    );
  });

  it("switches to nearest-neighbour steps when zoom gives each bin multiple pixels", () => {
    expect(shader).toContain(
      "let visibleSourceBinCount = sourceBinCount / historyZoom;",
    );
    expect(shader).toContain(
      "let isSteps = plotW / max(visibleSourceBinCount, 1.0) >= 3.0;",
    );
    expect(shader).toContain("if (wfSmooth && !isSteps)");
  });

  it("selects packed odd or even bins in the fragment shader", () => {
    expect(shader).toContain("let binSubsetMode = i32(uniforms[3].y);");
    expect(shader).toContain("let binSubsetParity = i32(uniforms[3].z);");
    expect(shader).toContain(
      "let selectedBinCount = max(1.0, ceil(fTexW / 2.0));",
    );
    expect(shader).toContain("selectedBin * 2 + binSubsetParity");
  });
});
