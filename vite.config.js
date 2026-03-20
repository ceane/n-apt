/// <reference types="vitest/config" />
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
import { fileURLToPath } from 'node:url';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const resolveGitRoot = () => {
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (!gitCommonDir) {
      return null;
    }

    const absoluteCommonDir = path.isAbsolute(gitCommonDir)
      ? gitCommonDir
      : path.resolve(dirname, gitCommonDir);

    return path.resolve(absoluteCommonDir, "..");
  } catch {
    return null;
  }
};

const fsAllow = Array.from(
  new Set(
    [dirname, resolveGitRoot()]
      .filter((value) => Boolean(value))
      .map((value) => {
        const resolved = path.resolve(value);
        try {
          return fs.realpathSync(resolved);
        } catch {
          return resolved;
        }
      }),
  ),
);

const markdownPreviewBasePath = "/md-preview";
const markdownPreviewSrcDir = path.resolve(dirname, "src/public");
const markdownPreviewPublicDir = path.resolve(dirname, "public", markdownPreviewBasePath.slice(1));

const copyDirectory = async (from, to) => {
  await fs.promises.mkdir(to, { recursive: true });
  const entries = await fs.promises.readdir(from, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(sourcePath, targetPath);
    }
  }
};

const syncMarkdownPreviewToPublic = async () => {
  await fs.promises.rm(markdownPreviewPublicDir, { recursive: true, force: true });
  await copyDirectory(markdownPreviewSrcDir, markdownPreviewPublicDir);
};

const debounce = (fn, delay = 120) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const markdownPreviewPlugin = () => ({
  name: "markdown-preview-sync",
  async configResolved() {
    await syncMarkdownPreviewToPublic();
  },
  configureServer(server) {
    const scheduleSync = debounce(async () => {
      await syncMarkdownPreviewToPublic();
      server.ws.send({ type: "full-reload" });
    });

    server.watcher.add(markdownPreviewSrcDir);
    server.watcher.on("all", (event, filePath) => {
      if (!filePath) return;
      const normalized = path.resolve(filePath);
      if (normalized.startsWith(markdownPreviewSrcDir)) {
        scheduleSync();
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), markdownPreviewPlugin()],
  root: "./src/ts",
  envDir: "../../",
  publicDir: "../../public",
  build: {
    outDir: "../../dist"
  },
  resolve: {
    alias: [{
      find: /^@n-apt\/encrypted-modules\/(.*)$/,
      replacement: `${path.resolve(__dirname, "src/encrypted-modules")}/$1`
    }, {
      find: /^@n-apt\/(.*)$/,
      replacement: `${path.resolve(__dirname, "src/ts")}/$1`
    }, {
      find: "@n-apt",
      replacement: path.resolve(__dirname, "src/ts")
    }]
  },
  server: {
    port: 5173,
    fs: {
      allow: fsAllow,
    },
    proxy: {
      "/ws": {
        target: "ws://localhost:8765",
        ws: true
      },
      "/auth": {
        target: "http://localhost:8765"
      },
      "/status": {
        target: "http://localhost:8765"
      },
      "/capture": {
        target: "http://localhost:8765"
      },
      "/api": {
        target: "http://localhost:8765"
      }
    }
  }
});