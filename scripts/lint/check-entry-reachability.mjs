#!/usr/bin/env node
/**
 * Structural hygiene checks:
 *  1. Every TS/TSX module under src must be reachable from a real entry
 *     point (SPA index.html, RR7 root/routes, worker entries, CLI tools,
 *     stories/tests). Flags files that nothing can reach anymore.
 *  2. Every package.json script that invokes a repo file target must point
 *     at a file that exists.
 *
 * Run via `npm run lint:structure`. Exit code 1 on violations.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CWD = process.cwd();
const ROOTS = ["src/ts", "src/app-article", "src/app-game", "src/app-legal"];
const SKIP_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "target",
  ".act",
]);

function walk(d, files) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, files);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      files.push(path.normalize(p));
    }
  }
}

const files = [];
ROOTS.forEach((r) => {
  if (fs.existsSync(r)) walk(r, files);
});

function tryFile(base) {
  const c = base.startsWith(CWD) ? path.relative(CWD, base) : base;
  for (const e of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const cand = c + e;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return path.normalize(cand);
    }
  }
  return null;
}

// Parse the @n-apt/* alias table straight out of tsconfig.json.
const raw = fs.readFileSync("tsconfig.json", "utf8");
const pathsMap = {};
let m;
const entryRe = /"(@ladle\/react|@n-apt\/[^"]+)"\s*:\s*\[([^\]]*)\]/g;
while ((m = entryRe.exec(raw))) {
  const targets = [...m[2].matchAll(/"([^"]+)"/g)].map((x) =>
    x[1].replace(/^\.\//, ""),
  );
  pathsMap[m[1]] = targets;
}

function resolveAlias(spec) {
  for (const [pat, targets] of Object.entries(pathsMap)) {
    if (!pat.endsWith("*")) continue;
    const prefix = pat.slice(0, -1);
    if (spec.startsWith(prefix)) {
      const rest = spec.slice(prefix.length);
      for (const t of targets) {
        const r = tryFile(t.replace(/\*$/, "") + rest);
        if (r) return r;
      }
    }
  }
  for (const [pat, targets] of Object.entries(pathsMap)) {
    if (!pat.endsWith("*") && spec === pat) {
      for (const t of targets) {
        const r = tryFile(t);
        if (r) return r;
      }
    }
  }
  return null;
}

const importRe =
  /from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']|new\s+URL\(\s*["']([^"']+)["']/g;

function importsOf(f) {
  const src = fs.readFileSync(f, "utf8");
  const out = [];
  let m2;
  while ((m2 = importRe.exec(src))) {
    const spec = m2[1] || m2[2] || m2[3];
    if (!spec) continue;
    let r = null;
    if (spec.startsWith(".")) r = tryFile(path.resolve(path.dirname(f), spec));
    else if (spec.startsWith("@n-apt/")) r = resolveAlias(spec);
    else continue;
    if (r) out.push(r);
  }
  return out;
}

// React Router route tables reference modules as plain strings.
function routeRefs(f) {
  const src = fs.readFileSync(f, "utf8");
  const out = [];
  const re = /(?:route|layout|index)\(\s*(?:[^,]*,\s*)?["'](\.\/[^"']+)["']/g;
  let m3;
  while ((m3 = re.exec(src))) {
    const r = tryFile(path.resolve(path.dirname(f), m3[1]));
    if (r) out.push(r);
  }
  return out;
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scriptText =
  JSON.stringify(pkg.scripts) +
  JSON.stringify(pkg.dependencies || {}) +
  JSON.stringify(pkg.devDependencies || {});

const prodSeeds = new Set(
  files.filter(
    (f) =>
      /^src\/ts\/(root|routes)\.(ts|tsx)$/.test(f) ||
      /^src\/ts\/app\/routes\//.test(f) ||
      /workers\/(fileWorker|scannerWorker)\.ts$/.test(f) ||
      /(questionnaireWorker|transcriptWorker|demodLayoutWorker)\.ts$/.test(f) ||
      /^src\/(app-article|app-game)\/main\.tsx$/.test(f) ||
      (/^src\/ts\/cli\//.test(f) &&
        scriptText.includes(path.basename(f, path.extname(f)))),
  ),
);
for (const f of [...prodSeeds]) {
  routeRefs(f).forEach((r) => prodSeeds.add(r));
}
// index.html script tags (classic Vite SPA entry)
const spaEntry = "src/ts/index.html";
if (fs.existsSync(spaEntry)) {
  const html = fs.readFileSync(spaEntry, "utf8");
  for (const mm of html.matchAll(/src="(\.\/[^"]+)"/g)) {
    const r = tryFile(path.resolve(path.dirname(spaEntry), mm[1]));
    if (r) prodSeeds.add(r);
  }
}

const testSeeds = new Set(
  files.filter(
    (f) => /\.stories\.tsx?$/.test(f) || /__tests__\//.test(f),
  ),
);

// Intentional keepers: manual CLI / agent tooling that is run by hand or by
// external agents rather than imported from an app entry point.
const intentionalKeepers = new Set([
  "src/ts/agents/capabilities.ts",
  "src/ts/agents/webmcp/registry.ts",
  "src/ts/cli/signalCli.ts",
  "src/ts/cli/snapshotHarness.ts",
  "src/ts/cli/snapshotModel.ts",
]);

function bfs(seeds) {
  const reach = new Set(seeds);
  for (let pass = 0; pass < 80; pass++) {
    let added = 0;
    for (const f of files) {
      if (!reach.has(f)) continue;
      for (const imp of importsOf(f)) {
        if (!reach.has(imp)) {
          reach.add(imp);
          added++;
        }
      }
    }
    if (!added) break;
  }
  return reach;
}

const fullReach = bfs(new Set([...prodSeeds, ...testSeeds]));
const orphans = files
  .filter((f) => !fullReach.has(f) && !intentionalKeepers.has(f))
  .sort();

// package.json script file-target existence
const brokenScripts = [];
for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
  const re = /(scripts\/[A-Za-z0-9_/.-]+\.(?:tsx?|cjs|mjs|js|sh))/g;
  let mm;
  while ((mm = re.exec(cmd))) {
    if (!fs.existsSync(mm[1])) brokenScripts.push(`${name} -> ${mm[1]}`);
  }
}

let failed = false;
if (orphans.length > 0) {
  failed = true;
  console.error(`Unreachable modules (${orphans.length}) — delete them or wire them in:`);
  for (const o of orphans) console.error(`  ${o}`);
}
if (brokenScripts.length > 0) {
  failed = true;
  console.error(`package.json scripts pointing at missing files:`);
  for (const b of brokenScripts) console.error(`  ${b}`);
}
if (!failed) {
  console.log(
    `OK: ${files.length} modules all reachable; every package.json script target exists.`,
  );
}
process.exit(failed ? 1 : 0);
