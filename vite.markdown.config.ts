import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import react from "@vitejs/plugin-react";

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
      const url = req.url || "";
      const isPages = url.startsWith("/pages/") || url.startsWith("/md-preview/pages/");
      if (isPages) {
        const relativeUrl = url.startsWith("/md-preview/") ? url.slice("/md-preview".length) : url;
        const filePath = path.join(dirname, relativeUrl);
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
              '.webp': 'image/webp'
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
    const targetDir = path.resolve(dirname, "docs/pages");
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(pagesDir, targetDir, { recursive: true });

    // In production build, we need to transform paths within the copied markdown files
    const productionBase = "/"; // The app helpers will prepend the base URL (e.g. /n-apt/) at runtime
    const devBase = "/md-preview/";

    const transformFile = (filePath: string) => {
      if (fs.statSync(filePath).isDirectory()) {
        fs.readdirSync(filePath).forEach(file => transformFile(path.join(filePath, file)));
        return;
      }
      if (path.extname(filePath) === ".md") {
        let content = fs.readFileSync(filePath, "utf-8");
        // Replace dev base with production base
        content = content.split(devBase).join(productionBase);
        fs.writeFileSync(filePath, content, "utf-8");
      }
    };

    if (fs.existsSync(targetDir)) {
      transformFile(targetDir);
    }

    // Exclude transformers-test.html from the build output
    const testFile = path.resolve(dirname, "docs/transformers-test.html");
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  },
};

export default defineConfig(({ mode }) => {
  const isProd = mode === "production" || process.env.NODE_ENV === "production";
  
  return {
    mode: isProd ? "production" : "development",
    define: {
      "__APP_BASE_URL__": JSON.stringify(isProd ? "/n-apt/" : "/md-preview/"),
      "__DEV__": JSON.stringify(!isProd),
    },
    esbuild: {
      jsx: "automatic",
      drop: isProd ? ["console", "debugger"] : [],
    },
    base: isProd ? "/n-apt/" : "/md-preview/",
    root: path.resolve(dirname, "src/md-preview"),
    envDir: dirname,
    publicDir: path.resolve(dirname, "public"),
    build: {
      outDir: path.resolve(dirname, "docs"),
      emptyOutDir: true,
      assetsDir: "assets",
      minify: "esbuild",
      sourcemap: !isProd,
    },
    resolve: {
      alias: [
        ...(isProd ? [{
          find: "react/jsx-dev-runtime",
          replacement: path.resolve(dirname, "src/md-preview/jsx-shim.js")
        }] : []),
        {
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
  plugins: [
    react({
      jsxRuntime: "automatic",
    }),
    pagesMiddleware,
    copyPagesPlugin,
    {
      name: "strip-tailwind-cdn",
      transformIndexHtml(html) {
        if (isProd) {
          return html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, "");
        }
        return html;
      }
    }
  ],
  };
});
