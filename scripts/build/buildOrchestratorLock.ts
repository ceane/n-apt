import fs from "node:fs";
import { spawnSync } from "node:child_process";

type LockRecord = { pid: number; startedAt: number };

const isOrchestratorProcess = (pid: number): boolean => {
  if (process.platform === "win32") return true;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  return /build-orchestrator/i.test(result.stdout ?? "");
};

const stopPreviousOrchestrator = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (!isOrchestratorProcess(pid)) return;

  try {
    if (process.platform !== "win32") process.kill(-pid, "SIGTERM");
  } catch {
    // The process may not be a process-group leader.
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // It already exited, which is the desired end state.
  }

};

export function acquireBuildOrchestratorLock(lockPath: string, record = {
  pid: process.pid,
  startedAt: Date.now(),
}): () => void {
  fs.mkdirSync(lockPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true });

  try {
    fs.writeFileSync(lockPath, JSON.stringify(record), { flag: "wx" });
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const previous = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LockRecord;
      stopPreviousOrchestrator(previous.pid);
    } catch {
      // An incomplete lock is safe to replace.
    }
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
