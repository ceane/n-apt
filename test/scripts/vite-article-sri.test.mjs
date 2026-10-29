import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import articleConfig from "../../vite.markdown.config.ts";
import { integrityForSource } from "../../scripts/build/viteSriPlugin.mjs";
import path from "node:path";

test("article markdown hot updates preserve imported modules and notify fetched pages", () => {
  const config = articleConfig({ mode: "development", command: "serve" });
  const plugin = config.plugins.find((plugin) => plugin?.name === "pages-middleware");
  const messages = [];
  const server = { ws: { send: (message) => messages.push(message) } };
  const file = path.resolve("pages/how-do-they-do-it.md");
  const modules = [{ url: "/pages/how-do-they-do-it.md?raw" }];
  assert.equal(plugin.handleHotUpdate({ file, server, modules }), modules);
  assert.equal(messages.length, 0);
  assert.deepEqual(plugin.handleHotUpdate({ file, server, modules: [] }), []);
  assert.equal(messages[0].event, "pages:update");
  assert.equal(messages[0].data.path, "/pages/how-do-they-do-it.md");
});

test("article development HTML applies SRI to its entry and HMR client", async (t) => {
  const config = articleConfig({ mode: "development", command: "serve" });
  const server = await createServer({
    ...config,
    optimizeDeps: { ...config.optimizeDeps, noDiscovery: true, include: [] },
    server: { ...config.server, host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const htmlResponse = await fetch(`${origin}/article`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  const entryTag = html.match(/<script\b(?=[^>]*\bsrc="\/main\.tsx")[^>]*>/)?.[0];
  assert.ok(entryTag, "article entry script should be root-relative");
  const entryIntegrity = entryTag.match(/\bintegrity="([^"]+)"/)?.[1];
  assert.match(entryIntegrity || "", /^sha384-/);
  assert.match(html, /<script\b(?=[^>]*\bsrc="\/__napt_sri_hmr_client\.js")(?=[^>]*\bintegrity="sha384-[^"]+")/);

  const entryResponse = await fetch(`${origin}/main.tsx`);
  assert.equal(entryResponse.status, 200);
  assert.equal(entryIntegrity, integrityForSource(await entryResponse.text()));

  // Markdown HMR imports the timestamped ?raw module. Hash precisely the
  // response the browser imports, including Vite's query normalization.
  for (const modulePath of ["/@fs" + path.resolve("pages/how-do-they-do-it.md") + "?import&t=1761760000000&raw", "/App.tsx?t=1761760000001"]) {
    const updateUrl = new URL(modulePath, origin).href;
    const hashResponse = await fetch(`${origin}/__napt_sri_hmr_hash?url=${encodeURIComponent(updateUrl)}`);
    const hashText = await hashResponse.text();
    assert.equal(hashResponse.status, 200, `${modulePath}: ${hashText}`);
    const { integrity } = JSON.parse(hashText);
    const response = await fetch(updateUrl);
    assert.equal(response.status, 200);
    assert.equal(integrity, integrityForSource(await response.text()));
  }
});

test("article production config enables SRI for emitted HTML", () => {
  const config = articleConfig({ mode: "production", command: "build" });
  const sriPlugin = config.plugins.find((plugin) => plugin && plugin.name === "n-apt-vite-sri");
  assert.ok(sriPlugin);
  sriPlugin.configResolved({ command: "build", base: "/n-apt/" });
  const bundle = {
    "assets/main.js": { type: "chunk", code: "export const ready = true;" },
    "index.html": {
      type: "asset",
      fileName: "index.html",
      source: '<!doctype html><html><head></head><body><script type="module" src="/n-apt/assets/main.js"></script></body></html>',
    },
  };
  sriPlugin.generateBundle({}, bundle);
  assert.match(String(bundle["index.html"].source), /integrity="sha384-/);
  assert.match(String(bundle["index.html"].source), /type="importmap"/);
});
