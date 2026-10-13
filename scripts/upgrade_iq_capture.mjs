#!/usr/bin/env node
// Upgrade a NAPT-IQ3 capture to the broadly compatible V5 container.
// This preserves frame records and payload bytes; encryption is a separate step.

import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { encryptIqCaptureBytes } from "./encrypt_iq_capture.mjs";

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

function parseLegacyHeader(bytes) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  const limit = Math.min(bytes.length, 1024 * 1024);
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b) {
      if (start < 0) start = index;
      depth += 1;
    } else if (byte === 0x7d) {
      depth -= 1;
      if (start >= 0 && depth === 0) {
        return {
          root: parseJson(
            bytes.subarray(start, index + 1),
            "legacy NAPT header",
          ),
          end: index + 1,
        };
      }
    }
  }
  throw new Error("Could not find a complete legacy NAPT header");
}

function decryptGcmPayload(input, key) {
  if (input.length < 28) throw new Error("Encrypted payload is too short");
  const nonce = input.subarray(0, 12);
  const tag = input.subarray(input.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(input.subarray(12, input.length - 16)),
    decipher.final(),
  ]);
}

function decryptedLegacyPayload(bytes, root, metadata, vaultKey) {
  if (
    metadata.encrypted !== true &&
    metadata.encrypted !== "true" &&
    root.encrypted !== true
  ) {
    throw new Error("Legacy NAPT input is not marked encrypted");
  }
  const section = metadata.sections?.binary;
  const offsets =
    Number.isSafeInteger(section?.offset_bytes) && section.offset_bytes > 0
      ? [section.offset_bytes]
      : [4096, 2048, 8192, 1024];
  const wrappedBase64 =
    root.wrapped_dek ??
    root.encrypted_dek ??
    metadata.wrapped_dek ??
    metadata.encrypted_dek ??
    root.wrapped_key ??
    metadata.wrapped_key ??
    root.encrypted_key ??
    metadata.encrypted_key;
  let dataKey = vaultKey;
  if (wrappedBase64) {
    const wrapped = Buffer.from(wrappedBase64, "base64");
    dataKey = decryptGcmPayload(wrapped, vaultKey);
    if (dataKey.length !== 32)
      throw new Error("Unwrapped capture key is not 256 bits");
  }

  let lastError;
  for (const offset of offsets) {
    const length = section?.length_bytes;
    const end = Number.isSafeInteger(length) ? offset + length : bytes.length;
    if (offset < 0 || end > bytes.length || end - offset < 28) continue;
    try {
      return decryptGcmPayload(bytes.subarray(offset, end), dataKey);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not authenticate legacy NAPT payload: ${lastError?.message ?? "invalid payload bounds"}`,
  );
}

function legacyIqChunks(metadata, root, payload) {
  const channels = root.channels ?? metadata.channels;
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("Legacy NAPT capture has no channel metadata");
  }
  return channels.map((channel, index) => {
    const offset = channel.offset_iq;
    const length = channel.iq_length ?? payload.length - offset;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      offset + length > payload.length
    ) {
      throw new Error(
        `Legacy NAPT channel ${index} has invalid I/Q byte bounds`,
      );
    }
    return {
      channel: index,
      sampleOffset: channel.sample_offset ?? 0,
      data: payload.subarray(offset, offset + length),
    };
  });
}

function encodeV3Iq(metadata, frames, chunks) {
  const metadataBytes = Buffer.from(JSON.stringify(metadata));
  const frameBytes = Buffer.from(JSON.stringify(frames));
  const payloadParts = [];
  for (const chunk of chunks) {
    const header = Buffer.alloc(20);
    header.writeBigUInt64LE(BigInt(chunk.sampleOffset), 0);
    header.writeUInt32LE(chunk.channel, 8);
    header.writeBigUInt64LE(BigInt(chunk.data.length), 12);
    payloadParts.push(header, chunk.data);
  }
  const payload = Buffer.concat(payloadParts);
  const header = Buffer.concat([
    IQ_MAGIC,
    Buffer.alloc(8),
    Buffer.alloc(8),
    Buffer.alloc(8),
    Buffer.from([0]),
    Buffer.alloc(7),
  ]);
  header.writeBigUInt64LE(BigInt(metadataBytes.length), 8);
  header.writeBigUInt64LE(BigInt(frameBytes.length), 16);
  header.writeBigUInt64LE(BigInt(payload.length), 24);
  return Buffer.concat([header, metadataBytes, frameBytes, payload]);
}

function verifyIntegrity(bytes, trailer, trailerStart) {
  const integrity = trailer?.integrity;
  if (
    integrity?.algorithm !== "SHA-256" ||
    integrity.scope !== "file-with-integrity-digest-placeholder" ||
    typeof integrity.digest !== "string" ||
    !/^[0-9a-f]{64}$/i.test(integrity.digest)
  ) {
    throw new Error("V5 capture is missing its SHA-256 integrity stamp");
  }
  const digestBytes = Buffer.from(integrity.digest, "ascii");
  const localOffset = bytes
    .subarray(trailerStart + TRAILER_HEADER_SIZE)
    .indexOf(digestBytes);
  if (localOffset < 0)
    throw new Error("Integrity digest is not in its trailer");
  const unstamped = Buffer.from(bytes);
  const digestOffset = trailerStart + TRAILER_HEADER_SIZE + localOffset;
  unstamped.fill(0x30, digestOffset, digestOffset + 64);
  const actual = createHash("sha256").update(unstamped).digest("hex");
  if (actual !== integrity.digest.toLowerCase()) {
    throw new Error("Capture integrity verification failed");
  }
}

function inspectCapture(input) {
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
    throw new Error("Capture has invalid or truncated section lengths");
  }
  const metadata = parseJson(
    bytes.subarray(metadataStart, framesStart),
    "I/Q metadata",
  );
  const frames = parseJson(
    bytes.subarray(framesStart, payloadStart),
    "frame updates",
  );
  if (
    metadata?.format !== "iq" ||
    metadata?.interleaving !== "IQ" ||
    !Array.isArray(frames)
  ) {
    throw new Error("Capture metadata or frame update list is invalid");
  }
  const version = metadata.format_version ?? 3;
  if (!Number.isInteger(version) || version < 3 || version > 6) {
    throw new Error(`Unsupported I/Q format version: ${String(version)}`);
  }
  const encrypted = bytes[32] !== 0;
  let trailer = {};
  if (version >= 4) {
    const binary = metadata.sections?.binary;
    const section = metadata.sections?.trailer;
    if (
      !binary ||
      !section ||
      binary.offset_bytes !== payloadStart ||
      binary.length_bytes !== payloadLength ||
      section.offset_bytes !== payloadEnd ||
      section.offset_bytes + section.length_bytes !== bytes.length ||
      section.length_bytes < TRAILER_HEADER_SIZE ||
      !bytes.subarray(payloadEnd, payloadEnd + 8).equals(TRAILER_MAGIC)
    ) {
      throw new Error(
        `Capture has an invalid V${version} section index or trailer`,
      );
    }
    const markerVersion = bytes[payloadEnd + 8];
    if (
      (version >= 5 && markerVersion !== 2) ||
      (version === 4 && markerVersion !== 1 && markerVersion !== 2)
    ) {
      throw new Error(`Unexpected V${version} trailer version`);
    }
    const trailerJsonLength = readU64(
      bytes,
      payloadEnd + 16,
      "trailer JSON length",
    );
    if (trailerJsonLength + TRAILER_HEADER_SIZE !== section.length_bytes) {
      throw new Error("Capture has an invalid trailer length");
    }
    trailer = parseJson(
      bytes.subarray(payloadEnd + TRAILER_HEADER_SIZE, bytes.length),
      "I/Q trailer",
    );
    if (version >= 5) verifyIntegrity(bytes, trailer, payloadEnd);
  } else if (payloadEnd !== bytes.length) {
    throw new Error("V3 capture has unexpected trailing bytes");
  }
  return {
    bytes,
    metadata,
    framesBytes: bytes.subarray(framesStart, payloadStart),
    payload: bytes.subarray(payloadStart, payloadEnd),
    payloadStart,
    encrypted,
    trailer,
    version,
  };
}

/** Upgrade V3/V4 to V5, preserve valid V5, and reject unsupported downgrades. */
export function upgradeIqCaptureBytes(input) {
  const capture = inspectCapture(input);
  if (capture.version > 5) {
    throw new Error(
      `V${capture.version} is newer than the V5 compatibility target; refusing to downgrade`,
    );
  }
  if (capture.version === 5) return capture.bytes;

  const trailer = {
    ...capture.trailer,
    integrity: {
      algorithm: "SHA-256",
      scope: "file-with-integrity-digest-placeholder",
      digest: INTEGRITY_PLACEHOLDER,
    },
  };
  const trailerJson = Buffer.from(JSON.stringify(trailer));
  const trailerLength = TRAILER_HEADER_SIZE + trailerJson.length;
  let metadataJson = Buffer.alloc(0);
  let binaryOffset = 0;
  let trailerOffset = 0;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    capture.metadata.format_version = 5;
    capture.metadata.sections = {
      ...capture.metadata.sections,
      binary: {
        ...capture.metadata.sections?.binary,
        offset_bytes: binaryOffset,
        length_bytes: capture.payload.length,
        encrypted: capture.encrypted,
      },
      trailer: {
        ...capture.metadata.sections?.trailer,
        offset_bytes: trailerOffset,
        length_bytes: trailerLength,
        version: 2,
      },
    };
    metadataJson = Buffer.from(JSON.stringify(capture.metadata));
    const nextBinaryOffset =
      HEADER_SIZE + metadataJson.length + capture.framesBytes.length;
    const nextTrailerOffset = nextBinaryOffset + capture.payload.length;
    if (
      nextBinaryOffset === binaryOffset &&
      nextTrailerOffset === trailerOffset
    )
      break;
    binaryOffset = nextBinaryOffset;
    trailerOffset = nextTrailerOffset;
    if (attempt === 15)
      throw new Error("Could not stabilize V5 section offsets");
  }

  const trailerHeader = Buffer.concat([
    TRAILER_MAGIC,
    Buffer.from([2]),
    Buffer.alloc(7),
    Buffer.alloc(8),
  ]);
  trailerHeader.writeBigUInt64LE(BigInt(trailerJson.length), 16);
  const output = Buffer.concat([
    IQ_MAGIC,
    Buffer.alloc(8),
    Buffer.alloc(8),
    Buffer.alloc(8),
    Buffer.from([capture.encrypted ? 1 : 0]),
    Buffer.alloc(7),
    metadataJson,
    capture.framesBytes,
    capture.payload,
    trailerHeader,
    trailerJson,
  ]);
  output.writeBigUInt64LE(BigInt(metadataJson.length), 8);
  output.writeBigUInt64LE(BigInt(capture.framesBytes.length), 16);
  output.writeBigUInt64LE(BigInt(capture.payload.length), 24);
  const digestOffset = output.indexOf(
    Buffer.from(INTEGRITY_PLACEHOLDER),
    trailerOffset + TRAILER_HEADER_SIZE,
  );
  if (digestOffset < 0)
    throw new Error("Could not locate the V5 integrity placeholder");
  const digest = createHash("sha256").update(output).digest("hex");
  Buffer.from(digest).copy(output, digestOffset);
  return output;
}

/** Convert and re-encrypt a legacy fixed-header NAPT capture directly to V5. */
export function upgradeLegacyNaptBytes(input, vaultKey) {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.byteLength !== 32) {
    throw new Error("AES-256 vault key must be exactly 32 bytes");
  }
  const bytes = Buffer.from(input);
  if (bytes.subarray(0, 8).equals(IQ_MAGIC)) {
    throw new Error(
      "Input is already a NAPT-IQ3 capture; use upgradeIqCaptureBytes",
    );
  }
  const { root } = parseLegacyHeader(bytes);
  const legacyMetadata = root.metadata ?? root;
  if (
    !legacyMetadata ||
    typeof legacyMetadata !== "object" ||
    Array.isArray(legacyMetadata)
  ) {
    throw new Error("Legacy NAPT metadata is invalid");
  }
  if (
    Number.isInteger(legacyMetadata.format_version) &&
    legacyMetadata.format_version > 5
  ) {
    throw new Error(
      `Legacy NAPT V${legacyMetadata.format_version} is newer than the V5 target; refusing to downgrade`,
    );
  }
  const plaintext = decryptedLegacyPayload(
    bytes,
    root,
    legacyMetadata,
    Buffer.from(vaultKey),
  );
  const chunks = legacyIqChunks(legacyMetadata, root, plaintext);
  const frames = root.frame_updates ?? legacyMetadata.frame_updates ?? [];
  if (!Array.isArray(frames))
    throw new Error("Legacy NAPT frame updates are invalid");

  const metadata = {
    ...legacyMetadata,
    format: "iq",
    format_version: 3,
    interleaving: "IQ",
    sample_encoding: legacyMetadata.sample_encoding ?? {
      element_type: "integer",
      bits_per_element: 8,
      signed: false,
      byte_order: "little",
      normalization: "(value - 128) / 127",
    },
    source_container: "legacy-napt",
    source_format_version: Number.isInteger(legacyMetadata.format_version)
      ? legacyMetadata.format_version
      : null,
    encrypted: false,
  };
  delete metadata.sections;
  delete metadata.trailer;
  delete metadata.wrapped_dek;
  delete metadata.encrypted_dek;
  delete metadata.wrapped_key;
  delete metadata.encrypted_key;
  delete metadata.session_key;

  const plaintextIq = encodeV3Iq(metadata, frames, chunks);
  const encryptedV3 = encryptIqCaptureBytes(plaintextIq, Buffer.from(vaultKey));
  return upgradeIqCaptureBytes(encryptedV3);
}

function findLegacyHeaderOffset(bytes, jsonEnd) {
  const candidates = [1024, 2048, 4096, 8192];
  const matching = candidates.filter(
    (offset) =>
      offset > jsonEnd &&
      offset + 28 <= bytes.length &&
      bytes
        .subarray(jsonEnd, offset)
        .every(
          (byte) =>
            byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d,
        ),
  );
  if (matching.length === 0) {
    throw new Error(
      "Could not identify the legacy NAPT padded-header boundary",
    );
  }
  return matching[matching.length - 1];
}

/** Add a V5 index and integrity stamp while preserving encrypted NAPT bytes. */
export function upgradeLegacyNaptContainerBytes(input) {
  const bytes = Buffer.from(input);
  if (bytes.subarray(0, 8).equals(IQ_MAGIC)) {
    throw new Error("Input is NAPT-IQ3; use upgradeIqCaptureBytes");
  }
  const { root, end: jsonEnd } = parseLegacyHeader(bytes);
  const originalMetadata = root.metadata ?? root;
  if (
    !originalMetadata ||
    typeof originalMetadata !== "object" ||
    Array.isArray(originalMetadata)
  ) {
    throw new Error("Legacy NAPT metadata is invalid");
  }
  const sourceVersion = originalMetadata.format_version ?? null;
  if (Number.isInteger(sourceVersion) && sourceVersion > 5) {
    throw new Error(
      `Legacy NAPT V${sourceVersion} is newer than V5; refusing to downgrade`,
    );
  }
  if (
    originalMetadata.encrypted !== true &&
    originalMetadata.encrypted !== "true" &&
    root.encrypted !== true
  ) {
    throw new Error("Legacy NAPT input is not marked encrypted");
  }

  let payloadOffset;
  let payloadLength;
  let sourceTrailer = {};
  const oldBinary = originalMetadata.sections?.binary;
  const oldTrailer = originalMetadata.sections?.trailer;
  if (oldBinary && oldTrailer) {
    payloadOffset = oldBinary.offset_bytes;
    payloadLength = oldBinary.length_bytes;
    const trailerOffset = oldTrailer.offset_bytes;
    const trailerLength = oldTrailer.length_bytes;
    if (
      !Number.isSafeInteger(payloadOffset) ||
      !Number.isSafeInteger(payloadLength) ||
      payloadOffset < jsonEnd ||
      payloadLength < 28 ||
      payloadOffset + payloadLength !== trailerOffset ||
      trailerOffset + trailerLength !== bytes.length ||
      trailerLength < TRAILER_HEADER_SIZE ||
      !bytes.subarray(trailerOffset, trailerOffset + 8).equals(TRAILER_MAGIC)
    ) {
      throw new Error(
        "Legacy NAPT section index or trailer bounds are invalid",
      );
    }
    const markerVersion = bytes[trailerOffset + 8];
    if (markerVersion !== 1 && markerVersion !== 2) {
      throw new Error("Legacy NAPT trailer marker is invalid");
    }
    const trailerJsonLength = readU64(
      bytes,
      trailerOffset + 16,
      "trailer JSON length",
    );
    if (trailerJsonLength + TRAILER_HEADER_SIZE !== trailerLength) {
      throw new Error("Legacy NAPT trailer length is invalid");
    }
    sourceTrailer = parseJson(
      bytes.subarray(trailerOffset + TRAILER_HEADER_SIZE),
      "legacy NAPT trailer",
    );
    if (sourceVersion >= 5) {
      if (markerVersion !== 2) {
        throw new Error("V5 NAPT trailer marker is invalid");
      }
      verifyIntegrity(bytes, sourceTrailer, trailerOffset);
      return bytes;
    }
    if (sourceVersion === 4 && markerVersion !== 1) {
      throw new Error("V4 NAPT trailer marker is invalid");
    }
  } else {
    payloadOffset = findLegacyHeaderOffset(bytes, jsonEnd);
    payloadLength = bytes.length - payloadOffset;
    if (payloadLength < 28) {
      throw new Error("Legacy NAPT encrypted payload is truncated");
    }
  }

  const encryptedPayload = bytes.subarray(
    payloadOffset,
    payloadOffset + payloadLength,
  );
  const trailer = {
    ...sourceTrailer,
    integrity: {
      algorithm: "SHA-256",
      scope: "file-with-integrity-digest-placeholder",
      digest: INTEGRITY_PLACEHOLDER,
    },
  };
  const trailerJson = Buffer.from(JSON.stringify(trailer));
  const newTrailerLength = TRAILER_HEADER_SIZE + trailerJson.length;
  const metadata = {
    ...originalMetadata,
    format_version: 5,
    encrypted: true,
    source_container_version: sourceVersion,
  };
  let headerSize = payloadOffset;
  let metadataJson = Buffer.alloc(0);
  let trailerOffset = 0;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    metadata.sections = {
      ...originalMetadata.sections,
      binary: {
        ...oldBinary,
        offset_bytes: headerSize,
        length_bytes: encryptedPayload.length,
        encrypted: true,
      },
      trailer: {
        ...oldTrailer,
        offset_bytes: headerSize + encryptedPayload.length,
        length_bytes: newTrailerLength,
        version: 2,
      },
    };
    const outputRoot = root.metadata ? { ...root, metadata } : { ...metadata };
    metadataJson = Buffer.from(JSON.stringify(outputRoot));
    const requiredHeaderSize = Math.max(
      4096,
      Math.ceil((metadataJson.length + 1) / 1024) * 1024,
    );
    trailerOffset = headerSize + encryptedPayload.length;
    if (requiredHeaderSize <= headerSize) break;
    headerSize = requiredHeaderSize;
    if (attempt === 15) {
      throw new Error("Could not stabilize V5 NAPT section offsets");
    }
  }

  const paddedHeader = Buffer.alloc(headerSize, 0x20);
  metadataJson.copy(paddedHeader);
  const trailerHeader = Buffer.alloc(TRAILER_HEADER_SIZE);
  TRAILER_MAGIC.copy(trailerHeader);
  trailerHeader[8] = 2;
  trailerHeader.writeBigUInt64LE(BigInt(trailerJson.length), 16);
  const output = Buffer.concat([
    paddedHeader,
    encryptedPayload,
    trailerHeader,
    trailerJson,
  ]);
  const digestOffset = output.indexOf(
    Buffer.from(INTEGRITY_PLACEHOLDER),
    trailerOffset + TRAILER_HEADER_SIZE,
  );
  if (digestOffset < 0) {
    throw new Error("Could not locate V5 NAPT integrity placeholder");
  }
  const digest = createHash("sha256").update(output).digest("hex");
  Buffer.from(digest).copy(output, digestOffset);
  return output;
}

function main(args = process.argv.slice(2)) {
  if (args.length < 1 || args.length > 2) {
    throw new Error(
      "Usage: node scripts/upgrade_iq_capture.mjs <input.iq> [output.iq]",
    );
  }
  const inputPath = resolve(args[0]);
  const outputPath = resolve(args[1] ?? `${inputPath}.v5.iq`);
  const output = upgradeIqCaptureBytes(readFileSync(inputPath));
  writeFileSync(outputPath, output, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Upgraded capture written to ${outputPath}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`upgrade_iq_capture: ${error.message}\n`);
    process.exitCode = 1;
  }
}
