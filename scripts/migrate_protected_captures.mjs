#!/usr/bin/env node

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { link, readFile, writeFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "redis";
import { inspectIqCapture } from "./encrypt_iq_capture.mjs";
import { loadIqCaptureKey, parseCaptureProtectionSalt } from "./classifier/crypto.mjs";

const OLD_MAGIC = Buffer.from("NAPTENC1");
const NEW_MAGIC = Buffer.from("NAPTENC2");
const SALT_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

function redisSaltOrNull(value) {
  if (value === null) return null;
  try {
    return parseCaptureProtectionSalt(value);
  } catch {
    return null;
  }
}

function deriveCaptureKey(vaultKey, salt) {
  const prk = createHmac("sha256", salt).update(vaultKey).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from("n-apt/capture-protection/v1"), Buffer.from([1])]))
    .digest();
}

function assertV6IqCapture(bytes) {
  const parsed = inspectIqCapture(bytes, { allowEncrypted: true });
  if (parsed.metadata.format !== "iq" || parsed.formatVersion !== 6) {
    throw new Error("This migration only accepts V6 IQ captures");
  }
}

function legacyEmbeddedSalt(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 8 + SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH || !bytes.subarray(0, 8).equals(OLD_MAGIC)) {
    throw new Error("Input is not a complete legacy NAPTENC1 envelope");
  }
  return Buffer.from(bytes.subarray(8, 8 + SALT_LENGTH));
}

/** Rewraps an NAPTENC1 V6 IQ file after proving Redis holds its matching salt. */
export function migrateProtectedIqCaptureBytes(input, vaultKey, redisSalt) {
  const legacy = Buffer.from(input);
  const key = Buffer.from(vaultKey);
  const expectedSalt = Buffer.from(redisSalt);
  if (key.length !== 32) throw new Error("Vault key must be 32 bytes");
  if (expectedSalt.length !== SALT_LENGTH) throw new Error("Redis salt must be 32 bytes");
  if (legacy.length < 8 + SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH || !legacy.subarray(0, 8).equals(OLD_MAGIC)) {
    throw new Error("Input is not a complete legacy NAPTENC1 envelope");
  }

  const embeddedSalt = legacy.subarray(8, 8 + SALT_LENGTH);
  if (!embeddedSalt.equals(expectedSalt)) {
    throw new Error("Redis salt does not match the salt embedded in this capture");
  }
  const nonceStart = 8 + SALT_LENGTH;
  const nonce = legacy.subarray(nonceStart, nonceStart + NONCE_LENGTH);
  const encrypted = legacy.subarray(nonceStart + NONCE_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", deriveCaptureKey(key, embeddedSalt), nonce);
  decipher.setAuthTag(encrypted.subarray(-TAG_LENGTH));
  const plaintext = Buffer.concat([
    decipher.update(encrypted.subarray(0, -TAG_LENGTH)),
    decipher.final(),
  ]);
  assertV6IqCapture(plaintext);

  const nextNonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveCaptureKey(key, expectedSalt), nextNonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const migrated = Buffer.concat([NEW_MAGIC, nextNonce, ciphertext]);
  const verify = createDecipheriv("aes-256-gcm", deriveCaptureKey(key, expectedSalt), nextNonce);
  verify.setAuthTag(migrated.subarray(-TAG_LENGTH));
  const roundTrip = Buffer.concat([
    verify.update(migrated.subarray(8 + NONCE_LENGTH, -TAG_LENGTH)),
    verify.final(),
  ]);
  if (!roundTrip.equals(plaintext)) {
    throw new Error("Re-encrypted capture verification failed; source was not changed");
  }
  assertV6IqCapture(roundTrip);
  return migrated;
}

/** Authenticates a legacy file before restoring its missing Redis salt, without overwriting conflicts. */
export async function recoverMissingCaptureSalt({ input, vaultKey, redisClient, jobId, persist = true }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) throw new Error("Invalid job ID");
  const salt = legacyEmbeddedSalt(input);
  const migrated = migrateProtectedIqCaptureBytes(input, vaultKey, salt);
  const key = `capture-protection:${jobId}`;
  if (!persist) return { salt, migrated };
  const result = await redisClient.set(key, salt.toString("hex"), { NX: true });
  if (result !== "OK") {
    const current = redisSaltOrNull(await redisClient.get(key));
    if (!current?.equals(salt)) {
      throw new Error(`Redis already contains a conflicting capture-protection salt for ${jobId}; no Redis value was changed`);
    }
  }
  return { salt, migrated };
}

