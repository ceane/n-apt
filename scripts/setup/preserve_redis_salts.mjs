import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "redis";

const SALT_PATTERN = "capture-protection:*";

export function buildSaltFingerprint(entries) {
  const records = entries
    .map(([key, value]) => ({
      key,
      valueSha256: createHash("sha256").update(String(value)).digest("hex"),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return { count: records.length, records };
}

export function saltFingerprintsMatch(before, after) {
  return before.count === after.count
    && JSON.stringify(before.records) === JSON.stringify(after.records);
}

async function readSaltFingerprint(client) {
  await client.select(1);
  const entries = [];
  for await (const keys of client.scanIterator({ MATCH: SALT_PATTERN, COUNT: 200 })) {
    for (const key of keys) {
      const value = await client.get(key);
      if (value !== null) entries.push([key, value]);
    }
  }
  return buildSaltFingerprint(entries);
}

function hasPersistedRedisFiles(projectRoot) {
  const candidates = [
    ".redis_data/dump.rdb",
    ".redis_data/appendonly.aof",
    "redis/data/dump.rdb",
    "redis/data/appendonly.aof",
  ];
  for (const relative of candidates) {
    try {
      if (fs.statSync(path.join(projectRoot, relative)).size > 0) return true;
    } catch {}
  }
  for (const relative of [".redis_data/appendonlydir", "redis/data/appendonlydir"]) {
    try {
      if (fs.readdirSync(path.join(projectRoot, relative)).length > 0) return true;
    } catch {}
  }
  return false;
}

function writeJsonOwnerOnly(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function redisConfigValue(reply) {
  if (Array.isArray(reply) && reply.length >= 2) return reply[1];
  if (reply && typeof reply === "object") {
    const values = Object.values(reply);
    if (values.length === 1) return values[0];
  }
  throw new Error("Redis CONFIG GET returned an invalid response.");
}

export async function capturePreAuthRedisState({ projectRoot, redisUrl, stateFile }) {
  const pendingStateExists = fs.existsSync(stateFile);
  if (pendingStateExists) return JSON.parse(fs.readFileSync(stateFile, "utf8"));

  const dataExists = hasPersistedRedisFiles(projectRoot);
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 1000 } });
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (error) {
    if (dataExists) {
      throw new Error("Redis data files exist but Redis is not reachable. Start the current Redis instance and rerun npm run setup so salts can be backed up and fingerprinted.");
    }
    const emptyState = {
      version: 1,
      createdAt: new Date().toISOString(),
      saltFingerprint: buildSaltFingerprint([]),
      backupFile: null,
    };
    writeJsonOwnerOnly(stateFile, emptyState);
    return emptyState;
  }

  try {
    const saltFingerprint = await readSaltFingerprint(client);
    try {
      await client.sendCommand(["BGSAVE"]);
    } catch (error) {
      if (!/already in progress|already scheduled/i.test(error.message)) throw error;
    }

    let persistence;
    const deadline = Date.now() + 30000;
    do {
      persistence = await client.info("persistence");
      const running = /(?:^|\n)rdb_bgsave_in_progress:1\r?/m.test(persistence);
      const failed = /(?:^|\n)rdb_last_bgsave_status:err\r?/m.test(persistence);
      if (failed) throw new Error("Redis reported that the pre-authentication backup failed.");
      if (!running && /(?:^|\n)rdb_last_bgsave_status:ok\r?/m.test(persistence)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    if (!/(?:^|\n)rdb_last_bgsave_status:ok\r?/m.test(persistence ?? "")) {
      throw new Error("Timed out waiting for the pre-authentication Redis backup.");
    }

    const directory = redisConfigValue(await client.sendCommand(["CONFIG", "GET", "dir"]));
    const filename = redisConfigValue(await client.sendCommand(["CONFIG", "GET", "dbfilename"]));
    const rdbPath = path.isAbsolute(directory) ? path.join(directory, filename) : path.join(projectRoot, directory, filename);
    if (!fs.existsSync(rdbPath)) throw new Error("Redis completed BGSAVE but its RDB file was not found.");

    const backupDirectory = path.join(projectRoot, ".n-apt", "redis", "backups");
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(backupDirectory, 0o700);
    const backupFile = path.join(backupDirectory, `before-acl-${Date.now()}.rdb`);
    fs.copyFileSync(rdbPath, backupFile, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backupFile, 0o600);

    const state = { version: 1, createdAt: new Date().toISOString(), saltFingerprint, backupFile };
    writeJsonOwnerOnly(stateFile, state);
    return state;
  } finally {
    await client.quit();
  }
}

export async function verifyPendingSaltFingerprint({ redisUrl, stateFile }) {
  if (!fs.existsSync(stateFile)) return { pending: false, matched: true };
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 3000 } });
  client.on("error", () => {});
  await client.connect();
  let current;
  try {
    current = await readSaltFingerprint(client);
  } finally {
    await client.quit();
  }
  if (!saltFingerprintsMatch(state.saltFingerprint, current)) {
    throw new Error("DB 1 capture-protection salts changed during Redis authentication setup. Backend startup is blocked; the protected pre-auth backup was retained.");
  }
  fs.renameSync(stateFile, `${stateFile}.verified`);
  return { pending: true, matched: true };
}
