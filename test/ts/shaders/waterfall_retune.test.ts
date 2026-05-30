import { WATERFALL_RETUNE_WGSL } from "../../../src/ts/consts/shaders/waterfall_retune";
import { synthesizeWaterfallTransitionRow } from "../../../src/ts/utils/waterfallRows";

describe("waterfall_retune.wgsl", () => {
  it("stays non-empty", () => {
    expect(WATERFALL_RETUNE_WGSL.trim()).not.toHaveLength(0);
  });

  it("exports the retune compute entry point", () => {
    expect(WATERFALL_RETUNE_WGSL).toContain("@compute @workgroup_size(64)");
    expect(WATERFALL_RETUNE_WGSL).toContain("fn main");
    expect(WATERFALL_RETUNE_WGSL).toContain("smoother_step");
    expect(WATERFALL_RETUNE_WGSL).toContain("sample_shifted_previous");
  });

  it("documents the CPU reference behavior used for snapshot parity", () => {
    const output = new Float32Array(4);

    synthesizeWaterfallTransitionRow({
      previous: new Float32Array([-80, -40, -60, -90]),
      current: new Float32Array([-20, -20, -20, -20]),
      target: output,
      driftBins: 2,
      progress: 0.5,
      floorDb: -100,
    });

    expect(Array.from(output)).toEqual([-30, -40, -55, -20]);
    expect(WATERFALL_RETUNE_WGSL).toContain(
      "output_row[idx] = previous_value + (current_value - previous_value) * blend",
    );
  });

  it("keeps shifted edges filled from the current row, not the floor", () => {
    expect(WATERFALL_RETUNE_WGSL).toContain(
      "sample_shifted_previous(\n    shifted_index,\n    current_value,",
    );
  });
});
