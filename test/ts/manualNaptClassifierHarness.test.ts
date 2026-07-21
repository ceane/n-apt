import { execFileSync } from "node:child_process";
import { join } from "node:path";

const SCRIPT = join(process.cwd(), "scripts/test/manual_napt_classifier_harness.mjs");

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
});
