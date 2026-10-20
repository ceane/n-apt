/// <reference types="vitest/config" />
import fs from "node:fs";
import crypto from "node:crypto";
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

const encryptedMlSourceRoot = path.resolve(
  dirname,
  "src/encrypted-modules/tmp/ml/src/ts/features",
);
const mlBundlePath = path.resolve(dirname, "src/encrypted-modules/ml.bundle.enc");
const mlExtractionRoot = path.resolve(dirname, "src/encrypted-modules/tmp/ml");
const mlEntryPath = path.join(mlExtractionRoot, "index.ts");
const mlExtractionStatePath = path.join(
  mlExtractionRoot,
  ".module-bundle-state.json",
);
const requiredMlBundleFiles = [
  "index.ts",
  "src/ts/features/classification/index.ts",
  "src/ts/features/demodulation/react-flow/nodes/AudioDemodWorkflowFlow.tsx",
  "src/ts/features/demodulation/react-flow/nodes/CoreMLNode.tsx",
  "src/ts/features/demodulation/react-flow/nodes/DemodReadinessNode.tsx",
  "src/ts/features/demodulation/react-flow/nodes/StimulusNode.tsx",
  "src/ts/features/demodulation/react-flow/nodes/stimulusChannelPolicy.ts",
  "src/ts/features/demodulation/react-flow/nodes/VisionDemodWorkflowFlow.tsx",
  "src/ts/features/demodulation/sidebar/StimulusNodeLibraryEntry.tsx",
  "src/ts/features/demodulation/survey/audioSurveyLiveDemod.ts",
  "src/ts/features/demodulation/survey/audioSurveyModel.ts",
  "src/ts/features/demodulation/survey/audioSurveyMedia.ts",
  "src/ts/features/demodulation/vision/visionScreens.ts",
  "src/ts/features/demodulation/vision/visionSourcePolicy.ts",
  "src/ts/features/demodulation/vision/visionML.ts",
  "src/ts/features/demodulation/vision/visionModel.ts",
  "src/ts/features/demodulation/vision/visionOnnxRuntime.ts",
  "src/ts/features/three-d/VisionScene.tsx",
];
const hasDecryptedMlSource = (() => {
  try {
    if (
      !fs.lstatSync(mlBundlePath).isFile() ||
      !fs.lstatSync(mlEntryPath).isFile() ||
      !fs.lstatSync(mlExtractionStatePath).isFile()
    ) {
      return false;
    }
    const state = JSON.parse(fs.readFileSync(mlExtractionStatePath, "utf8"));
    const bundleSha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(mlBundlePath))
      .digest("hex");
    return (
      state.format === "n-apt-encrypted-module-bundle" &&
      state.version === 1 &&
      /^[a-f0-9]{64}$/.test(state.bundleId) &&
      state.ciphertextSha256 === bundleSha256 &&
      Array.isArray(state.requiredFiles) &&
      Array.isArray(state.files) &&
      requiredMlBundleFiles.every(
        (filePath) =>
          state.requiredFiles.includes(filePath) && state.files.includes(filePath),
      )
    );
  } catch {
    return false;
  }
})();
const publicMlAdapterRoot = path.resolve(
  dirname,
  "src/ts/encryptedAdapters/ml",
);
const protectedSurveyRoot = path.join(
  encryptedMlSourceRoot,
  "demodulation",
  "survey",
);
const protectedVisionRoot = path.join(
  encryptedMlSourceRoot,
  "demodulation",
  "vision",
);
const protectedClassificationRoot = path.join(
  encryptedMlSourceRoot,
  "classification",
);
const protectedClassificationNativeRoot = path.join(
  protectedClassificationRoot,
  "native",
);
const publicClassificationNativeRoot = path.resolve(
  dirname,
  "src/ts/features/classification/native",
);

