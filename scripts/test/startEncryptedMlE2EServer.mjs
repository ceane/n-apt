import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const backendBinary = process.env.NAPT_E2E_BACKEND_BINARY;
const encryptedModulesRoot = path.join(root, "src/encrypted-modules");
const extractionRoot = path.join(encryptedModulesRoot, "tmp");
let backupRoot;
let backupExtractionRoot;
let stopping = false;
let shutdownPromise;

if (!backendBinary) {
  console.error("Encrypted ML E2E server is missing its local backend binary path.");
  process.exit(1);
}

const trackedSources = spawnSync(
  "git",
  ["ls-files", "--", "src/encrypted-modules/tmp"],
  { cwd: root, encoding: "utf8" },
);
if (trackedSources.error || trackedSources.status !== 0) {
  console.error("Could not verify that extracted encrypted module sources are untracked.");
  process.exit(trackedSources.status ?? 1);
}
if (trackedSources.stdout.trim()) {
  console.error(
    "Refusing the consumer E2E because encrypted module extraction paths are tracked.",
  );
  process.exit(1);
}

if (existsSync(extractionRoot)) {
  backupRoot = mkdtempSync(
    path.join(encryptedModulesRoot, ".e2e-preserve-modules-"),
  );
  backupExtractionRoot = path.join(backupRoot, "tmp");
  renameSync(extractionRoot, backupExtractionRoot);
}

function restoreExtraction() {
  rmSync(extractionRoot, { recursive: true, force: true });
  if (backupExtractionRoot && existsSync(backupExtractionRoot)) {
    renameSync(backupExtractionRoot, extractionRoot);
  }
  if (backupRoot) rmSync(backupRoot, { recursive: true, force: true });
}

const decrypt = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "scripts/encrypted-modules/crypt.ts",
    "decrypt-if-needed",
    "--require-ml",
  ],
  { cwd: root, stdio: "inherit", env: process.env },
);
if (decrypt.error || decrypt.status !== 0) {
  restoreExtraction();
  if (decrypt.error) console.error(decrypt.error.message);
  process.exit(decrypt.status ?? 1);
}

const runtimeEnv = { ...process.env };
delete runtimeEnv.UNSAFE_LOCAL_LATEX_PASSWORD;
delete runtimeEnv.UNSAFE_LOCAL_DEMOD_PASSWORD;

const backend = spawn(backendBinary, [], {
  cwd: root,
  stdio: "inherit",
  env: runtimeEnv,
});
const vite = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "--port",
    "5183",
    "--host",
    "127.0.0.1",
  ],
  { cwd: root, stdio: "inherit", env: runtimeEnv },
);
const children = [backend, vite];

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    waitForExit(child),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      timer.unref();
    }),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function shutdown(exitCode) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    await Promise.all(children.map(stopChild));
    restoreExtraction();
    process.exitCode = exitCode;
  })();
  return shutdownPromise;
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(`Encrypted ML E2E server process failed: ${error.message}`);
    void shutdown(1);
  });
  child.once("exit", (code) => {
    if (!stopping) void shutdown(code ?? 1);
  });
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
