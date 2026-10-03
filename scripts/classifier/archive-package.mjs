#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decryptIqCapturePayload, encryptIqCaptureBytes, rewrapIqCapturePayload } from "../encrypt_iq_capture.mjs";
import {
  deriveCaptureProtectionKey,
  getOrCreateCaptureProtectionSalt,
  loadCaptureProtectionSalt,
  loadIqCaptureKey,
} from "./crypto.mjs";
import { createCapturePackage, readCapturePackage } from "./package.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLASSIFICATION_ROOT = path.resolve(
  SCRIPT_DIR,
  "../../../n-apt-ml/training-captures/classification",
);
const LABEL_DRAFT_FORMAT = "n-apt-native-label-draft-v1";
const REGISTRY_COLUMNS = [
  "capture_id",
  "split",
  "label",
  "channel",
  "features",
  "tags",
  "capture_file",
];
const TRAINING_SPLITS = new Set(["train", "validation", "test"]);
const CHALLENGE_SPLITS = new Set(["challenge-mock", "challenge-sinc"]);

function splitSegments(split, label) {
  if (TRAINING_SPLITS.has(split)) return [split, label];
  if (split === "unlabeled") return ["unlabeled"];
  if (split === "challenge-mock") return ["challenge", "mock", label];
  if (split === "challenge-sinc") return ["challenge", "sinc", label];
  throw new Error(
    "Split must be train, validation, test, unlabeled, challenge-mock, or challenge-sinc",
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Classification labels.csv has an unclosed quoted field");
  if (field.length || row.length) {
    row.push(field);
    if (row.some((item) => item !== "")) rows.push(row);
  }
  return rows;
}

function csvDocument(columns, rows) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n") + "\n";
}

