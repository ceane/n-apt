#!/usr/bin/env node
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

async function findPackages(directory, found = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === ".git") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      try {
        const descriptor = await lstat(
          path.join(entryPath, "datapackage.json"),
        );
        if (descriptor.isFile() && !descriptor.isSymbolicLink()) {
          found.push(entryPath);
          continue;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await findPackages(entryPath, found);
    } else if (
      entry.isFile() &&
      path.extname(entry.name).toLowerCase() === ".zip"
    ) {
      found.push(entryPath);
    }
  }
  return found;
}

function outputPathForPackage(packagePath, packagesPath, outputPath) {
  const relative = path.relative(packagesPath, packagePath);
  const relativeOutput = relative.toLowerCase().endsWith(".zip")
    ? relative.slice(0, -4)
    : relative;
  const resolved = path.resolve(outputPath, relativeOutput);
  if (
    resolved === path.resolve(outputPath) ||
    !resolved.startsWith(`${path.resolve(outputPath)}${path.sep}`)
  ) {
    throw new Error(
      "Package output path must remain inside the batch output directory",
    );
  }
  return resolved;
}

function runPrepare(packagePath, outputPath, split, envFile) {
  const args = [
    "--import",
    "tsx",
    "scripts/classifier/cli.mjs",
    "prepare",
    "--package",
    packagePath,
    "--split",
    split,
    "--out",
    outputPath,
  ];
  if (envFile) args.push("--env-file", envFile);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prepare exited with status ${code ?? "unknown"}`));
    });
  });
}

/** Prepare package directories and ZIPs sequentially, preserving one output per recording. */
export async function prepareCapturePackageBatch({
  packagesPath,
  outputPath,
  split,
  envFile,
  runPackage = runPrepare,
} = {}) {
  if (!packagesPath || !outputPath || !split) {
    throw new Error(
      "Batch prepare requires --packages DIRECTORY, --split NAME, and --out DIRECTORY",
    );
  }
  const packageRoot = await realpath(path.resolve(packagesPath));
  const rootInfo = await lstat(packageRoot);
  if (!rootInfo.isDirectory())
    throw new Error("--packages must point to a directory");
  const outputRoot = path.resolve(outputPath);
  if (
    outputRoot === packageRoot ||
    outputRoot.startsWith(`${packageRoot}${path.sep}`)
  ) {
    throw new Error("--out must be outside the source package directory");
  }
  const packagePaths = await findPackages(packageRoot);
  if (packagePaths.length === 0)
    throw new Error(
      `No Data Package directories or ZIP files found under ${packageRoot}`,
    );

  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const result = { prepared: [], failed: [] };
  for (const packagePath of packagePaths) {
    const targetPath = outputPathForPackage(
      packagePath,
      packageRoot,
      outputRoot,
    );
    try {
      await runPackage(packagePath, targetPath, split, envFile);
      result.prepared.push({ packagePath, outputPath: targetPath });
      process.stdout.write(
        `Prepared ${path.relative(packageRoot, packagePath)}\n`,
      );
    } catch (error) {
      result.failed.push({ packagePath, outputPath: targetPath, error });
      process.stderr.write(
        `Failed ${path.relative(packageRoot, packagePath)}: ${error.message}\n`,
      );
    }
  }
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--packages", "--split", "--out", "--env-file"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} requires a value`);
    const key = {
      "--packages": "packagesPath",
      "--split": "split",
      "--out": "outputPath",
      "--env-file": "envFile",
    }[flag];
    if (options[key]) throw new Error(`${flag} may only be provided once`);
    options[key] = value;
  }
  return options;
}

async function main(argv) {
  const result = await prepareCapturePackageBatch(parseArgs(argv));
  if (result.failed.length) {
    process.stderr.write(
      `Batch finished: ${result.prepared.length} prepared, ${result.failed.length} failed.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Batch finished: ${result.prepared.length} prepared.\n`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`prepare-batch: ${error.message}\n`);
    process.exitCode = 1;
  });
}
