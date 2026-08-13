import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Force the Node entrypoint. Jest's jsdom environment otherwise resolves the
// package "browser" stub, which exports an empty object.
const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
/* eslint-disable @typescript-eslint/no-explicit-any */
const wsModule = nodeRequire(
  path.join(process.cwd(), "node_modules/ws/index.js"),
) as {
  WebSocket: any;
  WebSocketServer: any;
};
const wsTypes = {
  WebSocket: wsModule.WebSocket,
  WebSocketServer: wsModule.WebSocketServer,
};

export type BackendTarget = { host: string; port: number };

export function readBackendTarget(targetFile: string): BackendTarget {
  const parsed = JSON.parse(fs.readFileSync(targetFile, "utf8")) as Partial<BackendTarget>;
  if (typeof parsed.host !== "string" || !Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535) {
    throw new Error(`Invalid backend target in ${targetFile}`);
  }
  return { host: parsed.host, port: parsed.port };
}

export function writeBackendTarget(targetFile: string, target: BackendTarget): void {
  const directory = path.dirname(targetFile);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = `${targetFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(target)}\n`);
  fs.renameSync(temporaryFile, targetFile);
}

const targetUrl = (target: BackendTarget, protocol: "http" | "ws", requestUrl: string) =>
  `${protocol}://${target.host}:${target.port}${requestUrl}`;

export function createBackendHandoffProxy(options: {
  listenHost?: string;
  listenPort: number;
  targetFile: string;
}): http.Server {
  let target = readBackendTarget(options.targetFile);
  const targetDirectory = path.dirname(options.targetFile);
  const proxiedSockets = new Set<any>();

  const closeProxiedSockets = () => {
    for (const socket of proxiedSockets) {
      try {
        socket.close();
      } catch {
        // Best-effort cutover; sockets may already be closing.
      }
    }
    proxiedSockets.clear();
  };

  const refreshTarget = () => {
    try {
      const nextTarget = readBackendTarget(options.targetFile);
      const targetChanged =
        nextTarget.host !== target.host || nextTarget.port !== target.port;
      target = nextTarget;
      if (targetChanged) {
        // Existing websockets stay pinned to the old upstream; force clients to
        // reconnect so they attach to the replacement backend immediately.
        closeProxiedSockets();
      }
    } catch {
      // Atomic replacement can briefly make the file unavailable.
    }
  };
  // Polling avoids platform-specific fs.watch rename semantics and the low
  // per-process watcher limits reached by repeated test/dev proxy instances.
  const targetPoller = setInterval(refreshTarget, 50);

  const server = http.createServer((request, response) => {
    const upstream = http.request({
      hostname: target.host,
      port: target.port,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `${target.host}:${target.port}` },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });

    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("Backend unavailable");
    });
    request.pipe(upstream);
  });

  const websocketServer = wsTypes.WebSocketServer
    ? new wsTypes.WebSocketServer({ noServer: true })
    : null;
  server.on("upgrade", (request, socket, head) => {
    if (!websocketServer) {
      socket.destroy();
      return;
    }
    const selectedTarget = target;
    websocketServer.handleUpgrade(request, socket, head, (client: any) => {
      const upstream = new wsTypes.WebSocket(targetUrl(selectedTarget, "ws", request.url || "/"), {
        headers: { ...request.headers, host: `${selectedTarget.host}:${selectedTarget.port}` },
      });
      const pendingClientMessages: Array<{ data: Buffer; isBinary: boolean }> = [];
      proxiedSockets.add(client);
      proxiedSockets.add(upstream);

      // The client-side upgrade completes before the upstream connection is
      // necessarily open. Browser stream transports send their first
      // subscription immediately from onopen, so dropping CONNECTING-state
      // messages leaves a perfectly healthy backend with no logical stream.
      upstream.on("open", () => {
        for (const message of pendingClientMessages.splice(0)) {
          if (upstream.readyState === wsTypes.WebSocket.OPEN) {
            upstream.send(message.data, { binary: message.isBinary });
          }
        }
      });

      const closeBoth = () => {
        pendingClientMessages.length = 0;
        proxiedSockets.delete(client);
        proxiedSockets.delete(upstream);
        if (client.readyState === wsTypes.WebSocket.OPEN || client.readyState === wsTypes.WebSocket.CONNECTING) client.close();
        if (upstream.readyState === wsTypes.WebSocket.OPEN || upstream.readyState === wsTypes.WebSocket.CONNECTING) upstream.close();
      };
      client.on("message", (data: Buffer, isBinary: boolean) => {
        if (upstream.readyState === wsTypes.WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        else if (upstream.readyState === wsTypes.WebSocket.CONNECTING) pendingClientMessages.push({ data, isBinary });
      });
      upstream.on("message", (data: Buffer, isBinary: boolean) => {
        if (client.readyState === wsTypes.WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
      client.on("close", closeBoth);
      upstream.on("close", closeBoth);
      client.on("error", closeBoth);
      upstream.on("error", closeBoth);
    });
  });

  const originalClose = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    clearInterval(targetPoller);
    closeProxiedSockets();
    websocketServer?.close();
    return originalClose(callback);
  }) as typeof server.close;

  return server;
}

function acquireProxyLock(lockFile: string): () => void {
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const previous = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid?: number };
      if (previous.pid && process.platform !== "win32") {
        const command = spawnSync("ps", ["-p", String(previous.pid), "-o", "command="], { encoding: "utf8" }).stdout || "";
        if (/backend-handoff-proxy/i.test(command)) process.kill(previous.pid, "SIGTERM");
      }
    } catch {}
    fs.rmSync(lockFile, { force: true });
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  }
  return () => {
    try {
      if ((JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid?: number }).pid === process.pid) {
        fs.rmSync(lockFile, { force: true });
      }
    } catch {}
  };
}

const isMainModule = process.argv[1]?.includes("backend-handoff-proxy");
if (isMainModule) {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length - 1; index += 2) {
    args.set(process.argv[index], process.argv[index + 1]);
  }
  const targetFile = path.resolve(args.get("--target-file") || ".n-apt-backend-target.json");
  const listenPort = Number(args.get("--port") || 8765);
  const lockFile = path.resolve(".n-apt-backend-handoff-proxy.lock");
  const releaseLock = acquireProxyLock(lockFile);
  process.once("exit", releaseLock);
  const server = createBackendHandoffProxy({ listenPort, targetFile });
  const shutdown = () => {
    server.close(() => {
      releaseLock();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(listenPort, "127.0.0.1");
}
