import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import viteConfig from "../../vite.config.js";

test("Vite serves the linked n_apt_canvas WASM module", async (t) => {
  const config = viteConfig({ mode: "development", command: "serve" });
  const server = await createServer({
    ...config,
    server: { ...config.server, host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  t.after(() => server.close());

  const wasmPath = path.resolve("packages/n_apt_canvas/n_apt_backend_bg.wasm");
  const url = `/@fs${wasmPath}`;
  const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}${url}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(wasmPath));
});
