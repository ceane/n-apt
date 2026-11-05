import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import viteConfig from "../../vite.config.js";
import { viteMlBranchRefreshPlugin } from "../../scripts/build/viteMlBranchRefreshPlugin.mjs";

const repositoryRoot = path.resolve(".");
const bundlePath = path.join(
  repositoryRoot,
  "src/encrypted-modules/ml.bundle.enc",
);

function createServerFixture(t, plugin) {
  const watcher = new EventEmitter();
  const watchedPaths = [];
  watcher.add = (paths) => {
    watchedPaths.push(...(Array.isArray(paths) ? paths : [paths]));
    return watcher;
  };
  const warnings = [];
  let restartCount = 0;
  const server = {
    watcher,
    watchedPaths,
    config: { logger: { warn: (message) => warnings.push(message) } },
    restart: async () => {
      restartCount += 1;
    },
  };
  plugin.configureServer(server);
  t.after(() => plugin.closeServer());
  return {
    watcher,
    watchedPaths,
    warnings,
    get restartCount() {
      return restartCount;
    },
  };
}

function settleDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for Vite refresh");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("Vite refreshes decrypted ML aliases after the checked-out branch changes", async (t) => {
  let head = "branch-a";
  let notifyHeadChange;
  let decryptCount = 0;
  const plugin = viteMlBranchRefreshPlugin({
    repositoryRoot,
    debounceMs: 5,
    readHead: () => head,
    watchHead: (_root, onChange) => {
      notifyHeadChange = onChange;
      return () => {};
    },
    decryptModules: async () => {
      decryptCount += 1;
    },
  });
  const server = createServerFixture(t, plugin);

  notifyHeadChange();
  await settleDebounce();
  assert.equal(server.restartCount, 0, "unchanged HEAD must be ignored");

  head = "branch-b";
  notifyHeadChange();
  await settleDebounce();

  assert.equal(
    decryptCount,
    1,
    "branch changes should refresh the local bundle extraction",
  );
  assert.equal(
    server.restartCount,
    1,
    "Vite should re-evaluate startup-time aliases",
  );
});

test("the real Git HEAD watcher detects a branch checkout", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "napt-vite-ml-head-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "--quiet");
  git("config", "user.name", "Vite refresh test");
  git("config", "user.email", "vite-refresh@example.invalid");
  await fs.writeFile(path.join(root, "README.md"), "branch refresh test\n");
  git("add", "README.md");
  git("commit", "--quiet", "-m", "initial");
  const initialBranch = execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  git("checkout", "--quiet", "-b", "next-branch");
  await fs.writeFile(path.join(root, "branch-marker.txt"), "changed HEAD\n");
  git("add", "branch-marker.txt");
  git("commit", "--quiet", "-m", "branch commit");
  git("checkout", "--quiet", initialBranch);

  let decryptCount = 0;
  const plugin = viteMlBranchRefreshPlugin({
    repositoryRoot: root,
    debounceMs: 5,
    decryptModules: async () => {
      decryptCount += 1;
    },
  });
  const server = createServerFixture(t, plugin);
  git("checkout", "--quiet", "next-branch");

  await waitUntil(() => server.restartCount === 1);
  assert.equal(decryptCount, 1);
});

test("Vite refreshes ML aliases when the encrypted bundle changes on the same branch", async (t) => {
  let decryptCount = 0;
  const plugin = viteMlBranchRefreshPlugin({
    repositoryRoot,
    debounceMs: 5,
    readHead: () => "same-branch",
    watchHead: () => () => {},
    decryptModules: async () => {
      decryptCount += 1;
    },
  });
  const server = createServerFixture(t, plugin);

  server.watcher.emit("change", bundlePath);
  await settleDebounce();

  assert.deepEqual(server.watchedPaths, [bundlePath]);
  assert.equal(decryptCount, 1);
  assert.equal(server.restartCount, 1);
});

test("Vite restarts with fallback aliases if bundle refresh fails", async (t) => {
  let head = "branch-a";
  let notifyHeadChange;
  const plugin = viteMlBranchRefreshPlugin({
    repositoryRoot,
    debounceMs: 5,
    readHead: () => head,
    watchHead: (_root, onChange) => {
      notifyHeadChange = onChange;
      return () => {};
    },
    decryptModules: async () => {
      throw new Error("sensitive decrypt detail");
    },
  });
  const server = createServerFixture(t, plugin);

  head = "branch-b";
  notifyHeadChange();
  await settleDebounce();

  assert.equal(
    server.restartCount,
    1,
    "Vite should stop using stale aliases after failure",
  );
  assert.equal(server.warnings.length, 1);
  assert.ok(!server.warnings[0].includes("sensitive decrypt detail"));
});

test("branch refreshes serialize decryption while another checkout is pending", async (t) => {
  let head = "branch-a";
  let notifyHeadChange;
  const completeDecryptions = [];
  let decryptCount = 0;
  const plugin = viteMlBranchRefreshPlugin({
    repositoryRoot,
    debounceMs: 5,
    readHead: () => head,
    watchHead: (_root, onChange) => {
      notifyHeadChange = onChange;
      return () => {};
    },
    decryptModules: () => {
      decryptCount += 1;
      return new Promise((resolve) => completeDecryptions.push(resolve));
    },
  });
  const server = createServerFixture(t, plugin);
  t.after(() => completeDecryptions.forEach((resolve) => resolve()));

  head = "branch-b";
  notifyHeadChange();
  await waitUntil(() => decryptCount === 1);
  head = "branch-c";
  notifyHeadChange();
  await settleDebounce();
  assert.equal(
    decryptCount,
    1,
    "a second decrypt must wait for the current extraction",
  );

  completeDecryptions[0]();
  await waitUntil(() => decryptCount === 2);
  completeDecryptions[1]();
  await waitUntil(() => server.restartCount === 2);
});

test("development Vite config installs the ML branch refresh plugin", () => {
  const config = viteConfig({ mode: "development", command: "serve" });
  assert.ok(
    config.plugins.some(
      (plugin) => plugin.name === "vite:encrypted-ml-branch-refresh",
    ),
  );
});
