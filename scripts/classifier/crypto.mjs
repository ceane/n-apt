import { readFile } from "node:fs/promises";
import {
  createDecipheriv,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { createClient } from "redis";
import {
  decryptIqCapturePayload,
  deriveIqCaptureKey,
  captureAdditionalData,
  verifyContainerChecksum,
} from "../encrypt_iq_capture.mjs";

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function resolveReference(value, values) {
  return value.startsWith("$") ? (values[value.slice(1)] ?? value) : value;
}

function deriveRedisUrl(envFileValues, env) {
  const raw = env.REDIS_URL ?? envFileValues.REDIS_URL;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      "Set REDIS_URL in the shell environment or selected env file for Redis-backed capture salts",
    );
  }
  return resolveReference(raw.trim(), { ...envFileValues, ...env });
}

async function connectRedis({
  envFile = ".env.local",
  env = process.env,
  clientFactory = createClient,
} = {}) {
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
    throw new Error(
      "Capture protection requires a 64-character V6 capture checksum",
    );
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

const VAULT_RECOVERY_FORMAT = "n-apt-vault-key-wrapper-v1";
const VAULT_RECOVERY_KDF_ITERATIONS = 600_000;
const vaultRecoveryCache = new Map();

process.once("exit", () => {
  for (const key of vaultRecoveryCache.values()) key.fill(0);
  vaultRecoveryCache.clear();
});

/** Derive a FIDO-vault recovery key from the same local credential used today. */
export function deriveVaultRecoveryKey(recoveryCredential, salt) {
  if (typeof recoveryCredential !== "string" || !recoveryCredential.trim()) {
    throw new Error("Vault recovery credential must not be empty");
  }
  if (!(salt instanceof Uint8Array) || salt.byteLength !== 32) {
    throw new Error("Vault recovery salt must contain exactly 32 bytes");
  }
  return pbkdf2Sync(
    recoveryCredential.trim(),
    salt,
    VAULT_RECOVERY_KDF_ITERATIONS,
    32,
    "sha256",
  );
}

/** Unwrap the vault key once for an offline batch; this does not use WebAuthn or Redis. */
export async function unwrapVaultRecoveryWrapper(wrapper, options = {}) {
  if (wrapper?.format !== VAULT_RECOVERY_FORMAT) {
    throw new Error("Unsupported FIDO vault recovery wrapper format");
  }
  const salt = decodeWrapperBase64(wrapper.salt, "salt");
  const nonce = decodeWrapperBase64(wrapper.nonce, "nonce");
  const ciphertext = decodeWrapperBase64(wrapper.ciphertext, "ciphertext");
  if (salt.length !== 32 || nonce.length !== 12 || ciphertext.length !== 48) {
    throw new Error("FIDO vault recovery wrapper has invalid field lengths");
  }
  const cacheId = `${wrapper.salt}.${wrapper.nonce}.${wrapper.ciphertext}`;
  const cachedKey = vaultRecoveryCache.get(cacheId);
  if (cachedKey) return Buffer.from(cachedKey);
  const recoveryCredential = await loadRecoveryCredential(options);
  const recoveryKey = deriveVaultRecoveryKey(recoveryCredential, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", recoveryKey, nonce);
    decipher.setAAD(Buffer.from(VAULT_RECOVERY_FORMAT));
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plaintext = Buffer.concat([
      decipher.update(ciphertext.subarray(0, -16)),
      decipher.final(),
    ]);
    if (plaintext.length !== 32) {
      plaintext.fill(0);
      throw new Error("Unwrapped FIDO vault key has an invalid length");
    }
    if (vaultRecoveryCache.size >= 4) {
      const oldestId = vaultRecoveryCache.keys().next().value;
      const oldestKey = vaultRecoveryCache.get(oldestId);
      oldestKey?.fill(0);
      vaultRecoveryCache.delete(oldestId);
    }
    vaultRecoveryCache.set(cacheId, Buffer.from(plaintext));
    return plaintext;
  } catch (error) {
    throw new Error(`Could not unwrap FIDO vault key: ${error.message}`);
  } finally {
    recoveryKey.fill(0);
    salt.fill(0);
  }
}

function decodeWrapperBase64(value, field) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error(`FIDO vault recovery wrapper has invalid ${field}`);
  }
  return Buffer.from(value, "base64");
}

