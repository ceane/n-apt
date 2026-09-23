import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT = join(process.cwd(), "scripts/test/manual_napt_classifier_harness.mjs");
const MODULE = pathToFileURL(SCRIPT).href;
const REGRESSION_MODULE = pathToFileURL(
  join(process.cwd(), "scripts/test/napt_classifier_regression.mjs"),
).href;

function runRegressionExpression(expression: string) {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { aggregateClassifierFrames, evaluateRegressionCase } from ${JSON.stringify(REGRESSION_MODULE)}; console.log(JSON.stringify(${expression}));`,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output);
}

describe("manual NAPT classifier harness", () => {
  test("documents the manual raw-IQ-to-GPU scoring workflow", () => {
    const output = execFileSync(process.execPath, [SCRIPT, "--help"], {
      encoding: "utf8",
    });

    expect(output).toMatch(/--manifest-dir/);
    expect(output).toMatch(/--frames/);
    expect(output).toMatch(/--regression-manifest/);
    expect(output).toMatch(/--assert/);
    expect(output).toMatch(/WebGPU/);
    expect(output).toMatch(/never runs as part of CI/i);
  });

  test("requires a manifest directory instead of silently scoring the wrong buffer shape", () => {
    const result = (() => {
      try {
        execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
        return "completed";
      } catch (error) {
        return String(error);
      }
    })();

    expect(result).toMatch(/--manifest-dir or --regression-manifest is required/);
  });

  test("uses the app's 3.2 MHz fallback when capture metadata omits sample rate", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { resolveCaptureSampleRateHz } from ${JSON.stringify(MODULE)}; console.log(JSON.stringify([resolveCaptureSampleRateHz({ capture_metadata: {} }), resolveCaptureSampleRateHz({ capture_metadata: { sample_rate_hz: 2_400_000 } })]));`,
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(output)).toEqual([3_200_000, 2_400_000]);
  });

  test("can isolate one labeled capture from the regression manifest", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { selectRegressionCases } from ${JSON.stringify(MODULE)}; console.log(JSON.stringify(selectRegressionCases([{ id: "positive" }, { id: "mock-deformed" }], "mock-deformed")));`,
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(output)).toEqual([{ id: "mock-deformed" }]);
  });

  test("rejects any single-frame interference false positive in a negative capture", () => {
    const result = runRegressionExpression(
      `(() => { const aggregate = aggregateClassifierFrames([{ interferenceScore: 0.03 }, { interferenceScore: 0.91 }, { interferenceScore: 0.02 }]); return { peak: aggregate.metrics.interference?.peak ?? null, result: evaluateRegressionCase({ expected: { napt: "no", interference: "low" }, thresholds: { napt: { confidence_max: 1 }, interference: { peak_max: 0.09 } } }, aggregate) }; })()`,
    );

    expect(result.peak).toBe(0.91);
    expect(result.result.ok).toBe(false);
    expect(result.result.failures.join(" ")).toMatch(/interference peak/);
  });

  test("requires a labeled interference capture to remain present after confirmation", () => {
    const result = runRegressionExpression(
      `(() => { const aggregate = aggregateClassifierFrames([{ interferenceScore: 0.02 }, { interferenceScore: 0.02 }, { interferenceScore: 0.82 }, { interferenceScore: 0.6 }, { interferenceScore: 0.88 }]); return evaluateRegressionCase({ expected: { napt: "no", interference: "high" }, thresholds: { napt: { confidence_max: 1 }, interference: { mean_min: 0.75, present_fraction_min: 0.75 } } }, aggregate); })()`,
    );

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toMatch(/interference/);
  });

  test("accepts sustained high interference after GPU confirmation", () => {
    const result = runRegressionExpression(
      `(() => { const aggregate = aggregateClassifierFrames([{ interferenceScore: 0.02 }, { interferenceScore: 0.02 }, { interferenceScore: 0.82 }, { interferenceScore: 0.91 }, { interferenceScore: 0.88 }]); return evaluateRegressionCase({ expected: { napt: "no", interference: "high" }, thresholds: { napt: { confidence_max: 1 }, interference: { mean_min: 0.75, present_fraction_min: 0.75 } } }, aggregate); })()`,
    );

    expect(result.ok).toBe(true);
  });
});
