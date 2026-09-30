import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { readTrainingCapture } from "./io.mjs";
import { verifyCaptureArtifact } from "../cli/artifact.ts";

const LABEL_DRAFT_FORMAT = "n-apt-native-label-draft-v1";
const LABEL_PACKAGE_FORMAT = "n-apt-capture-labels-v1";
const CAPTURE_ANNOTATIONS_FORMAT = "n-apt-native-annotations-v2";
const DATA_PACKAGE_SCHEMA =
  "https://datapackage.org/profiles/2.0/datapackage.json";
const INTEGRITY_SCOPE = "file-with-integrity-digest-placeholder";
const MAX_PACKAGE_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_PACKAGE_RESOURCE_BYTES = 128 * 1024 * 1024;
const MAX_PACKAGE_DESCRIPTOR_BYTES = 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readU64(bytes, offset) {
  const value = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Capture has an unsafe size field");
  return Number(value);
}

function metadataForV6(bytes, extension) {
  if (extension === "iq") {
    if (
      bytes.byteLength < 40 ||
      Buffer.from(bytes.subarray(0, 8)).toString("ascii") !== "NAPT-IQ3"
    )
      throw new Error("IQ capture has an invalid NAPT-IQ3 header");
    const metadataLength = readU64(bytes, 8);
    const framesLength = readU64(bytes, 16);
    const payloadLength = readU64(bytes, 24);
    const metadataStart = 40;
    const framesStart = metadataStart + metadataLength;
    const payloadStart = framesStart + framesLength;
    if (payloadStart + payloadLength > bytes.byteLength)
      throw new Error("IQ capture is truncated");
    return JSON.parse(
      Buffer.from(bytes.subarray(metadataStart, framesStart)).toString("utf8"),
    );
  }
  const lineEnd = bytes.indexOf(10);
  if (lineEnd <= 0)
    throw new Error("NAPT capture has an invalid header boundary");
  const root = JSON.parse(
    Buffer.from(bytes.subarray(0, lineEnd)).toString("utf8"),
  );
  return root.metadata ?? root;
}

function trailerIntegrity(bytes, metadata) {
  const section = metadata?.sections?.trailer;
  const offset = section?.offset_bytes;
  const length = section?.length_bytes;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 24 ||
    offset + length > bytes.byteLength
  ) {
    throw new Error("V6 capture has an invalid integrity trailer range");
  }
  const trailer = bytes.subarray(offset, offset + length);
  if (
    Buffer.from(trailer.subarray(0, 8)).toString("ascii") !== "NAPTTRLR" ||
    trailer[8] !== 2 ||
    readU64(trailer, 16) + 24 !== trailer.byteLength
  ) {
    throw new Error("V6 capture has an invalid integrity trailer");
  }
  const parsed = JSON.parse(Buffer.from(trailer.subarray(24)).toString("utf8"));
  if (
    parsed?.integrity?.algorithm !== "SHA-256" ||
    parsed.integrity.scope !== INTEGRITY_SCOPE ||
    !/^[\da-f]{64}$/i.test(parsed.integrity.digest)
  ) {
    throw new Error("V6 capture has incomplete trailer integrity metadata");
  }
  return parsed.integrity;
}

