import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeIqCaptureV4 } from "../../src/ts/webusb/iqCaptureFormat.ts";
import { encryptIqCaptureBytes, inspectIqCapture } from "../../scripts/encrypt_iq_capture.mjs";
import {
  decryptArchivedIqPayload,
  deriveCaptureProtectionKey,
  getOrCreateCaptureProtectionSalt,
  loadCaptureProtectionSalt,
  parseCaptureProtectionSalt,
} from "../../scripts/classifier/crypto.mjs";

function fakeRedis(records) {
  return () => ({
    isOpen: false,
    on() {},
    async connect() { this.isOpen = true; },
    async select(database) { assert.equal(database, 1); },
    async get(key) { return records.get(key) ?? null; },
    async set(key, value, options) {
      assert.deepEqual(options, { NX: true });
      if (records.has(key)) return null;
      records.set(key, value);
      return "OK";
    },
    async quit() { this.isOpen = false; },
  });
}

const id = "a".repeat(64);

test("capture salt parser accepts canonical raw hex and legacy JSON strings", () => {
  const expected = Buffer.alloc(32, 21);
  assert.deepEqual(parseCaptureProtectionSalt(expected.toString("hex")), expected);
  assert.deepEqual(parseCaptureProtectionSalt(JSON.stringify(expected.toString("hex"))), expected);
});

test("classifier salt creation uses an atomic Redis DB 1 record and reuses it", async () => {
  const records = new Map();
  const options = { env: { REDIS_URL: "redis://test" }, clientFactory: fakeRedis(records) };
  const [first, second] = await Promise.all([
    getOrCreateCaptureProtectionSalt(id, options),
    getOrCreateCaptureProtectionSalt(id, options),
  ]);
  const third = await getOrCreateCaptureProtectionSalt(id, options);
  assert.equal(first.length, 32);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(records.get(`capture-protection:${id}`), first.toString("hex"));
});

test("classifier reader fails closed when its per-capture Redis salt is missing", async () => {
  await assert.rejects(
    loadCaptureProtectionSalt(id, { env: { REDIS_URL: "redis://test" }, clientFactory: fakeRedis(new Map()) }),
    /missing a valid capture-protection salt/i,
  );
});

test("classifier key derivation requires fixed-size vault key and salt", () => {
  assert.throws(() => deriveCaptureProtectionKey(Buffer.alloc(31), Buffer.alloc(32)), /Vault key must be 32 bytes/);
  assert.throws(() => deriveCaptureProtectionKey(Buffer.alloc(32), Buffer.alloc(31)), /Capture salt must be 32 bytes/);
  assert.equal(deriveCaptureProtectionKey(Buffer.alloc(32, 3), Buffer.alloc(32, 4)).length, 32);
  assert.equal(
    deriveCaptureProtectionKey(Buffer.alloc(32, 7), Buffer.alloc(32, 8)).toString("hex"),
    "41d3d7c41410e3a76d9ebdc2040a91d208225e57664faab773f8394cd91264a1",
    "per-capture key matches the Rust HKDF-style HMAC-SHA256 vector",
  );
});

test("classifier reader decrypts with a legacy JSON-encoded Redis salt", async () => {
  const captureId = "b".repeat(64);
  const salt = Buffer.alloc(32, 17);
  const env = {
    REDIS_URL: "redis://test",
    UNSAFE_LOCAL_USER_PASSWORD: "classifier-redis-test-secret",
  };
  const records = new Map([[`capture-protection:${captureId}`, JSON.stringify(salt.toString("hex"))]]);
  const plaintext = await encodeIqCaptureV4({
    metadata: { center_frequency_hz: 1_618_000, capture_sample_rate_hz: 3_200_000, fft_size: 4, fft_window: "rectangular" },
    frameUpdates: [{ sample_offset: 0, timestamp_us: 10, patch: {} }],
    chunks: [{ sample_offset: 0, channel: 0, data: Uint8Array.from([128, 130, 127, 126]) }],
  });
  const { loadIqCaptureKey } = await import("../../scripts/classifier/crypto.mjs");
  const vaultKey = await loadIqCaptureKey({ envFile: null, env });
  const perCaptureKey = deriveCaptureProtectionKey(vaultKey, salt);
  const encrypted = encryptIqCaptureBytes(plaintext, perCaptureKey);
  vaultKey.fill(0);
  perCaptureKey.fill(0);

  const restoredPayload = await decryptArchivedIqPayload({
    captureBytes: encrypted,
    archive: {
      encryption: "AES-256-GCM-REDIS-SALT-V1",
      sourceCaptureId: captureId,
      saltKey: `capture-protection:${captureId}`,
    },
    envFile: null,
    env,
    clientFactory: fakeRedis(records),
  });
  assert.deepEqual(restoredPayload, inspectIqCapture(plaintext).payload);
});
