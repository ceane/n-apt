/// <reference types="vitest/config" />
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";

// https://vite.dev/config/
import { fileURLToPath } from 'node:url';
// import { reactDevtools } from 'agent-react-devtools/vite';
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

const injectBrowserEnv = (browserEnv) => ({
  name: "n-apt-browser-env",
  transform(code, id) {
    if (!id.includes("consts/env.ts") || !code.includes("__N_APT_ENV__")) {
      return null;
    }

    return code.replaceAll(
      "__N_APT_BROWSER_ENV__",
      JSON.stringify(browserEnv),
    );
  },
});

const styledComponentsFixPlugin = () => ({
  name: 'styled-components-fix',
  async resolveId(id) {
    if (id === 'styled-components') {
      // Force resolution to the node_modules version only
      return { id: require.resolve('styled-components'), external: false };
    }
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, dirname, "");
  const browserEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        (key.startsWith("VITE_") && key !== "VITE_UNSAFE_LOCAL_USER_PASSWORD") ||
        key === "NAPT_PBKDF2_SALT",
    ),
  );

  return {
  plugins: [
    injectBrowserEnv(browserEnv),
    styledComponentsFixPlugin(),
    react({
      // Configure React Fast Refresh to handle styled-components better
      jsxRuntime: 'automatic',
      // Ensure JSX is parsed correctly
    }),
    glsl({
      defaultExtension: 'wgsl',
      compress: false,
    })
  ],
  optimizeDeps: {
    include: ['styled-components', 'react', 'react-dom'],
    exclude: [],
  },
  ssr: {
    noExternal: ['styled-components'],
  },
  root: "./src/ts",
  envDir: "../../",
  publicDir: path.resolve(dirname, "public"),
  build: {
    outDir: "./dist",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/styled-components')) {
            return 'vendor-styled';
          }
        },
      },
    },
  },
  resolve: {
    alias: [{
      find: /^\/?@n-apt\/md-signals\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/md-signals")}/$1`
    }, {
      find: /^\/?@n-apt\/md-preview\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/md-preview")}/$1`
    }, {
      find: /^\/?@n-apt\/encrypted-modules\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/encrypted-modules")}/$1`
    }, {
      find: /^\/?@n-apt\/public\/(.*)$/,
      replacement: path.resolve(dirname, "public/$1")
    }, {
      find: /^\/?@n-apt\/webmcp\/(.*)$/,
      replacement: path.resolve(dirname, "src/ts/agents/webmcp/$1")
    }, {
      find: /^\/?@n-apt\/tracked-interactive\/(.*)$/,
      replacement: path.resolve(dirname, "src/tracked-interactive/$1")
    }, {
      find: /^\/?@n-apt\/(.*)$/,
      replacement: path.resolve(dirname, "src/ts/$1")
    }, {
      find: /^\/?@n-apt$/,
      replacement: path.resolve(dirname, "src/ts")
    }]
  },
  server: {
    port: 5173,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
    fs: {
      allow: fsAllow,
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/rebuild-status') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          const statusFile = path.resolve(dirname, '.rebuild_status.json');
          if (fs.existsSync(statusFile)) {
            res.end(fs.readFileSync(statusFile));
          } else {
            res.end(JSON.stringify({ rebuilding: false }));
          }
        } else {
          next();
        }
      });
    },
    proxy: {
      "/ws": {
        target: "ws://localhost:8765",
        ws: true,
        changeOrigin: true,
        timeout: 10000,
        proxyTimeout: 10000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, socket) => {
            if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
              if (socket && typeof socket.destroy === 'function') {
                socket.destroy();
              }
            } else {
              console.error('WebSocket proxy error:', err);
            }
          });
        }
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
      "/logout": {
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
  };
});