export function decodeV6IqContainer(bytes, metadata, decryptedPayload = null) {
  if (
    Buffer.from(bytes.subarray(0, 8)).toString("ascii") !== "NAPT-IQ3" ||
    metadata?.format !== "iq" ||
    metadata?.format_version !== 6 ||
    metadata?.interleaving !== "IQ" ||
    metadata?.sample_encoding?.element_type !== "integer" ||
    metadata?.sample_encoding?.bits_per_element !== 8 ||
    metadata?.sample_encoding?.signed !== false
  ) {
    throw new Error(
      "Only V6 unsigned 8-bit interleaved IQ containers are supported",
    );
  }
  const metadataLength = readU64(bytes, 8);
  const frameUpdatesLength = readU64(bytes, 16);
  const payloadLength = readU64(bytes, 24);
  const metadataStart = 40;
  const frameUpdatesStart = metadataStart + metadataLength;
  const payloadStart = frameUpdatesStart + frameUpdatesLength;
  const payloadEnd = payloadStart + payloadLength;
  if (payloadEnd > bytes.byteLength)
    throw new Error("IQ capture container is truncated");
  const frameUpdates = JSON.parse(
    Buffer.from(bytes.subarray(frameUpdatesStart, payloadStart)).toString(
      "utf8",
    ),
  );
  const binary = metadata.sections?.binary;
  const encrypted = metadata.encrypted === true || metadata.encrypted === "true";
  if (
    binary?.encoding !== "iq_u8_interleaved" ||
    binary.offset_bytes !== payloadStart ||
    binary.length_bytes !== payloadLength
  ) {
    throw new Error("IQ capture has inconsistent binary section metadata");
  }
  if (!Array.isArray(frameUpdates) || !frameUpdates.length) {
    throw new Error("IQ capture requires patch history and at least one data chunk");
  }
  if (encrypted && binary.encrypted !== true) {
    throw new Error("IQ capture encryption metadata is inconsistent");
  }
  if (decryptedPayload !== null && !encrypted) {
    throw new Error("A decrypted IQ payload was supplied for an unencrypted capture");
  }
  if (encrypted && decryptedPayload === null) {
    return { frameUpdates, chunks: [], encrypted: true };
  }
  const payload = decryptedPayload ?? bytes.subarray(payloadStart, payloadEnd);
  let offset = 0;
  if (Buffer.from(payload.subarray(0, 4)).toString("ascii") === "PMD3") {
    if (payload.byteLength < 12)
      throw new Error("IQ private metadata header is truncated");
    const privateLength = readU64(payload, 4);
    if (privateLength > payload.byteLength - 12)
      throw new Error("IQ private metadata is truncated");
    JSON.parse(
      Buffer.from(payload.subarray(12, 12 + privateLength)).toString("utf8"),
    );
    offset = 12 + privateLength;
  }
  const chunks = [];
  while (offset < payload.byteLength) {
    if (payload.byteLength - offset < 20)
      throw new Error("IQ chunk header is truncated");
    const sampleOffset = readU64(payload, offset);
    const channel = new DataView(
      payload.buffer,
      payload.byteOffset + offset + 8,
      4,
    ).getUint32(0, true);
    const length = readU64(payload, offset + 12);
    offset += 20;
    if (
      length <= 0 ||
      length > payload.byteLength - offset ||
      length % 2 !== 0
    ) {
      throw new Error("IQ chunk has an invalid byte length");
    }
    chunks.push({
      sampleOffset,
      channel,
      data: payload.subarray(offset, offset + length),
    });
    offset += length;
  }
  if (!chunks.length) {
    throw new Error(
      "IQ capture requires patch history and at least one data chunk",
    );
  }
  return { frameUpdates, chunks, encrypted: false };
}

function packageResourcePath(resource) {
  if (
    typeof resource?.path !== "string" ||
    resource.path.includes("\\") ||
    path.posix.isAbsolute(resource.path) ||
    resource.path
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(
      "Data Package resource path must stay inside the package directory",
    );
  }
  return resource.path;
}

function verifyPackageResourceBytes(resource, bytes) {
  if (
    !Number.isSafeInteger(resource.bytes) ||
    resource.bytes < 0 ||
    resource.bytes > MAX_PACKAGE_RESOURCE_BYTES ||
    resource.bytes !== bytes.byteLength
  ) {
    throw new Error(`Data Package resource size mismatch: ${resource.path}`);
  }
  const expectedHash =
    typeof resource.hash === "string"
      ? resource.hash.match(/^sha256:([\da-f]{64})$/i)?.[1]
      : null;
  if (!expectedHash || sha256(bytes) !== expectedHash.toLowerCase()) {
    throw new Error(`Data Package resource hash mismatch: ${resource.path}`);
  }
  return bytes;
}

async function readVerifiedPackageResource(packageRoot, resource) {
  const resourcePathValue = packageResourcePath(resource);
  const resourcePath = path.resolve(packageRoot, ...resourcePathValue.split("/"));
  if (!resourcePath.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error("Data Package resource path escapes the package directory");
  }
  const info = await lstat(resourcePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Data Package resources must be regular files, not links");
  }
  const resolvedPath = await realpath(resourcePath);
  if (!resolvedPath.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error(
      "Data Package resource resolves outside the package directory",
    );
  }
  const bytes = await readFile(resolvedPath);
  verifyPackageResourceBytes(resource, bytes);
  return { path: resolvedPath, bytes };
}

function safeZipEntryPath(entryName, isDirectory) {
  const value = isDirectory ? entryName.replace(/\/$/, "") : entryName;
  if (
    !value ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Data Package ZIP contains an unsafe resource path");
  }
  return value;
}

