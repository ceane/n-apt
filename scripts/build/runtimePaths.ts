import path from "node:path";

export const appRuntimeDirectory = path.resolve(".n-apt");
export const backendHandoffLockPath = path.join(appRuntimeDirectory, "backend-handoff.lock");
export const backendTargetPath = path.join(appRuntimeDirectory, "backend-target.json");
export const buildOrchestratorLockPath = path.join(appRuntimeDirectory, "build-orchestrator.lock");
export const rebuildStatusPath = path.join(appRuntimeDirectory, "rebuild_status.json");
