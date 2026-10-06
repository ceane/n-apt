import { execFileSync } from "node:child_process";

describe("entry reachability", () => {
  it("counts test/ts imports when checking source-module reachability", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/lint/check-entry-reachability.mjs"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(output).toMatch(/all reachable/i);
  });
});
