import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

describe("Vite development-server memory safety", () => {
  it("uses a Vite release with the HMR hot-data cleanup fix", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { devDependencies?: Record<string, string> };
    const version = packageJson.devDependencies?.vite;
    expect(version).toBeDefined();
    const [major, minor] = version!.split(".").map(Number);

    expect(
      major > 8 || (major === 8 && minor >= 3),
    ).toBe(true);
  });

  it("does not use a broad process-name kill for Vite startup cleanup", () => {
    const orchestrator = fs.readFileSync(
      path.join(repositoryRoot, "scripts/build/build-orchestrator.tsx"),
      "utf8",
    );

    expect(orchestrator).not.toContain("pkill -9 -f '[v]ite'");
  });
});