function readZipEntryBytes(entry, limit, label) {
  if (!entry || entry.isDirectory) {
    throw new Error(`Data Package ZIP is missing ${label}`);
  }
  const advertisedSize = entry.header?.size;
  if (
    Number.isSafeInteger(advertisedSize) &&
    (advertisedSize < 0 || advertisedSize > limit)
  ) {
    throw new Error(`Data Package ZIP ${label} exceeds the supported size`);
  }
  if ((entry.header?.flags & 1) !== 0) {
    throw new Error("Encrypted Data Package ZIP entries are not supported");
  }
  let bytes;
  try {
    bytes = entry.getData();
  } catch {
    throw new Error(`Data Package ZIP could not read ${label}`);
  }
  if (!bytes || bytes.byteLength > limit) {
    throw new Error(`Data Package ZIP ${label} exceeds the supported size`);
  }
  return Buffer.from(bytes);
}

function readVerifiedZipPackageResource(entries, resource) {
  const resourcePath = packageResourcePath(resource);
  const entry = entries.get(resourcePath);
  const advertisedSize = entry?.header?.size;
  if (
    !Number.isSafeInteger(resource?.bytes) ||
    resource.bytes < 0 ||
    resource.bytes > MAX_PACKAGE_RESOURCE_BYTES ||
    (Number.isSafeInteger(advertisedSize) && advertisedSize !== resource.bytes)
  ) {
    throw new Error(`Data Package resource size mismatch: ${resourcePath}`);
  }
  const bytes = readZipEntryBytes(entry, MAX_PACKAGE_RESOURCE_BYTES, resourcePath);
  verifyPackageResourceBytes(resource, bytes);
  return { path: resourcePath, bytes };
}

function normalizeAnnotations(value) {
  if (
    !value ||
    !["matching", "nonmatching", "uncertain"].includes(value.label) ||
    (value.channel !== undefined &&
      !["unspecified", "A", "B", "other"].includes(value.channel)) ||
    !Array.isArray(value.features) ||
    value.features.some((item) => typeof item !== "string") ||
    !Array.isArray(value.tags) ||
    value.tags.some((item) => typeof item !== "string")
  ) {
    throw new Error(
      "Labels must include a valid label, channel, features, and tags",
    );
  }
  return {
    label: value.label,
    channel: value.channel ?? "unspecified",
    features: [...new Set(value.features)],
    tags: [...new Set(value.tags)],
  };
}

function normalizeEvents(value) {
  const annotationEvents = value.annotationEvents ?? [];
  const interferenceMarkedEvents = value.interferenceMarkedEvents ?? [];
  if (
    !Array.isArray(annotationEvents) ||
    annotationEvents.some(
      (event) =>
        !Number.isFinite(event.timestampMs) ||
        !(
          event.frameSequence === null || Number.isInteger(event.frameSequence)
        ),
    )
  )
    throw new Error("Label annotation timeline is invalid");
  if (
    !Array.isArray(interferenceMarkedEvents) ||
    interferenceMarkedEvents.some(
      (event) =>
        event.kind !== "InterferenceMarked" ||
        event.code !== 2 ||
        !Number.isFinite(event.timestampMs) ||
        !Number.isInteger(event.byteOffset) ||
        event.byteOffset < 0 ||
        !(
          event.frameSequence === null || Number.isInteger(event.frameSequence)
        ),
    )
  )
    throw new Error("Label interference timeline is invalid");
  return { annotationEvents, interferenceMarkedEvents };
}

function captureIdFor(identity) {
  if (identity.kind === "v6-trailer-sha256")
    return identity.digestHex.toLowerCase();
  return `${identity.fileName}@${new Date(identity.capturedAtTimestampMs).toISOString()}`;
}

function parseFilenameTimestamp(fileName) {
  const compact = fileName.match(/(?:^|[_-])(\d{8})_(\d{6})(?:\.[^.]+)?$/);
  if (compact) {
    const [, date, time] = compact;
    return Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(time.slice(0, 2)),
      Number(time.slice(2, 4)),
      Number(time.slice(4, 6)),
    );
  }
  const iso = fileName.match(
    /(\d{4}-\d{2}-\d{2}T\d{2})[-:](\d{2})[-:](\d{2})-(\d{3})Z(?:\.[^.]+)?$/,
  );
  if (iso)
    return new Date(`${iso[1]}:${iso[2]}:${iso[3]}.${iso[4]}Z`).getTime();
  return null;
}

