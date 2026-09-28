import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "napt-iq-cross-language-"));
const backendCapture = path.join(temporaryDirectory, "backend.iq");

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
  ], { NAPT_IQ_CROSS_LANGUAGE_FIXTURE: backendCapture });
  if (wroteBackendFile) {
    run(process.execPath, ["node_modules/jest/bin/jest.js", "--runInBand", "test/ts/iqCaptureCrossLanguage.test.ts"], {
      NAPT_IQ_CROSS_LANGUAGE_FIXTURE: backendCapture,
    });
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