const encryptedMlAliases = [
  {
    find: /^\/?@n-apt\/encrypted-modules\/tmp\/ml\/index$/,
    replacement: hasDecryptedMlSource
      ? mlEntryPath
      : path.join(publicMlAdapterRoot, "encryptedMlUnavailable.ts"),
  },
  {
    find: /^\/?@n-apt\/demodulation\/survey\/audioSurveyMedia$/,
    replacement: hasDecryptedMlSource
      ? path.join(protectedSurveyRoot, "audioSurveyMedia.ts")
      : path.join(publicMlAdapterRoot, "audioSurveyFallback.ts"),
  },
  {
    find: /^\/?@n-apt\/demodulation\/vision\/visionScreens$/,
    replacement: hasDecryptedMlSource
      ? path.join(protectedVisionRoot, "visionScreens.ts")
      : path.join(publicMlAdapterRoot, "visionScreensFallback.ts"),
  },
  {
    find: /^\/?@n-apt\/demodulation\/vision\/visionSourcePolicy$/,
    replacement: hasDecryptedMlSource
      ? path.join(protectedVisionRoot, "visionSourcePolicy.ts")
      : path.join(publicMlAdapterRoot, "visionSourcePolicyFallback.ts"),
  },
  {
    find: /^\/?@n-apt\/demodulation\/react-flow\/nodes\/stimulusChannelPolicy$/,
    replacement: hasDecryptedMlSource
      ? path.join(
          encryptedMlSourceRoot,
          "demodulation/react-flow/nodes/stimulusChannelPolicy.ts",
        )
      : path.join(publicMlAdapterRoot, "stimulusChannelPolicyFallback.ts"),
  },
  {
    find: /^\/?@n-apt\/demodulation\/react-flow\/nodes\/(AudioDemodWorkflowFlow|VisionDemodWorkflowFlow)$/,
    replacement: hasDecryptedMlSource
      ? `${encryptedMlSourceRoot}/demodulation/react-flow/nodes/$1`
      : path.join(publicMlAdapterRoot, "demodReadinessFallbackDependencies.tsx"),
  },
  {
    find: /^\/?@n-apt\/demodulation\/survey\/(.*)$/,
    replacement: hasDecryptedMlSource
      ? `${protectedSurveyRoot}/$1`
      : path.join(publicMlAdapterRoot, "audioSurveyFallback.ts"),
  },
  {
    find: /^\/?@n-apt\/demodulation\/vision\/(.*)$/,
    replacement: hasDecryptedMlSource
      ? `${protectedVisionRoot}/$1`
      : path.join(publicMlAdapterRoot, "audioSurveyFallback.ts"),
  },
  {
    find: /^\/?@n-apt\/classification\/native\/(core|gpu)$/,
    replacement: path.join(
      hasDecryptedMlSource
        ? protectedClassificationNativeRoot
        : publicMlAdapterRoot,
      hasDecryptedMlSource ? "$1" : "classificationNativeFallback.ts",
    ),
  },
  {
    find: /^\/?@n-apt\/classification\/native\/(.*)$/,
    replacement: hasDecryptedMlSource
      ? `${protectedClassificationNativeRoot}/$1`
      : `${publicClassificationNativeRoot}/$1`,
  },
  {
    find: /^\/?@n-apt\/classification$/,
    replacement: hasDecryptedMlSource
      ? path.join(protectedClassificationRoot, "index.ts")
      : path.join(publicMlAdapterRoot, "classificationFallback.ts"),
  },
];

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

