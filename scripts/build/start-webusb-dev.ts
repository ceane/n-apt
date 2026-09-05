import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { isProjectBuildOrchestratorCommand } from "./webusbDevOwnership";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const orchestratorLockPath = path.join(
  projectRoot,
  ".n-apt-build-orchestrator.lock",
);
const orchestratorScriptPath = path.join(
  scriptDirectory,
  "build-orchestrator.tsx",
);
const viteConfigPath = path.join(projectRoot, "vite.webusb.config.ts");

type OrchestratorLock = {
  pid: number;
  startedAt?: number;
};

function readLock(): OrchestratorLock | null {
  if (!fs.existsSync(orchestratorLockPath)) return null;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(orchestratorLockPath, "utf8"),
    ) as Partial<OrchestratorLock>;
    if (!Number.isInteger(parsed.pid) || (parsed.pid ?? 0) <= 0) return null;
    return { pid: parsed.pid, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

function processCommand(pid: number): string {
  if (process.platform === "win32") return "";
  return spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  }).stdout?.trim() ?? "";
}

function processWorkingDirectory(pid: number): string | undefined {
  if (process.platform === "win32") return undefined;
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  return result.stdout
    ?.split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

function requestOrchestratorShutdown(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // The process may not be a group leader; signal the verified PID below.
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // It exited between validation and signaling.
  }
}

async function waitForExit(pid: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
}

function removeLockIfOwned(lock: OrchestratorLock): void {
  try {
    const current = JSON.parse(
      fs.readFileSync(orchestratorLockPath, "utf8"),
    ) as Partial<OrchestratorLock>;
    if (current.pid === lock.pid) fs.rmSync(orchestratorLockPath, { force: true });
  } catch {
    // The orchestrator normally removes its own lock during shutdown.
  }
}

export async function stopProjectDevStack(
  log: (message: string) => void = console.log,
): Promise<void> {
  const lock = readLock();
  if (!lock) {
    if (fs.existsSync(orchestratorLockPath)) {
      throw new Error(
        `Found an unreadable ${path.basename(orchestratorLockPath)}; refusing to start WebUSB until it is resolved.`,
      );
    }
    log("[WebUSB] No n-apt dev orchestrator lock found.");
    return;
  }

  const command = processCommand(lock.pid);
  const commandCwd = processWorkingDirectory(lock.pid);
  if (!processExists(lock.pid)) {
    log(`[WebUSB] Removing stale dev lock for PID ${lock.pid}.`);
    removeLockIfOwned(lock);
    return;
  }
  if (
    !isProjectBuildOrchestratorCommand(
      command,
      orchestratorScriptPath,
      commandCwd,
    )
  ) {
    throw new Error(
      `[WebUSB] Refusing to signal PID ${lock.pid}: it is not this project's build orchestrator.`,
    );
  }

  log(
    `[WebUSB] Stopping the n-apt dev stack (orchestrator PID ${lock.pid}) so Rust/libusb releases SDR ownership…`,
  );
  requestOrchestratorShutdown(lock.pid);
  if (!(await waitForExit(lock.pid))) {
    throw new Error(
      `[WebUSB] The n-apt dev stack did not exit within 8 seconds; WebUSB will not start while ownership is uncertain.`,
    );
  }
  removeLockIfOwned(lock);
  log("[WebUSB] n-apt dev stack stopped; project-owned SDR handles should be released.");
}

function startVite(): void {
  const viteBinary = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vite.cmd" : "vite",
  );
  const child = spawn(viteBinary, ["--config", viteConfigPath], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  child.once("error", (error) => {
    console.error(`[WebUSB] Failed to start Vite: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

async function main(): Promise<void> {
  console.warn(
    "[WebUSB] USB OWNERSHIP WARNING: close SDR++, CubicSDR, SoapySDR, and any other software that may claim the SDR.",
  );
  console.warn(
    "[WebUSB] This launcher stops only n-apt's own dev stack; it will not kill unrelated hardware software.",
  );
  await stopProjectDevStack();
  console.log("[WebUSB] Starting the backend-free Vite app on http://localhost:5175");
  console.log("[WebUSB] Probe: http://localhost:5175/webusb-probe/");
  console.log("[WebUSB] Lite:  http://localhost:5175/lite/");
  startVite();
}

const isMainModule =
  path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMainModule) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
