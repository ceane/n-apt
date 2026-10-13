#!/usr/bin/env node
// Encrypts NAPT-IQ3 v3-v6 captures in place of a separate output file.
// Usage: node scripts/encrypt_iq_capture.mjs input.iq [output.iq]
// Passphrase: UNSAFE_LOCAL_USER_PASSWORD or N_APT_PASSKEY from the shell env.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HEADER_SIZE = 40;
const TRAILER_HEADER_SIZE = 24;
const IQ_MAGIC = Buffer.from("NAPT-IQ3");
const TRAILER_MAGIC = Buffer.from("NAPTTRLR");
const INTEGRITY_PLACEHOLDER = "0".repeat(64);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function readU64(bytes, offset, label) {
  if (offset < 0 || offset + 8 > bytes.length) {
    throw new Error(`Truncated ${label}`);
  }
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript's safe integer range`);
  }
  return Number(value);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(UTF8.decode(bytes));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function verifyIntegrity(bytes, trailer, trailerJsonStart, label) {
  const integrity = trailer?.integrity;
  if (
    integrity?.algorithm !== "SHA-256" ||
    integrity.scope !== "file-with-integrity-digest-placeholder" ||
    typeof integrity.digest !== "string" ||
    !/^[0-9a-f]{64}$/i.test(integrity.digest)
  ) {
    throw new Error(`${label} is missing a valid SHA-256 integrity stamp`);
  }
  const digestBytes = Buffer.from(integrity.digest, "ascii");
  const localOffset = bytes.subarray(trailerJsonStart).indexOf(digestBytes);
  if (localOffset < 0)
    throw new Error(`${label} integrity digest is not in its trailer`);
  const unstamped = Buffer.from(bytes);
  unstamped.fill(
    0x30,
    trailerJsonStart + localOffset,
    trailerJsonStart + localOffset + 64,
  );
  const actual = createHash("sha256").update(unstamped).digest("hex");
  if (actual !== integrity.digest.toLowerCase()) {
    throw new Error(
      `${label} integrity verification failed; input was not changed`,
    );
  }
}

export function inspectIqCapture(input, { allowEncrypted = false } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length < HEADER_SIZE || !bytes.subarray(0, 8).equals(IQ_MAGIC)) {
    throw new Error("Input is not a NAPT-IQ3 I/Q capture");
  }

  const metadataLength = readU64(bytes, 8, "metadata length");
  const framesLength = readU64(bytes, 16, "frame metadata length");
  const payloadLength = readU64(bytes, 24, "payload length");
  const metadataStart = HEADER_SIZE;
  const framesStart = metadataStart + metadataLength;
  const payloadStart = framesStart + framesLength;
  const payloadEnd = payloadStart + payloadLength;
  if (
    !Number.isSafeInteger(payloadEnd) ||
    metadataLength <= 0 ||
    payloadEnd > bytes.length
  ) {
    throw new Error("I/Q capture has invalid or truncated section lengths");
  }

  const metadata = parseJson(
    bytes.subarray(metadataStart, framesStart),
    "I/Q metadata",
  );
  const frameUpdates = parseJson(
    bytes.subarray(framesStart, payloadStart),
    "frame updates",
  );
  if (
    metadata.format !== "iq" ||
    metadata.interleaving !== "IQ" ||
    !Array.isArray(frameUpdates)
  ) {
    throw new Error("I/Q capture metadata or frame update list is invalid");
  }
  const formatVersion = metadata.format_version ?? 3;
  if (
    !Number.isInteger(formatVersion) ||
    formatVersion < 3 ||
    formatVersion > 6
  ) {
    throw new Error(`Unsupported I/Q format version: ${String(formatVersion)}`);
  }
  const encrypted = metadata.encrypted === true || metadata.encrypted === "true";
  if (bytes[32] === 1 && !encrypted && !allowEncrypted) {
    throw new Error(
      "Capture appears already encrypted or has an inconsistent encryption flag",
    );
  }
  if (encrypted && !allowEncrypted) {
    throw new Error(
      "Capture is already encrypted; refusing to encrypt it twice",
    );
  }
  if (bytes[32] !== (encrypted ? 1 : 0)) {
    throw new Error("I/Q capture encryption flag disagrees with its metadata");
  }
  if (encrypted && metadata.sections?.binary?.encrypted !== true) {
    throw new Error("Encrypted I/Q capture binary section is not marked encrypted");
  }

  let trailer = null;
  let trailerMarkerVersion = null;
  let trailerJsonStart = null;
  if (formatVersion >= 4) {
    const binary = metadata.sections?.binary;
    const trailerSection = metadata.sections?.trailer;
    if (
      !binary ||
      !trailerSection ||
      binary.offset_bytes !== payloadStart ||
      binary.length_bytes !== payloadLength ||
      trailerSection.offset_bytes !== payloadEnd ||
      !Number.isSafeInteger(trailerSection.length_bytes) ||
      trailerSection.length_bytes < TRAILER_HEADER_SIZE ||
      trailerSection.offset_bytes + trailerSection.length_bytes !== bytes.length
    ) {
      throw new Error("I/Q capture has an invalid V4+ section index");
    }
    if (!bytes.subarray(payloadEnd, payloadEnd + 8).equals(TRAILER_MAGIC)) {
      throw new Error("I/Q capture has an invalid trailer marker");
    }
    trailerMarkerVersion = bytes[payloadEnd + 8];
    if (
      (formatVersion >= 5 && trailerMarkerVersion !== 2) ||
      (formatVersion === 4 && trailerMarkerVersion !== 1)
    ) {
      throw new Error(`Unexpected V${formatVersion} trailer version`);
    }
    const trailerJsonLength = readU64(
      bytes,
      payloadEnd + 16,
      "trailer JSON length",
    );
    if (
      trailerJsonLength + TRAILER_HEADER_SIZE !==
      trailerSection.length_bytes
    ) {
      throw new Error("I/Q capture has an invalid trailer length");
    }
    trailerJsonStart = payloadEnd + TRAILER_HEADER_SIZE;
    trailer = parseJson(
      bytes.subarray(trailerJsonStart, trailerJsonStart + trailerJsonLength),
      "I/Q trailer",
    );
    if (formatVersion >= 5) {
      verifyIntegrity(bytes, trailer, trailerJsonStart, "I/Q capture");
    }
  } else if (payloadEnd !== bytes.length) {
    throw new Error("V3 I/Q capture has unexpected trailing bytes");
  }

  return {
    bytes,
    metadata,
    formatVersion,
    frames: bytes.subarray(framesStart, payloadStart),
    payload: bytes.subarray(payloadStart, payloadEnd),
    trailer,
    trailerMarkerVersion,
  };
}

