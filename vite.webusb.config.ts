import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const redirectRootToProbe = () => ({
  name: "webusb-root-redirect",
  configureServer(server: {
    middlewares: {
      use: (
        handler: (
          request: { url?: string },
          response: {
            statusCode: number;
            setHeader: (name: string, value: string) => void;
            end: (body?: string) => void;
          },
          next: () => void,
        ) => void,
      ) => void;
    };
  }) {
    server.middlewares.use((request, response, next) => {
      const pathname = (request.url ?? "").split("?", 1)[0];
      if (pathname !== "/" && pathname !== "/index.html") {
        next();
        return;
      }
      response.statusCode = 302;
      response.setHeader("Location", "/webusb-probe/");
      response.end();
    });
  },
});

/**
 * The WebUSB experiment is intentionally a separate Vite application. It
 * must be possible to start these pages without spawning Rust, Redis, or the
 * main app's backend proxy, because those services may claim the SDR first.
 */
export default defineConfig({
  root: path.resolve(dirname, "src/ts"),
  base: "/",
  resolve: {
    // The standalone entries still reuse small, app-owned rendering modules
    // such as SnapshotRenderer. Keep the app namespace available without
    // pulling in the main Vite configuration or app shell.
    alias: {
      "@n-apt/layout": path.resolve(dirname, "src/ts/shared/layout"),
      "@n-apt/math": path.resolve(dirname, "src/ts/shared/math"),
      "@n-apt/consts": path.resolve(dirname, "src/ts/consts"),
      "@n-apt/ui": path.resolve(dirname, "src/ts/shared/ui"),
      "@n-apt/capture": path.resolve(dirname, "src/ts/features/capture"),
    },
  },
  // Neither standalone page uses the main app's public assets. Keeping this
  // disabled makes the phone test bundle small and self-contained.
  publicDir: false,
  plugins: [
    redirectRootToProbe(),
    react({
      jsxRuntime: "automatic",
    }),
  ],
  build: {
    outDir: path.resolve(dirname, "dist-webusb"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        webUsbProbe: path.resolve(dirname, "src/ts/webusb-probe/index.html"),
        lite: path.resolve(dirname, "src/ts/lite/index.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    fs: {
      allow: [dirname],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4175,
    strictPort: true,
  },
});