function parseExplicitUtc(value) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error("--captured-at must include an explicit UTC offset");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error("--captured-at is not a valid date/time");
  return timestamp;
}

function existingIdentity(
  labels,
  captureKind,
  captureName,
  captureTimestamp,
  verifiedDigest,
) {
  if (labels.format === LABEL_DRAFT_FORMAT) return null;
  const identity = labels.captureIdentity;
  if (
    labels.format === CAPTURE_ANNOTATIONS_FORMAT ||
    labels.format === LABEL_PACKAGE_FORMAT
  ) {
    if (!identity || typeof labels.captureId !== "string" || !labels.sessionId)
      throw new Error("Bound label sidecar is missing its capture identity");
    if (
      captureKind === "v6" &&
      (identity.kind !== "v6-trailer-sha256" ||
        identity.algorithm !== "SHA-256" ||
        identity.scope !== INTEGRITY_SCOPE ||
        identity.digestHex?.toLowerCase() !== verifiedDigest ||
        labels.captureId !== verifiedDigest)
    ) {
      throw new Error(
        "Bound label sidecar checksum does not match the verified V6 capture",
      );
    }
    if (
      captureKind === "filename-timestamp" &&
      (identity.kind !== "filename-timestamp" ||
        identity.fileName !== captureName ||
        identity.capturedAtTimestampMs !== captureTimestamp ||
        labels.captureId !== captureIdFor(identity))
    ) {
      throw new Error(
        "Bound label sidecar filename/time does not match the capture",
      );
    }
    return identity;
  }
  throw new Error(
    `Unsupported label input format: ${labels.format ?? "missing"}`,
  );
}

function packageLabelObject(labels, identity) {
  if (
    ![
      LABEL_DRAFT_FORMAT,
      CAPTURE_ANNOTATIONS_FORMAT,
      LABEL_PACKAGE_FORMAT,
    ].includes(labels.format)
  ) {
    throw new Error(
      `Unsupported label input format: ${labels.format ?? "missing"}`,
    );
  }
  const annotations = normalizeAnnotations(labels.annotations);
  const { annotationEvents, interferenceMarkedEvents } =
    normalizeEvents(labels);
  const captureId = captureIdFor(identity);
  return {
    format: LABEL_PACKAGE_FORMAT,
    captureId,
    sessionId: labels.sessionId || captureId,
    captureIdentity: identity,
    annotations,
    annotationEvents,
    interferenceMarkedEvents,
  };
}

async function readCaptureIdentity(
  capturePath,
  bytes,
  labels,
  capturedAtOption,
) {
  const captureName = path.basename(capturePath);
  if (
    !captureName ||
    captureName === "." ||
    captureName === ".." ||
    /[/\\\0]/.test(captureName)
  )
    throw new Error("Capture filename is invalid");
  const extension = path.extname(captureName).slice(1).toLowerCase();

  if (extension === "iq" || extension === "napt") {
    const rawFileHash = sha256(bytes);
    const verified = await verifyCaptureArtifact(bytes, {
      filename: captureName,
      fileSize: bytes.byteLength,
      checksum: rawFileHash,
    });
    const metadata = metadataForV6(bytes, extension);
    if (verified.formatVersion !== 6 || metadata.format_version !== 6)
      throw new Error("Only verified V6 IQ/NAPT captures are packageable");
    const integrity = trailerIntegrity(bytes, metadata);
    const identity = {
      kind: "v6-trailer-sha256",
      algorithm: "SHA-256",
      scope: integrity.scope,
      digestHex: integrity.digest.toLowerCase(),
    };
    existingIdentity(labels, "v6", captureName, null, identity.digestHex);
    return {
      identity,
      format: extension,
      mediaType: "application/octet-stream",
      fileHash: rawFileHash,
    };
  }

  if (extension === "wav") {
    const verified = await verifyCaptureArtifact(bytes, {
      filename: captureName,
      fileSize: bytes.byteLength,
      checksum: sha256(bytes),
    });
    const boundIdentity =
      labels.captureIdentity?.kind === "filename-timestamp"
        ? labels.captureIdentity
        : null;
    const timestamp =
      boundIdentity?.capturedAtTimestampMs ??
      labels.capturedAtTimestampMs ??
      (capturedAtOption
        ? parseExplicitUtc(capturedAtOption)
        : parseFilenameTimestamp(captureName));
    if (!Number.isFinite(timestamp))
      throw new Error(
        "WAV has no V6 trailer; provide a timestamped filename or --captured-at ISO-8601",
      );
    const identity = {
      kind: "filename-timestamp",
      fileName: captureName,
      capturedAtTimestampMs: timestamp,
    };
    existingIdentity(
      labels,
      "filename-timestamp",
      captureName,
      timestamp,
      null,
    );
    return {
      identity,
      format: extension,
      mediaType: "audio/wav",
      fileHash: verified.checksum,
    };
  }

  if (extension === "json") {
    const capture = JSON.parse(bytes.toString("utf8"));
    const annotationSidecar =
      labels.format === CAPTURE_ANNOTATIONS_FORMAT ? labels : null;
    readTrainingCapture(capture, annotationSidecar, captureName);
    const timestamp = capture.createdAtTimestampMs;
    if (!Number.isFinite(timestamp))
      throw new Error("Browser frame capture has no first-frame timestamp");
    const identity = {
      kind: "filename-timestamp",
      fileName: captureName,
      capturedAtTimestampMs: timestamp,
    };
    existingIdentity(
      labels,
      "filename-timestamp",
      captureName,
      timestamp,
      null,
    );
    return {
      identity,
      format: extension,
      mediaType: "application/json",
      fileHash: sha256(bytes),
    };
  }

  throw new Error(
    `Unsupported package capture extension: ${extension || "none"}`,
  );
}

