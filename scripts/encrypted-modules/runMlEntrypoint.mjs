import path from "node:path";
import { spawn } from "node:child_process";
import { register } from "tsx/esm/api";
import { fileURLToPath } from "node:url";

register();
const {
  ensureMlBundle,
  ML_UNAVAILABLE_EXIT_STATUS,
  ML_UNAVAILABLE_FALLBACK,
  runGuardedMlCommand,
} = await import("./mlRuntime.ts");
const tsxLoaderPath = fileURLToPath(import.meta.resolve("tsx/esm/api"));

function parseArguments(argv) {
  let runtime = "node";
  let entry;
  let index = 0;
  while (index < argv.length && argv[index] !== "--") {
    const arg = argv[index++];
    if (arg === "--runtime") runtime = argv[index++];
    else if (arg === "--entry") entry = argv[index++];
    else throw new Error(`Unknown ML runner option: ${arg}`);
  }
  if (argv[index] === "--") index += 1;
  if (!entry || !["node", "python"].includes(runtime)) {
    throw new Error("Usage: runMlEntrypoint.mjs --runtime node|python --entry PATH -- [arguments...]");
  }
  return { runtime, entry, args: argv.slice(index) };
}

function runChild(runtime, entry, args) {
  const extractionRoot = path.resolve(process.cwd(), "src/encrypted-modules/tmp/ml");
  const target = path.resolve(extractionRoot, entry);
  if (target === extractionRoot || !target.startsWith(`${extractionRoot}${path.sep}`)) {
    return Promise.reject(new Error("Protected ML entry must stay inside the extracted bundle"));
  }
  const command = runtime === "python"
    ? (process.env.PYTHON ?? "python3")
    : process.execPath;
  const childArgs = runtime === "python"
    ? [target, ...args]
    : ["--import", tsxLoaderPath, target, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(command, childArgs, { cwd: process.cwd(), stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
}

let parsed;
try {
  parsed = parseArguments(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 64;
}

if (parsed) {
  process.exitCode = await runGuardedMlCommand({
    args: parsed.args,
    ensureReady: () => ensureMlBundle(process.cwd()),
    run: (args) => runChild(parsed.runtime, parsed.entry, args),
    writeFallback: (message) => process.stderr.write(`${message}\n`),
  });
}

// Keep these imports reachable for static smoke checks that verify the fixed
// fallback status and text used by every ML command wrapper.
void ML_UNAVAILABLE_EXIT_STATUS;
void ML_UNAVAILABLE_FALLBACK;
