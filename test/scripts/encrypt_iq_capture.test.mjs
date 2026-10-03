import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, pbkdf2Sync, webcrypto } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { decryptIqCapturePayload, encryptIqCaptureBytes, inspectIqCapture, rewrapIqCapturePayload } from "../../scripts/encrypt_iq_capture.mjs";

const encoder = new TextEncoder();
const placeholder = "0".repeat(64);

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function buildV6Iq() {
  const metadata = {
    format: "iq",
    format_version: 6,
    interleaving: "IQ",
    sample_encoding: {
      element_type: "integer",
      bits_per_element: 8,
      signed: false,
      byte_order: "little",
      normalization: "(value - 128) / 127",
    },
    encrypted: false,
  };
  const frames = encoder.encode(
    JSON.stringify([
      {
        sample_offset: 0,
        timestamp_us: 12,
        kind: "Frame",
        frame_sequence: 0,
        patch: {},
      },
    ]),
  );
  const payload = Buffer.concat([
    u64(0),
    Buffer.alloc(4),
    u64(4),
    Buffer.from([128, 127, 129, 126]),
  ]);
  const trailerJson = encoder.encode(
    JSON.stringify({
      integrity: {
        algorithm: "SHA-256",
        scope: "file-with-integrity-digest-placeholder",
        digest: placeholder,
      },
    }),
  );
  let metadataBytes;
  let binaryOffset = 0;
  let trailerOffset = 0;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    metadata.sections = {
      binary: {
        offset_bytes: binaryOffset,
        length_bytes: payload.length,
        encoding: "iq_u8_interleaved",
        encrypted: false,
      },
      trailer: {
        offset_bytes: trailerOffset,
        length_bytes: 24 + trailerJson.length,
        encoding: "utf8_json",
        version: 2,
      },
    };
    metadataBytes = encoder.encode(JSON.stringify(metadata));
    const nextBinaryOffset = 40 + metadataBytes.length + frames.length;
    const nextTrailerOffset = nextBinaryOffset + payload.length;
    if (
      nextBinaryOffset === binaryOffset &&
      nextTrailerOffset === trailerOffset
    )
      break;
    binaryOffset = nextBinaryOffset;
    trailerOffset = nextTrailerOffset;
  }
  const header = Buffer.concat([
    Buffer.from("NAPT-IQ3"),
    u64(metadataBytes.length),
    u64(frames.length),
    u64(payload.length),
    Buffer.from([0]),
    Buffer.alloc(7),
  ]);
  const trailerHeader = Buffer.concat([
    Buffer.from("NAPTTRLR"),
    Buffer.from([2]),
    Buffer.alloc(7),
    u64(trailerJson.length),
  ]);
  const file = Buffer.concat([
    header,
    metadataBytes,
    frames,
    payload,
    trailerHeader,
    trailerJson,
  ]);
  const digest = createHash("sha256").update(file).digest("hex");
  const marker = Buffer.from(placeholder);
  const digestOffset = file.indexOf(marker);
  assert.notEqual(digestOffset, -1);
  Buffer.from(digest).copy(file, digestOffset);
  return { file, payload };
}

function buildV3Iq() {
  const metadata = encoder.encode(
    JSON.stringify({
      format: "iq",
      format_version: 3,
      interleaving: "IQ",
      sample_encoding: { element_type: "integer", bits_per_element: 8 },
    }),
  );
  const frames = encoder.encode(
    JSON.stringify([{ sample_offset: 0, timestamp_us: 12, patch: {} }]),
  );
  const payload = Buffer.concat([
    u64(0),
    Buffer.alloc(4),
    u64(4),
    Buffer.from([128, 127, 129, 126]),
  ]);
  const header = Buffer.concat([
    Buffer.from("NAPT-IQ3"),
    u64(metadata.length),
    u64(frames.length),
    u64(payload.length),
    Buffer.from([0]),
    Buffer.alloc(7),
  ]);
  return { file: Buffer.concat([header, metadata, frames, payload]), payload };
}

test("encrypts a V6 IQ payload, updates section offsets, and restamps integrity", async () => {
  const { file, payload } = buildV6Iq();
  const key = pbkdf2Sync(
    "test-secret",
    "n-apt-aes-salt-v1",
    100_000,
    32,
    "sha256",
  );
  const encrypted = encryptIqCaptureBytes(file, key);
  const metadataLength = Number(encrypted.readBigUInt64LE(8));
  const framesLength = Number(encrypted.readBigUInt64LE(16));
  const payloadLength = Number(encrypted.readBigUInt64LE(24));
  const metadataStart = 40;
  const payloadStart = metadataStart + metadataLength + framesLength;
  const metadata = JSON.parse(
    encrypted.subarray(metadataStart, metadataStart + metadataLength),
  );
  const sections = metadata.sections;

  assert.equal(encrypted[32], 1);
  assert.equal(metadata.encrypted, true);
  assert.equal(metadata.format_version, 6);
  assert.equal(metadata.originalVersion, undefined);
  assert.equal(sections.binary.encrypted, true);
  assert.equal(sections.binary.offset_bytes, payloadStart);
  assert.equal(sections.binary.length_bytes, payloadLength);
  assert.equal(sections.trailer.offset_bytes, payloadStart + payloadLength);
  assert.equal(payloadLength, payload.length + 28);

  const aesKey = await webcrypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plain = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encrypted.subarray(payloadStart, payloadStart + 12),
    },
    aesKey,
    encrypted.subarray(payloadStart + 12, payloadStart + payloadLength),
  );
  assert.deepEqual(Buffer.from(plain), payload);

  const digest =
    metadata.sections.trailer.offset_bytes + sections.trailer.length_bytes;
  assert.equal(digest, encrypted.length);
  const zeroed = Buffer.from(encrypted);
  const trailerJsonStart = sections.trailer.offset_bytes + 24;
  const trailer = JSON.parse(zeroed.subarray(trailerJsonStart));
  const stampedDigest = trailer.integrity.digest;
  zeroed.fill(
    0x30,
    trailerJsonStart +
      zeroed.subarray(trailerJsonStart).indexOf(Buffer.from(stampedDigest)),
    trailerJsonStart +
      zeroed.subarray(trailerJsonStart).indexOf(Buffer.from(stampedDigest)) +
      64,
  );
  assert.equal(
    createHash("sha256").update(zeroed).digest("hex"),
    stampedDigest,
  );
});

