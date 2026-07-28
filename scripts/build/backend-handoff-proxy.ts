import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
// @ts-ignore ws is installed directly but this script is also executed through tsx.
import { WebSocket, WebSocketServer } from "ws";
/* eslint-disable @typescript-eslint/no-explicit-any */
const wsTypes = { WebSocket, WebSocketServer } as {
  WebSocket: any;
  WebSocketServer: any;
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
  const targetWatcher = fs.watch(targetDirectory, (_event, filename) => {
    if (filename !== path.basename(options.targetFile)) return;
    try {
      target = readBackendTarget(options.targetFile);
    } catch {
      // Atomic replacement can briefly make the file unavailable.
    }
  });

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
  const proxiedSockets = new Set<any>();
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
      proxiedSockets.add(client);
      proxiedSockets.add(upstream);

      const closeBoth = () => {
        proxiedSockets.delete(client);
        proxiedSockets.delete(upstream);
        if (client.readyState === wsTypes.WebSocket.OPEN || client.readyState === wsTypes.WebSocket.CONNECTING) client.close();
        if (upstream.readyState === wsTypes.WebSocket.OPEN || upstream.readyState === wsTypes.WebSocket.CONNECTING) upstream.close();
      };
      client.on("message", (data: Buffer, isBinary: boolean) => {
        if (upstream.readyState === wsTypes.WebSocket.OPEN) upstream.send(data, { binary: isBinary });
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
    targetWatcher.close();
    for (const socket of proxiedSockets) {
      try { socket.close(); } catch {}
    }
    proxiedSockets.clear();
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
