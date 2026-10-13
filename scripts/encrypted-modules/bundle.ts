import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveContainedPath } from "./pathSafety";

const ALGORITHM = "aes-256-gcm";
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const BUNDLE_FORMAT = "n-apt-encrypted-module-bundle";
const BUNDLE_VERSION = 1;
const EXTRACTION_STATE_FILE = ".module-bundle-state.json";

export interface BundleInputFile {
  path: string;
  content: Uint8Array;
}

export interface DecryptedBundleFile {
  path: string;
  content: Buffer;
}

export interface DecryptedBundle {
  bundleId: string;
  ciphertextSha256?: string;
  requiredFiles: string[];
  files: DecryptedBundleFile[];
}

export interface BundleOptions {
  requiredFiles?: readonly string[];
}

interface EncodedBundleFile {
  path: string;
  size: number;
  sha256: string;
  content: string;
}

interface BundleEnvelope {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  bundleId: string;
  requiredFiles: string[];
  files: EncodedBundleFile[];
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 268435456,
  });
}

function normalizedBundlePath(value: string): string {
  if (!value || value.includes("\\") || path.posix.isAbsolute(value)) {
    throw new Error("Bundle paths must be normalized relative paths");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Bundle paths must not contain empty or traversal segments");
  }
  if (value === EXTRACTION_STATE_FILE) {
    throw new Error("Bundle path is reserved for extraction state");
  }
  return segments.join("/");
}

