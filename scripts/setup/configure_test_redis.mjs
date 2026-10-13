#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { createClient } from "redis";
import { renderRedisAcl } from "./redis_auth_config.mjs";

const host = process.env.REDIS_TEST_HOST || "127.0.0.1";
const port = Number(process.env.REDIS_TEST_PORT || 6379);
const appPassword = randomBytes(32).toString("hex");
const operatorPassword = randomBytes(32).toString("hex");
const aclLines = renderRedisAcl({
  appUsername: "napt-app",
  appPassword,
  operatorPassword,
}).split("\n").filter(Boolean);

function userCommand(line) {
  const [, username, state, ...permissions] = line.split(/\s+/);
  return ["ACL", "SETUSER", username, "reset", state, ...permissions];
}

async function verifyUnauthenticatedDenied() {
  const socket = net.createConnection({ host, port });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
      socket.setTimeout(2000, () => reject(new Error("Redis auth probe timed out")));
    });
    const reply = new Promise((resolve, reject) => {
      socket.once("data", (data) => resolve(data.toString("utf8")));
      socket.once("error", reject);
      socket.setTimeout(2000, () => reject(new Error("Redis auth probe timed out")));
    });
    socket.write("*1\r\n$4\r\nPING\r\n");
    const response = await reply;
    if (!/NOAUTH|Authentication required/i.test(response)) {
      throw new Error("Redis still accepts unauthenticated commands");
    }
  } finally {
    socket.destroy();
  }
}

async function main() {
  let client;
  let connected = false;
  for (let attempt = 0; attempt < 60 && !connected; attempt += 1) {
    client = createClient({
      url: `redis://${host}:${port}`,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    client.on("error", () => {});
    try {
      await client.connect();
      connected = true;
    } catch {
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!connected) throw new Error("Redis did not become ready for authenticated setup");
  try {
    // Install both users first, verify their credentials, then disable default.
    for (const line of aclLines.filter((entry) => !entry.startsWith("user default "))) {
      await client.sendCommand(userCommand(line));
    }
  } finally {
    await client.quit();
  }

  const appUrl = `redis://napt-app:${appPassword}@${host}:${port}/0`;
  const operatorUrl = `redis://napt-operator:${operatorPassword}@${host}:${port}/0`;
  const app = createClient({ url: appUrl });
  const operator = createClient({ url: operatorUrl });
  app.on("error", () => {});
  operator.on("error", () => {});
  await Promise.all([app.connect(), operator.connect()]);
  try {
    if (await app.ping() !== "PONG" || await operator.ping() !== "PONG") {
      throw new Error("Authenticated Redis probes failed");
    }
    await app.select(1);
    await app.set("capture-protection:ci-auth-probe", "probe");
    if (await app.get("capture-protection:ci-auth-probe") !== "probe") {
      throw new Error("Redis app ACL data probe failed");
    }
    await app.del("capture-protection:ci-auth-probe");
    if (await operator.sendCommand(["ACL", "WHOAMI"]) !== "napt-operator") {
      throw new Error("Redis operator ACL probe failed");
    }
  } finally {
    await Promise.all([app.quit(), operator.quit()]);
  }

  const defaultClient = createClient({ url: `redis://${host}:${port}` });
  defaultClient.on("error", () => {});
  await defaultClient.connect();
  try {
    await defaultClient.sendCommand(["ACL", "SETUSER", "default", "off"]);
  } finally {
    await defaultClient.destroy();
  }
  await verifyUnauthenticatedDenied();

  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    fs.appendFileSync(githubEnv, `REDIS_URL=${appUrl}\nREDIS_ADMIN_URL=${operatorUrl}\n`, { mode: 0o600 });
  } else {
    process.env.REDIS_URL = appUrl;
    process.env.REDIS_ADMIN_URL = operatorUrl;
  }
  console.log("Redis ACL configured; authenticated app/operator probes passed and default access is disabled.");
}

main().catch(() => {
  console.error("Redis ACL test setup failed; the unauthenticated default account was not intentionally disabled.");
  process.exitCode = 1;
});
