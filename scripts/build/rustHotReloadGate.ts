export type RustCommandResult = {
  success: boolean;
  output: string;
};

export type RustHotReloadValidationDependencies = {
  cargoCheck: () => Promise<RustCommandResult>;
  cargoBuild: () => Promise<RustCommandResult>;
  restart: () => Promise<boolean>;
  log: (message: string) => void;
  updateStatus: (
    status: "success" | "warning" | "error" | "running",
    message?: string,
    label?: string,
  ) => void;
  isCancelled?: () => boolean;
};

export type RustHotReloadValidationResult =
  | { stage: "check_failed"; check: RustCommandResult }
  | {
      stage: "build_failed";
      check: RustCommandResult;
      build: RustCommandResult;
    }
  | {
      stage: "restart_failed";
      check: RustCommandResult;
      build: RustCommandResult;
    }
  | { stage: "restarted"; check: RustCommandResult; build: RustCommandResult };

export type RustHotReloadPhase =
  | "idle"
  | "waiting"
  | "rebuilding"
  | "restarting"
  | "ready"
  | "degraded";

export const RUST_HOT_RELOAD_QUIET_MS = 5000;
export const RUST_HOT_RELOAD_MAX_COALESCE_MS = 30000;

export function isProcessSpinnerActive(status: string): boolean {
  return status === "running";
}

export function canKeepRustHotReloadWatcherAttached(
  vitePid?: number,
  redisPid?: number,
  rustPid?: number,
): boolean {
  return [vitePid, redisPid, rustPid].every(
    (pid) => typeof pid === "number" && Number.isInteger(pid) && pid > 0,
  );
}

export function getRustHotReloadProcessLabel(
  status: string,
  message?: string,
): string | undefined {
  if (status !== "running") return undefined;
  return message?.includes("Restarting")
    ? "Restarting Rust backend..."
    : "[HOT-RELOAD] Rebuilding Rust backend...";
}

export function getRustHotReloadStepLabel(phase: RustHotReloadPhase): string | undefined {
  switch (phase) {
    case "idle":
      return undefined;
    case "waiting":
      return "[HOT-RELOAD] Waiting for Rust changes to settle...";
    case "rebuilding":
      return "[HOT-RELOAD] Rebuilding Rust backend...";
    case "restarting":
      return "Restarting Rust backend...";
    case "ready":
      return "[HOT-RELOAD] Rust backend reloaded";
    case "degraded":
      return "[HOT-RELOAD] Rust backend running (old)";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function getRustHotReloadRuntimeLabel(
  updateCount: number,
  fallback: string,
): string {
  return updateCount > 0 ? `✓ Updated (+${updateCount})` : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRustHotReloadGate(
  quietWindowMs: number,
  maxCoalesceMs: number = Number.POSITIVE_INFINITY,
) {
  let firstChangeAt = -Infinity;
  let lastChangeAt = -Infinity;
  const changedFiles = new Set<string>();

  return {
    recordChange(filename?: string, at = Date.now()) {
      if (!Number.isFinite(lastChangeAt) || lastChangeAt === -Infinity) {
        firstChangeAt = at;
      }
      lastChangeAt = at;
      if (filename) changedFiles.add(filename);
    },
    shouldAttemptValidation(now = Date.now()) {
      if (!Number.isFinite(lastChangeAt) || lastChangeAt === -Infinity) {
        return false;
      }
      const quietElapsed = now - lastChangeAt >= quietWindowMs;
      const maxElapsed =
        Number.isFinite(maxCoalesceMs) &&
        Number.isFinite(firstChangeAt) &&
        firstChangeAt !== -Infinity &&
        now - firstChangeAt >= maxCoalesceMs;
      return quietElapsed || maxElapsed;
    },
    getRemainingMs(now = Date.now()) {
      if (!Number.isFinite(lastChangeAt) || lastChangeAt === -Infinity) {
        return null;
      }
      const quietRemaining = Math.max(0, quietWindowMs - (now - lastChangeAt));
      if (!Number.isFinite(maxCoalesceMs) || !Number.isFinite(firstChangeAt) || firstChangeAt === -Infinity) {
        return quietRemaining;
      }
      const maxRemaining = Math.max(0, maxCoalesceMs - (now - firstChangeAt));
      return Math.min(quietRemaining, maxRemaining);
    },
    clear() {
      firstChangeAt = -Infinity;
      lastChangeAt = -Infinity;
      changedFiles.clear();
    },
    getChangedFiles() {
      return Array.from(changedFiles);
    },
  };
}

export function buildRustBackendStopCommand(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return `taskkill /PID ${pid} /T /F`;
  }

  return `kill -TERM -${pid} || kill -TERM ${pid}`;
}

export async function runRustHotReloadValidation(
  deps: RustHotReloadValidationDependencies,
): Promise<RustHotReloadValidationResult> {
  if (deps.isCancelled?.()) {
    deps.log("[Watcher] Rust hot reload cancelled before validation started.");
    return {
      stage: "check_failed",
      check: { success: false, output: "cancelled" },
    };
  }

  deps.updateStatus(
    "running",
    "Checking Rust backend...",
    "[HOT-RELOAD] Checking Rust backend...",
  );
  let check: RustCommandResult;
  try {
    check = await deps.cargoCheck();
  } catch (error) {
    check = { success: false, output: errorMessage(error) };
  }
  if (deps.isCancelled?.()) {
    deps.log("[Watcher] Rust hot reload cancelled after cargo check.");
    return { stage: "check_failed", check };
  }
  if (!check.success) {
    deps.log("[Watcher] cargo check failed; keeping old binary running.");
    deps.updateStatus(
      "warning",
      "Rust check failed - running old binary",
      "[HOT-RELOAD] Rust backend running (old)",
    );
    return { stage: "check_failed", check };
  }

  deps.updateStatus(
    "running",
    "Building Rust backend...",
    "[HOT-RELOAD] Rebuilding Rust backend...",
  );
  let build: RustCommandResult;
  try {
    build = await deps.cargoBuild();
  } catch (error) {
    build = { success: false, output: errorMessage(error) };
  }
  if (deps.isCancelled?.()) {
    deps.log("[Watcher] Rust hot reload cancelled after cargo build.");
    return { stage: "build_failed", check, build };
  }
  if (!build.success) {
    deps.log("[Watcher] cargo build failed; keeping old binary running.");
    deps.updateStatus(
      "warning",
      "Rust build failed - running old binary",
      "[HOT-RELOAD] Rust backend running (old)",
    );
    return { stage: "build_failed", check, build };
  }

  deps.updateStatus(
    "running",
    "Restarting Rust backend...",
    "Restarting Rust backend...",
  );
  let restarted = false;
  try {
    restarted = await deps.restart();
  } catch (error) {
    const message = errorMessage(error);
    deps.log(`[Watcher] Rust backend restart threw: ${message}`);
    deps.updateStatus(
      "error",
      `Failed to restart Rust backend: ${message}`,
      "Rust backend failed",
    );
    return { stage: "restart_failed", check, build };
  }
  if (deps.isCancelled?.()) {
    deps.log("[Watcher] Rust hot reload cancelled before restart.");
    return { stage: "restart_failed", check, build };
  }
  if (!restarted) {
    deps.log("[Watcher] Rust backend restart failed.");
    deps.updateStatus(
      "error",
      "Failed to restart Rust backend",
      "Rust backend failed",
    );
    return { stage: "restart_failed", check, build };
  }

  deps.updateStatus(
    "success",
    "Running new build",
    "[HOT-RELOAD] Rust backend reloaded",
  );
  return { stage: "restarted", check, build };
}