const fsAllow = Array.from(
  new Set(
    [path.resolve(dirname, "src"), path.resolve(dirname, "node_modules")]
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

const PUBLIC_BROWSER_ENV_KEYS = new Set([
  "NAPT_PBKDF2_SALT",
  "VITE_APP_URL",
  "VITE_BACKEND_URL",
  "VITE_GOOGLE_MAPS_API_KEY",
  "VITE_PBKDF2_SALT",
  "VITE_SESSION_KEY",
  "VITE_WASM_BUILD_PATH",
  "VITE_WS_URL",
]);

export const selectBrowserEnv = (env) =>
  Object.fromEntries(
    Object.entries(env).filter(([key]) => PUBLIC_BROWSER_ENV_KEYS.has(key)),
  );

const frontendContentSecurityPolicyPlugin = (browserEnv, reportOnly) => {
  const backendConnectSources = new Set(["'self'"]);
  const addBackendSource = (value, fallbackProtocol) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
      backendConnectSources.add(url.origin);
      if (fallbackProtocol && ["http:", "https:"].includes(url.protocol)) {
        backendConnectSources.add(`${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
      }
    } catch {
      // Invalid optional backend URLs are handled by the app when it connects.
    }
  };

  addBackendSource(browserEnv.VITE_BACKEND_URL ?? "http://127.0.0.1:8765", true);
  addBackendSource(browserEnv.VITE_WS_URL);
  backendConnectSources.add("https://nominatim.openstreetmap.org");
  backendConnectSources.add("https://huggingface.co");
  backendConnectSources.add("https://cdn-lfs.huggingface.co");
  backendConnectSources.add("https://*.xethub.hf.co");

  const applyPolicy = (middlewares, isDev) => {
    const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
    if (isDev) {
      // Vite's React Refresh runtime is injected as an inline module script.
      // The development policy allows it; production preview stays strict.
      scriptSrc.push("'unsafe-inline'");
    }

    middlewares.use((req, res, next) => {
      const connectSources = new Set(backendConnectSources);
      if (isDev && typeof req.headers.host === "string") {
        try {
          const host = req.headers.host;
          const url = new URL(`http://${host}`);
          if (url.host === host && !url.username && !url.password) {
            connectSources.add(`${req.socket.encrypted ? "wss" : "ws"}://${url.host}`);
          }
        } catch {
          // Ignore malformed Host headers; Vite HMR can still use its configured URL.
        }
      }

      res.setHeader(
        reportOnly
          ? "Content-Security-Policy-Report-Only"
          : "Content-Security-Policy",
        [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          `script-src ${scriptSrc.join(" ")}`,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
          "media-src 'self' blob:",
          `connect-src ${[...connectSources].join(" ")}`,
          "worker-src 'self' blob:",
        ].join("; "),
      );
      next();
    });
  };

  return {
    name: "n-apt-frontend-content-security-policy",
    configureServer(server) {
      applyPolicy(server.middlewares, true);
    },
    configurePreviewServer(server) {
      applyPolicy(server.middlewares, false);
    },
  };
};

const styledComponentsFixPlugin = () => ({
  name: 'styled-components-fix',
  async resolveId(id) {
    if (id === 'styled-components') {
      // Force resolution to the node_modules version only
      return { id: require.resolve('styled-components'), external: false };
    }
  },
});

