import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "redis";
import test from "node:test";
import { ensureRedisAuthConfig } from "../../scripts/setup/redis_auth_config.mjs";
import {
  buildSaltFingerprint,
  capturePreAuthRedisState,
  saltFingerprintsMatch,
  verifyPendingSaltFingerprint,
} from "../../scripts/setup/preserve_redis_salts.mjs";

test("salt fingerprints retain only keys and value hashes in stable order", () => {
  const fingerprint = buildSaltFingerprint([
    ["capture-protection:z", "secret-z"],
    ["capture-protection:a", "secret-a"],
  ]);

  assert.equal(fingerprint.count, 2);
  assert.deepEqual(fingerprint.records.map(({ key }) => key), ["capture-protection:a", "capture-protection:z"]);
  assert.ok(fingerprint.records.every(({ valueSha256 }) => /^[a-f0-9]{64}$/.test(valueSha256)));
  assert.doesNotMatch(JSON.stringify(fingerprint), /secret-[az]/);
});

test("fingerprint comparison detects missing, replaced, and additional salts", () => {
  const before = buildSaltFingerprint([["capture-protection:a", "same"]]);
  const same = buildSaltFingerprint([["capture-protection:a", "same"]]);
  const replaced = buildSaltFingerprint([["capture-protection:a", "different"]]);
  const added = buildSaltFingerprint([
    ["capture-protection:a", "same"],
    ["capture-protection:b", "new"],
  ]);

  assert.equal(saltFingerprintsMatch(before, same), true);
  assert.equal(saltFingerprintsMatch(before, replaced), false);
  assert.equal(saltFingerprintsMatch(before, buildSaltFingerprint([])), false);
  assert.equal(saltFingerprintsMatch(before, added), false);
});

test("pre-auth backup and post-ACL verification preserve DB 1 salt values", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "napt-salt-migration-"));
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const saltKey = "capture-protection:integration-migration";
  const saltValue = "ab".repeat(32);
  const stateFile = path.join(directory, "salt-fingerprint.pending.json");
  let server;

  async function startRedis(extraArgs = [], redisUrl = `redis://127.0.0.1:${port}`) {
    server = spawn("redis-server", [
      "--port", String(port), "--bind", "127.0.0.1", "--protected-mode", "yes",
      "--dir", directory, "--dbfilename", "dump.rdb", "--save", "", "--appendonly", "no",
      "--daemonize", "no", ...extraArgs,
    ], { stdio: "ignore" });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Disposable Redis exited with code ${server.exitCode}`);
      const client = createClient({ url: redisUrl, socket: { connectTimeout: 100 } });
      client.on("error", () => {});
      try {
        await client.connect();
        await client.ping();
        await client.quit();
        return;
      } catch {
        client.destroy();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    throw new Error("Disposable Redis did not become ready");
  }

  async function stopRedis() {
    if (!server || server.exitCode !== null) return;
    const exited = once(server, "exit").catch(() => {});
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
  }

  context.after(async () => {
    await stopRedis();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await startRedis();
  const preAuthClient = createClient({ url: `redis://127.0.0.1:${port}` });
  preAuthClient.on("error", () => {});
  await preAuthClient.connect();
  await preAuthClient.select(1);
  await preAuthClient.set(saltKey, saltValue);
  await preAuthClient.quit();

  const state = await capturePreAuthRedisState({
    projectRoot: directory,
    redisUrl: `redis://127.0.0.1:${port}/0`,
    stateFile,
  });
  assert.equal(state.saltFingerprint.count, 1);
  assert.ok(state.backupFile, "pre-auth backup path should be recorded");
  assert.equal(fs.statSync(state.backupFile).mode & 0o777, 0o600, "backup must be owner-only");

  await stopRedis();
  const appPassword = "cd".repeat(32);
  const operatorPassword = "ef".repeat(32);
  const configured = ensureRedisAuthConfig({
    envText: `REDIS_URL=redis://napt-app:${appPassword}@127.0.0.1:${port}/0\nREDIS_ADMIN_URL=redis://napt-operator:${operatorPassword}@127.0.0.1:${port}/0\n`,
  });
  const aclPath = path.join(directory, "users.acl");
  fs.writeFileSync(aclPath, configured.aclText, { mode: 0o600 });
  const appUrl = configured.envText.match(/^REDIS_URL=(.+)$/m)[1];
  await startRedis(["--aclfile", aclPath], appUrl);

  assert.deepEqual(await verifyPendingSaltFingerprint({ redisUrl: appUrl, stateFile }), { pending: true, matched: true });
  const authenticatedClient = createClient({ url: appUrl });
  authenticatedClient.on("error", () => {});
  await authenticatedClient.connect();
  try {
    await authenticatedClient.select(1);
    assert.equal(await authenticatedClient.get(saltKey), saltValue);
  } finally {
    await authenticatedClient.quit();
  }
});
