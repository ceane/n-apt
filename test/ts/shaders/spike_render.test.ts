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

  it("anchors the annotation stem to the exact FFT peak coordinate", () => {
    expect(SPIKE_RENDER_WGSL).toContain(
      "let peak_y = value_to_y(spike.value);",
    );
    expect(SPIKE_RENDER_WGSL).toContain("let line_bottom = peak_y;");
    expect(SPIKE_RENDER_WGSL).toContain("peak_y + hover_gap");
  });

  it("keeps edge markers fully inside the visible plot", () => {
    expect(SPIKE_RENDER_WGSL).toContain("fn marker_position(idx: u32, mirror_side: u32)");
    expect(SPIKE_RENDER_WGSL).toContain("let source_frequency = mix(uniforms[4].x, uniforms[4].y, t);");
    expect(SPIKE_RENDER_WGSL).toContain("let display_t = (frequency - view_min) / view_span;");
    expect(SPIKE_RENDER_WGSL).toContain("fn marker_x_for_peak");
    expect(SPIKE_RENDER_WGSL).toContain(
      "clamp(peak_x, plot_left + radius, plot_right - radius)",
    );
    expect(SPIKE_RENDER_WGSL).toContain("let mapped = marker_position(spike.index, mirror_side);");
    expect(SPIKE_RENDER_WGSL).toContain("let x = marker_x_for_peak(mapped.x);");
  });
});
