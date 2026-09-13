import path from "node:path";
import { isProjectBuildOrchestratorCommand } from "../../scripts/build/webusbDevOwnership";

describe("WebUSB dev launcher ownership guard", () => {
  it("recognizes only the n-apt build orchestrator", () => {
    expect(
      isProjectBuildOrchestratorCommand(
        `node ${path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs")} ${path.resolve(process.cwd(), "scripts/build/build-orchestrator.tsx")}`,
      ),
    ).toBe(true);
    expect(
      isProjectBuildOrchestratorCommand(
        "node /workspace/other-project/scripts/build/build-orchestrator.tsx",
      ),
    ).toBe(false);
    expect(isProjectBuildOrchestratorCommand("n-apt-backend")).toBe(false);
    expect(
      isProjectBuildOrchestratorCommand(
        "node --import tsx scripts/build/build-orchestrator.tsx",
        path.resolve(process.cwd(), "scripts/build/build-orchestrator.tsx"),
        process.cwd(),
      ),
    ).toBe(true);
  });
});
