import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import test from "node:test";

import {
  upgradeIqCaptureBytes,
  upgradeLegacyNaptContainerBytes,
  upgradeLegacyNaptBytes,
} from "../../scripts/upgrade_iq_capture.mjs";

function u64(value) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(BigInt(value));
  return result;
}

function v4Capture() {
  const frames = Buffer.from(
    JSON.stringify([
      { timestamp_us: 1234, frame_sequence: 0, sample_offset: 0, patch: {} },
    ]),
  );
  const payload = Buffer.from([128, 12, 255, 1, 2, 3]);
  const trailerJson = Buffer.from(
    JSON.stringify({ processing: { operation: "capture" } }),
  );
  const trailerHeader = Buffer.concat([
    Buffer.from("NAPTTRLR"),
    Buffer.from([1]),
    Buffer.alloc(7),
    u64(trailerJson.length),
  ]);
  const trailer = Buffer.concat([trailerHeader, trailerJson]);
  let binaryOffset = 0;
  let trailerOffset = 0;
  let metadataJson = Buffer.alloc(0);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    metadataJson = Buffer.from(
      JSON.stringify({
        format: "iq",
        format_version: 4,
        interleaving: "IQ",
        sections: {
          binary: {
            offset_bytes: binaryOffset,
            length_bytes: payload.length,
            encoding: "iq_u8_interleaved",
            encrypted: false,
          },
          trailer: {
            offset_bytes: trailerOffset,
            length_bytes: trailer.length,
            version: 1,
          },
        },
      }),
    );
    const nextBinaryOffset = 40 + metadataJson.length + frames.length;
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
    u64(metadataJson.length),
    u64(frames.length),
    u64(payload.length),
    Buffer.from([0]),
    Buffer.alloc(7),
  ]);
  return {
    bytes: Buffer.concat([header, metadataJson, frames, payload, trailer]),
    frames,
    payload,
  };
}

test("upgrades a V4 capture to V5 without changing frame timestamps or payload", () => {
  const source = v4Capture();
  const upgraded = upgradeIqCaptureBytes(source.bytes);
  const metadataLength = Number(upgraded.readBigUInt64LE(8));
  const framesLength = Number(upgraded.readBigUInt64LE(16));
  const payloadLength = Number(upgraded.readBigUInt64LE(24));
  const metadataStart = 40;
  const framesStart = metadataStart + metadataLength;
  const payloadStart = framesStart + framesLength;
  const metadata = JSON.parse(upgraded.subarray(metadataStart, framesStart));
  const frames = upgraded.subarray(framesStart, payloadStart);
  const payload = upgraded.subarray(payloadStart, payloadStart + payloadLength);
  const trailer = metadata.sections.trailer;
  const trailerStart = trailer.offset_bytes;
  const trailerBytes = upgraded.subarray(trailerStart);
  const trailerJson = JSON.parse(trailerBytes.subarray(24));

  assert.equal(metadata.format_version, 5);
  assert.deepEqual(frames, source.frames);
  assert.deepEqual(payload, source.payload);
  assert.equal(trailerBytes.subarray(0, 8).toString(), "NAPTTRLR");
  assert.equal(trailerBytes[8], 2);
  assert.equal(trailerJson.processing.operation, "capture");
  assert.equal(trailerJson.integrity.algorithm, "SHA-256");
  const digest = trailerJson.integrity.digest;
  const digestBytes = Buffer.from(digest);
  const zeroed = Buffer.from(upgraded);
  const digestOffset = zeroed.indexOf(digestBytes, trailerStart + 24);
  zeroed.fill(0x30, digestOffset, digestOffset + 64);
  assert.equal(createHash("sha256").update(zeroed).digest("hex"), digest);
});