function safePackageName(captureId) {
  return `napt-capture-${sha256(Buffer.from(captureId)).slice(0, 16)}`;
}

export async function createCapturePackage({
  capturePath,
  labelsPath,
  outputPath,
  capturedAt,
}) {
  if (!capturePath || !labelsPath || !outputPath)
    throw new Error("package requires --capture, --labels, and --out");
  const sourcePath = path.resolve(capturePath);
  const sourceName = path.basename(sourcePath);
  const outputDir = path.resolve(outputPath);
  const bytes = await readFile(sourcePath);
  const labels = JSON.parse(await readFile(path.resolve(labelsPath), "utf8"));
  const verified = await readCaptureIdentity(
    sourcePath,
    bytes,
    labels,
    capturedAt,
  );
  const labelObject = packageLabelObject(labels, verified.identity);
  const labelsBytes = Buffer.from(`${JSON.stringify(labelObject, null, 2)}\n`);
  const rawFileHash = verified.fileHash;
  const captureResourcePath = `captures/${sourceName}`;
  const descriptor = {
    $schema: DATA_PACKAGE_SCHEMA,
    name: safePackageName(labelObject.captureId),
    title: `N-APT capture ${sourceName}`,
    description:
      "Original signal capture and its detachable N-APT classifier labels.",
    resources: [
      {
        name: "signal-capture",
        path: captureResourcePath,
        title: sourceName,
        format: verified.format,
        mediatype: verified.mediaType,
        bytes: bytes.byteLength,
        hash: `sha256:${rawFileHash}`,
      },
      {
        name: "labels",
        path: "labels.json",
        title: "Capture labels",
        format: "json",
        mediatype: "application/json",
        bytes: labelsBytes.byteLength,
        hash: `sha256:${sha256(labelsBytes)}`,
      },
    ],
  };
  const descriptorBytes = Buffer.from(
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );

  await mkdir(path.dirname(outputDir), { recursive: true });
  await mkdir(outputDir);
  try {
    await mkdir(path.join(outputDir, "captures"));
    await copyFile(sourcePath, path.join(outputDir, captureResourcePath));
    await writeFile(path.join(outputDir, "labels.json"), labelsBytes, {
      flag: "wx",
    });
    await writeFile(path.join(outputDir, "datapackage.json"), descriptorBytes, {
      flag: "wx",
    });
  } catch (error) {
    await rm(outputDir, { recursive: true, force: true });
    throw error;
  }
  return {
    outputDir,
    captureId: labelObject.captureId,
    identity: labelObject.captureIdentity,
    captureBytes: bytes.byteLength,
    resourceHash: rawFileHash,
    format: verified.format,
  };
}

