import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("build orchestrator singleton", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("takes over a stale lock left by a crashed orchestrator", async () => {
    const { acquireBuildOrchestratorLock } = require("../../scripts/build/buildOrchestratorLock");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "n-apt-orchestrator-"));
    temporaryDirectories.push(directory);
    const lockPath = path.join(directory, "orchestrator.lock");
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: 1 }));

    const release = await acquireBuildOrchestratorLock(lockPath, { pid: process.pid });

    expect(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
    release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("waits for the previous orchestrator to exit before replacing its lock", async () => {
    const { acquireBuildOrchestratorLock } = require("../../scripts/build/buildOrchestratorLock");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "n-apt-orchestrator-"));
    temporaryDirectories.push(directory);
    const lockPath = path.join(directory, "orchestrator.lock");
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 12345, startedAt: 1 }));

    let allowPreviousToExit!: () => void;
    const previousExit = new Promise<void>((resolve) => {
      allowPreviousToExit = () => {
        resolve();
      };
    });

    const takeover = acquireBuildOrchestratorLock(
      lockPath,
      { pid: process.pid },
      {
        stopPreviousOrchestrator: async () => previousExit,
      },
    );

    await Promise.resolve();
    expect(fs.readFileSync(lockPath, "utf8")).toContain('"pid":12345');
    allowPreviousToExit();
    const release = await takeover;

    expect(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
    release();
  });
});
