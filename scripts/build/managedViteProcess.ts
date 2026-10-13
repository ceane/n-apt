import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VITE_PORT = 5173;
const STOP_TIMEOUT_MS = 4_000;

const run = (command: string, args: string[]) =>
  spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });

const getListeningPids = (port: number): number[] => {
  if (process.platform === "win32") {
    const result = run("netstat", ["-ano", "-p", "tcp"]);
    if (result.error || result.status !== 0) return [];

    const pids = new Set<number>();
    for (const line of (result.stdout ?? "").split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[0].toUpperCase() !== "TCP") continue;
      if (columns[3].toUpperCase() !== "LISTENING") continue;
      const localPort = Number(columns[1].slice(columns[1].lastIndexOf(":") + 1));
      const pid = Number(columns[4]);
      if (localPort === port && Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }

  const result = run("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (result.error || (result.status !== 0 && result.status !== 1)) return [];
  return [...new Set(
    (result.stdout ?? "")
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  )];
};

const getProcessCommand = (pid: number): string => {
  if (process.platform === "win32") {
    const query = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { $p.CommandLine }`;
    const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query]);
    return result.error || result.status !== 0 ? "" : (result.stdout ?? "").trim();
  }

  const result = run("ps", ["-p", String(pid), "-o", "command="]);
  return result.error || result.status !== 0 ? "" : (result.stdout ?? "").trim();
};

const getProcessWorkingDirectory = (pid: number): string | undefined => {
  if (process.platform === "win32") return undefined;
  const result = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  if (result.error || result.status !== 0) return undefined;
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .find((line) => line.startsWith("n"))
    ?.slice(1);
};

const normalizePath = (value: string): string => {
  let resolved = path.resolve(value);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // The process may exit between discovery and checking its working directory.
  }
  resolved = resolved.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const normalizeCommand = (value: string): string =>
  value.replace(/\\/g, "/").toLowerCase();

const isViteCommand = (command: string): boolean =>
  /(?:^|[\\/\s])vite(?:\.(?:m?js|cjs|cmd))?(?:$|[\\/\s])/i.test(command);

const isProjectViteProcess = (pid: number, projectRoot: string): boolean => {
  const command = getProcessCommand(pid);
  if (!command || !isViteCommand(command)) return false;

  if (process.platform === "win32") {
    return normalizeCommand(command).includes(normalizePath(projectRoot));
  }

  const cwd = getProcessWorkingDirectory(pid);
  return Boolean(cwd && normalizePath(cwd) === normalizePath(projectRoot));
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const waitForExit = async (pid: number): Promise<boolean> => {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
};

const signalProcess = (pid: number, force: boolean): void => {
  if (process.platform === "win32") {
    run("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])]);
    return;
  }

  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // The Vite process may exit between the port check and the signal.
  }
};

/** Stop only a Vite listener owned by this project before the orchestrator restarts it. */
export async function stopExistingProjectVite(
  projectRoot = process.cwd(),
  log: (message: string) => void = console.log,
): Promise<void> {
  const listeningPids = getListeningPids(VITE_PORT);
  if (listeningPids.length === 0) return;

  let stoppedAny = false;
  for (const pid of listeningPids) {
    if (!isProjectViteProcess(pid, projectRoot)) {
      log(`[Build] Leaving port ${VITE_PORT} listener PID ${pid} untouched; it is not this project's Vite server.`);
      continue;
    }

    log(`[Build] Stopping the previous N-APT Vite server (PID ${pid}) before restart...`);
    signalProcess(pid, false);
    if (!(await waitForExit(pid)) && isProjectViteProcess(pid, projectRoot)) {
      signalProcess(pid, true);
      if (!(await waitForExit(pid))) {
        log(`[Build] Could not stop the previous N-APT Vite server (PID ${pid}).`);
        continue;
      }
    }
    stoppedAny = true;
  }

  if (stoppedAny) {
    // Let the OS release the listener before Vite binds with strictPort enabled.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
