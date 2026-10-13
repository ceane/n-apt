import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createBundleSnapshot,
  decryptBundleBytes,
  decryptLegacyBundleBytes,
  encryptBundleBytes,
  extractBundleAtomically,
  isBundleExtracted,
  type BundleInputFile,
  type DecryptedBundle,
} from "./bundle";
import { ensureMlBundle, ML_REQUIRED_FILES } from "./mlRuntime";

const ROOT = path.resolve(process.env.NAPT_ENCRYPTED_MODULE_ROOT || process.cwd());
const BUNDLE_DIR = "src/encrypted-modules";

type ModuleTarget = {
  label: string;
  password: "latex" | "demod";
  bundle: string;
  source: string;
  requiredFiles: string[];
};

const MODULES: ModuleTarget[] = [
  {
    label: "TS modules",
    password: "latex",
    bundle: `${BUNDLE_DIR}/ts.bundle.enc`,
    source: `${BUNDLE_DIR}/tmp/ts`,
    requiredFiles: ["math/napt-spike-eq.ts"],
  },
  {
    label: "RS modules",
    password: "demod",
    bundle: `${BUNDLE_DIR}/rs.bundle.enc`,
    source: `${BUNDLE_DIR}/tmp/rs`,
    requiredFiles: ["mod.rs"],
  },
  {
    label: "ML modules",
    password: "latex",
    bundle: `${BUNDLE_DIR}/ml.bundle.enc`,
    source: `${BUNDLE_DIR}/tmp/ml`,
    requiredFiles: [...ML_REQUIRED_FILES],
  },
];

