import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { isProjectBuildOrchestratorCommand } from "./webusbDevOwnership";

type LockRecord = { pid: number; startedAt: number };
type StopPreviousOrchestrator = (pid: number) => void | Promise<void>;

type BuildOrchestratorLockOptions = {
  stopPreviousOrchestrator?: StopPreviousOrchestrator;
};

const isOrchestratorProcess = (pid: number): boolean => {
  if (process.platform === "win32") return true;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  if (result.status !== 0 || result.error) return false;

  const command = result.stdout ?? "";
  const commandCwd = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  }).stdout
    ?.split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);

  return isProjectBuildOrchestratorCommand(
    command,
    path.resolve("scripts/build/build-orchestrator.tsx"),
    commandCwd,
  );
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
};

const waitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
};

const signalOrchestrator = (pid: number, signal: NodeJS.Signals): void => {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    // The process may not be a process-group leader.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // It exited between the group and direct signal attempts.
  }
};

const stopPreviousOrchestratorAndWait: StopPreviousOrchestrator = async (pid) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (!isOrchestratorProcess(pid)) return;

  signalOrchestrator(pid, "SIGTERM");
  if (await waitForExit(pid, 8_000)) return;

  signalOrchestrator(pid, "SIGKILL");
  if (!(await waitForExit(pid, 2_000))) {
    throw new Error(`Previous n-apt dev orchestrator PID ${pid} did not exit.`);
  }
};

export async function acquireBuildOrchestratorLock(
  lockPath: string,
  record = {
    pid: process.pid,
    startedAt: Date.now(),
  },
  options: BuildOrchestratorLockOptions = {},
): Promise<() => void> {
  fs.mkdirSync(lockPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true });

  try {
    fs.writeFileSync(lockPath, JSON.stringify(record), { flag: "wx" });
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    let previous: LockRecord;
    try {
      previous = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LockRecord;
    } catch {
      // An incomplete lock is safe to replace.
      previous = { pid: 0, startedAt: 0 };
    }
    await (options.stopPreviousOrchestrator ?? stopPreviousOrchestratorAndWait)(previous.pid);
    fs.rmSync(lockPath, { force: true });
    fs.writeFileSync(lockPath, JSON.stringify(record), { flag: "wx" });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LockRecord;
      if (current.pid === record.pid) fs.rmSync(lockPath, { force: true });
    } catch {
      // The next orchestrator can recover a missing or malformed lock.
    }
  };
}
