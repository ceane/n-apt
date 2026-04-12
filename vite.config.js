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
  publicDir: path.resolve(dirname, "public"),
  build: {
    outDir: "./dist"
  },
  resolve: {
    alias: [{
      find: /^@n-apt\/encrypted-modules\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/encrypted-modules")}/$1`
    }, {
      find:  /^@n-apt\/public\/(.*)$/,
      replacement: path.resolve(dirname, "public/$1")
    }, {
      find: /^@n-apt\/(.*)$/,
      replacement: path.resolve(dirname, "src/ts/$1")
    }, {
      find: "@n-apt",
      replacement: path.resolve(dirname, "src/ts")
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
        ws: true,
        changeOrigin: true,
        timeout: 10000,
        proxyTimeout: 10000
      },
      "/auth": {
        target: "http://localhost:8765",
        changeOrigin: true,
        timeout: 10000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            if (err.code === 'ECONNREFUSED') {
              // Backend not ready yet, don't log error as it's expected during startup
              // The request will be retried by the browser
              if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('Backend not ready yet, please retry');
              }
            } else if (err.code === 'ECONNRESET') {
              // Connection reset by backend, also expected during startup/restarts
              if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('Backend connection reset, please retry');
              }
            } else {
              console.error('Proxy error:', err);
            }
          });
          proxy.on('proxyReq', (_proxyReq, _req, _res) => {
            // Log successful proxy requests for debugging
            // console.log(`Proxying ${req.method} ${req.url} to backend`);
          });
        }
      },
      "/status": {
        target: "http://localhost:8765",
        changeOrigin: true,
        timeout: 10000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            if (err.code === 'ECONNREFUSED') {
              if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('Backend not ready yet, please retry');
              }
            } else {
              console.error('Proxy error:', err);
            }
          });
        }
      },
      "/capture": {
        target: "http://localhost:8765",
        changeOrigin: true,
        timeout: 10000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            if (err.code === 'ECONNREFUSED') {
              if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('Backend not ready yet, please retry');
              }
            } else {
              console.error('Proxy error:', err);
            }
          });
        }
      },
      "/api": {
        target: "http://localhost:8765",
        changeOrigin: true,
        timeout: 10000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            if (err.code === 'ECONNREFUSED') {
              if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('Backend not ready yet, please retry');
              }
            } else {
              console.error('Proxy error:', err);
            }
          });
        }
      }
    }
  }
});