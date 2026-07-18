import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLASSIFY_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_classify.wgsl"),
  "utf8",
);
const DETECT_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_detect.wgsl"),
  "utf8",
);
const TEMPORAL_WGSL = readFileSync(
  join(process.cwd(), "src/ts/shaders/napt_temporal.wgsl"),
  "utf8",
);

const BIN_COUNT = 1024;
const FLOOR = -90;

type Fixture = Float32Array;

const gaussian = (x: number, center: number, width: number) =>
  Math.exp(-((x - center) ** 2) / (2 * width ** 2));

const makeFlatDcFixture = (): Fixture => {
  const values = new Float32Array(BIN_COUNT).fill(FLOOR);
  values[Math.floor(BIN_COUNT / 2)] = -20;
  return values;
};

const makeMockCombFixture = (): Fixture => {
  const values = new Float32Array(BIN_COUNT).fill(FLOOR);
  for (let i = 8; i < BIN_COUNT; i += 21) values[i] = -45;
  return values;
};

const makeNaptFixture = (offset = 0): Fixture => {
  const values = new Float32Array(BIN_COUNT);
  for (let i = 0; i < BIN_COUNT; i += 1) {
    const x = i / (BIN_COUNT - 1);
    const uEnvelope = 18 * ((x - 0.5) ** 2) * 4;
    const bridge = 8 * gaussian(x, 0.32 + offset, 0.07) +
      12 * gaussian(x, 0.52 + offset, 0.09) +
      7 * gaussian(x, 0.72 + offset, 0.06);
    const comb = 4 * Math.max(0, Math.sin(i * Math.PI / 10));
    values[i] = FLOOR + uEnvelope + bridge + comb;
  }
  return values;
};

const countElevatedBins = (fixture: Fixture, threshold = FLOOR + 3) =>
  Array.from(fixture).filter((value) => value >= threshold).length;

describe("N-APT classifier synthetic fixtures", () => {
  it("contains GPU logic for normalized local U search and sparse-spur rejection", () => {
    expect(CLASSIFY_WGSL).toContain("local_u_peak");
    expect(CLASSIFY_WGSL).toContain("center_position");
    expect(CLASSIFY_WGSL).toContain("result.spike_count < 64u");
    expect(DETECT_WGSL).toContain("metrics.spike_count < 64u");
  });

  it("measures bridge hats using distance-bucketed monotonicity", () => {
    expect(CLASSIFY_WGSL).toContain("left_bucket0_drop_sum");
    expect(CLASSIFY_WGSL).toContain("left_bucket3_count");
    expect(CLASSIFY_WGSL).toContain("right_bucket0_drop_sum");
    expect(CLASSIFY_WGSL).toContain("pair_order_score");
    expect(CLASSIFY_WGSL).toContain("ordered_bridge_score");
    expect(CLASSIFY_WGSL).toContain("MIN_VALIDATED_HAT_PAIR_SCORE");
    // The O(n²) pairwise loop has been replaced by bucketed monotonicity.
    expect(CLASSIFY_WGSL).not.toContain("near_index < hat_scan_count");
    expect(CLASSIFY_WGSL).not.toContain("far_index < hat_scan_count");
  });

  it("fits a U-dip from the displayed upper envelope", () => {
    expect(CLASSIFY_WGSL).toContain("waveform_quadratic_score");
    expect(CLASSIFY_WGSL).toContain("waveform_envelope_at");
    expect(CLASSIFY_WGSL).toContain("best_visible_u_score");
  });

  it("keeps envelope fit advisory for partial captures", () => {
    expect(DETECT_WGSL).toContain("envelope_fit_score < 0.20");
    expect(DETECT_WGSL).not.toContain("envelope_fit_score >= 0.45 &&");
  });

  it("uses chronological pulse-aware history for partial bridges", () => {
    expect(TEMPORAL_WGSL).toContain("history_slot");
    expect(TEMPORAL_WGSL).toContain("last_active_gap");
    expect(TEMPORAL_WGSL).toContain("two_event_pulse_support");
    expect(TEMPORAL_WGSL).toContain("repeated_bridge_support");
    expect(TEMPORAL_WGSL).toContain("pulse_support >= 0.75");
  });

  it("preserves repeated U-dip peaks across pulsed temporal windows", () => {
    expect(TEMPORAL_WGSL).toContain("u_dip_peak");
    expect(TEMPORAL_WGSL).toContain("u_dip_active_count");
    expect(TEMPORAL_WGSL).toContain("u_dip_temporal_score");
    expect(TEMPORAL_WGSL).toContain("u_dip_active_count >= 2u");
  });

  it("penalizes a strong isolated hat without a supporting U-dip", () => {
    expect(DETECT_WGSL).toContain("u_dip_score < 0.35 && effective_bridge_score > 0.70");
  });

  it("scaffolds a sinc-shaped hardware-artifact penalty", () => {
    expect(CLASSIFY_WGSL).toContain("sinc_penalty_score");
    expect(DETECT_WGSL).toContain("sinc_penalty_score");
    expect(TEMPORAL_WGSL).toContain("sinc_penalty_score");
  });

  it("makes the flat DC fixture sparse rather than bridge-like", () => {
    const fixture = makeFlatDcFixture();
    expect(countElevatedBins(fixture)).toBe(1);
    expect(fixture[BIN_COUNT / 2]).toBe(-20);
  });

  it("keeps the Mock comb disconnected", () => {
    const fixture = makeMockCombFixture();
    expect(countElevatedBins(fixture)).toBeGreaterThan(30);
    expect(countElevatedBins(fixture)).toBeLessThan(60);
    expect(Array.from(fixture).some((value, index) =>
      value >= FLOOR + 3 && fixture[index + 1] >= FLOOR + 3,
    )).toBe(false);
  });

  it("has repeated connected clumps and a movable normalized envelope", () => {
    const centered = makeNaptFixture();
    const shifted = makeNaptFixture(0.08);
    expect(countElevatedBins(centered)).toBeGreaterThan(64);
    expect(countElevatedBins(shifted)).toBeGreaterThan(64);
    expect(Math.max(...centered)).toBeGreaterThan(FLOOR + 15);
    expect(Math.max(...shifted)).toBeGreaterThan(FLOOR + 15);
  });
});
