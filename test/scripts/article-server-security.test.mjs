import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: pathname, headers: { Connection: "close" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("article server confines Markdown and asset reads to their roots", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "napt-article-files-")));
  let server;
  t.after(async () => {
    await server?.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.copyFile(new URL("../../vite.markdown.config.ts", import.meta.url), path.join(root, "vite.markdown.config.ts"));
  await fs.symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await fs.mkdir(path.join(root, "src/app-article"), { recursive: true });
  await fs.mkdir(path.join(root, "pages"), { recursive: true });
  await fs.mkdir(path.join(root, "public/md-preview"), { recursive: true });
  await fs.writeFile(path.join(root, ".env.local"), "FAKE_ARTICLE_SECRET_SENTINEL");
  await fs.writeFile(path.join(root, "pages/safe.md"), "safe page");
  await fs.symlink(path.join(root, ".env.local"), path.join(root, "pages/linked.md"));

  server = await createServer({
    configFile: path.join(root, "vite.markdown.config.ts"),
    cacheDir: path.join(root, ".vite-cache"),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const port = server.httpServer.address().port;

  const safePage = await get(port, "/pages/safe.md");
  assert.equal(safePage.status, 200);
  assert.match(safePage.body, /safe page/);

  for (const requestPath of [
    "/pages/../.env.local",
    "/pages/linked.md",
    "/article/../.env.local",
  ]) {
    const response = await get(port, requestPath);
    assert.ok(!response.body.includes("FAKE_ARTICLE_SECRET_SENTINEL"), `${requestPath} must not expose files outside its root`);
  }
});
