import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
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
  const policy = response.headers.get("content-security-policy");
  assert.ok(policy, "frontend document should have a CSP");
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
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