function encryptPayload(payload, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

function writeU64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

/** Encrypts a plaintext NAPT-IQ3 v3-v6 capture without changing its format version. */
export function encryptIqCaptureBytes(input, key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new Error("AES-256 key must be exactly 32 bytes");
  }
  const parsed = inspectIqCapture(input);
  const encryptedPayload = encryptPayload(parsed.payload, key);
  const metadata = {
    ...parsed.metadata,
    format_version: parsed.formatVersion,
    encrypted: true,
  };
  if (metadata.sections?.binary) {
    metadata.sections = {
      ...metadata.sections,
      binary: {
        ...metadata.sections.binary,
        encrypted: true,
        length_bytes: encryptedPayload.length,
      },
    };
  }

  let trailerJson = parsed.trailer
    ? Buffer.from(JSON.stringify(parsed.trailer))
    : Buffer.alloc(0);
  if (parsed.formatVersion >= 5) {
    parsed.trailer.integrity.digest = INTEGRITY_PLACEHOLDER;
    trailerJson = Buffer.from(JSON.stringify(parsed.trailer));
  }
  const trailerLength =
    parsed.formatVersion >= 4 ? TRAILER_HEADER_SIZE + trailerJson.length : 0;

  let metadataJson = Buffer.alloc(0);
  let binaryOffset = 0;
  let trailerOffset = 0;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (parsed.formatVersion >= 4) {
      metadata.sections = {
        ...metadata.sections,
        binary: {
          ...metadata.sections.binary,
          offset_bytes: binaryOffset,
          length_bytes: encryptedPayload.length,
          encrypted: true,
        },
        trailer: {
          ...metadata.sections.trailer,
          offset_bytes: trailerOffset,
          length_bytes: trailerLength,
        },
      };
    }
    metadataJson = Buffer.from(JSON.stringify(metadata));
    const nextBinaryOffset =
      HEADER_SIZE + metadataJson.length + parsed.frames.length;
    const nextTrailerOffset = nextBinaryOffset + encryptedPayload.length;
    if (
      nextBinaryOffset === binaryOffset &&
      nextTrailerOffset === trailerOffset
    )
      break;
    binaryOffset = nextBinaryOffset;
    trailerOffset = nextTrailerOffset;
    if (attempt === 15)
      throw new Error("Could not stabilize I/Q section offsets");
  }

  const payloadOffset =
    HEADER_SIZE + metadataJson.length + parsed.frames.length;
  const outputHeader = Buffer.concat([
    IQ_MAGIC,
    writeU64(metadataJson.length),
    writeU64(parsed.frames.length),
    writeU64(encryptedPayload.length),
    Buffer.from([1]),
    Buffer.alloc(7),
  ]);
  const parts = [outputHeader, metadataJson, parsed.frames, encryptedPayload];
  if (parsed.formatVersion >= 4) {
    const trailerHeader = Buffer.concat([
      TRAILER_MAGIC,
      Buffer.from([parsed.trailerMarkerVersion]),
      Buffer.alloc(7),
      writeU64(trailerJson.length),
    ]);
    parts.push(trailerHeader, trailerJson);
  }
  let output = Buffer.concat(parts);
  if (parsed.formatVersion >= 5) {
    const digest = createHash("sha256").update(output).digest("hex");
    const marker = Buffer.from(INTEGRITY_PLACEHOLDER);
    const digestOffset = output.indexOf(
      marker,
      payloadOffset + encryptedPayload.length + TRAILER_HEADER_SIZE,
    );
    if (digestOffset < 0)
      throw new Error("Could not locate the V5+ integrity placeholder");
    Buffer.from(digest).copy(output, digestOffset);
  }
  return output;
}

