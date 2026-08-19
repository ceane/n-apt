/// <reference types="vitest/config" />
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";
import { reactRouter } from "@react-router/dev/vite";

// https://vite.dev/config/
import { fileURLToPath } from 'node:url';
// import { reactDevtools } from 'agent-react-devtools/vite';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const scopedFrontendRoots = {
  app: "src/ts/app",
  ui: "src/ts/shared/ui",
  math: "src/ts/shared/math",
  layout: "src/ts/shared/layout",
  spectrum: "src/ts/features/spectrum",
  demodulation: "src/ts/features/demodulation",
  capture: "src/ts/features/capture",
  transmit: "src/ts/features/transmit",
  maps: "src/ts/features/maps",
  learn: "src/ts/features/learn",
  "three-d": "src/ts/features/three-d",
  "draw-signal": "src/ts/features/draw-signal",
  classification: "src/ts/features/classification",
  settings: "src/ts/features/settings",
  "sdr-test": "src/ts/features/sdr-test",
  agents: "src/ts/agents",
  cli: "src/ts/cli",
  consts: "src/ts/consts",
  crypto: "src/ts/crypto",
  redux: "src/ts/redux",
  types: "src/ts/types",
  validation: "src/ts/validation",
  workers: "src/ts/workers",
  shaders: "src/ts/shaders",
};

const scopedFrontendAliases = Object.entries(scopedFrontendRoots).flatMap(
  ([namespace, relativeRoot]) => {
    const root = path.resolve(dirname, relativeRoot);
    return [
      {
        find: new RegExp(`^\\/?@n-apt/${namespace}$`),
        replacement: root,
      },
      {
        find: new RegExp(`^\\/?@n-apt/${namespace}/(.*)$`),
        replacement: `${root}/$1`,
      },
    ];
  },
);

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

const rebuildStatusPlugin = () => ({
  name: "n-apt-rebuild-status",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const urlPath = req.url?.split("?")[0];
      if (urlPath !== "/rebuild-status") {
        next();
        return;
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const statusFile = path.resolve(dirname, ".rebuild_status.json");
      if (fs.existsSync(statusFile)) {
        res.end(fs.readFileSync(statusFile));
      } else {
        res.end(JSON.stringify({ rebuilding: false }));
      }
    });
  },
});

const markdownForAgentsPlugin = () => ({
  name: "n-apt-markdown-for-agents",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const urlPath = (req.url || "").split("?")[0];
      const wantsMarkdown = String(req.headers.accept || "").includes("text/markdown");
      if (urlPath === "/agents.md" && (wantsMarkdown || req.method === "GET")) {
        const index = [
          "# N-APT Agent Surfaces",
          "",
          "This index describes the Markdown-for-Agents and WebMCP surfaces. CLI mutations require `--allow-mutations`; transmission and destructive operations are blocked.",
          "",
          "## Supported Markdown routes",
          "",
          "- `/` and `/visualizer` — [visualizer](visualizer.md)",
          "- `/demodulate` and `/demod` — [analysis](analysis.md)",
          "- `/draw-signal` — [draw-signal](draw-signal.md)",
          "- `/3d-model` — [3d-model](3d-model.md)",
          "- `/map-endpoints` — [map-endpoints](map-endpoints.md)",
          "",
          "## Coverage policy",
          "",
          "Settings and I/Q captures require authentication. Educational, legal, onboarding, and demo routes are not executable agent surfaces.",
        ].join("\n");
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Vary", "Accept");
        res.setHeader("x-markdown-tokens", String(Math.ceil(index.length / 4)));
        res.setHeader("content-signal", "ai-train=no, search=yes, ai-input=yes");
        res.end(index);
        return;
      }
      if (!wantsMarkdown) return next();
      const files = {
        "/": "visualizer.md",
        "/visualizer": "visualizer.md",
        "/demodulate": "analysis.md",
        "/demod": "analysis.md",
        "/draw-signal": "draw-signal.md",
        "/3d-model": "3d-model.md",
        "/map-endpoints": "map-endpoints.md",
      };
      const file = files[urlPath];
      if (!file) return next();
      const filePath = path.resolve(dirname, "src/ts/agents/markdown/routes", file);
      if (!fs.existsSync(filePath)) return next();
      const content = fs.readFileSync(filePath, "utf8");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Vary", "Accept");
      res.setHeader("x-markdown-tokens", String(Math.ceil(content.length / 4)));
      res.setHeader("content-signal", "ai-train=no, search=yes, ai-input=yes");
      res.end(content);
    });
  },
});

