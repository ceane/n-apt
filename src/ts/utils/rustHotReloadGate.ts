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
  | { stage: "build_failed"; check: RustCommandResult; build: RustCommandResult }
  | { stage: "restart_failed"; check: RustCommandResult; build: RustCommandResult }
  | { stage: "restarted"; check: RustCommandResult; build: RustCommandResult };

export function createRustHotReloadGate(quietWindowMs: number) {
  let lastChangeAt = -Infinity;
  const changedFiles = new Set<string>();

  return {
    recordChange(filename?: string, at = Date.now()) {
      lastChangeAt = at;
      if (filename) changedFiles.add(filename);
    },
    shouldAttemptValidation(now = Date.now()) {
      return Number.isFinite(lastChangeAt) && now - lastChangeAt >= quietWindowMs;
    },
    clear() {
      lastChangeAt = -Infinity;
      changedFiles.clear();
    },
    getChangedFiles() {
      return Array.from(changedFiles);
    }
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
    return { stage: "check_failed", check: { success: false, output: "cancelled" } };
  }

  const check = await deps.cargoCheck();
  if (deps.isCancelled?.()) {
    deps.log("[Watcher] Rust hot reload cancelled after cargo check.");
    return { stage: "check_failed", check };
  }
  if (!check.success) {
    deps.log("[Watcher] cargo check failed; keeping old binary running.");
    deps.updateStatus(
      "warning",
      "Rust check failed - running old binary",
      "Rust backend running (old)",
    );
    return { stage: "check_failed", check };
  }

  const build = await deps.cargoBuild();
  if (deps.isCancelled?.()) {
    deps.log("[Watcher] Rust hot reload cancelled after cargo build.");
    return { stage: "build_failed", check, build };
  }
  if (!build.success) {
    deps.log("[Watcher] cargo build failed; keeping old binary running.");
    deps.updateStatus(
      "warning",
      "Rust build failed - running old binary",
      "Rust backend running (old)",
    );
    return { stage: "build_failed", check, build };
  }

  const restarted = await deps.restart();
  if (deps.isCancelled?.()) {
    deps.log("[Watcher] Rust hot reload cancelled before restart.");
    return { stage: "restart_failed", check, build };
  }
  if (!restarted) {
    deps.log("[Watcher] Rust backend restart failed.");
    deps.updateStatus("error", "Failed to restart Rust backend", "Rust backend failed");
    return { stage: "restart_failed", check, build };
  }

  deps.updateStatus("success", "Rust backend running...", "Rust backend running...");
  return { stage: "restarted", check, build };
}
