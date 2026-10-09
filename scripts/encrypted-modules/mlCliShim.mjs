import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("./runMlEntrypoint.mjs", import.meta.url));

export function runProtectedMlEntrypoint(runtime, entry, args = process.argv.slice(2)) {
  const result = spawnSync(process.execPath, [
    helperPath,
    "--runtime", runtime,
    "--entry", entry,
    "--",
    ...args,
  ], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function projectRootFromEntry(entryPath) {
  return path.resolve(path.dirname(fileURLToPath(entryPath)), "../..");
}
