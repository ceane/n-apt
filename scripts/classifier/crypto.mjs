import { readFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "redis";
import { decryptIqCapturePayload, deriveIqCaptureKey } from "../encrypt_iq_capture.mjs";

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function resolveReference(value, values) {
  return value.startsWith("$") ? values[value.slice(1)] ?? value : value;
}

function deriveRedisUrl(envFileValues, env) {
  const raw = env.REDIS_URL ?? envFileValues.REDIS_URL;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Set REDIS_URL in the shell environment or selected env file for Redis-backed capture salts");
  }
  return resolveReference(raw.trim(), { ...envFileValues, ...env });
}

async function connectRedis({ envFile = ".env.local", env = process.env, clientFactory = createClient } = {}) {
  let fileValues = {};
  if (envFile) {
    try {
      fileValues = parseEnv(await readFile(envFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const client = clientFactory({ url: deriveRedisUrl(fileValues, env) });
  client.on?.("error", () => {});
  await client.connect();
  await client.select(1);
  return client;
}

function validateCaptureId(captureId) {
  if (typeof captureId !== "string" || !/^[a-f0-9]{64}$/i.test(captureId)) {
    throw new Error("Capture protection requires a 64-character V6 capture checksum");
  }
}

export function parseCaptureProtectionSalt(value) {
  let normalized = value;
  if (typeof normalized === "string" && normalized.startsWith('"')) {
    try {
      normalized = JSON.parse(normalized);
    } catch {
      normalized = null;
    }
  }
  if (typeof normalized !== "string" || !/^[a-f0-9]{64}$/i.test(normalized)) {
    throw new Error("Redis DB 1 is missing a valid capture-protection salt");
  }
  return Buffer.from(normalized, "hex");
}

/** Derives the same per-capture AES-256 key as the Rust backend. */
export function deriveCaptureProtectionKey(vaultKey, salt) {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.byteLength !== 32) throw new Error("Vault key must be 32 bytes");
  if (!(salt instanceof Uint8Array) || salt.byteLength !== 32) throw new Error("Capture salt must be 32 bytes");
  const prk = createHmac("sha256", salt).update(vaultKey).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from("n-apt/capture-protection/v1"), Buffer.from([1])]))
    .digest();
}

/** Loads a salt without creating one; archive readers must never invent lost key material. */
export async function loadCaptureProtectionSalt(captureId, options = {}) {
  validateCaptureId(captureId);
  const client = await connectRedis(options);
  try {
    const value = await client.get(`capture-protection:${captureId}`);
    return parseCaptureProtectionSalt(value);
  } finally {
    if (client.isOpen) await client.quit();
  }
}

/** Creates or reads the archive salt using Redis SET NX to handle concurrent archivers. */
export async function getOrCreateCaptureProtectionSalt(captureId, options = {}) {
  validateCaptureId(captureId);
  const client = await connectRedis(options);
  const key = `capture-protection:${captureId}`;
  try {
    let value = await client.get(key);
    if (value !== null) return parseCaptureProtectionSalt(value);
    const generated = randomBytes(32);
    const created = await client.set(key, generated.toString("hex"), { NX: true });
    value = await client.get(key);
    const persisted = parseCaptureProtectionSalt(value);
    if (created === "OK" && !persisted.equals(generated)) {
      throw new Error("Redis capture-protection salt changed during creation; refusing to encrypt with an uncommitted salt");
    }
    return persisted;
  } finally {
    if (client.isOpen) await client.quit();
  }
}

/** Opens classifier IQ payloads using Redis-backed per-capture salts, with legacy-key fallback. */
export async function decryptArchivedIqPayload({ captureBytes, archive, envFile = ".env.local", env = process.env, clientFactory } = {}) {
  const vaultKey = await loadIqCaptureKey({ envFile, env });
  try {
    if (archive?.encryption !== "AES-256-GCM-REDIS-SALT-V1") {
      return decryptIqCapturePayload(captureBytes, vaultKey);
    }
    const captureId = archive.sourceCaptureId;
    if (!/^[a-f0-9]{64}$/i.test(captureId ?? "") || archive.saltKey !== `capture-protection:${captureId}`) {
      throw new Error("Protected classifier archive has invalid Redis salt-key metadata");
    }
    const salt = await loadCaptureProtectionSalt(captureId, { envFile, env, clientFactory });
    const captureKey = deriveCaptureProtectionKey(vaultKey, salt);
    salt.fill(0);
    try {
      return decryptIqCapturePayload(captureBytes, captureKey);
    } finally {
      captureKey.fill(0);
    }
  } finally {
    vaultKey.fill(0);
  }
}

/** Loads a local capture key without printing or accepting the passkey as an argument. */
export async function loadIqCaptureKey({ envFile = ".env.local", env = process.env } = {}) {
  let fileValues = {};
  if (envFile) {
    try {
      fileValues = parseEnv(await readFile(envFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const values = { ...fileValues, ...env };
  const rawPasskey = env.UNSAFE_LOCAL_USER_PASSWORD ?? env.N_APT_PASSKEY ??
    env.VITE_UNSAFE_LOCAL_USER_PASSWORD ?? fileValues.UNSAFE_LOCAL_USER_PASSWORD ??
    fileValues.N_APT_PASSKEY ?? fileValues.VITE_UNSAFE_LOCAL_USER_PASSWORD;
  if (typeof rawPasskey !== "string" || !rawPasskey.trim()) {
    throw new Error("Set the capture passkey in the shell environment or the selected env file");
  }
  const passkey = resolveReference(rawPasskey, values).trim();
  const salt = env.NAPT_PBKDF2_SALT ?? env.VITE_PBKDF2_SALT ??
    fileValues.NAPT_PBKDF2_SALT ?? fileValues.VITE_PBKDF2_SALT ?? "n-apt-aes-salt-v1";
  if (!passkey || !salt) throw new Error("Capture key configuration is incomplete");
  return deriveIqCaptureKey(passkey, salt);
}
