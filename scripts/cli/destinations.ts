import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { CaptureDestinationId } from "@n-apt/capture/destinations";

type CaptureDestinationSettings = {
  version: 1;
  captureDestination: CaptureDestinationId;
};

export const DEFAULT_CAPTURE_DESTINATION_SETTINGS_PATH = join(
  homedir(),
  ".n-apt.json",
);

export async function loadCaptureDestination(
  settingsPath = DEFAULT_CAPTURE_DESTINATION_SETTINGS_PATH,
): Promise<CaptureDestinationId> {
  try {
    const parsed = JSON.parse(
      await readFile(settingsPath, "utf8"),
    ) as Partial<CaptureDestinationSettings>;
    return parsed.captureDestination === "aspect" ? "aspect" : "local";
  } catch {
    return "local";
  }
}

export async function saveCaptureDestination(
  destination: CaptureDestinationId,
  settingsPath = DEFAULT_CAPTURE_DESTINATION_SETTINGS_PATH,
): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  const settings: CaptureDestinationSettings = {
    version: 1,
    captureDestination: destination,
  };
  await writeFile(settingsPath, `${JSON.stringify(settings)}\n`, {
    mode: 0o600,
  });
  await chmod(settingsPath, 0o600);
}

export function getCaptureOutputPath(options: {
  destination: CaptureDestinationId;
  filename: string;
  downloadsDirectory: string;
  aspectPath?: string;
  outputOverride?: string;
}): string {
  if (options.outputOverride) return resolve(options.outputOverride);
  if (!options.filename || basename(options.filename) !== options.filename) {
    throw new Error("Capture filename must not contain a path");
  }
  if (options.destination === "aspect") {
    if (!options.aspectPath) {
      throw new Error(
        "Aspect destination is not configured; set N_APT_ASPECT_PATH to its mounted captures folder",
      );
    }
    return join(options.aspectPath, options.filename);
  }
  return join(options.downloadsDirectory, options.filename);
}

export async function writeCaptureArtifact(
  outputPath: string,
  bytes: Uint8Array,
  destination: CaptureDestinationId,
): Promise<void> {
  if (destination === "aspect") {
    await assertAspectMountAvailable(dirname(outputPath));
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
  }
  await writeFile(outputPath, bytes);
}

export async function assertAspectMountAvailable(aspectPath: string): Promise<void> {
  try {
    if (!isAbsolute(aspectPath)) {
      throw new Error("N_APT_ASPECT_PATH must be an absolute path");
    }
    if (!(await stat(aspectPath)).isDirectory()) {
      throw new Error("configured path is not a directory");
    }
  } catch (error) {
    throw new Error(
      `Aspect mount folder is unavailable at ${aspectPath}: ${String(error)}`,
    );
  }
}
