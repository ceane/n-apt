import path from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";

register();

/** Loads the implementation only after the authenticated ML bundle is ready. */
export async function createRunner(...args) {
  const { ensureMlBundle } = await import("../encrypted-modules/mlRuntime.ts");
  const { extractionPath } = await ensureMlBundle(process.cwd());
  const implementation = pathToFileURL(
    path.join(extractionPath, "scripts/classifier/webgpuClassifierHarness.mjs"),
  ).href;
  const module = await import(implementation);
  return module.createRunner(...args);
}
