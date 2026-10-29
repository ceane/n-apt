import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import net from "node:net";
import { startDevStatusServer } from "../../scripts/build/devStatusServer.ts";

test("dev status page loads its client script with a matching SRI attribute", async (t) => {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const availablePort = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(availablePort));
    });
  });
  const server = await startDevStatusServer({ port });
  assert.ok(server);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.port}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const scriptTag = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*\bintegrity="([^"]+)"[^>]*>/);
  assert.ok(scriptTag, "the status page should expose an external client with SRI");
  const scriptResponse = await fetch(new URL(scriptTag[1], response.url));
  assert.equal(scriptResponse.status, 200);
  const expectedIntegrity = `sha384-${createHash("sha384").update(Buffer.from(await scriptResponse.arrayBuffer())).digest("base64")}`;
  assert.equal(scriptTag[2], expectedIntegrity);

  const policy = response.headers.get("content-security-policy");
  assert.ok(policy, "the status page should have a CSP");
  assert.match(policy, /script-src 'self'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
});