/** Decrypts and authenticates the binary payload of an encrypted NAPT-IQ3 capture. */
export function decryptIqCapturePayload(input, key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new Error("AES-256 key must be exactly 32 bytes");
  }
  const parsed = inspectIqCapture(input, { allowEncrypted: true });
  if (parsed.metadata.encrypted !== true && parsed.metadata.encrypted !== "true") {
    throw new Error("Capture is not encrypted");
  }
  if (parsed.formatVersion < 4) {
    throw new Error("Encrypted I/Q payload decryption requires indexed V4+ capture sections");
  }
  if (parsed.payload.length < 12 + 16) {
    throw new Error("Encrypted I/Q payload is too short");
  }
  const nonce = parsed.payload.subarray(0, 12);
  const body = parsed.payload.subarray(12);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(body.subarray(-16));
  return Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
}

/** Re-encrypts an indexed encrypted IQ payload while preserving its frame section and offsets. */
export function rewrapIqCapturePayload(input, oldKey, newKey) {
  for (const [label, key] of [["Old", oldKey], ["New", newKey]]) {
    if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
      throw new Error(`${label} AES-256 key must be exactly 32 bytes`);
    }
  }
  const parsed = inspectIqCapture(input, { allowEncrypted: true });
  if (!parsed.metadata.encrypted || parsed.formatVersion < 4) {
    throw new Error("Rewrapping requires an encrypted V4+ I/Q capture");
  }
  const plaintext = decryptIqCapturePayload(parsed.bytes, oldKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", newKey, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const encryptedPayload = Buffer.concat([nonce, body]);
  if (encryptedPayload.length !== parsed.payload.length) {
    throw new Error("Rewrapped payload length changed; refusing to alter capture offsets");
  }
  const output = Buffer.from(parsed.bytes);
  const payloadStart = HEADER_SIZE + readU64(output, 8, "metadata length") + readU64(output, 16, "frame metadata length");
  encryptedPayload.copy(output, payloadStart);
  if (parsed.formatVersion >= 5) {
    const trailerJsonStart = payloadStart + parsed.payload.length + TRAILER_HEADER_SIZE;
    const trailerJsonLength = readU64(output, payloadStart + parsed.payload.length + 16, "trailer JSON length");
    const trailerText = output.subarray(trailerJsonStart, trailerJsonStart + trailerJsonLength).toString("utf8");
    const digestMatch = /("digest"\s*:\s*")[a-f\d]{64}(")/i.exec(trailerText);
    if (!digestMatch) throw new Error("Could not locate the V5+ integrity checksum");
    const digestOffset = trailerJsonStart + digestMatch.index + digestMatch[1].length;
    Buffer.from(INTEGRITY_PLACEHOLDER).copy(output, digestOffset);
    const digest = createHash("sha256").update(output).digest("hex");
    Buffer.from(digest).copy(output, digestOffset);
  }
  const verified = inspectIqCapture(output, { allowEncrypted: true });
  if (!decryptIqCapturePayload(verified.bytes, newKey).equals(plaintext)) {
    throw new Error("Rewrapped payload verification failed");
  }
  return output;
}

export function deriveIqCaptureKey(
  passkey,
  salt = process.env.NAPT_PBKDF2_SALT ??
    process.env.VITE_PBKDF2_SALT ??
    "n-apt-aes-salt-v1",
) {
  if (typeof passkey !== "string" || passkey.trim().length === 0) {
    throw new Error("Capture passkey must be a non-empty string");
  }
  return pbkdf2Sync(passkey.trim(), salt, 100_000, 32, "sha256");
}

function main(args = process.argv.slice(2)) {
  if (args.length < 1 || args.length > 2) {
    throw new Error(
      "Usage: node scripts/encrypt_iq_capture.mjs <input.iq> [output.iq]",
    );
  }
  const inputPath = resolve(args[0]);
  if (!existsSync(inputPath))
    throw new Error(`Input file does not exist: ${inputPath}`);
  const outputPath = resolve(args[1] ?? `${inputPath}.encrypted.iq`);
  if (inputPath === outputPath)
    throw new Error("Output path must differ from the input path");
  const passkey =
    process.env.UNSAFE_LOCAL_USER_PASSWORD ?? process.env.N_APT_PASSKEY;
  if (!passkey) {
    throw new Error(
      "Set UNSAFE_LOCAL_USER_PASSWORD (or N_APT_PASSKEY) in the shell environment first",
    );
  }
  const key = deriveIqCaptureKey(passkey);
  const encrypted = encryptIqCaptureBytes(readFileSync(inputPath), key);
  // Exclusive creation avoids silently replacing an existing capture; keep the file private.
  writeFileSync(outputPath, encrypted, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Encrypted I/Q capture: ${basename(outputPath)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`encrypt_iq_capture: ${error.message}\n`);
    process.exitCode = 1;
  }
}
