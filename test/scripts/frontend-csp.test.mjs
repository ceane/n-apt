import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, preview } from "vite";
import viteConfig from "../../vite.config.js";

test("frontend responses use a CSP with scoped backend and HMR connections", async (t) => {
  const config = viteConfig({ mode: "development", command: "serve" });
  const server = await createServer({
    ...config,
    server: { ...config.server, host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  t.after(() => server.close());

  const port = server.httpServer.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<script type="module">[\s\S]*?@react-refresh[\s\S]*?<\/script>/);
  const appModule = await fetch(`http://127.0.0.1:${port}/app/Main.tsx`);
  assert.equal(appModule.status, 200, "the app entry module should load");
  assert.match(await appModule.text(), /ReactDOM\.createRoot/);
  const viteClient = await fetch(`http://127.0.0.1:${port}/@vite/client`);
  assert.equal(viteClient.status, 200, "Vite's development client should load");
  const favicon = await fetch(`http://127.0.0.1:${port}/images/favicon.svg`);
  assert.equal(favicon.status, 200, "public assets should load");
  const policy = response.headers.get("content-security-policy");
  assert.ok(policy, "frontend document should have a CSP");
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(
    policy,
    /script-src[^;]*'unsafe-inline'/,
    "Vite's development React Refresh preamble is an inline module script",
  );
  assert.match(policy, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(policy, /font-src 'self' data: https:\/\/fonts\.gstatic\.com/);
  assert.match(policy, /img-src 'self' data: blob: https:\/\/\*\.basemaps\.cartocdn\.com/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.match(policy, /media-src 'self' blob:/);
  assert.match(policy, /connect-src[^;]*http:\/\/127\.0\.0\.1:8765/);
  assert.match(policy, /connect-src[^;]*ws:\/\/127\.0\.0\.1:8765/);
  assert.match(policy, /connect-src[^;]*https:\/\/nominatim\.openstreetmap\.org/);
  assert.match(policy, /connect-src[^;]*https:\/\/huggingface\.co/);
  assert.match(
    policy,
    new RegExp(`connect-src[^;]*ws://127\\.0\\.0\\.1:${port}`),
    "dev HMR should be scoped to its own socket",
  );
  assert.doesNotMatch(policy, /connect-src[^;]*\b(?:ws|wss):\b/);
});

test("production-mode preview reports CSP without enforcing it", async (t) => {
  const config = viteConfig({ mode: "production", command: "serve" });
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "napt-csp-preview-"));
  await fs.writeFile(path.join(outputDir, "index.html"), "<!doctype html><title>N-APT</title>");
  const server = await preview({
    ...config,
    build: { ...config.build, outDir: outputDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  t.after(async () => {
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  const address = server.httpServer.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  const policy = response.headers.get("content-security-policy-report-only");
  assert.ok(policy);
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.equal(response.headers.get("content-security-policy"), null);
});