// codeql[js/insufficient-password-hash] This hashes bundle/file bytes for integrity; deriveKey uses scrypt for passwords.
function hash(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizeRequiredFiles(
  requiredFiles: readonly string[],
  availablePaths: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const normalized = requiredFiles.map((filePath) => normalizedBundlePath(filePath));
  for (const filePath of normalized) {
    const foldedPath = filePath.toLocaleLowerCase("en-US");
    if (seen.has(foldedPath)) {
      throw new Error(`Encrypted module bundle contains duplicate required path: ${filePath}`);
    }
    seen.add(foldedPath);
    if (!availablePaths.has(filePath)) {
      throw new Error(`Encrypted module bundle is missing required file: ${filePath}`);
    }
  }
  return [...normalized].sort((left, right) => left.localeCompare(right, "en"));
}

function bundleIdentity(files: readonly EncodedBundleFile[], requiredFiles: readonly string[]): string {
  const members = files.map(({ path: filePath, size, sha256 }) => ({
    path: filePath,
    size,
    sha256,
  }));
  return hash(Buffer.from(JSON.stringify({ files: members, requiredFiles }), "utf8"));
}

function validatedFileManifest(files: readonly DecryptedBundleFile[]): EncodedBundleFile[] {
  const paths = new Set<string>();
  const foldedPaths = new Set<string>();
  const manifest = files.map(({ path: filePath, content }) => {
    const safePath = normalizedBundlePath(filePath);
    const foldedPath = safePath.toLocaleLowerCase("en-US");
    if (paths.has(safePath) || foldedPaths.has(foldedPath)) {
      throw new Error(`Encrypted module bundle contains duplicate path: ${safePath}`);
    }
    paths.add(safePath);
    foldedPaths.add(foldedPath);
    const bytes = Buffer.from(content);
    return {
      path: safePath,
      size: bytes.length,
      sha256: hash(bytes),
      content: bytes.toString("base64"),
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (manifest.length === 0) throw new Error("Encrypted module bundle has no files");
  return manifest;
}

export function createBundleSnapshot(
  files: readonly DecryptedBundleFile[],
  requiredFiles: readonly string[] = [],
): DecryptedBundle {
  const manifest = validatedFileManifest(files);
  const normalizedRequired = normalizeRequiredFiles(
    requiredFiles,
    new Set(manifest.map((file) => file.path)),
  );
  return {
    bundleId: bundleIdentity(manifest, normalizedRequired),
    requiredFiles: normalizedRequired,
    files: manifest.map((file) => ({
      path: file.path,
      content: Buffer.from(file.content, "base64"),
    })),
  };
}

function validateDecryptedBundle(bundle: DecryptedBundle): EncodedBundleFile[] {
  if (!bundle || typeof bundle.bundleId !== "string" || !Array.isArray(bundle.files)) {
    throw new Error("Encrypted module bundle has an invalid decrypted shape");
  }
  const manifest = validatedFileManifest(bundle.files);
  if (!Array.isArray(bundle.requiredFiles)) {
    throw new Error("Encrypted module bundle has an invalid required-file manifest");
  }
  const requiredFiles = normalizeRequiredFiles(
    bundle.requiredFiles,
    new Set(manifest.map((file) => file.path)),
  );
  if (
    !/^[a-f0-9]{64}$/.test(bundle.bundleId) ||
    bundleIdentity(manifest, requiredFiles) !== bundle.bundleId
  ) {
    throw new Error("Encrypted module bundle identity does not match its contents");
  }
  return manifest;
}

function parseAndValidateBundle(plaintext: Buffer): DecryptedBundle {
  let value: unknown;
  try {
    value = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Encrypted module bundle contains invalid JSON");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Encrypted module bundle has an invalid envelope");
  }

  const envelope = value as Partial<BundleEnvelope>;
  if (envelope.format !== BUNDLE_FORMAT || envelope.version !== BUNDLE_VERSION) {
    throw new Error("Encrypted module bundle format or version is unsupported");
  }
  if (!Array.isArray(envelope.files) || envelope.files.length === 0) {
    throw new Error("Encrypted module bundle has no files");
  }
  if (!Array.isArray(envelope.requiredFiles) || envelope.requiredFiles.some((filePath) => typeof filePath !== "string")) {
    throw new Error("Encrypted module bundle has an invalid required-file manifest");
  }

  const paths = new Set<string>();
  const foldedPaths = new Set<string>();
  const decodedFiles: DecryptedBundleFile[] = [];
  const manifestFiles: EncodedBundleFile[] = [];

  for (const entry of envelope.files) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Encrypted module bundle contains an invalid file entry");
    }
    const file = entry as Partial<EncodedBundleFile>;
    if (typeof file.path !== "string") {
      throw new Error("Encrypted module bundle contains a file without a path");
    }
    const filePath = normalizedBundlePath(file.path);
    if (paths.has(filePath) || foldedPaths.has(filePath.toLocaleLowerCase("en-US"))) {
      throw new Error(`Encrypted module bundle contains duplicate path: ${filePath}`);
    }
    paths.add(filePath);
    foldedPaths.add(filePath.toLocaleLowerCase("en-US"));
    if (
      typeof file.size !== "number" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      typeof file.content !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)
    ) {
      throw new Error(`Encrypted module bundle has invalid metadata for ${filePath}`);
    }
    const content = Buffer.from(file.content, "base64");
    if (content.length !== file.size || hash(content) !== file.sha256) {
      throw new Error(`Encrypted module bundle content failed validation: ${filePath}`);
    }
    const normalizedEntry: EncodedBundleFile = {
      path: filePath,
      size: file.size,
      sha256: file.sha256,
      content: file.content,
    };
    manifestFiles.push(normalizedEntry);
    decodedFiles.push({ path: filePath, content });
  }

  const sortedManifest = [...manifestFiles].sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  const requiredFiles = normalizeRequiredFiles(
    envelope.requiredFiles,
    new Set(sortedManifest.map((file) => file.path)),
  );
  if (
    typeof envelope.bundleId !== "string" ||
    !/^[a-f0-9]{64}$/.test(envelope.bundleId) ||
    bundleIdentity(sortedManifest, requiredFiles) !== envelope.bundleId
  ) {
    throw new Error("Encrypted module bundle manifest identity does not match its contents");
  }
  return { bundleId: envelope.bundleId, requiredFiles, files: decodedFiles };
}

