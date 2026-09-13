import { execFileSync } from "node:child_process";

describe("entry reachability", () => {
  it("treats every source HTML module script as a production entry", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/lint/check-entry-reachability.mjs"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(output).toMatch(/all reachable/i);
  });
});