function parseEnvFile(): Record<string, string> {
  const envPath = path.resolve(
    process.env.NAPT_ENCRYPTED_MODULE_ENV_FILE || path.join(ROOT, ".env.local"),
  );
  if (!fs.existsSync(envPath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function getPasswords(): { latex?: string; demod?: string } {
  const fileValues = parseEnvFile();
  return {
    latex: process.env.UNSAFE_LOCAL_LATEX_PASSWORD || fileValues.UNSAFE_LOCAL_LATEX_PASSWORD,
    demod: process.env.UNSAFE_LOCAL_DEMOD_PASSWORD || fileValues.UNSAFE_LOCAL_DEMOD_PASSWORD,
  };
}

function getCurrentBranch(): string | null {
  try {
    return execSync("git branch --show-current", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function readSourceFiles(directory: string): BundleInputFile[] {
  const root = path.resolve(ROOT, directory);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
    throw new Error(`Encrypted module source directory is missing: ${directory}`);
  }
  const files: BundleInputFile[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (
        entry.name === ".DS_Store" ||
        entry.name === ".gitkeep" ||
        (current === root && entry.name === ".module-bundle-state.json")
      ) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Encrypted module sources cannot include symlinks: ${fullPath}`);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        const relative = path.relative(root, fullPath).split(path.sep).join("/");
        if (directory.endsWith("/tmp/ml")) validateMlSourcePath(relative);
        files.push({ path: relative, content: fs.readFileSync(fullPath) });
      } else {
        throw new Error(`Encrypted module source has an unsupported filesystem entry: ${fullPath}`);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function validateMlSourcePath(filePath: string): void {
  const segments = filePath.toLocaleLowerCase("en-US").split("/");
  const extension = path.extname(filePath).toLocaleLowerCase("en-US");
  const forbiddenExtensions = new Set([
    ".env", ".iq", ".napt", ".wav", ".onnx", ".pt", ".pth", ".safetensors",
    ".gguf", ".npy", ".npz", ".pkl", ".pickle", ".key", ".pem", ".p12",
  ]);
  const forbiddenSegments = new Set([
    "capture", "captures", "dataset", "datasets", "credentials", "models",
    "training-captures", "training_captures",
  ]);
  if (
    forbiddenExtensions.has(extension) ||
    path.basename(filePath).startsWith(".env") ||
    segments.some((segment) => forbiddenSegments.has(segment))
  ) {
    throw new Error(`ML bundle source path is reserved for local data or secrets: ${filePath}`);
  }
}

function writeFileAtomically(filePath: string, bytes: Uint8Array): void {
  const target = path.resolve(ROOT, filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.stage-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function encryptTarget(target: ModuleTarget, password: string): void {
  const sourceFiles = readSourceFiles(target.source);
  const encrypted = encryptBundleBytes(sourceFiles, password, {
    requiredFiles: target.requiredFiles,
  });
  writeFileAtomically(target.bundle, encrypted);
  console.log(`✔ [pass] ${target.label}: encrypted ${sourceFiles.length} source files`);
}

function decodeBundle(encrypted: Buffer, password: string, target: ModuleTarget): DecryptedBundle {
  try {
    const bundle = decryptBundleBytes(encrypted, password);
    const required = new Set(bundle.requiredFiles);
    for (const requiredFile of target.requiredFiles) {
      if (!required.has(requiredFile)) {
        throw new Error(`${target.label} manifest is missing required entry ${requiredFile}`);
      }
    }
    return bundle;
  } catch (versionedError) {
    const versionedMessage = versionedError instanceof Error ? versionedError.message : String(versionedError);
    if (!/format or version is unsupported/i.test(versionedMessage)) {
      throw versionedError;
    }
    try {
      const legacy = decryptLegacyBundleBytes(encrypted, password);
      return {
        ...createBundleSnapshot(legacy.files, target.requiredFiles),
        ciphertextSha256: legacy.ciphertextSha256 ?? crypto.createHash("sha256").update(encrypted).digest("hex"),
      };
    } catch (legacyError) {
      const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
      if (/authentication failed/i.test(versionedMessage) && /authentication failed/i.test(legacyMessage)) {
        throw new Error(`${target.label} bundle authentication failed (check its configured password)`);
      }
      throw new Error(`${target.label} bundle validation failed: ${versionedMessage}; legacy format: ${legacyMessage}`);
    }
  }
}

function decryptTarget(
  target: ModuleTarget,
  password: string,
  options: { reportReady: boolean },
): boolean {
  const bundlePath = path.resolve(ROOT, target.bundle);
  if (!fs.existsSync(bundlePath)) throw new Error(`${target.label} bundle is missing: ${target.bundle}`);
  const bundle = decodeBundle(fs.readFileSync(bundlePath), password, target);
  const extractionPath = path.resolve(ROOT, target.source);
  if (!isBundleExtracted(bundle, extractionPath)) {
    extractBundleAtomically(bundle, extractionPath);
  }
  if (!isBundleExtracted(bundle, extractionPath)) {
    throw new Error(`${target.label} extraction failed final integrity validation`);
  }
  if (options.reportReady) console.log(`✔ [pass] ${target.label}: ${bundle.bundleId}`);
  return true;
}

function isStrictEnvironment(): boolean {
  return ["1", "true"].includes((process.env.CI ?? "").toLocaleLowerCase("en-US"));
}

async function main(argv: string[]): Promise<number> {
  const [mode, ...options] = argv;
  const passwords = getPasswords();
  const branch = getCurrentBranch();
  const onlyRs = options.includes("--only-rs");
  const onlyMl = options.includes("--only-ml");
  const requireMl = options.includes("--require-ml") || isStrictEnvironment();

  if (mode === "encrypt") {
    if (isStrictEnvironment()) {
      throw new Error("Encryption is restricted to local checkouts; CI must consume committed encrypted bundles");
    }
    if (branch !== "encrypted-modules") {
      throw new Error("Encryption is only allowed on the `encrypted-modules` branch");
    }
    const targets = onlyRs
      ? MODULES.filter((target) => target.password === "demod")
      : onlyMl
        ? MODULES.filter((target) => target.label === "ML modules")
        : MODULES;
    for (const target of targets) {
      const password = passwords[target.password];
      if (!password) throw new Error(`${target.label} password is not configured`);
      encryptTarget(target, password);
    }
    console.log("✔ [pass] Encrypted module bundles are ready.");
    return 0;
  }

  if (mode !== "decrypt" && mode !== "decrypt-if-needed") {
    console.error("Usage: tsx scripts/encrypted-modules/crypt.ts [encrypt|decrypt|decrypt-if-needed] [--force] [--require-ml]");
    return 64;
  }
  if (branch === "encrypted-modules") {
    if (mode === "decrypt-if-needed") return 0;
    console.log("ℹ [skip] Decryption is prevented on the `encrypted-modules` branch to preserve source edits.");
    return 0;
  }

  for (const target of MODULES.filter((item) => item.label !== "ML modules")) {
    const password = passwords[target.password];
    if (!password) throw new Error(`${target.label} password is not configured`);
    decryptTarget(target, password, { reportReady: mode === "decrypt" });
  }

  const mlTarget = MODULES.find((target) => target.label === "ML modules")!;
  const mlPassword = passwords[mlTarget.password];
  if (!fs.existsSync(path.resolve(ROOT, mlTarget.bundle))) {
    const message = `Encrypted ML bundle is unavailable: ${mlTarget.bundle}`;
    if (requireMl || mode === "decrypt") throw new Error(message);
    console.warn(`⚠ [unavailable] ${message}; development surfaces will use their retryable fallback.`);
  } else if (!mlPassword) {
    const message = "UNSAFE_LOCAL_LATEX_PASSWORD is required to load encrypted ML modules";
    if (requireMl || mode === "decrypt") throw new Error(message);
    console.warn(`⚠ [unavailable] ${message}; development surfaces will use their retryable fallback.`);
  } else {
    try {
      const ready = await ensureMlBundle(ROOT, { password: mlPassword });
      if (mode === "decrypt") console.log(`✔ [pass] ML modules: ${ready.bundleId}`);
    } catch (error) {
      if (requireMl || mode === "decrypt") throw error;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`⚠ [unavailable] ML bundle validation failed: ${detail}; development surfaces will use their retryable fallback.`);
    }
  }

  if (mode === "decrypt") console.log("✔ [pass] Decrypting N-APT modules.");
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2)).then((status) => {
    process.exitCode = status;
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`✗ [fail] Encrypted modules: ${detail}`);
    process.exitCode = 1;
  });
}
