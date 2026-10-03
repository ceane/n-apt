import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import test from "node:test";

import { migrateProtectedIqCaptureBytes, recoverMissingCaptureSalt } from "../../scripts/migrate_protected_captures.mjs";

function v6Iq() {
  const frames = Buffer.from(JSON.stringify([{ sample_offset: 0, timestamp_us: 1234, frame_sequence: 0, patch: {} }]));
  const payload = Buffer.from([10, 20, 30, 40]);
  const trailerJson = Buffer.from(JSON.stringify({
    integrity: {
      algorithm: "SHA-256",
      scope: "file-with-integrity-digest-placeholder",
      digest: "0".repeat(64),
    },
  }));
  const trailer = Buffer.concat([
    Buffer.from("NAPTTRLR"),
    Buffer.from([2]),
    Buffer.alloc(7),
    Buffer.alloc(8),
    trailerJson,
  ]);
  trailer.writeBigUInt64LE(BigInt(trailerJson.length), 16);
  const metadataValue = {
    format: "iq",
    format_version: 6,
    interleaving: "IQ",
    sections: {
      binary: { offset_bytes: 0, length_bytes: payload.length, encoding: "iq_u8_interleaved", encrypted: false },
      trailer: { offset_bytes: 0, length_bytes: trailer.length, encoding: "utf8_json", version: 2 },
    },
  };
  let metadata = Buffer.alloc(0);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    metadata = Buffer.from(JSON.stringify(metadataValue));
    const binaryOffset = 40 + metadata.length + frames.length;
    const trailerOffset = binaryOffset + payload.length;
    if (metadataValue.sections.binary.offset_bytes === binaryOffset && metadataValue.sections.trailer.offset_bytes === trailerOffset) break;
    metadataValue.sections.binary.offset_bytes = binaryOffset;
    metadataValue.sections.trailer.offset_bytes = trailerOffset;
  }
  metadata = Buffer.from(JSON.stringify(metadataValue));
  const header = Buffer.alloc(40);
  Buffer.from("NAPT-IQ3").copy(header);
  header.writeBigUInt64LE(BigInt(metadata.length), 8);
  header.writeBigUInt64LE(BigInt(frames.length), 16);
  header.writeBigUInt64LE(BigInt(payload.length), 24);
  const trailerHeader = Buffer.concat([trailer.subarray(0, 24), trailerJson]);
  const file = Buffer.concat([header, metadata, frames, payload, trailerHeader]);
  const digest = createHash("sha256").update(file).digest("hex");
  const digestOffset = file.indexOf(Buffer.from("0".repeat(64)));
  assert.notEqual(digestOffset, -1);
  Buffer.from(digest).copy(file, digestOffset);
  return file;
}

function deriveCaptureKey(vaultKey, salt) {
  const prk = createHmac("sha256", salt).update(vaultKey).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from("n-apt/capture-protection/v1"), Buffer.from([1])]))
    .digest();
}

function legacyEnvelope(plaintext, vaultKey, salt) {
  const nonce = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", deriveCaptureKey(vaultKey, salt), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from("NAPTENC1"), salt, nonce, encrypted]);
}

function restampV6(bytes) {
  const stamped = Buffer.from(bytes);
  const metadataLength = Number(stamped.readBigUInt64LE(8));
  const payloadEnd = 40 + metadataLength + Number(stamped.readBigUInt64LE(16)) + Number(stamped.readBigUInt64LE(24));
  const trailerJsonStart = payloadEnd + 24;
  const trailerJsonLength = Number(stamped.readBigUInt64LE(payloadEnd + 16));
  const trailer = JSON.parse(stamped.subarray(trailerJsonStart, trailerJsonStart + trailerJsonLength));
  trailer.integrity.digest = "0".repeat(64);
  const updatedTrailer = Buffer.from(JSON.stringify(trailer));
  const result = Buffer.concat([
    stamped.subarray(0, trailerJsonStart),
    updatedTrailer,
  ]);
  result.writeBigUInt64LE(BigInt(updatedTrailer.length), payloadEnd + 16);
  const digest = createHash("sha256").update(result).digest("hex");
  Buffer.from(digest).copy(result, trailerJsonStart + updatedTrailer.indexOf("0".repeat(64)));
  return result;
}

test("migrates a protected V6 IQ file to a salt-free NAPTENC2 envelope", () => {
  const vaultKey = Buffer.alloc(32, 11);
  const salt = Buffer.alloc(32, 19);
  const original = v6Iq();
  const legacy = legacyEnvelope(original, vaultKey, salt);

  const migrated = migrateProtectedIqCaptureBytes(legacy, vaultKey, salt);

  assert.equal(migrated.subarray(0, 8).toString(), "NAPTENC2");
  assert.equal(migrated.includes(salt), false);
  const nonce = migrated.subarray(8, 20);
  const decipher = createDecipheriv("aes-256-gcm", deriveCaptureKey(vaultKey, salt), nonce);
  decipher.setAuthTag(migrated.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(migrated.subarray(20, -16)), decipher.final()]);
  assert.deepEqual(plaintext, original);
});

