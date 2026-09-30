import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { createClient } from "redis";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { encodeIqCaptureV4 } from "../../src/ts/webusb/iqCaptureFormat.ts";
import {
  decryptIqCapturePayload,
  encryptIqCaptureBytes,
  inspectIqCapture,
} from "../../scripts/encrypt_iq_capture.mjs";
import {
  deriveCaptureProtectionKey,
  getOrCreateCaptureProtectionSalt,
  loadCaptureProtectionSalt,
} from "../../scripts/classifier/crypto.mjs";

const REDIS_SERVER_START_TIMEOUT_MS = 5_000;

function makeV6Capture() {
  return encodeIqCaptureV4({
    metadata: {
      center_frequency_hz: 1_618_000,
      capture_sample_rate_hz: 3_200_000,
      fft_size: 4,
      fft_window: "rectangular",
    },
    frameUpdates: [{
      sample_offset: 0,
      timestamp_us: 1_790_000_000_000_000,
      kind: "Frame",
      frame_sequence: 0,
      patch: {
        center_frequency_hz: 1_618_000,
        capture_sample_rate_hz: 3_200_000,
        fft_size: 4,
        fft_window: "rectangular",
      },
    }],
    chunks: [{
      sample_offset: 0,
      channel: 0,
      data: Uint8Array.from([128, 130, 127, 126, 127, 129, 128, 127]),
    }],
  });
}

async function startRedis(directory, name) {
  const socketPath = path.join(directory, `${name}.sock`);
  const dataDirectory = path.join(directory, `${name}-data`);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const child = spawn("redis-server", [
    "--port", "0",
    "--unixsocket", socketPath,
    "--unixsocketperm", "700",
    "--dir", dataDirectory,
    "--dbfilename", "dump.rdb",
    "--save", "",
    "--appendonly", "no",
    "--protected-mode", "no",
    "--daemonize", "no",
    "--loglevel", "warning",
  ], { stdio: "ignore" });
  let spawnError;
  child.once("error", (error) => { spawnError = error; });

  const clientFactory = () => createClient({ socket: { path: socketPath } });
  const deadline = Date.now() + REDIS_SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      child.kill("SIGTERM");
      if (spawnError.code === "ENOENT") {
        throw Object.assign(
          new Error("Could not start the disposable Redis server; install redis-server to run this recovery proof"),
          { code: "REDIS_SERVER_MISSING" },
        );
      }
      throw new Error("Could not start the disposable Redis server");
    }
    if (child.exitCode !== null) throw new Error("The disposable Redis server exited during startup");
    try {
      const client = clientFactory();
      client.on("error", () => {});
      await client.connect();
      await client.ping();
      await client.quit();
      return {
        child,
        clientFactory,
        socketPath,
        dataDirectory,
        async close() {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
            await Promise.race([
              new Promise((resolve) => child.once("exit", resolve)),
              delay(2_000),
            ]);
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          }
        },
      };
    } catch {
      await delay(25);
    }
  }
  child.kill("SIGKILL");
  throw new Error("The disposable Redis server did not become ready in time");
}

async function withRedisClient(server, callback) {
  const client = server.clientFactory();
  client.on("error", () => {});
  await client.connect();
  try {
    await client.select(1);
    return await callback(client);
  } finally {
    if (client.isOpen) await client.quit();
  }
}

test("Redis backup restores a missing per-capture salt and decrypts the V6 capture", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "napt-capture-salt-backup-"));
  const active = await startRedis(directory, "active").catch((error) => {
    if (error.code !== "REDIS_SERVER_MISSING") throw error;
    t.skip(error.message);
    return null;
  });
  if (!active) {
    await rm(directory, { recursive: true, force: true });
    return;
  }
  let empty;
  let restored;
  try {
    empty = await startRedis(directory, "empty");
    const captureId = "b".repeat(64);
    const redisKey = `capture-protection:${captureId}`;
    const env = { REDIS_URL: "redis://disposable-test-redis" };
    const redisOptions = { env, envFile: null, clientFactory: active.clientFactory };
    const salt = await getOrCreateCaptureProtectionSalt(captureId, redisOptions);
    assert.equal(salt.length, 32, "test setup creates one 256-bit per-capture salt");

    const vaultKey = Buffer.alloc(32, 0x52);
    const captureKey = deriveCaptureProtectionKey(vaultKey, salt);
    const plaintextCapture = await makeV6Capture();
    const plain = inspectIqCapture(plaintextCapture);
    assert.equal(plain.formatVersion, 6, "fixture exercises the current V6 I/Q container");
    const encryptedCapture = encryptIqCaptureBytes(plaintextCapture, captureKey);
    const encrypted = inspectIqCapture(encryptedCapture, { allowEncrypted: true });
    const sourceFrameSection = plain.frames;
    const encryptedFrameSection = encrypted.frames;
    assert.ok(encryptedFrameSection.equals(sourceFrameSection), "encryption preserves frame bytes and offsets");

    // Save the actual Redis DB containing the salt, then copy that snapshot as a backup artifact.
    await withRedisClient(active, async (client) => {
      const stored = await client.get(redisKey);
      assert.equal(typeof stored, "string", "salt record exists in Redis DB 1 before backup");
      await client.sendCommand(["SAVE"]);
    });
    const backupPath = path.join(directory, "capture-salt-backup.rdb");
    await copyFile(
      path.join(active.dataDirectory, "dump.rdb"),
      backupPath,
    );
    await chmod(backupPath, 0o600);
    const backupStats = await stat(backupPath);
    assert.ok(backupStats.size > 0, "Redis snapshot backup is non-empty");
    assert.equal(backupStats.mode & 0o777, 0o600, "the test backup file is private to its owner");

    // Prove the backup is independent of the live Redis process and can restore a lost record.
    const lossOptions = { env, envFile: null, clientFactory: empty.clientFactory };
    await assert.rejects(
      loadCaptureProtectionSalt(captureId, lossOptions),
      /missing a valid capture-protection salt/i,
      "a clean Redis instance has no implicit copy of the salt",
    );
    await active.close();

    const restoreDataDirectory = path.join(directory, "restored-data");
    await mkdir(restoreDataDirectory, { recursive: true, mode: 0o700 });
    await copyFile(
      backupPath,
      path.join(restoreDataDirectory, "dump.rdb"),
    );
    restored = await startRedis(directory, "restored");
    const restoredSalt = await loadCaptureProtectionSalt(captureId, {
      env,
      envFile: null,
      clientFactory: restored.clientFactory,
    });
    assert.ok(restoredSalt.equals(salt), "restored Redis returns the exact backed-up salt");

    const restoredKey = deriveCaptureProtectionKey(vaultKey, restoredSalt);
    const decryptedPayload = decryptIqCapturePayload(encryptedCapture, restoredKey);
    assert.ok(
      decryptedPayload.equals(plain.payload),
      "the restored salt derives the AES-GCM key that authenticates and decrypts the capture payload",
    );
    const restoredContainer = inspectIqCapture(encryptedCapture, { allowEncrypted: true });
    assert.ok(restoredContainer.frames.equals(plain.frames), "frame update bytes remain intact after salt recovery");
    assert.ok(restoredKey.equals(captureKey), "restored key matches the original encryption key");

    salt.fill(0);
    restoredSalt.fill(0);
    vaultKey.fill(0);
    captureKey.fill(0);
    restoredKey.fill(0);
  } finally {
    await active.close();
    if (empty) await empty.close();
    if (restored) await restored.close();
    await rm(directory, { recursive: true, force: true });
  }
});
