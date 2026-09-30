#!/usr/bin/env node
// Upgrade and encrypt every .iq/.napt capture in an evidentiary directory.
// The source directory is changed only after every output has passed V5 checks.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import {
  deriveIqCaptureKey,
  encryptIqCaptureBytes,
} from "./encrypt_iq_capture.mjs";
import { inspectCaptureEncryption } from "./git/check_encrypted_captures.mjs";
import {
  upgradeIqCaptureBytes,
  upgradeLegacyNaptContainerBytes,
} from "./upgrade_iq_capture.mjs";

const IQ_MAGIC = Buffer.from("NAPT-IQ3");
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function decodeCapture(bytes, extension, key) {
  const isIqContainer = bytes.subarray(0, 8).equals(IQ_MAGIC);
  if (extension === ".iq" && !isIqContainer) {
    throw new Error(".iq file is not a NAPT-IQ3 capture");
  }
  let output;
  if (isIqContainer) {
    output = upgradeIqCaptureBytes(bytes);
    if (output[32] === 0) output = encryptIqCaptureBytes(output, key);
  } else if (extension === ".napt") {
    output = upgradeLegacyNaptContainerBytes(bytes);
  } else {
    throw new Error("Unsupported capture container");
  }
  const encryption = inspectCaptureEncryption(`capture${extension}`, output);
  if (!encryption.encrypted) {
    throw new Error(`Migration output is not encrypted: ${encryption.reason}`);
  }
  // Re-run the appropriate upgrader as a read-only V5 integrity check.
  if (isIqContainer) upgradeIqCaptureBytes(output);
  else upgradeLegacyNaptContainerBytes(output);
  return output;
}

/** Convert and atomically replace all capture files after staging every result. */
export function migrateCaptureDirectory(
  directoryPath,
  key,
  { dryRun = false } = {},
) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new Error("AES-256 capture key must be exactly 32 bytes");
  }
  const directory = resolve(directoryPath);
  const sources = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        [".iq", ".napt"].includes(extname(entry.name).toLowerCase()),
    )
    .map((entry) => ({
      name: entry.name,
      path: join(directory, entry.name),
      extension: extname(entry.name).toLowerCase(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (sources.length === 0) return { migrated: 0, outputs: [] };

  const outputs = sources.map((source) => ({
    ...source,
    outputName: source.name,
  }));
  const outputNames = new Set();
  for (const output of outputs) {
    if (outputNames.has(output.outputName)) {
      throw new Error(`Multiple source captures map to ${output.outputName}`);
    }
    outputNames.add(output.outputName);
  }

  const stagingRoot = dryRun ? tmpdir() : directory;
  const staging = mkdtempSync(join(stagingRoot, ".napt-evidentiary-v5-"));
  const stagedFiles = [];
  const backups = [];
  const installed = [];
  try {
    for (const source of outputs) {
      try {
        const converted = decodeCapture(
          readFileSync(source.path),
          source.extension,
          Buffer.from(key),
        );
        const stagedPath = join(staging, source.outputName);
        writeFileSync(stagedPath, converted, { flag: "wx", mode: 0o600 });
        stagedFiles.push({
          source,
          stagedPath,
          outputPath: join(directory, source.outputName),
        });
      } catch (error) {
        throw new Error(`${source.name}: ${error.message}`);
      }
    }

    if (dryRun) {
      rmSync(staging, { recursive: true, force: true });
      return {
        migrated: stagedFiles.length,
        outputs: stagedFiles.map(({ source, outputPath }) => ({
          from: source.name,
          to: basename(outputPath),
        })),
      };
    }

    const backupDirectory = join(staging, "originals");
    mkdirSync(backupDirectory, { mode: 0o700 });
    for (const { source } of stagedFiles) {
      const backupPath = join(backupDirectory, source.name);
      renameSync(source.path, backupPath);
      backups.push({ sourcePath: source.path, backupPath });
    }
    for (const item of stagedFiles) {
      renameSync(item.stagedPath, item.outputPath);
      installed.push(item.outputPath);
    }

    rmSync(staging, { recursive: true, force: true });
    return {
      migrated: stagedFiles.length,
      outputs: stagedFiles.map(({ source, outputPath }) => ({
        from: source.name,
        to: basename(outputPath),
      })),
    };
  } catch (error) {
    for (const outputPath of installed.reverse())
      rmSync(outputPath, { force: true });
    for (const { sourcePath, backupPath } of backups.reverse()) {
      if (existsSync(backupPath)) renameSync(backupPath, sourcePath);
    }
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function resolveDotenvValue(value, config) {
  if (typeof value !== "string") return value;
  const reference = value.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
  return reference
    ? (config[reference[1]] ?? process.env[reference[1]] ?? value)
    : value;
}

function migrationKey() {
  const envPath = join(SCRIPT_ROOT, ".env.local");
  const config = existsSync(envPath) ? dotenv.parse(readFileSync(envPath)) : {};
  const passphrase =
    process.env.UNSAFE_LOCAL_USER_PASSWORD ??
    process.env.N_APT_PASSKEY ??
    resolveDotenvValue(
      config.UNSAFE_LOCAL_USER_PASSWORD ??
        config.N_APT_PASSKEY ??
        config.VITE_UNSAFE_LOCAL_USER_PASSWORD,
      config,
    );
  if (!passphrase) {
    throw new Error(
      "Set UNSAFE_LOCAL_USER_PASSWORD or N_APT_PASSKEY in the shell or .env.local",
    );
  }
  const salt =
    process.env.NAPT_PBKDF2_SALT ??
    process.env.VITE_PBKDF2_SALT ??
    config.NAPT_PBKDF2_SALT ??
    config.VITE_PBKDF2_SALT;
  return deriveIqCaptureKey(passphrase, salt);
}

function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || !["--dry-run", "--in-place"].includes(args[1])) {
    throw new Error(
      "Usage: node scripts/migrate_evidentiary_captures.mjs <captures-directory> --dry-run|--in-place",
    );
  }
  const dryRun = args[1] === "--dry-run";
  const report = migrateCaptureDirectory(args[0], migrationKey(), { dryRun });
  process.stdout.write(
    `${dryRun ? "Validated" : "Migrated"} ${report.migrated} capture(s) as encrypted V5.\n`,
  );
  if (!dryRun) {
    for (const item of report.outputs)
      process.stdout.write(`  ${item.from} -> ${item.to}\n`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`migrate_evidentiary_captures: ${error.message}\n`);
    process.exitCode = 1;
  }
}
