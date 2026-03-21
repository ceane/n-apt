import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";

const dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const pagesDir = path.resolve(dirname, "pages");

const pagesMiddleware: Plugin = {
  name: "pages-middleware",
  configureServer(server) {
    const sendUpdate = (file: string) => {
      if (!file.startsWith(pagesDir)) {
        return;
      }
      const relative = path.relative(dirname, file).replace(/\\+/g, "/");
      server.ws.send({
        type: "custom",
        event: "pages:update",
        data: { path: `/${relative}` },
      });
    };

    server.watcher.add(pagesDir);
    for (const event of ["add", "change", "unlink"]) {
      server.watcher.on(event, sendUpdate);
    }

    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith("/pages/")) {
        const filePath = path.join(dirname, req.url);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath, "utf-8");
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(content);
          return;
        }
      }
      next();
    });
  },
};

export default defineConfig({
  base: "/md-preview/",
  root: path.resolve(dirname, "src/md-preview"),
  envDir: dirname,
  publicDir: path.resolve(dirname, "pages"),
  build: {
    outDir: path.resolve(dirname, "dist/md-preview"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
  server: {
    port: 5174,
    strictPort: false,
    fs: {
      allow: [path.resolve(dirname)],
    },
  },
  preview: {
    port: 4174,
  },
  plugins: [pagesMiddleware],
});
