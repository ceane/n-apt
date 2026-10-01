import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import viteConfig from "../../vite.config.js";
import { selectBrowserEnv } from "../../vite.config.js";

test("Vite does not include local password variables in browser transforms", async (t) => {
  const appConfig = viteConfig({ mode: "development", command: "serve" });
  assert.deepEqual(appConfig.envPrefix, []);
  for (const configPath of ["vite.markdown.config.ts", "vite.webusb.config.ts"]) {
    const source = await fs.readFile(new URL(`../../${configPath}`, import.meta.url), "utf8");
    assert.match(source, /envPrefix:\s*\[\]/, `${configPath} must disable VITE_ auto-exposure`);
  }
  assert.deepEqual(
    selectBrowserEnv({
      VITE_APP_URL: "https://app.example.test",
      VITE_BACKEND_URL: "https://api.example.test",
      VITE_UNSAFE_LOCAL_USER_PASSWORD: "must-not-ship",
      VITE_UNLISTED_SECRET: "must-not-ship-either",
      NAPT_PBKDF2_SALT: "public compatibility salt",
    }),
    {
      VITE_APP_URL: "https://app.example.test",
      VITE_BACKEND_URL: "https://api.example.test",
      NAPT_PBKDF2_SALT: "public compatibility salt",
    },
  );

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "napt-vite-env-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".env.development"),
    "VITE_UNSAFE_LOCAL_USER_PASSWORD=FAKE_VITE_PASSWORD_SENTINEL\n",
  );
  await fs.writeFile(
    path.join(root, "src", "probe.js"),
    "export const development = import.meta.env.DEV;\n",
  );

  const server = await createServer({
    configFile: false,
    root,
    envDir: root,
    cacheDir: path.join(root, ".vite-cache"),
    envPrefix: appConfig.envPrefix,
    mode: "development",
    server: { middlewareMode: true },
    appType: "custom",
  });
  t.after(() => server.close());

  const transformed = await server.transformRequest("/src/probe.js");
  assert.ok(transformed, "Vite should transform the dev-only module");
  assert.ok(
    !transformed.code.includes("FAKE_VITE_PASSWORD_SENTINEL"),
    "a local password must not appear in browser-served code",
  );
});

test("main Vite server does not serve private capture files", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "napt-vite-files-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.copyFile(new URL("../../vite.config.js", import.meta.url), path.join(root, "vite.config.js"));
  await fs.symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await fs.mkdir(path.join(root, "src/ts"), { recursive: true });
  await fs.writeFile(path.join(root, "src/ts/probe.js"), "export const appModule = true;\n");
  await fs.mkdir(path.join(root, "training-captures"), { recursive: true });
  await fs.writeFile(path.join(root, "training-captures/private.iq"), "FAKE_PRIVATE_IQ_SENTINEL");

  const server = await createServer({
    configFile: path.join(root, "vite.config.js"),
    root: path.join(root, "src/ts"),
    envDir: root,
    cacheDir: path.join(root, ".vite-cache"),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/@fs${path.join(root, "training-captures/private.iq")}`);
  const body = await response.text();
  assert.ok(!body.includes("FAKE_PRIVATE_IQ_SENTINEL"), "private capture bytes must not be served");

  const appModule = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/probe.js`);
  assert.equal(appModule.status, 200, "normal frontend source should remain available to Vite");
  assert.match(await appModule.text(), /appModule/);
});
