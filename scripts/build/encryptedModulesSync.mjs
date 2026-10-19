import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.env.NAPT_ENCRYPTED_MODULE_ROOT || process.cwd());
const sourceRelativePath = "src/encrypted-modules/tmp";
const bundleNames = ["ts.bundle.enc", "rs.bundle.enc", "ml.bundle.enc"];
const pollIntervalMs = 2000;
const stateFileName = ".module-bundle-state.json";

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function findEncryptedModulesWorktree() {
  const result = git(["worktree", "list", "--porcelain"], root);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git worktree list failed");
  const records = result.stdout.trim().split(/\n\n+/).filter(Boolean);
  for (const record of records) {
    const worktreePath = record.match(/^worktree (.+)$/m)?.[1];
    const branch = record.match(/^branch refs\/heads\/encrypted-modules$/m);
    if (worktreePath && branch) return path.resolve(worktreePath);
  }
  return null;
}

function listSourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === stateFileName || entry.name === ".DS_Store" || entry.name === ".gitkeep") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Encrypted module source cannot contain symlinks: ${fullPath}`);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(path.relative(directory, fullPath));
      else throw new Error(`Unsupported encrypted module source entry: ${fullPath}`);
    }
  };
  visit(directory);
  return files.sort();
}

function hashSource(directory) {
  const hash = crypto.createHash("sha256");
  const files = listSourceFiles(directory);
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(directory, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function syncSource(source, destination) {
  const sourceFiles = listSourceFiles(source);
  const sourceSet = new Set(sourceFiles);
  for (const relativePath of listSourceFiles(destination)) {
    if (!sourceSet.has(relativePath)) fs.rmSync(path.join(destination, relativePath), { force: true });
  }
  for (const relativePath of sourceFiles) {
    const from = path.join(source, relativePath);
    const to = path.join(destination, relativePath);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function generateBundles(worktree) {
  const encryptScript = path.join(root, "scripts/encrypted-modules/crypt.ts");
  const result = spawnSync(process.execPath, ["--import", "tsx", encryptScript, "encrypt"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      NAPT_ENCRYPTED_MODULE_ROOT: root,
      NAPT_ENCRYPTED_MODULE_BRANCH_ROOT: worktree,
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Encrypted-module bundle generation failed with status ${result.status}`);
  for (const bundleName of bundleNames) {
    const generatedBundle = path.join(root, "src/encrypted-modules", bundleName);
    if (!fs.existsSync(generatedBundle)) throw new Error(`Generated encrypted-module bundle is missing: ${generatedBundle}`);
  }
}

async function run() {
  const watch = process.argv.includes("--watch");
  let previousHash = null;
  let warnedUnavailable = false;
  do {
    const worktree = findEncryptedModulesWorktree();
    if (!worktree) {
      if (!warnedUnavailable) {
        console.log("[Encrypted Modules] Git has no worktree checked out on encrypted-modules; using existing bundles.");
        warnedUnavailable = true;
      }
    } else {
      warnedUnavailable = false;
      const source = path.join(worktree, sourceRelativePath);
      const destination = path.join(root, sourceRelativePath);
      const currentHash = hashSource(source);
      if (previousHash !== currentHash) {
        const destinationHash = hashSource(destination);
        if (currentHash !== destinationHash) {
          console.log("[Encrypted Modules] Branch source changed; syncing source and rebuilding bundles.");
          syncSource(source, destination);
          generateBundles(worktree);
          console.log("[Encrypted Modules] Source copied and encrypted bundles updated.");
        }
        previousHash = currentHash;
      }
    }
    if (!watch) break;
    await delay(pollIntervalMs);
  } while (true);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  run().catch((error) => {
    console.error(`[Encrypted Modules] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