async function readRegistry(root) {
  const registryPath = path.join(root, "labels.csv");
  let bytes;
  try {
    bytes = await readFile(registryPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { registryPath, columns: [...REGISTRY_COLUMNS], rows: [] };
  }
  const parsed = parseCsv(bytes.replace(/^\uFEFF/, ""));
  if (!parsed.length) return { registryPath, columns: [...REGISTRY_COLUMNS], rows: [] };
  const oldColumns = parsed[0];
  if (new Set(oldColumns).size !== oldColumns.length || oldColumns.some((name) => !name)) {
    throw new Error("Classification labels.csv has an invalid header");
  }
  const columns = [...REGISTRY_COLUMNS];
  const rows = parsed.slice(1).map((values) => {
    if (values.length !== oldColumns.length) {
      throw new Error("Classification labels.csv contains a row with the wrong number of fields");
    }
    return Object.fromEntries(oldColumns.map((column, index) => [column, values[index]]));
  });
  return { registryPath, columns, rows };
}

function packageDraftLabels(labels) {
  return {
    format: LABEL_DRAFT_FORMAT,
    sessionId: labels.sessionId,
    annotations: labels.annotations,
    annotationEvents: labels.annotationEvents,
    interferenceMarkedEvents: labels.interferenceMarkedEvents,
  };
}

function validateSplitAndLabel(split, labels) {
  const label = labels?.annotations?.label;
  if (!["matching", "nonmatching", "uncertain"].includes(label)) {
    throw new Error("Capture package must include matching, nonmatching, or uncertain labels");
  }
  if (split === "unlabeled" && label !== "uncertain") {
    throw new Error("Only uncertain labels may be archived in the unlabeled folder");
  }
  if (TRAINING_SPLITS.has(split) && label === "uncertain") {
    throw new Error("Uncertain captures cannot be placed in train, validation, or test");
  }
  if (!TRAINING_SPLITS.has(split) && split !== "unlabeled" && !CHALLENGE_SPLITS.has(split)) {
    throw new Error(`Unsupported archive split: ${split}`);
  }
  return label;
}

function assertSameAnnotation(existing, row) {
  for (const field of ["session_id", "split", "label", "channel", "features", "tags"]) {
    if (existing[field] !== row[field]) {
      throw new Error(
        `Capture checksum is already archived with different ${field}; refusing to relabel an existing record`,
      );
    }
  }
}

async function findArchiveBySource(root, sourceCaptureId) {
  const expectedDirectory = `capture-${sourceCaptureId.slice(0, 16)}`;
  async function visit(directory, depth) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.name === expectedDirectory) {
        try {
          const descriptor = JSON.parse(
            await readFile(path.join(candidate, "datapackage.json"), "utf8"),
          );
          if (descriptor?.napt?.archive?.sourceCaptureId === sourceCaptureId) {
            return { packagePath: candidate, archive: descriptor.napt.archive };
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      if (depth < 5) {
        const match = await visit(candidate, depth + 1);
        if (match) return match;
      }
    }
    return null;
  }
  return visit(root, 0);
}

async function writeRegistry(registry) {
  const csv = csvDocument(registry.columns, registry.rows);
  const temporaryRegistry = `${registry.registryPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryRegistry, csv, { flag: "wx", mode: 0o644 });
    await rename(temporaryRegistry, registry.registryPath);
  } finally {
    await rm(temporaryRegistry, { force: true });
  }
}

async function registerArchivedPackage({ root, registry, baseRow, sourceCaptureId, packagePath, capture }) {
  const captureFile = path.join(packagePath, "captures", capture.captureName);
  const row = {
    ...baseRow,
    capture_id: capture.captureId,
    capture_file: path.relative(root, captureFile).split(path.sep).join("/"),
  };
  const existingRow = registry.rows.find((item) => item.capture_id === row.capture_id);
  if (existingRow) Object.assign(existingRow, row);
  else registry.rows.push(row);
  await writeRegistry(registry);
  return {
    packagePath,
    captureId: capture.captureId,
    sourceCaptureId,
    existing: true,
  };
}

/** Archives one browser Data Package, encrypting its raw IQ payload before storage. */
export async function archiveCapturePackage({
  packagePath,
  classificationRoot = DEFAULT_CLASSIFICATION_ROOT,
  split,
  envFile = ".env.local",
  captureSaltProvider,
} = {}) {
  if (!packagePath || !split) throw new Error("archive requires --package and --split");
  const capture = await readCapturePackage(packagePath);
  if (!["iq", "napt"].includes(capture.format) || capture.metadata?.format_version !== 6) {
    throw new Error("Only verified V6 .iq or .napt Data Packages can be archived for classification");
  }
  const encrypted = capture.metadata.encrypted === true || capture.metadata.encrypted === "true" || capture.metadata.sections?.binary?.encrypted === true;
  if (capture.format === "napt" && !encrypted) {
    throw new Error("Plaintext V6 .napt cannot be archived; encrypt it with the existing capture migration workflow first");
  }
  const label = validateSplitAndLabel(split, capture.labels);
  const sourceCaptureId = capture.captureId;
  const root = path.resolve(classificationRoot);
  await mkdir(root, { recursive: true });
  const registry = await readRegistry(root);
  const annotation = capture.labels.annotations;
  const baseRow = {
    session_id: capture.labels.sessionId,
    split,
    label,
    channel: annotation.channel,
    features: annotation.features.join(";"),
    tags: annotation.tags.join(";"),
  };
  const storageSegments = splitSegments(split, label);
  const categoryDirectory = path.join(root, ...storageSegments);
  await mkdir(categoryDirectory, { recursive: true });
  const directoryName = `capture-${sourceCaptureId.slice(0, 16)}`;
  const finalPackagePath = path.join(categoryDirectory, directoryName);
  const existingArchive = await findArchiveBySource(root, sourceCaptureId);
  if (existingArchive) {
    const archive = existingArchive.archive;
    if (archive.split !== split || archive.label !== label || archive.sessionId !== capture.labels.sessionId) {
      throw new Error("This source capture is already archived with a different split, session, or label; refusing to create a cross-split duplicate");
    }
    const existingPackage = await readCapturePackage(existingArchive.packagePath);
    if (archive.captureId !== existingPackage.captureId) {
      throw new Error("Archived Data Package checksum metadata does not match its capture");
    }
    assertSameAnnotation({
      session_id: existingPackage.labels.sessionId,
      split: archive.split,
      label: existingPackage.labels.annotations.label,
      channel: existingPackage.labels.annotations.channel,
      features: existingPackage.labels.annotations.features.join(";"),
      tags: existingPackage.labels.annotations.tags.join(";"),
    }, baseRow);
    return await registerArchivedPackage({
      root,
      registry,
      baseRow,
      sourceCaptureId,
      packagePath: existingArchive.packagePath,
      capture: existingPackage,
    });
  }

  let archivedBytes = capture.captureBytes;
  let archiveEncryption = encrypted ? "pre-encrypted" : "none";
  let saltKey;
  if (capture.format === "iq") {
    saltKey = `capture-protection:${sourceCaptureId}`;
    const salt = captureSaltProvider
      ? Buffer.from(await captureSaltProvider(sourceCaptureId))
      : capture.archive?.encryption === "AES-256-GCM-REDIS-SALT-V1"
        ? await loadCaptureProtectionSalt(sourceCaptureId, { envFile })
        : await getOrCreateCaptureProtectionSalt(sourceCaptureId, { envFile });
    if (salt.length !== 32) throw new Error("Capture salt provider must return exactly 32 bytes");
    const vaultKey = await loadIqCaptureKey({ envFile });
    const captureKey = deriveCaptureProtectionKey(vaultKey, salt);
    try {
      if (capture.archive?.encryption === "AES-256-GCM-REDIS-SALT-V1") {
        const verified = decryptIqCapturePayload(capture.captureBytes, captureKey);
        if (!verified.length) throw new Error("Encrypted archive has an empty IQ payload");
      } else if (encrypted) {
        archivedBytes = rewrapIqCapturePayload(capture.captureBytes, vaultKey, captureKey);
      } else {
        archivedBytes = encryptIqCaptureBytes(capture.captureBytes, captureKey);
      }
    } finally {
      vaultKey.fill(0);
      captureKey.fill(0);
      salt.fill(0);
    }
    archiveEncryption = "AES-256-GCM-REDIS-SALT-V1";
  }
  const captureId = capture.format !== "iq" ? sourceCaptureId : (() => {
    const metadataLength = Number(archivedBytes.readBigUInt64LE(8));
    const framesLength = Number(archivedBytes.readBigUInt64LE(16));
    const payloadLength = Number(archivedBytes.readBigUInt64LE(24));
    const trailerOffset = 40 + metadataLength + framesLength + payloadLength;
    const trailerJsonLength = Number(archivedBytes.readBigUInt64LE(trailerOffset + 16));
    const trailer = JSON.parse(archivedBytes.subarray(trailerOffset + 24, trailerOffset + 24 + trailerJsonLength).toString("utf8"));
    const id = trailer?.integrity?.digest;
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/i.test(id)) {
      throw new Error("Encrypted capture has no valid V6 trailer checksum");
    }
    return id.toLowerCase();
  })();
  const encryptedName = capture.captureName;
  const stagingRoot = await mkdtemp(path.join(categoryDirectory, ".archive-stage-"));
  const stagingPackagePath = path.join(stagingRoot, directoryName);
  const temporaryInput = await mkdtemp(path.join(os.tmpdir(), "napt-classifier-archive-"));
  try {
    const encryptedCapturePath = path.join(temporaryInput, encryptedName);
    const draftLabelsPath = path.join(temporaryInput, "labels-draft.json");
    await writeFile(encryptedCapturePath, archivedBytes, { flag: "wx", mode: 0o600 });
    await writeFile(draftLabelsPath, `${JSON.stringify(packageDraftLabels(capture.labels), null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await createCapturePackage({
      capturePath: encryptedCapturePath,
      labelsPath: draftLabelsPath,
      outputPath: stagingPackagePath,
    });
    const descriptorPath = path.join(stagingPackagePath, "datapackage.json");
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
    descriptor.napt ??= {};
    descriptor.napt.archive = {
      format: "n-apt-classification-archive-v1",
      sourceCaptureId,
      captureId,
      split,
      label,
      sessionId: capture.labels.sessionId,
      encryption: archiveEncryption,
      ...(saltKey ? { saltKey } : {}),
    };
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
    await rename(stagingPackagePath, finalPackagePath);
  } finally {
    await rm(temporaryInput, { recursive: true, force: true });
    await rm(stagingRoot, { recursive: true, force: true });
  }

  const archivedCapture = await readCapturePackage(finalPackagePath);
  if (archivedCapture.captureId !== captureId) {
    throw new Error("Archived Data Package checksum does not match the encrypted capture");
  }
  await registerArchivedPackage({
    root,
    registry,
    baseRow,
    sourceCaptureId,
    packagePath: finalPackagePath,
    capture: archivedCapture,
  });
  return {
    packagePath: finalPackagePath,
    captureId,
    sourceCaptureId,
    existing: false,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    values[key.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await archiveCapturePackage({
    packagePath: args.package,
    classificationRoot: args.classification_root ?? DEFAULT_CLASSIFICATION_ROOT,
    split: args.split,
    envFile: args.env_file ?? ".env.local",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`classifier archive: ${error.message}\n`);
    process.exitCode = 1;
  }
}
