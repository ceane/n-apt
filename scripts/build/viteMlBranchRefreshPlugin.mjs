import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PLUGIN_NAME = "vite:encrypted-ml-branch-refresh";
const DEBOUNCE_MS = 300;

function resolveGitHeadPath(repositoryRoot) {
  return execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-path", "HEAD"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
}

function readGitHead(repositoryRoot) {
  return execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function watchGitHead(repositoryRoot, onChange) {
  try {
    const headPath = resolveGitHeadPath(repositoryRoot);
    const onStatChange = (current, previous) => {
      if (
        current.mtimeMs !== previous.mtimeMs ||
        current.ctimeMs !== previous.ctimeMs ||
        current.ino !== previous.ino ||
        current.size !== previous.size
      ) {
        onChange();
      }
    };
    fs.watchFile(headPath, { interval: 200, persistent: false }, onStatChange);
    return () => fs.unwatchFile(headPath, onStatChange);
  } catch {
    return () => {};
  }
}

function decryptModules(repositoryRoot) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(
      repositoryRoot,
      "scripts/encrypted-modules/crypt.ts",
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, "decrypt-if-needed"],
      { cwd: repositoryRoot, stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Encrypted module refresh failed"));
    });
  });
}

export function viteMlBranchRefreshPlugin(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const bundlePath = path.join(
    repositoryRoot,
    "src/encrypted-modules/ml.bundle.enc",
  );
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const readHead = options.readHead ?? readGitHead;
  const watchHead = options.watchHead ?? watchGitHead;
  const decrypt = options.decryptModules ?? decryptModules;
  let cleanup = () => {};

  return {
    name: PLUGIN_NAME,
    apply: "serve",
    configureServer(server) {
      let disposed = false;
      let timer;
      let bundleChanged = false;
      let refreshRunning = false;
      let refreshRequested = false;
      let lastHead;
      try {
        lastHead = readHead(repositoryRoot);
      } catch {
        lastHead = undefined;
      }

      server.watcher.add(bundlePath);
      const refresh = async () => {
        if (refreshRunning) {
          refreshRequested = true;
          return;
        }
        refreshRunning = true;
        try {
          do {
            refreshRequested = false;
            if (disposed) return;
            let currentHead;
            try {
              currentHead = readHead(repositoryRoot);
            } catch {
              currentHead = undefined;
            }
            const branchChanged =
              currentHead !== undefined && currentHead !== lastHead;
            if (!branchChanged && !bundleChanged) return;

            if (currentHead !== undefined) lastHead = currentHead;
            bundleChanged = false;
            try {
              await decrypt(repositoryRoot);
            } catch {
              server.config.logger.warn(
                "[vite] Encrypted ML modules could not be refreshed; reloading with the available fallback.",
              );
            }

            if (disposed) return;
            await server.restart();
          } while (refreshRequested && !disposed);
        } finally {
          refreshRunning = false;
          if (refreshRequested && !disposed) scheduleRefresh();
        }
      };
      const scheduleRefresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void refresh();
        }, debounceMs);
      };
      const onBundleFileEvent = (file) => {
        if (path.resolve(file) !== bundlePath) return;
        bundleChanged = true;
        scheduleRefresh();
      };
      const removeHeadWatcher = watchHead(repositoryRoot, scheduleRefresh);
      for (const event of ["add", "change", "unlink"]) {
        server.watcher.on(event, onBundleFileEvent);
      }

      cleanup = () => {
        disposed = true;
        clearTimeout(timer);
        removeHeadWatcher();
        for (const event of ["add", "change", "unlink"]) {
          server.watcher.off(event, onBundleFileEvent);
        }
      };
    },
    closeServer() {
      cleanup();
      cleanup = () => {};
    },
  };
}
