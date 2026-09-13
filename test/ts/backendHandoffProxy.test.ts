import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type {
  RawData,
  WebSocket as WsWebSocket,
  WebSocketServer as WsWebSocketServer,
} from "ws";

import { createRequire } from "node:module";

const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
const ws = nodeRequire(
  path.join(path.dirname(nodeRequire.resolve("ws/package.json")), "index.js"),
);
const WebSocket = ws.WebSocket as typeof WsWebSocket;
const WebSocketServer = (ws.WebSocketServer ?? ws.Server) as typeof WsWebSocketServer;

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

const waitForClose = (socket: WsWebSocket, timeoutMs = 2000) =>
  new Promise<void>((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("socket did not close")), timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
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

  it("uses the IPv4 loopback endpoint for the default handoff proxy", () => {
    const { getDefaultBackendProxyUrl } = require("../../scripts/build/backend-handoff-proxy");

    expect(getDefaultBackendProxyUrl()).toBe("http://127.0.0.1:8765");
  });

  it("keeps Vite on the IPv4 handoff proxy during backend cutover", () => {
    const viteConfig = fs.readFileSync(path.resolve("vite.config.js"), "utf8");

    expect(viteConfig).toContain('?? "http://127.0.0.1:8765"');
    expect(viteConfig).not.toContain('?? "http://localhost:8765"');
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

  it("forwards client messages sent before the upstream websocket opens", async () => {
    const { createBackendHandoffProxy, writeBackendTarget } = require("../../scripts/build/backend-handoff-proxy");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "n-apt-handoff-"));
    directories.push(directory);
    const targetFile = path.join(directory, "backend-target.json");
    const backend = http.createServer();
    const upstream = new WebSocketServer({ noServer: true });
    upstream.on("connection", (socket: WsWebSocket) => {
      socket.on("message", (message: RawData) => socket.send(message));
    });
    backend.on("upgrade", (request, socket, head) => {
      setTimeout(() => upstream.handleUpgrade(request, socket, head, (client) => {
        upstream.emit("connection", client, request);
      }), 100);
    });
    const backendPort = await listen(backend);
    writeBackendTarget(targetFile, { host: "127.0.0.1", port: backendPort });
    const proxy = createBackendHandoffProxy({ listenPort: 0, targetFile });
    const proxyPort = await listen(proxy);

    const client = new WebSocket(`ws://127.0.0.1:${proxyPort}/ws/streams`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });
    client.send("stream_subscribe");

    const message = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("upstream did not receive buffered websocket message")), 2000);
      client.once("message", (data: RawData) => {
        clearTimeout(timer);
        resolve(String(data));
      });
      client.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect(message).toBe("stream_subscribe");

    client.close();
    proxy.close();
    upstream.close();
    backend.close();
  });

  it("closes proxied websockets when the backend target changes", async () => {
    const { createBackendHandoffProxy, writeBackendTarget } = require("../../scripts/build/backend-handoff-proxy");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "n-apt-handoff-"));
    directories.push(directory);
    const targetFile = path.join(directory, "backend-target.json");

    const makeWsBackend = async () => {
      const backend = http.createServer((_request, response) => {
        response.writeHead(200);
        response.end("ok");
      });
      const wss = new WebSocketServer({ server: backend });
      wss.on("connection", (socket: WsWebSocket) => {
        socket.send("hello");
      });
      const port = await listen(backend);
      return { backend, wss, port };
    };

    const first = await makeWsBackend();
    const second = await makeWsBackend();
    writeBackendTarget(targetFile, { host: "127.0.0.1", port: first.port });
    const proxy = createBackendHandoffProxy({ listenPort: 0, targetFile });
    const proxyPort = await listen(proxy);

    const client = new WebSocket(`ws://127.0.0.1:${proxyPort}/ws`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    writeBackendTarget(targetFile, { host: "127.0.0.1", port: second.port });
    await waitForClose(client);

    const replacement = new WebSocket(`ws://127.0.0.1:${proxyPort}/ws`);
    const message = await new Promise<string>((resolve, reject) => {
      replacement.once("message", (data: RawData) => resolve(String(data)));
      replacement.once("error", reject);
    });
    expect(message).toBe("hello");

    replacement.close();
    proxy.close();
    first.wss.close();
    second.wss.close();
    first.backend.close();
    second.backend.close();
  });
});