async function migrateFile({ inputPath, outputPath, jobId, dryRun, restoreMissingRedisRecord, restoreOnly, envFile }) {
  const input = resolve(inputPath);
  const output = resolve(outputPath || `${inputPath}.v2.enc`);
  if (output === input) {
    throw new Error("Migration never replaces the source; choose a separate output path");
  }
  if (!dryRun && !restoreOnly) {
    try {
      await readFile(output);
      throw new Error(`Output already exists: ${output}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) throw new Error("Invalid job ID");
  let redisUrl = process.env.REDIS_URL;
  if (!redisUrl && envFile) {
    try {
      const envText = await readFile(envFile, "utf8");
      const redisLine = envText.match(/^\s*REDIS_URL\s*=\s*(.*?)\s*$/m);
      if (redisLine) redisUrl = redisLine[1].replace(/^(['"])(.*)\1$/, "$2");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!redisUrl) throw new Error("Set REDIS_URL in the shell or env file for the Redis instance containing capture-protection records");

  const client = createClient({ url: redisUrl });
  client.on("error", () => {});
  let redisSalt;
  let migrated;
  let restoredRedisRecord = false;
  const sourceBytes = await readFile(input);
  const vaultKey = await loadIqCaptureKey({ envFile });
  const redisKey = `capture-protection:${jobId}`;
  try {
    await client.connect();
    await client.select(1);
    const storedSalt = await client.get(redisKey);
    const parsedSalt = redisSaltOrNull(storedSalt);
    if (parsedSalt) {
      redisSalt = parsedSalt.toString("hex");
      migrated = migrateProtectedIqCaptureBytes(sourceBytes, vaultKey, parsedSalt);
    } else if (storedSalt === null && restoreMissingRedisRecord) {
      const recovered = await recoverMissingCaptureSalt({ input: sourceBytes, vaultKey, redisClient: client, jobId, persist: !dryRun });
      redisSalt = recovered.salt.toString("hex");
      migrated = recovered.migrated;
      restoredRedisRecord = !dryRun;
    } else {
      throw new Error(`Redis DB 1 is missing a valid capture-protection salt for ${jobId}${restoreMissingRedisRecord ? "" : "; pass --restore-missing-redis-record to authenticate the legacy file and restore its embedded salt"}`);
    }
    if (dryRun && !redisSalt) throw new Error("Validated capture has no salt");
  } finally {
    if (client.isOpen) await client.quit();
  }
  if (dryRun) {
    process.stdout.write(`Validated ${basename(input)} for ${jobId}; no files or Redis records changed.\n`);
    return;
  }
  if (restoreOnly) {
    process.stdout.write(`Validated ${basename(input)} for ${jobId}; Redis salt ${restoredRedisRecord ? "restored" : "already present"}; source file unchanged.\n`);
    return;
  }
  if (output !== input) {
    try {
      await readFile(output);
      throw new Error(`Output already exists: ${output}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, migrated, { flag: "wx", mode: 0o600 });
    const written = await readFile(temporary);
    if (!written.equals(migrated)) throw new Error("Output verification failed; source was not changed");
    await link(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  process.stdout.write(`Migrated ${basename(input)} to NAPTENC2; salt remains in Redis DB 1.\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      "job-id": { type: "string" },
      "env-file": { type: "string", default: ".env.local" },
      "dry-run": { type: "boolean", default: false },
      "restore-missing-redis-record": { type: "boolean", default: false },
      "restore-redis-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(
      "Usage: REDIS_URL=... node scripts/migrate_protected_captures.mjs --input capture.iq.enc --job-id JOB_ID [--output capture.iq.v2.enc] [--dry-run] [--restore-missing-redis-record] [--restore-redis-only]\nThe source is never overwritten; output defaults to <input>.v2.enc. The restore flag validates the legacy file before SET NX in Redis DB 1. Restore-only updates Redis without writing a converted file.\n",
    );
    return;
  }
  if (!values.input || !values["job-id"]) {
    throw new Error("Both --input and --job-id are required");
  }
  if (values["restore-redis-only"] && !values["restore-missing-redis-record"]) {
    throw new Error("--restore-redis-only requires --restore-missing-redis-record");
  }
  await migrateFile({
    inputPath: values.input,
    outputPath: values.output,
    jobId: values["job-id"],
    dryRun: values["dry-run"],
    restoreMissingRedisRecord: values["restore-missing-redis-record"],
    restoreOnly: values["restore-redis-only"],
    envFile: values["env-file"],
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`migrate_protected_captures: ${error.message}\n`);
    process.exitCode = 1;
  });
}
