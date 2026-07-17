#!/usr/bin/env node

/**
 * Manual .napt -> raw IQ harness for shader and DSP experiments.
 *
 * This is intentionally opt-in. It never runs as part of the normal test
 * suite, never accepts a password on the command line, and defaults all
 * decrypted output to /private/tmp so raw samples do not enter the repository.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HEADER_SIZE_CANDIDATES = [4096, 2048, 8192, 1024];
const DEFAULT_SALT = "n-apt-aes-salt-v1";
const PBKDF2_ITERATIONS = 100_000;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

function parseDotEnv(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function resolveEnvReference(value, values) {
  if (value.startsWith("$")) return values[value.slice(1)] ?? value;
  return value;
}

function findJsonBoundary(bytes, limit = 16_384) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let started = false;
  const end = Math.min(bytes.length, limit);
  for (let i = 0; i < end; i++) {
    const character = String.fromCharCode(bytes[i]);
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") {
      started = true;
      depth++;
    } else if (character === "}" && started && --depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

export function parseNaptHeader(bytes) {
  const jsonEnd = findJsonBoundary(bytes);
  if (jsonEnd < 0) throw new Error("Could not find the JSON header boundary");
  let root;
  try {
    root = JSON.parse(Buffer.from(bytes.subarray(0, jsonEnd)).toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid .napt JSON header: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { root, metadata: root.metadata ?? root, jsonEnd };
}

function decryptGcm(payload, key) {
  if (payload.length < AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES) {
    throw new Error("Encrypted payload is too short");
  }
  const iv = payload.subarray(0, AES_GCM_IV_BYTES);
  const body = payload.subarray(AES_GCM_IV_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(body.subarray(-AES_GCM_TAG_BYTES));
  return Buffer.concat([decipher.update(body.subarray(0, -AES_GCM_TAG_BYTES)), decipher.final()]);
}

function getWrappedDek(root, metadata) {
  return root.wrapped_dek ?? root.encrypted_dek ?? metadata.wrapped_dek ?? metadata.encrypted_dek;
}

function decryptWithHeader(bytes, headerSize, vaultKey, root, metadata) {
  const wrappedDek = getWrappedDek(root, metadata);
  let dataKey = vaultKey;
  if (wrappedDek) dataKey = decryptGcm(Buffer.from(wrappedDek, "base64"), vaultKey);
  return decryptGcm(bytes.subarray(headerSize), dataKey);
}

function captureChannel(root, metadata, plaintextLength) {
  const channel = (metadata.channels ?? root.channels ?? [])[0] ?? {};
  const offset = Number(channel.offset_iq ?? metadata.offset_iq ?? root.offset_iq ?? 0);
  const requestedLength = Number(channel.iq_length ?? metadata.iq_length ?? root.iq_length ?? plaintextLength - offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > plaintextLength) throw new Error("Invalid IQ channel offset");
  const length = Math.min(Math.max(0, requestedLength), plaintextLength - offset);
  return { offset, length };
}

function loadPassword(envFile) {
  const fileValues = parseDotEnv(envFile);
  const values = { ...fileValues, ...process.env };
  const rawPassword = process.env.UNSAFE_LOCAL_USER_PASSWORD ??
    process.env.VITE_UNSAFE_LOCAL_USER_PASSWORD ??
    fileValues.UNSAFE_LOCAL_USER_PASSWORD ??
    fileValues.VITE_UNSAFE_LOCAL_USER_PASSWORD;
  if (!rawPassword) throw new Error("UNSAFE_LOCAL_USER_PASSWORD is missing; set it in .env.local or the environment");
  return resolveEnvReference(rawPassword, values).trim();
}

export function decryptNaptBytes(bytes, { password, salt = DEFAULT_SALT } = {}) {
  if (!password) throw new Error("A password is required; do not pass it as a CLI argument");
  const { root, metadata } = parseNaptHeader(bytes);
  const encrypted = metadata.encrypted === true || metadata.encrypted === "true" || root.encrypted === true;
  let plaintext;
  if (!encrypted) {
    plaintext = Buffer.from(bytes.subarray(4096));
  } else {
    const vaultKey = crypto.pbkdf2Sync(password.trim(), salt, PBKDF2_ITERATIONS, 32, "sha256");
    let lastError;
    for (const headerSize of HEADER_SIZE_CANDIDATES) {
      if (bytes.length <= headerSize + AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES) continue;
      try {
        plaintext = decryptWithHeader(bytes, headerSize, vaultKey, root, metadata);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!plaintext) throw new Error(`Could not decrypt .napt payload${lastError ? `: ${lastError.message}` : ""}`);
  }
  const channel = captureChannel(root, metadata, plaintext.length);
  const iq = Buffer.from(plaintext.subarray(channel.offset, channel.offset + channel.length));
  if (iq.length % 2 !== 0) throw new Error("Extracted IQ payload has an odd byte length");
  return { root, metadata, iq };
}

export function parseFrameSelection(selection, frameCount) {
  if (frameCount <= 0) return [];
  if (!selection || selection.trim().toLowerCase() === "all") return Array.from({ length: frameCount }, (_, index) => index);
  const selected = [];
  const seen = new Set();
  for (const token of selection.split(",")) {
    const index = Number.parseInt(token.trim(), 10);
    if (Number.isInteger(index) && index >= 0 && index < frameCount && !seen.has(index)) {
      seen.add(index);
      selected.push(index);
    }
  }
  return selected;
}

function safeBaseName(input) {
  return path.basename(input).replace(/\.napt$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function publicMetadata(metadata) {
  const allowed = ["sample_rate_hz", "sample_rate", "center_frequency_hz", "center_frequency", "frame_rate", "duration_s", "duration", "fft_size", "format", "iq_format"];
  return Object.fromEntries(allowed.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]));
}

export function buildManifest({ input, outputDir, iqByteLength, fftSize, frameIndices, metadata }) {
  const frameByteLength = fftSize * 2;
  return {
    version: 1,
    input_file: path.basename(input),
    output_dir: outputDir,
    iq_format: "iq_u8",
    byte_order: "interleaved I0,Q0,I1,Q1",
    iq_byte_length: iqByteLength,
    complex_sample_count: Math.floor(iqByteLength / 2),
    fft_size: fftSize,
    frame_byte_length: frameByteLength,
    complete_frame_count: Math.floor(iqByteLength / frameByteLength),
    frame_count: frameIndices.length,
    frames: frameIndices.map((index) => ({ index, file: `frames/frame_${String(index).padStart(6, "0")}.iq.u8` })),
    capture_metadata: publicMetadata(metadata),
  };
}

function printHelp() {
  console.log(`Manual .napt capture harness\n\nDecrypt a capture and extract raw interleaved I/Q for shader tests.\n\nUsage:\n  node scripts/test/manual_napt_capture_harness.mjs --input capture.napt [options]\n\nOptions:\n  --input PATH       Encrypted .napt capture to read (required)\n  --out-dir PATH     Output directory; defaults to /private/tmp/napt-harness/<capture>\n  --fft-size N       Complex samples per frame; defaults to capture metadata or 65536\n  --frames LIST      Comma-separated frame indices, or 'all' (default: all)\n  --env-file PATH    Password env file (default: .env.local)\n  --help             Show this help\n\nOutput contains raw unsigned 8-bit interleaved I/Q and selected frame files.\nThe password is read from UNSAFE_LOCAL_USER_PASSWORD and is never accepted as a CLI argument.\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2).replaceAll("-", "_");
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key.replaceAll("_", "-")}`);
    options[key] = value;
  }
  return options;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (!args.input) throw new Error("--input is required");
  const input = path.resolve(args.input);
  const bytes = await readFile(input);
  const { root, metadata, iq } = decryptNaptBytes(bytes, {
    password: loadPassword(args.env_file ? path.resolve(args.env_file) : path.resolve(".env.local")),
    salt: process.env.NAPT_PBKDF2_SALT ?? process.env.VITE_PBKDF2_SALT ?? DEFAULT_SALT,
  });
  const fftSize = Number.parseInt(args.fft_size ?? metadata.fft_size ?? 65_536, 10);
  if (!Number.isInteger(fftSize) || fftSize <= 0 || (fftSize & (fftSize - 1)) !== 0) throw new Error("--fft-size must be a positive power of two");
  const completeFrameCount = Math.floor(iq.length / (fftSize * 2));
  const frameIndices = parseFrameSelection(args.frames, completeFrameCount);
  const outputDir = path.resolve(args.out_dir ?? path.join("/private/tmp/napt-harness", safeBaseName(input)));
  await mkdir(path.join(outputDir, "frames"), { recursive: true });
  await writeFile(path.join(outputDir, "raw.iq.u8"), iq);
  for (const frameIndex of frameIndices) {
    const start = frameIndex * fftSize * 2;
    await writeFile(path.join(outputDir, "frames", `frame_${String(frameIndex).padStart(6, "0")}.iq.u8`), iq.subarray(start, start + fftSize * 2));
  }
  const manifest = buildManifest({ input, outputDir, iqByteLength: iq.length, fftSize, frameIndices, metadata });
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ output_dir: outputDir, raw_iq: path.join(outputDir, "raw.iq.u8"), manifest: path.join(outputDir, "manifest.json"), frame_count: frameIndices.length, sample_rate_hz: metadata.sample_rate_hz ?? metadata.sample_rate ?? null }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
