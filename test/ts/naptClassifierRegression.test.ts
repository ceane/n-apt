import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const MODULE = pathToFileURL(
  join(process.cwd(), "scripts/test/napt_classifier_regression.mjs"),
).href;

const invoke = (expression: string) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { parseRegressionManifest, aggregateClassifierFrames, evaluateRegressionCase } from ${JSON.stringify(MODULE)}; ${expression}`,
      ],
      { encoding: "utf8" },
    ),
  );

describe("manual N-APT capture regression evaluator", () => {
  it("validates explicit capture labels and thresholds", () => {
    const manifest = {
      version: 1,
      cases: [
        {
          id: "real-wide-u",
          capture_dir: "captures/real-wide-u",
          expected: {
            napt: "yes",
            suspension_bridge: "positive",
            u_dip: "positive",
          },
          thresholds: {
            suspension_bridge: { peak_min: 0.9 },
            u_dip: { peak_min: 0.9 },
            napt: { confidence_min: 0.8, yes_fraction_min: 0.25 },
          },
        },
      ],
    };
    const result = invoke(`console.log(JSON.stringify(parseRegressionManifest(${JSON.stringify(manifest)}, process.cwd())))`);
    expect(result.cases[0].id).toBe("real-wide-u");
    expect(result.cases[0].expected.suspension_bridge).toBe("positive");
  });

  it("rejects missing expected feature labels", () => {
    const result = invoke(`try { parseRegressionManifest(${JSON.stringify({ version: 1, cases: [{ id: "broken", capture_dir: "x", expected: { napt: "yes" } }] })}, process.cwd()); console.log(JSON.stringify({ ok: true })); } catch (error) { console.log(JSON.stringify({ ok: false, message: String(error.message) })); }`);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/suspension_bridge|u_dip/);
  });

  it("aggregates frame scores without hiding peak and persistence behavior", () => {
    const frames = [
      { suspensionBridge: 0.92, uDip: 0.88, confidence: 0.86, isNapt: true },
      { suspensionBridge: 0.80, uDip: 0.76, confidence: 0.72, isNapt: false },
      { suspensionBridge: 0.96, uDip: 0.91, confidence: 0.90, isNapt: true },
    ];
    const result = invoke(`console.log(JSON.stringify(aggregateClassifierFrames(${JSON.stringify(frames)})))`);
    expect(result.frame_count).toBe(3);
    expect(result.metrics.suspension_bridge.peak).toBeCloseTo(0.96);
    expect(result.metrics.u_dip.peak).toBeCloseTo(0.91);
    expect(result.temporal_yes_fraction).toBeCloseTo(2 / 3);
  });

  it("fails a positive case when a labeled feature regresses", () => {
    const testCase = {
      id: "real-wide-u",
      expected: { napt: "yes", suspension_bridge: "positive", u_dip: "positive" },
      thresholds: {
        suspension_bridge: { peak_min: 0.9 },
        u_dip: { peak_min: 0.9 },
        napt: { confidence_min: 0.8, yes_fraction_min: 0.25 },
      },
    };
    const aggregate = {
      frame_count: 4,
      metrics: {
        suspension_bridge: { peak: 0.55 },
        u_dip: { peak: 0.92 },
        confidence: { peak: 0.86 },
      },
      temporal_yes_fraction: 0.5,
    };
    const result = invoke(`console.log(JSON.stringify(evaluateRegressionCase(${JSON.stringify(testCase)}, ${JSON.stringify(aggregate)})))`);
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toMatch(/suspension_bridge/);
  });

  it("fails a negative case when a Mock exceeds a negative threshold", () => {
    const testCase = {
      id: "mock-comb",
      expected: { napt: "no", suspension_bridge: "negative", u_dip: "negative" },
      thresholds: {
        suspension_bridge: { peak_max: 0.35 },
        u_dip: { peak_max: 0.35 },
        napt: { confidence_max: 0.5, yes_fraction_max: 0 },
      },
    };
    const aggregate = {
      frame_count: 4,
      metrics: {
        suspension_bridge: { peak: 0.72 },
        u_dip: { peak: 0.18 },
        confidence: { peak: 0.48 },
      },
      temporal_yes_fraction: 0,
    };
    const result = invoke(`console.log(JSON.stringify(evaluateRegressionCase(${JSON.stringify(testCase)}, ${JSON.stringify(aggregate)})))`);
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toMatch(/suspension_bridge/);
  });
});