export function encryptBundleBytes(
  files: readonly BundleInputFile[],
  password: string,
  options: BundleOptions = {},
): Buffer {
  if (!password) throw new Error("Encrypted module password is required");
  if (files.length === 0) throw new Error("Cannot encrypt an empty module bundle");

  const normalized = files.map(({ path: filePath, content }) => {
    const safePath = normalizedBundlePath(filePath);
    const bytes = Buffer.from(content);
    return {
      path: safePath,
      size: bytes.length,
      sha256: hash(bytes),
      content: bytes.toString("base64"),
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const uniquePaths = new Set<string>();
  for (const file of normalized) {
    const foldedPath = file.path.toLocaleLowerCase("en-US");
    if (uniquePaths.has(foldedPath)) {
      throw new Error(`Cannot encrypt duplicate module path: ${file.path}`);
    }
    uniquePaths.add(foldedPath);
  }
  const requiredFiles = normalizeRequiredFiles(
    options.requiredFiles ?? [],
    new Set(normalized.map((file) => file.path)),
  );

  const envelope: BundleEnvelope = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    bundleId: bundleIdentity(normalized, requiredFiles),
    requiredFiles,
    files: normalized,
  };
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(envelope), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    salt,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptBundleBytes(
  encrypted: Uint8Array,
  password: string,
): DecryptedBundle {
  const bytes = Buffer.from(encrypted);
  const headerLength = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
  if (!password) throw new Error("Encrypted module password is required");
  if (bytes.length <= headerLength) {
    throw new Error("Encrypted module bundle is truncated");
  }

  const salt = bytes.subarray(0, SALT_LENGTH);
  const iv = bytes.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = bytes.subarray(SALT_LENGTH + IV_LENGTH, headerLength);
  const ciphertext = bytes.subarray(headerLength);
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(password, salt), iv);
  decipher.setAuthTag(authTag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Encrypted module authentication failed");
  }
  return {
    ...parseAndValidateBundle(plaintext),
    ciphertextSha256: hash(bytes),
  };
}

export function decryptLegacyBundleBytes(
  encrypted: Uint8Array,
  password: string,
): DecryptedBundle {
  const bytes = Buffer.from(encrypted);
  const headerLength = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
  if (!password) throw new Error("Encrypted module password is required");
  if (bytes.length <= headerLength) {
    throw new Error("Encrypted module bundle is truncated");
  }

  const salt = bytes.subarray(0, SALT_LENGTH);
  const iv = bytes.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = bytes.subarray(SALT_LENGTH + IV_LENGTH, headerLength);
  const ciphertext = bytes.subarray(headerLength);
  let plaintext: Buffer;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(password, salt), iv);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    try {
      const key = crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, "sha256");
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error("Encrypted module authentication failed");
    }
  }

  let value: unknown;
  try {
    value = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Legacy encrypted module bundle contains invalid JSON");
  }
  if (!value || typeof value !== "object" || !Array.isArray((value as { files?: unknown }).files)) {
    throw new Error("Legacy encrypted module bundle has an invalid manifest");
  }
  const files = (value as { files: unknown[] }).files.map((entry): DecryptedBundleFile => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Legacy encrypted module bundle contains an invalid file entry");
    }
    const file = entry as { path?: unknown; content?: unknown };
    if (
      typeof file.path !== "string" ||
      typeof file.content !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)
    ) {
      throw new Error("Legacy encrypted module bundle contains invalid file metadata");
    }
    const content = Buffer.from(file.content, "base64");
    if (content.toString("base64") !== file.content) {
      throw new Error(`Legacy encrypted module bundle has invalid base64 content: ${file.path}`);
    }
    return { path: file.path, content };
  });
  return {
    ...createBundleSnapshot(files),
    ciphertextSha256: hash(bytes),
  };
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Extracted module bundle cannot contain symlinks");
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name !== EXTRACTION_STATE_FILE) {
          files.push(path.relative(root, fullPath).split(path.sep).join("/"));
        }
      } else {
        throw new Error("Extracted module bundle contains an unsupported filesystem entry");
      }
    }
  };
  walk(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function isBundleExtracted(bundle: DecryptedBundle, targetDir: string): boolean {
  try {
    const manifest = validateDecryptedBundle(bundle);
    const root = path.resolve(targetDir);
    if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) return false;
    const statePath = path.join(root, EXTRACTION_STATE_FILE);
    if (!fs.existsSync(statePath) || !fs.lstatSync(statePath).isFile()) return false;
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      format?: unknown;
      version?: unknown;
      bundleId?: unknown;
      ciphertextSha256?: unknown;
      requiredFiles?: unknown;
      files?: unknown;
    };
    if (
      state.format !== BUNDLE_FORMAT ||
      state.version !== BUNDLE_VERSION ||
      state.bundleId !== bundle.bundleId ||
      (bundle.ciphertextSha256 !== undefined &&
        state.ciphertextSha256 !== bundle.ciphertextSha256) ||
      !Array.isArray(state.requiredFiles) ||
      state.requiredFiles.length !== bundle.requiredFiles.length ||
      state.requiredFiles.some((filePath, index) => filePath !== bundle.requiredFiles[index]) ||
      !Array.isArray(state.files)
    ) return false;
    const expectedPaths = manifest.map((file) => file.path);
    const actualPaths = walkFiles(root);
    if (
      actualPaths.length !== expectedPaths.length ||
      actualPaths.some((filePath, index) => filePath !== expectedPaths[index]) ||
      state.files.length !== expectedPaths.length ||
      state.files.some((filePath, index) => filePath !== expectedPaths[index])
    ) return false;
    return manifest.every((file) => {
      const fullPath = resolveContainedPath(root, file.path);
      const stat = fs.lstatSync(fullPath);
      return stat.isFile() && stat.size === file.size && hash(fs.readFileSync(fullPath)) === file.sha256;
    });
  } catch {
    return false;
  }
}