export default defineConfig(({ mode }) => {
  const useFrameworkViteRoot = process.env.NAPT_REACT_ROUTER === "1";
  const backendProxyTarget =
    process.env.NAPT_BACKEND_PROXY_URL ?? "http://127.0.0.1:8765";
  const backendWebSocketProxyTarget = backendProxyTarget.replace(
    /^http:/,
    "ws:",
  );
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
    rebuildStatusPlugin(),
    markdownForAgentsPlugin(),
    ...(!useFrameworkViteRoot ? [react({
      // Configure React Fast Refresh to handle styled-components better
      jsxRuntime: 'automatic',
    })] : []),
    ...(useFrameworkViteRoot ? [reactRouter()] : []),
    glsl({
      defaultExtension: 'wgsl',
      compress: false,
    })
  ],
  optimizeDeps: {
    include: ['styled-components', 'react', 'react-dom'],
    // Heavy / route-lazy packages: keep out of cold Rolldown prebundle so
    // Vite can serve the app before these are needed.
    exclude: [
      '@huggingface/transformers',
      'elkjs',
      'elkjs/lib/elk.bundled.js',
    ],
    holdUntilCrawlEnd: false,
  },
  ssr: {
    noExternal: ['styled-components'],
  },
  root: useFrameworkViteRoot ? dirname : "./src/ts",
  envDir: useFrameworkViteRoot ? dirname : "../../",
  publicDir: path.resolve(dirname, "public"),
  build: {
    // Keep the existing CSS surface compatible with Vite 8's default
    // Lightning CSS minifier. The app's global @font-face declarations are
    // valid PostCSS input but are rejected by Lightning CSS's minify pass.
    cssMinify: 'esbuild',
        outDir: path.resolve(dirname, "dist"),
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
    alias: [...scopedFrontendAliases, {
      find: /^\/?@n-apt\/app-article$/,
      replacement: path.resolve(dirname, "src/app-article")
    }, {
      find: /^\/?@n-apt\/app-article\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/app-article")}/$1`
    }, {
      find: /^\/?@n-apt\/app-game$/,
      replacement: path.resolve(dirname, "src/app-game")
    }, {
      find: /^\/?@n-apt\/app-game\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/app-game")}/$1`
    }, {
      find: /^\/?@n-apt\/app-legal$/,
      replacement: path.resolve(dirname, "src/app-legal")
    }, {
      find: /^\/?@n-apt\/app-legal\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/app-legal")}/$1`
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
      find: /^\/?@n-apt\/(.*)$/,
      replacement: path.resolve(dirname, "src/ts/$1")
    }, {
      find: /^\/?@n-apt$/,
      replacement: path.resolve(dirname, "src/ts")
    }]
  },
  server: {
    port: 5173,
    // Let Vite bind HMR to the actual dev-server port. A fixed 5173 HMR
    // endpoint breaks `vite --port <other-port>` and leaves the Router SPA
    // hydration fallback stuck on Loading N-APT.
    hmr: true,
    fs: {
      allow: fsAllow,
    },
    proxy: {
      "/ws": {
        target: backendWebSocketProxyTarget,
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
        target: backendProxyTarget,
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
        target: backendProxyTarget,
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
        target: backendProxyTarget,
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
        target: backendProxyTarget,
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
        target: backendProxyTarget,
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