async function loadRecoveryCredential({
  envFile = ".env.local",
  env = process.env,
} = {}) {
  let fileValues = {};
  if (envFile) {
    try {
      fileValues = parseEnv(await readFile(envFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const values = { ...fileValues, ...env };
  const raw =
    env.UNSAFE_LOCAL_USER_PASSWORD ??
    env.N_APT_PASSKEY ??
    env.VITE_UNSAFE_LOCAL_USER_PASSWORD ??
    fileValues.UNSAFE_LOCAL_USER_PASSWORD ??
    fileValues.N_APT_PASSKEY ??
    fileValues.NAPT_LEGACY_CAPTURE_PASSWORD ??
    fileValues.VITE_UNSAFE_LOCAL_USER_PASSWORD;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      "Set the local capture recovery credential in the shell environment or env file",
    );
  }
  const credential = resolveReference(raw.trim(), values).trim();
  if (!credential) throw new Error("Vault recovery credential is empty");
  return credential;
}

/** Derives the same per-capture AES-256 key as the Rust backend. */
export function deriveCaptureProtectionKey(vaultKey, salt) {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.byteLength !== 32)
    throw new Error("Vault key must be 32 bytes");
  if (!(salt instanceof Uint8Array) || salt.byteLength !== 32)
    throw new Error("Capture salt must be 32 bytes");
  const prk = createHmac("sha256", salt).update(vaultKey).digest();
  return createHmac("sha256", prk)
    .update(
      Buffer.concat([
        Buffer.from("n-apt/capture-protection/v1"),
        Buffer.from([1]),
      ]),
    )
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
export async function getOrCreateCaptureProtectionSalt(
  captureId,
  options = {},
) {
  validateCaptureId(captureId);
  const client = await connectRedis(options);
  const key = `capture-protection:${captureId}`;
  try {
    let value = await client.get(key);
    if (value !== null) return parseCaptureProtectionSalt(value);
    const generated = randomBytes(32);
    const created = await client.set(key, generated.toString("hex"), {
      NX: true,
    });
    value = await client.get(key);
    const persisted = parseCaptureProtectionSalt(value);
    if (created === "OK" && !persisted.equals(generated)) {
      throw new Error(
        "Redis capture-protection salt changed during creation; refusing to encrypt with an uncommitted salt",
      );
    }
    return persisted;
  } finally {
    if (client.isOpen) await client.quit();
  }
}

/** Opens classifier IQ payloads using Redis-backed per-capture salts, with legacy-key fallback. */
export async function decryptArchivedIqPayload({
  captureBytes,
  archive,
  metadata,
  envFile = ".env.local",
  env = process.env,
  clientFactory,
} = {}) {
  if (
    archive?.encryption === "AES-256-GCM-FIDO-VAULT-V1" ||
    metadata?.encryption === "AES-256-GCM-FIDO-VAULT-V1"
  ) {
    const vaultKey = await unwrapVaultRecoveryWrapper(
      archive?.vaultKeyRecovery ?? metadata?.vault_key_recovery,
      { envFile, env },
    );
    try {
      return decryptIqCapturePayload(captureBytes, vaultKey);
    } finally {
      vaultKey.fill(0);
    }
  }
  const vaultKey = await loadIqCaptureKey({ envFile, env });
  try {
    if (archive?.encryption !== "AES-256-GCM-REDIS-SALT-V1") {
      return decryptIqCapturePayload(captureBytes, vaultKey);
    }
    const captureId = archive.sourceCaptureId;
    if (
      !/^[a-f0-9]{64}$/i.test(captureId ?? "") ||
      archive.saltKey !== `capture-protection:${captureId}`
    ) {
      throw new Error(
        "Protected classifier archive has invalid Redis salt-key metadata",
      );
    }
    const salt = await loadCaptureProtectionSalt(captureId, {
      envFile,
      env,
      clientFactory,
    });
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

/** Opens an encrypted V6 .napt payload whose wrapped DEK is protected by the FIDO vault key. */
export async function decryptFidoVaultNaptPayload({
  captureBytes,
  metadata,
  envFile = ".env.local",
  env = process.env,
} = {}) {
  if (metadata?.encryption !== "AES-256-GCM-FIDO-VAULT-V1") {
    throw new Error("Capture is not marked as FIDO vault encrypted");
  }
  const section = metadata?.sections?.binary;
  const offset = section?.offset_bytes;
  const length = section?.length_bytes;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 28 ||
    offset + length > captureBytes?.length
  ) {
    throw new Error(
      "FIDO vault .napt capture has an invalid encrypted payload range",
    );
  }
  verifyContainerChecksum(captureBytes, metadata);
  const wrappedDek = decodeWrapperBase64(metadata.wrapped_dek, "wrapped DEK");
  const vaultKey = await unwrapVaultRecoveryWrapper(
    metadata.vault_key_recovery,
    { envFile, env },
  );
  let dek;
  try {
    dek = decryptAesGcm(vaultKey, wrappedDek);
    if (dek.length !== 32)
      throw new Error("Unwrapped .napt data key has an invalid length");
    return decryptAesGcm(
      dek,
      captureBytes.subarray(offset, offset + length),
      metadata.payload_authentication === "public-sections-v1"
        ? captureAdditionalData(captureBytes, offset, length)
        : undefined,
    );
  } finally {
    vaultKey.fill(0);
    dek?.fill(0);
    wrappedDek.fill(0);
  }
}

function decryptAesGcm(key, payload, aad) {
  if (
    !(key instanceof Uint8Array) ||
    key.byteLength !== 32 ||
    payload.byteLength < 28
  ) {
    throw new Error("AES-GCM payload has invalid key or ciphertext length");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    payload.subarray(0, 12),
  );
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([
    decipher.update(payload.subarray(12, payload.length - 16)),
    decipher.final(),
  ]);
}

/** Loads a local capture key without printing or accepting the passkey as an argument. */
export async function loadIqCaptureKey({
  envFile = ".env.local",
  env = process.env,
} = {}) {
  let fileValues = {};
  if (envFile) {
    try {
      fileValues = parseEnv(await readFile(envFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const values = { ...fileValues, ...env };
  const passkey = await loadRecoveryCredential({ envFile, env });
  const salt =
    env.NAPT_PBKDF2_SALT ??
    env.VITE_PBKDF2_SALT ??
    fileValues.NAPT_PBKDF2_SALT ??
    fileValues.VITE_PBKDF2_SALT ??
    "n-apt-aes-salt-v1";
  if (!passkey || !salt)
    throw new Error("Capture key configuration is incomplete");
  return deriveIqCaptureKey(passkey, salt);
}