export async function readCapturePackage(packagePath) {
  if (!packagePath) {
    throw new Error("prepare requires --package DIRECTORY_OR_ZIP");
  }
  const sourcePath = await realpath(path.resolve(packagePath));
  const sourceInfo = await lstat(sourcePath);
  let packageRoot = sourcePath;
  let zipEntries = null;
  let descriptor;
  if (sourceInfo.isDirectory()) {
    descriptor = JSON.parse(
      await readFile(path.join(packageRoot, "datapackage.json"), "utf8"),
    );
  } else if (sourceInfo.isFile() && path.extname(sourcePath).toLowerCase() === ".zip") {
    if (sourceInfo.size > MAX_PACKAGE_ARCHIVE_BYTES) {
      throw new Error("Data Package ZIP exceeds the supported archive size");
    }
    const archive = new AdmZip(await readFile(sourcePath));
    zipEntries = new Map();
    const seenPaths = new Set();
    for (const entry of archive.getEntries()) {
      const entryPath = safeZipEntryPath(entry.entryName, entry.isDirectory);
      if (seenPaths.has(entryPath)) {
        throw new Error(`Data Package ZIP contains a duplicate path: ${entryPath}`);
      }
      seenPaths.add(entryPath);
      if (!entry.isDirectory) zipEntries.set(entryPath, entry);
    }
    const descriptorEntry = zipEntries.get("datapackage.json");
    const descriptorBytes = readZipEntryBytes(
      descriptorEntry,
      MAX_PACKAGE_DESCRIPTOR_BYTES,
      "datapackage.json",
    );
    descriptor = JSON.parse(descriptorBytes.toString("utf8"));
  } else {
    throw new Error("prepare --package requires a Data Package directory or ZIP archive");
  }
  if (
    descriptor?.$schema !== DATA_PACKAGE_SCHEMA ||
    !Array.isArray(descriptor.resources)
  ) {
    throw new Error("Unsupported or invalid Data Package descriptor");
  }
  const resourcesByName = new Map();
  for (const resource of descriptor.resources) {
    if (
      typeof resource?.name !== "string" ||
      resourcesByName.has(resource.name)
    ) {
      throw new Error("Data Package resource names must be present and unique");
    }
    resourcesByName.set(resource.name, resource);
  }
  const captureResources = [
    resourcesByName.get("signal-capture"),
    resourcesByName.get("iq-capture"),
  ].filter(Boolean);
  const labelsResources = [
    resourcesByName.get("labels"),
    resourcesByName.get("annotations"),
  ].filter(Boolean);
  const captureResource = captureResources[0];
  const labelsResource = labelsResources[0];
  if (
    captureResources.length !== 1 ||
    labelsResources.length !== 1 ||
    !captureResource ||
    !labelsResource
  ) {
    throw new Error(
      "Data Package requires one signal-capture/iq-capture and one labels/annotations resource",
    );
  }
  const readResource = zipEntries
    ? (resource) => readVerifiedZipPackageResource(zipEntries, resource)
    : (resource) => readVerifiedPackageResource(packageRoot, resource);
  const [captureFile, labelsFile] = await Promise.all([
    readResource(captureResource),
    readResource(labelsResource),
  ]);
  const captureName = path.posix.basename(captureResource.path);
  if (!captureName || captureName === "." || captureName === "..") {
    throw new Error("Data Package capture path has no filename");
  }
  const labels = JSON.parse(labelsFile.bytes.toString("utf8"));
  if (
    labels?.format !== LABEL_PACKAGE_FORMAT &&
    labels?.format !== CAPTURE_ANNOTATIONS_FORMAT
  ) {
    throw new Error("Data Package labels resource has an unsupported format");
  }
  const verified = await readCaptureIdentity(
    captureName,
    captureFile.bytes,
    labels,
  );
  const labelObject = packageLabelObject(labels, verified.identity);
  if (verified.format !== path.extname(captureName).slice(1).toLowerCase()) {
    throw new Error("Data Package capture format disagrees with its filename");
  }
  const metadata =
    verified.format === "iq" || verified.format === "napt"
      ? metadataForV6(captureFile.bytes, verified.format)
      : null;
  const metadataTimestamp = Date.parse(metadata?.timestamp_utc ?? "");
  const captureTimestampMs = Number.isFinite(metadataTimestamp)
    ? metadataTimestamp
    : parseFilenameTimestamp(captureName);
  return {
    packageRoot,
    capturePath: captureFile.path,
    captureName,
    captureBytes: captureFile.bytes,
    captureId: labelObject.captureId,
    captureIdentity: labelObject.captureIdentity,
    captureTimestampMs,
    labels: labelObject,
    archive: descriptor?.napt?.archive ?? null,
    format: verified.format,
    archiveSource: zipEntries !== null,
    metadata,
    iqContainer:
      verified.format === "iq"
        ? decodeV6IqContainer(captureFile.bytes, metadata)
        : null,
  };
}
