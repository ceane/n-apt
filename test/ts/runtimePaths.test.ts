import path from "node:path";

import {
  appRuntimeDirectory,
  backendHandoffLockPath,
  backendTargetPath,
  buildOrchestratorLockPath,
  rebuildStatusPath,
} from "../../scripts/build/runtimePaths";

describe("app runtime paths", () => {
  it("scopes build and backend handoff state under .n-apt", () => {
    expect(appRuntimeDirectory).toBe(path.resolve(".n-apt"));
    expect(backendHandoffLockPath).toBe(path.join(appRuntimeDirectory, "backend-handoff.lock"));
    expect(backendTargetPath).toBe(path.join(appRuntimeDirectory, "backend-target.json"));
    expect(buildOrchestratorLockPath).toBe(path.join(appRuntimeDirectory, "build-orchestrator.lock"));
    expect(rebuildStatusPath).toBe(path.join(appRuntimeDirectory, "rebuild_status.json"));
  });
});