test("converts an encrypted legacy NAPT capture to encrypted V5 IQ", () => {
  const vaultKey = Buffer.alloc(32, 17);
  const dek = Buffer.alloc(32, 29);
  const wrapNonce = Buffer.alloc(12, 31);
  const wrapCipher = createCipheriv("aes-256-gcm", vaultKey, wrapNonce);
  const wrappedDek = Buffer.concat([
    wrapNonce,
    wrapCipher.update(dek),
    wrapCipher.final(),
    wrapCipher.getAuthTag(),
  ]);
  const iqPayload = Buffer.from([101, 102, 103, 104, 105, 106]);
  const dataNonce = Buffer.alloc(12, 37);
  const dataCipher = createCipheriv("aes-256-gcm", dek, dataNonce);
  const encryptedPayload = Buffer.concat([
    dataNonce,
    dataCipher.update(iqPayload),
    dataCipher.final(),
    dataCipher.getAuthTag(),
  ]);
  const metadata = {
    encrypted: true,
    format_version: 3,
    timestamp_utc: "2026-09-24T12:00:00Z",
    wrapped_dek: wrappedDek.toString("base64"),
    channels: [
      {
        offset_iq: 0,
        iq_length: iqPayload.length,
        center_freq_hz: 137000000,
        sample_rate_hz: 3200000,
        label: "A",
      },
    ],
  };
  const headerJson = Buffer.from(JSON.stringify({ metadata }));
  const legacy = Buffer.concat([
    headerJson,
    Buffer.alloc(4096 - headerJson.length, 32),
    encryptedPayload,
  ]);

  const upgraded = upgradeLegacyNaptBytes(legacy, vaultKey);
  const metadataLength = Number(upgraded.readBigUInt64LE(8));
  const framesLength = Number(upgraded.readBigUInt64LE(16));
  const payloadLength = Number(upgraded.readBigUInt64LE(24));
  const metadataStart = 40;
  const framesStart = metadataStart + metadataLength;
  const payloadStart = framesStart + framesLength;
  const upgradedMetadata = JSON.parse(
    upgraded.subarray(metadataStart, framesStart),
  );
  const encryptedV5Payload = upgraded.subarray(
    payloadStart,
    payloadStart + payloadLength,
  );
  assert.equal(upgradedMetadata.format_version, 5);
  assert.equal(upgradedMetadata.encrypted, true);
  assert.equal(upgraded[32], 1);
  assert.ok(upgradedMetadata.sections.binary.encrypted);
  assert.deepEqual(
    JSON.parse(upgraded.subarray(framesStart, payloadStart)),
    [],
  );
  const nonce = encryptedV5Payload.subarray(0, 12);
  const decipherPayload = createDecipheriv("aes-256-gcm", vaultKey, nonce);
  decipherPayload.setAuthTag(encryptedV5Payload.subarray(-16));
  const plaintext = Buffer.concat([
    decipherPayload.update(encryptedV5Payload.subarray(12, -16)),
    decipherPayload.final(),
  ]);
  assert.equal(plaintext.readUInt32LE(8), 0);
  assert.equal(plaintext.readBigUInt64LE(12), BigInt(iqPayload.length));
  assert.deepEqual(plaintext.subarray(20), iqPayload);
});

test("upgrades a legacy encrypted NAPT container without decrypting or changing its payload", () => {
  const metadata = {
    encrypted: true,
    channels: [{ offset_iq: 0, iq_length: 8, sample_rate_hz: 3200000 }],
    timestamp_utc: "2026-06-12T09:00:00Z",
  };
  const headerJson = Buffer.from(JSON.stringify({ metadata }));
  const ciphertext = Buffer.alloc(64, 91);
  const legacy = Buffer.concat([
    headerJson,
    Buffer.alloc(4096 - headerJson.length, 32),
    ciphertext,
  ]);
  const upgraded = upgradeLegacyNaptContainerBytes(legacy);
  const headerText = upgraded.subarray(0, 4096).toString("utf8").trimEnd();
  const root = JSON.parse(headerText);
  const upgradedMetadata = root.metadata;
  const binary = upgradedMetadata.sections.binary;
  const trailer = upgradedMetadata.sections.trailer;

  assert.equal(upgradedMetadata.format_version, 5);
  assert.equal(upgradedMetadata.encrypted, true);
  assert.equal(upgradedMetadata.source_container_version, null);
  assert.equal(binary.encrypted, true);
  assert.deepEqual(
    upgraded.subarray(
      binary.offset_bytes,
      binary.offset_bytes + binary.length_bytes,
    ),
    ciphertext,
  );
  assert.equal(upgraded.readUInt8(trailer.offset_bytes + 8), 2);
  const trailerLength = Number(
    upgraded.readBigUInt64LE(trailer.offset_bytes + 16),
  );
  const trailerJson = JSON.parse(
    upgraded.subarray(
      trailer.offset_bytes + 24,
      trailer.offset_bytes + 24 + trailerLength,
    ),
  );
  const digestOffset = upgraded.indexOf(
    Buffer.from(trailerJson.integrity.digest),
  );
  const zeroed = Buffer.from(upgraded);
  zeroed.fill(0x30, digestOffset, digestOffset + 64);
  assert.equal(
    createHash("sha256").update(zeroed).digest("hex"),
    trailerJson.integrity.digest,
  );
});