test("rejects already encrypted and malformed inputs", () => {
  const { file } = buildV6Iq();
  const key = Buffer.alloc(32, 9);
  const alreadyEncrypted = Buffer.from(file);
  alreadyEncrypted[32] = 1;
  assert.throws(
    () => encryptIqCaptureBytes(alreadyEncrypted, key),
    /already encrypted/,
  );
  assert.throws(
    () => encryptIqCaptureBytes(Buffer.from("not an IQ file"), key),
    /NAPT-IQ3/,
  );
});

test("encrypts V3 without inventing sections or changing its frame timestamps", async () => {
  const { file, payload } = buildV3Iq();
  const key = Buffer.alloc(32, 3);
  const encrypted = encryptIqCaptureBytes(file, key);
  const metadataLength = Number(encrypted.readBigUInt64LE(8));
  const framesLength = Number(encrypted.readBigUInt64LE(16));
  const payloadLength = Number(encrypted.readBigUInt64LE(24));
  const metadata = JSON.parse(encrypted.subarray(40, 40 + metadataLength));
  const frameStart = 40 + metadataLength;
  const payloadStart = frameStart + framesLength;
  const frames = JSON.parse(encrypted.subarray(frameStart, payloadStart));
  assert.equal(encrypted[32], 1);
  assert.equal(metadata.format_version, 3);
  assert.equal(metadata.encrypted, true);
  assert.equal(metadata.sections, undefined);
  assert.deepEqual(frames, [{ sample_offset: 0, timestamp_us: 12, patch: {} }]);
  const aesKey = await webcrypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plain = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encrypted.subarray(payloadStart, payloadStart + 12),
    },
    aesKey,
    encrypted.subarray(payloadStart + 12, payloadStart + payloadLength),
  );
  assert.deepEqual(Buffer.from(plain), payload);
});

test("CLI reads its passphrase from the environment and refuses to overwrite output", () => {
  const directory = mkdtempSync(join(tmpdir(), "napt-iq-encrypt-"));
  const inputPath = join(directory, "capture.iq");
  const outputPath = join(directory, "capture-encrypted.iq");
  const scriptPath = fileURLToPath(
    new URL("../../scripts/encrypt_iq_capture.mjs", import.meta.url),
  );
  const { file } = buildV6Iq();
  writeFileSync(inputPath, file);
  const env = {
    ...process.env,
    UNSAFE_LOCAL_USER_PASSWORD: "test-secret",
    NAPT_PBKDF2_SALT: "n-apt-aes-salt-v1",
  };
  try {
    const first = spawnSync(
      process.execPath,
      [scriptPath, inputPath, outputPath],
      { env, encoding: "utf8" },
    );
    assert.equal(first.status, 0, first.stderr);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(outputPath)[32], 1);

    const second = spawnSync(
      process.execPath,
      [scriptPath, inputPath, outputPath],
      { env, encoding: "utf8" },
    );
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /EEXIST|already exists/i);
  } finally {
    rmSync(resolve(directory), { recursive: true, force: true });
  }
});

test("rewraps V6 IQ payloads without changing frame offsets and verifies checksum", () => {
  const { file, payload } = buildV6Iq();
  const oldKey = Buffer.alloc(32, 3);
  const newKey = Buffer.alloc(32, 4);
  const legacyEncrypted = encryptIqCaptureBytes(file, oldKey);
  const rewrapped = rewrapIqCapturePayload(legacyEncrypted, oldKey, newKey);
  const parsed = inspectIqCapture(rewrapped, { allowEncrypted: true });

  assert.equal(parsed.formatVersion, 6);
  assert.deepEqual(parsed.frames, inspectIqCapture(legacyEncrypted, { allowEncrypted: true }).frames);
  assert.deepEqual(decryptIqCapturePayload(rewrapped, newKey), payload);
  assert.notDeepEqual(parsed.payload, inspectIqCapture(legacyEncrypted, { allowEncrypted: true }).payload);
  assert.throws(() => decryptIqCapturePayload(rewrapped, oldKey));
});
