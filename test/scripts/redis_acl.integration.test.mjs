import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "redis";
import { ensureRedisAuthConfig } from "../../scripts/setup/redis_auth_config.mjs";

let credentialSeed = 0x5a;
const randomBytes = (size) => Buffer.alloc(size, ++credentialSeed);
const require = createRequire(import.meta.url);
const { promoteTowerStaging } = require("../../scripts/redis/promote_tower_staging.cjs");

function urlCredentials(urlText) {
  const url = new URL(urlText);
  return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}

test("Redis ACL requires authentication and restricts the app account", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "napt-redis-acl-"));
  const socketPath = path.join(directory, "redis.sock");
  const aclPath = path.join(directory, "users.acl");
  const configured = ensureRedisAuthConfig({ envText: "", randomBytes });
  fs.writeFileSync(aclPath, configured.aclText, { mode: 0o600 });
  const server = spawn("redis-server", [
    "--port", "0",
    "--unixsocket", socketPath,
    "--dir", directory,
    "--aclfile", aclPath,
    "--daemonize", "no",
    "--appendonly", "no",
    "--save", "",
  ], { stdio: "ignore" });
  let spawnError;
  server.once("error", (error) => { spawnError = error; });
  context.after(async () => {
    for (const client of [app, operator].filter(Boolean)) client.destroy();
    if (server.exitCode === null) {
      const exited = once(server, "exit").catch(() => {});
      server.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let app;
  let operator;
  const appCredentials = urlCredentials(new URL(configured.envText.match(/^REDIS_URL=(.+)$/m)[1]).toString());
  const operatorCredentials = urlCredentials(new URL(configured.envText.match(/^REDIS_ADMIN_URL=(.+)$/m)[1]).toString());
  const connectOptions = (credentials) => ({
    socket: { path: socketPath, connectTimeout: 1000 },
    ...credentials,
  });

  for (let attempt = 0; attempt < 50 && !fs.existsSync(socketPath); attempt += 1) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`Disposable redis-server exited with code ${server.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(fs.existsSync(socketPath), "disposable redis-server should create its Unix socket");
  app = createClient(connectOptions(appCredentials));
  app.on("error", () => {});
  await app.connect();

  const rawUnauthenticatedSocket = net.createConnection(socketPath);
  await once(rawUnauthenticatedSocket, "connect");
  const unauthenticatedReply = new Promise((resolve, reject) => {
    rawUnauthenticatedSocket.once("data", (data) => resolve(data.toString("utf8")));
    rawUnauthenticatedSocket.once("error", reject);
    setTimeout(() => reject(new Error("Unauthenticated Redis probe timed out")), 1000).unref();
  });
  rawUnauthenticatedSocket.write("*1\r\n$4\r\nPING\r\n");
  assert.match(await unauthenticatedReply, /NOAUTH|Authentication required/i);
  rawUnauthenticatedSocket.destroy();

  await app.select(1);
  await app.set("capture-protection:integration-test", "preserved-salt");
  assert.equal(await app.get("capture-protection:integration-test"), "preserved-salt");
  await assert.rejects(app.get("unrelated:secret"), /NOPERM|without permission/i);
  await assert.rejects(app.flushDb(), /NOPERM|without permission/i);
  await assert.rejects(app.sendCommand(["SWAPDB", "5", "2"]), /NOPERM|without permission/i);

  operator = createClient(connectOptions(operatorCredentials));
  operator.on("error", () => {});
  await operator.connect();
  assert.equal(await operator.ping(), "PONG");
  await operator.select(5);
  await operator.set("tower:staged-fast", "fast");
  await operator.select(6);
  await operator.set("tower:staged-full", "full");
  const markerDirectory = path.join(directory, ".n-apt", "redis");
  fs.mkdirSync(markerDirectory, { recursive: true });
  fs.writeFileSync(path.join(markerDirectory, "tower-staging-ready.json"), JSON.stringify({
    fastKeyCount: 1,
    fullKeyCount: 1,
  }));
  await promoteTowerStaging({
    projectRoot: directory,
    redisUrl: configured.envText.match(/^REDIS_ADMIN_URL=(.+)$/m)[1],
    clientFactory: () => createClient(connectOptions(operatorCredentials)),
  });
  assert.equal(await app.get("capture-protection:integration-test"), "preserved-salt");
  await operator.select(2);
  assert.equal(await operator.get("tower:staged-fast"), "fast");
  await operator.select(3);
  assert.equal(await operator.get("tower:staged-full"), "full");
});
