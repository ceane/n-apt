import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import viteConfig from "../../vite.config.js";
import { integrityForSource, renderSriHtml, viteSriPlugin } from "../../scripts/build/viteSriPlugin.mjs";

test("production HTML applies SRI to JS entry points and module preloads", () => {
  const entry = "export const ready = true;";
  const lazy = "export const lazy = true;";
  const bundle = {
    "assets/app.js": { type: "chunk", code: entry },
    "assets/lazy.js": { type: "chunk", code: lazy },
    "assets/app.css": { type: "asset", source: "body { color: red; }" },
  };
  const html = `<!doctype html><html><head><link rel="modulepreload" href="/assets/lazy.js"></head><body><script type="module" crossorigin src="/assets/app.js"></script></body></html>`;

  const result = renderSriHtml(html, bundle, "/");
  const entryIntegrity = integrityForSource(entry);
  const lazyIntegrity = integrityForSource(lazy);

  assert.ok(result.includes(`<script type="module" src="/assets/app.js" integrity="${entryIntegrity}"`));
  assert.ok(result.includes(`<link rel="modulepreload" href="/assets/lazy.js" integrity="${lazyIntegrity}"`));
  assert.match(result, /<script type="importmap">[\s\S]*?<\/script>/);
  assert.ok(result.includes(`"/assets/lazy.js":"${lazyIntegrity}"`));
  assert.equal(
    integrityForSource(entry),
    `sha384-${createHash("sha384").update(entry).digest("base64")}`,
  );
});

test("the Vite build hook applies SRI to emitted HTML", () => {
  const plugin = viteSriPlugin();
  plugin.configResolved({ command: "build", base: "/" });
  const bundle = {
    "assets/app.js": { type: "chunk", code: "export const ready = true;" },
    "index.html": {
      type: "asset",
      fileName: "index.html",
      source: '<!doctype html><html><head></head><body><script type="module" src="/assets/app.js"></script></body></html>',
    },
  };
  plugin.generateBundle({}, bundle);
  assert.match(String(bundle["index.html"].source), /integrity="sha384-/);
  assert.match(String(bundle["index.html"].source), /type="importmap"/);
});

test("development HMR exposes a matching SRI hash for its transformed JS module", async (t) => {
  const config = viteConfig({ mode: "development", command: "serve" });
  const server = await createServer({
    ...config,
    server: { ...config.server, host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const htmlResponse = await fetch(`${origin}/`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /__napt_sri_hmr_client\.js/);
  assert.match(html, /<script\b(?=[^>]*\bsrc="\.\/app\/Main\.tsx")(?=[^>]*\bintegrity="sha384-[^"]+")(?=[^>]*\bcrossorigin="anonymous")/);
  assert.match(html, /<script\b(?=[^>]*\bsrc="\/\@vite\/client")(?=[^>]*\bintegrity="sha384-[^"]+")/);
  assert.match(html, /<script\b(?=[^>]*\bsrc="\/__napt_sri_hmr_client\.js")(?=[^>]*\bintegrity="sha384-[^"]+")/);
  assert.doesNotMatch(html, /<script type="importmap">/);

  for (const query of ["?t=1729000000000", "?import&t=1729000000001"]) {
    const updateUrl = new URL(`/app/Main.tsx${query}`, origin).href;
    const hashResponse = await fetch(
      `${origin}/__napt_sri_hmr_hash?url=${encodeURIComponent(updateUrl)}`,
    );
    assert.equal(hashResponse.status, 200);
    const { integrity } = await hashResponse.json();
    const moduleResponse = await fetch(updateUrl);
    assert.equal(moduleResponse.status, 200);
    assert.equal(integrity, integrityForSource(await moduleResponse.text()));
  }

  const clientResponse = await fetch(`${origin}/__napt_sri_hmr_client.js`);
  assert.equal(clientResponse.status, 200);
  const client = await clientResponse.text();
  assert.match(client, /vite:beforeUpdate/);
  assert.match(client, /createHotContext/);
  assert.match(client, /type = "importmap"/);
  assert.match(client, /verifyImportMapIntegritySupport/);
  const probeResponse = await fetch(`${origin}/__napt_sri_hmr_probe.js`);
  assert.equal(probeResponse.status, 200);
  assert.match(await probeResponse.text(), /sriProbe/);
});
