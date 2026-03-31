/// <reference types="vitest/config" />
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";

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

export default defineConfig({
  plugins: [react(), glsl({
    defaultExtension: 'wgsl',
    compress: false,
  })],
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