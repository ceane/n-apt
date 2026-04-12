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

    const publicDir = path.resolve(dirname, "public");

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

      if (req.url?.startsWith("/md-preview/")) {
        const assetPath = req.url.replace(/^\/md-preview\//, "");
        const searchPaths = [
          path.join(publicDir, "md-preview", assetPath),
          path.join(publicDir, assetPath), // Direct fallback to public root
        ];

        for (const filePath of searchPaths) {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = {
              '.svg': 'image/svg+xml',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.webp': 'image/webp',
              '.glb': 'application/octet-stream'
            }[ext] || 'application/octet-stream';
            
            res.setHeader("Content-Type", contentType);
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
      }
      next();
    });
  },
};

const copyPagesPlugin: Plugin = {
  name: "copy-pages-to-dist",
  apply: "build",
  closeBundle() {
    const targetDir = path.resolve(dirname, "dist/md-preview/pages");
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(pagesDir, targetDir, { recursive: true });
  },
};

export default defineConfig({
  base: "/md-preview/",
  root: path.resolve(dirname, "src/md-preview"),
  envDir: dirname,
  publicDir: path.resolve(dirname, "public"),
  build: {
    outDir: path.resolve(dirname, "dist/md-preview"),
    emptyOutDir: true,
    assetsDir: "assets",
  },
  resolve: {
    alias: [{
      find: /^@n-apt\/encrypted-modules\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/encrypted-modules")}/$1`
    }, {
      find: /^@n-apt\/md-preview\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/md-preview")}/$1`
    }, {
      find: /^@n-apt\/public\/(.*)$/,
      replacement: `${path.resolve(dirname, "public")}/$1`
    }, {
      find: /^@n-apt\/(.*)$/,
      replacement: `${path.resolve(dirname, "src/ts")}/$1`
    }, {
      find: "@n-apt",
      replacement: path.resolve(dirname, "src/ts")
    }]
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
  plugins: [pagesMiddleware, copyPagesPlugin],
});
