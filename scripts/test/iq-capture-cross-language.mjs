import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "napt-iq-cross-language-"));
const backendCapture = path.join(temporaryDirectory, "backend.iq");
const captureStorage = path.join(temporaryDirectory, "capture-storage");
const captureDownloads = path.join(temporaryDirectory, "capture-downloads");
const captureBackup = path.join(temporaryDirectory, "capture-backup");

const run = (command, args, env) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status === 0;
};

try {
  const wroteBackendFile = run("cargo", [
    "test",
    "--test",
    "iq_capture_format_acceptance",
    "backend_iq_v6_writes_shared_cross_language_playback_fixture",
    "--",
    "--exact",
  ], {
    NAPT_IQ_CROSS_LANGUAGE_FIXTURE: backendCapture,
    N_APT_CAPTURE_STORAGE_PATH: captureStorage,
    N_APT_CAPTURE_DOWNLOADS_PATH: captureDownloads,
    N_APT_CAPTURE_BACKUP_PATH: captureBackup,
  });
  if (wroteBackendFile) {
    run(process.execPath, ["node_modules/jest/bin/jest.js", "--runInBand", "test/ts/iqCaptureCrossLanguage.test.ts"], {
      NAPT_IQ_CROSS_LANGUAGE_FIXTURE: backendCapture,
    });
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