export function extractBundleAtomically(bundle: DecryptedBundle, targetDir: string): void {
  const manifest = validateDecryptedBundle(bundle);
  const root = path.resolve(targetDir);
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, `.${path.basename(root)}.stage-`));
  const backup = path.join(parent, `.${path.basename(root)}.backup-${crypto.randomUUID()}`);
  let movedExisting = false;
  let promoted = false;

  try {
    for (const file of bundle.files) {
      const destination = resolveContainedPath(stage, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const realStage = fs.realpathSync(stage);
      const realParent = fs.realpathSync(path.dirname(destination));
      if (realParent !== realStage && !realParent.startsWith(`${realStage}${path.sep}`)) {
        throw new Error("Bundle path resolves through a symlink outside the staging directory");
      }
      fs.writeFileSync(destination, Buffer.from(file.content), { mode: 0o600, flag: "wx" });
    }

    const expectedPaths = manifest.map((file) => file.path);
    fs.writeFileSync(
      path.join(stage, EXTRACTION_STATE_FILE),
      `${JSON.stringify({
        format: BUNDLE_FORMAT,
        version: BUNDLE_VERSION,
        bundleId: bundle.bundleId,
        ciphertextSha256: bundle.ciphertextSha256 ?? null,
        requiredFiles: bundle.requiredFiles,
        files: expectedPaths,
      })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    if (!isBundleExtracted(bundle, stage)) {
      throw new Error("Extracted module bundle failed staged integrity validation");
    }

    if (fs.existsSync(root)) {
      fs.renameSync(root, backup);
      movedExisting = true;
    }
    fs.renameSync(stage, root);
    promoted = true;
    if (!isBundleExtracted(bundle, root)) {
      throw new Error("Promoted module bundle failed integrity validation");
    }
    if (movedExisting) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (promoted) fs.rmSync(root, { recursive: true, force: true });
    if (movedExisting && fs.existsSync(backup) && !fs.existsSync(root)) {
      fs.renameSync(backup, root);
    }
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (fs.existsSync(backup) && fs.existsSync(root)) {
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }
}