test("rejects a Redis salt that does not match the legacy embedded salt", () => {
  const vaultKey = Buffer.alloc(32, 11);
  const legacySalt = Buffer.alloc(32, 19);
  const wrongRedisSalt = Buffer.alloc(32, 20);
  assert.throws(
    () => migrateProtectedIqCaptureBytes(legacyEnvelope(v6Iq(), vaultKey, legacySalt), vaultKey, wrongRedisSalt),
    /Redis salt does not match/i,
  );
});

test("rejects non-V6 IQ captures", () => {
  const vaultKey = Buffer.alloc(32, 11);
  const salt = Buffer.alloc(32, 19);
  const nonV6 = v6Iq();
  const metadataLength = Number(nonV6.readBigUInt64LE(8));
  const metadata = JSON.parse(nonV6.subarray(40, 40 + metadataLength));
  metadata.format_version = 5;
  const updated = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.from(nonV6.subarray(0, 40));
  header.writeBigUInt64LE(BigInt(updated.length), 8);
  const validNonV6 = restampV6(Buffer.concat([header, updated, nonV6.subarray(40 + metadataLength)]));
  assert.throws(
    () => migrateProtectedIqCaptureBytes(legacyEnvelope(validNonV6, vaultKey, salt), vaultKey, salt),
    /V6 IQ/i,
  );
});

test("restores a missing Redis salt only after authenticating and validating the V6 file", async () => {
  const vaultKey = Buffer.alloc(32, 11);
  const salt = Buffer.alloc(32, 19);
  const legacy = legacyEnvelope(v6Iq(), vaultKey, salt);
  const records = new Map();
  const redisClient = {
    async set(key, value, options) {
      assert.deepEqual(options, { NX: true });
      if (records.has(key)) return null;
      records.set(key, value);
      return "OK";
    },
    async get(key) { return records.get(key) ?? null; },
  };

  const recovered = await recoverMissingCaptureSalt({ input: legacy, vaultKey, redisClient, jobId: "capture-test" });

  assert.equal(records.get("capture-protection:capture-test"), salt.toString("hex"));
  assert.equal(recovered.salt.toString("hex"), salt.toString("hex"));
  assert.equal(recovered.migrated.subarray(0, 8).toString(), "NAPTENC2");
});

test("does not restore a salt from an unauthenticated or invalid V6 file", async () => {
  const vaultKey = Buffer.alloc(32, 11);
  const salt = Buffer.alloc(32, 19);
  const tampered = legacyEnvelope(v6Iq(), vaultKey, salt);
  tampered[tampered.length - 1] ^= 1;
  const records = new Map();
  const redisClient = {
    async set(key, value) { records.set(key, value); return "OK"; },
    async get(key) { return records.get(key) ?? null; },
  };

  await assert.rejects(
    recoverMissingCaptureSalt({ input: tampered, vaultKey, redisClient, jobId: "capture-test" }),
  );
  assert.equal(records.size, 0);
});

test("never overwrites a conflicting Redis salt during recovery", async () => {
  const vaultKey = Buffer.alloc(32, 11);
  const salt = Buffer.alloc(32, 19);
  const records = new Map([["capture-protection:capture-test", Buffer.alloc(32, 20).toString("hex")]]);
  const redisClient = {
    async set(key, value) { if (records.has(key)) return null; records.set(key, value); return "OK"; },
    async get(key) { return records.get(key) ?? null; },
  };

  await assert.rejects(
    recoverMissingCaptureSalt({ input: legacyEnvelope(v6Iq(), vaultKey, salt), vaultKey, redisClient, jobId: "capture-test" }),
    /conflicting capture-protection salt/i,
  );
  assert.equal(records.get("capture-protection:capture-test"), Buffer.alloc(32, 20).toString("hex"));
});

test("accepts a matching legacy JSON-encoded Redis salt during recovery", async () => {
  const vaultKey = Buffer.alloc(32, 11);
  const salt = Buffer.alloc(32, 19);
  const key = "capture-protection:capture-test";
  const records = new Map([[key, JSON.stringify(salt.toString("hex"))]]);
  const redisClient = {
    async set() { return null; },
    async get(recordKey) { return records.get(recordKey) ?? null; },
  };

  const recovered = await recoverMissingCaptureSalt({
    input: legacyEnvelope(v6Iq(), vaultKey, salt),
    vaultKey,
    redisClient,
    jobId: "capture-test",
  });

  assert.deepEqual(recovered.salt, salt);
  assert.equal(records.get(key), JSON.stringify(salt.toString("hex")));
});

test("dry-run validation does not write a missing Redis salt", async () => {
  const vaultKey = Buffer.alloc(32, 11);
  const salt = Buffer.alloc(32, 19);
  const records = new Map();
  const redisClient = {
    async set(key, value) { records.set(key, value); return "OK"; },
    async get(key) { return records.get(key) ?? null; },
  };

  await recoverMissingCaptureSalt({ input: legacyEnvelope(v6Iq(), vaultKey, salt), vaultKey, redisClient, jobId: "capture-test", persist: false });
  assert.equal(records.size, 0);
});