const connectionAllowlistPlugin = (browserEnv) => {
  const backendOrigins = new Set();
  const addBackendOrigin = (value) => {
    if (!value) return;
    try {
      const url = new URL(value);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
      backendOrigins.add(`${url.protocol}//${url.host}/*`);
    } catch {
      // Ignore malformed optional backend URLs; Vite and the app will surface
      // their own configuration errors when they attempt to use them.
    }
  };

  addBackendOrigin(browserEnv.VITE_BACKEND_URL ?? "http://127.0.0.1:8765");
  addBackendOrigin(browserEnv.VITE_WS_URL);
  for (const originPattern of [...backendOrigins]) {
    if (originPattern.startsWith("http://")) {
      backendOrigins.add(originPattern.replace("http://", "ws://"));
    } else if (originPattern.startsWith("https://")) {
      backendOrigins.add(originPattern.replace("https://", "wss://"));
    }
  }

  const destinations = [
    ...backendOrigins,
    "https://fonts.googleapis.com/*",
    "https://fonts.gstatic.com/*",
    "https://nominatim.openstreetmap.org/*",
    "https://*.basemaps.cartocdn.com/*",
    "https://huggingface.co/*",
    "https://*.hf.co/*",
  ];
  const headerValue = `(${[
    "response-origin",
    ...destinations.map((destination) => `"${destination}"`),
  ].join(" ")})`;
  const applyHeader = (middlewares) => {
    middlewares.use((_req, res, next) => {
      res.setHeader("Connection-Allowlist", headerValue);
      next();
    });
  };

  return {
    name: "n-apt-connection-allowlist",
    configureServer(server) {
      applyHeader(server.middlewares);
    },
    configurePreviewServer(server) {
      applyHeader(server.middlewares);
    },
  };
};

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
      const statusFile = path.resolve(dirname, ".n-apt", "rebuild_status.json");
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
          "## Markdown routes",
          "",
          "- [Visualizer](/visualizer) (also `/`)",
          "- [Demodulate](/demodulate) (also `/demod`)",
          "- [Draw Signal](/draw-signal)",
          "- [3D Model](/3d-model)",
          "- [Map Endpoints](/map-endpoints)",
          "- [Get Started](/get-started)",
          "- Legal document reader: [Terms](/terms), [Privacy](/privacy), [License](/license), [Responsible Use](/responsible-use)",
          "- [Cellular Triangulation Demo](/game)",
          "",
          "## Coverage policy",
          "",
          "Onboarding, legal, and demo routes have descriptive Markdown only and expose no executable WebMCP tools. `non-agent` in the capability manifest means the route has no agent-driven actions; it does not prevent Markdown retrieval.",
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
        "/get-started": "start-page.md",
        "/terms": "legal.md",
        "/privacy": "legal.md",
        "/license": "legal.md",
        "/responsible-use": "legal.md",
        "/game": "game.md",
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
  const browserEnv = selectBrowserEnv(env);

  return {
  define: {
    __DEV__: JSON.stringify(mode !== "production"),
    __N_APT_ML_BUNDLE_READY__: JSON.stringify(hasDecryptedMlSource),
  },
  plugins: [
    injectBrowserEnv(browserEnv),
    frontendContentSecurityPolicyPlugin(browserEnv, mode === "production"),
    connectionAllowlistPlugin(browserEnv),
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
    // Every bare import in the app graph belongs here. A dependency Vite meets
    // for the first time mid-session (on navigating to a lazy route) makes it
    // re-optimize and hard reload the page, which reads as the app constantly
    // "refreshing itself". Keep this list in step with the import graph.
    include: [
      'styled-components',
      'react',
      'react-dom',
      'react-redux',
      '@reduxjs/toolkit',
      'react-router',
      'react-helmet-async',
      'lucide-react',
      'framer-motion',
      'zod',
      'zustand',
      'dexie',
      'dompurify',
      'leaflet',
      'react-leaflet',
      'three',
      'three-stdlib',
      '@react-three/fiber',
      '@react-three/drei',
      '@react-three/postprocessing',
      '@xyflow/react',
      'leva',
      'gsap',
      'katex',
      'react-katex',
      'react-markdown',
      'remark-gfm',
      'rehype-raw',
      'rehype-katex',
      'unified',
      'unist-util-visit',
      '@chenglou/pretext',
    ],
    // Heavy / route-lazy packages: keep out of cold Rolldown prebundle so
    // Vite can serve the app before these are needed. `exclude` skips
    // prebundling entirely, so these never trigger a re-optimize reload.
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
  // All app config is passed through the explicit browserEnv allowlist above.
  // Vite's default VITE_ prefix would expose every matching local variable.
  envPrefix: [],
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
    alias: [...encryptedMlAliases, ...scopedFrontendAliases, {
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
    // The build orchestrator hands port 5173 over from its pre-Vite status
    // page to Vite. If the handoff races, fail loudly instead of silently
    // bumping to another port and breaking the "same URL" swap.
    strictPort: true,
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
