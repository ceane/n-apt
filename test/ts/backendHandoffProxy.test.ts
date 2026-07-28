import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";


const listen = (server: http.Server) => new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
});

const requestBody = (port: number) => new Promise<string>((resolve, reject) => {
  const request = http.get({ hostname: "127.0.0.1", port, path: "/status" }, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => resolve(body));
  });
  request.on("error", reject);
});

describe("backend handoff target store", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes a complete target atomically and reads it back", () => {
    const { readBackendTarget, writeBackendTarget } = require("../../scripts/build/backend-handoff-proxy");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "n-apt-handoff-"));
    directories.push(directory);
    const targetFile = path.join(directory, "backend-target.json");

    writeBackendTarget(targetFile, { host: "127.0.0.1", port: 8766 });

    expect(readBackendTarget(targetFile)).toEqual({ host: "127.0.0.1", port: 8766 });
    expect(fs.existsSync(`${targetFile}.tmp`)).toBe(false);
  });

  it("switches HTTP traffic to the replacement backend", async () => {
    const { createBackendHandoffProxy, writeBackendTarget } = require("../../scripts/build/backend-handoff-proxy");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "n-apt-handoff-"));
    directories.push(directory);
    const targetFile = path.join(directory, "backend-target.json");

    const makeBackend = async (name: string) => {
      const backend = http.createServer((_request, response) => response.end(name));
      const port = await listen(backend);
      return { backend, port };
    };
    const first = await makeBackend("first");
    const second = await makeBackend("second");
    writeBackendTarget(targetFile, { host: "127.0.0.1", port: first.port });
    const proxy = createBackendHandoffProxy({ listenPort: 0, targetFile });
    const proxyPort = await listen(proxy);

    expect(await requestBody(proxyPort)).toBe("first");

    writeBackendTarget(targetFile, { host: "127.0.0.1", port: second.port });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await requestBody(proxyPort)).toBe("second");
    proxy.close();
    first.backend.close();
    second.backend.close();
  });
});
