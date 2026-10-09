import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  decryptBundleBytes,
  extractBundleAtomically,
  isBundleExtracted,
} from "./bundle";

export const ML_BUNDLE_RELATIVE_PATH = "src/encrypted-modules/ml.bundle.enc";
export const ML_EXTRACTION_RELATIVE_PATH = "src/encrypted-modules/tmp/ml";
export const ML_REQUIRED_ENTRY = "index.ts";
export const ML_REQUIRED_FILES = [
  ML_REQUIRED_ENTRY,
  "src/ts/features/classification/index.ts",
  "src/ts/features/demodulation/react-flow/nodes/AudioDemodWorkflowFlow.tsx",
  "src/ts/features/demodulation/react-flow/nodes/CoreMLNode.tsx",
  "src/ts/features/demodulation/react-flow/nodes/StimulusNode.tsx",
  "src/ts/features/demodulation/react-flow/nodes/VisionDemodWorkflowFlow.tsx",
  "src/ts/features/demodulation/sidebar/StimulusNodeLibraryEntry.tsx",
  "src/ts/features/demodulation/survey/audioSurveyLiveDemod.ts",
  "src/ts/features/demodulation/survey/audioSurveyModel.ts",
  "src/ts/features/demodulation/vision/visionML.ts",
  "src/ts/features/demodulation/vision/visionModel.ts",
  "src/ts/features/demodulation/vision/visionOnnxRuntime.ts",
  "src/ts/features/three-d/VisionScene.tsx",
] as const;
export const ML_UNAVAILABLE_EXIT_STATUS = 69;
export const ML_UNAVAILABLE_FALLBACK = "Encrypted ML modules are unavailable.";

export interface EnsureMlBundleOptions {
  password?: string;
}

export interface MlBundleReady {
  bundleId: string;
  extractionPath: string;
}

export interface GuardedMlCommandOptions {
  args: readonly string[];
  ensureReady: () => Promise<unknown>;
  run: (args: readonly string[]) => Promise<number | null>;
  writeFallback: (message: string) => void;
}

export async function runGuardedMlCommand({
  args,
  ensureReady,
  run,
  writeFallback,
}: GuardedMlCommandOptions): Promise<number> {
  try {
    await ensureReady();
  } catch {
    writeFallback(ML_UNAVAILABLE_FALLBACK);
    return ML_UNAVAILABLE_EXIT_STATUS;
  }
  return (await run(args)) ?? 1;
}

function parseEnvValue(envPath: string, key: string): string | undefined {
  if (!fs.existsSync(envPath)) return undefined;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*?)\\s*$`));
    if (!match) continue;
    let value = match[1];
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    return value;
  }
  return undefined;
}

function resolvePassword(root: string, configuredPassword?: string): string | undefined {
  return configuredPassword || process.env.UNSAFE_LOCAL_LATEX_PASSWORD ||
    parseEnvValue(path.join(root, ".env.local"), "UNSAFE_LOCAL_LATEX_PASSWORD");
}

function processExists(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireExtractionLock(lockPath: string): Promise<() => Promise<void>> {
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.promises.open(lockPath, "wx", 0o600);
      await handle.writeFile(token, "utf8");
      await handle.close();
      return async () => {
        try {
          if (await fs.promises.readFile(lockPath, "utf8") === token) {
            await fs.promises.unlink(lockPath);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const existing = await fs.promises.readFile(lockPath, "utf8");
        const ownerPid = Number(existing.split(":", 1)[0]);
        if (existing && !processExists(ownerPid)) {
          await fs.promises.unlink(lockPath);
          continue;
        }
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
      }
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for encrypted ML bundle extraction to finish");
}

export async function ensureMlBundle(
  workingDirectory = process.cwd(),
  options: EnsureMlBundleOptions = {},
): Promise<MlBundleReady> {
  const root = path.resolve(workingDirectory);
  const bundlePath = path.join(root, ML_BUNDLE_RELATIVE_PATH);
  const extractionPath = path.join(root, ML_EXTRACTION_RELATIVE_PATH);
  if (!fs.existsSync(bundlePath) || !fs.lstatSync(bundlePath).isFile()) {
    throw new Error(`Encrypted ML bundle not found: ${ML_BUNDLE_RELATIVE_PATH}`);
  }
  const password = resolvePassword(root, options.password);
  if (!password) {
    throw new Error("UNSAFE_LOCAL_LATEX_PASSWORD is required to load encrypted ML modules");
  }

  const encrypted = fs.readFileSync(bundlePath);
  const bundle = decryptBundleBytes(encrypted, password);
  for (const requiredFile of ML_REQUIRED_FILES) {
    if (!bundle.requiredFiles.includes(requiredFile)) {
      throw new Error(`Encrypted ML bundle is missing required file ${requiredFile}`);
    }
  }
  const extractionParent = path.dirname(extractionPath);
  fs.mkdirSync(extractionParent, { recursive: true });
  const release = await acquireExtractionLock(path.join(extractionParent, ".ml-bundle-extract.lock"));
  try {
    if (!isBundleExtracted(bundle, extractionPath)) {
      extractBundleAtomically(bundle, extractionPath);
    }
    if (!isBundleExtracted(bundle, extractionPath)) {
      throw new Error("Encrypted ML bundle extraction failed final integrity validation");
    }
  } finally {
    await release();
  }
  return { bundleId: bundle.bundleId, extractionPath };
}
