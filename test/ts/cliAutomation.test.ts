import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCliArguments } from "../../scripts/cli/options";

const cliPath = join(process.cwd(), "scripts", "cli", "index.ts");
const unavailableUrl = "http://127.0.0.1:1";

interface CliResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", cliPath, ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          N_APT_BACKEND_URL: unavailableUrl,
          N_APT_FRONTEND_URL: unavailableUrl,
          PATH: join(process.cwd(), ".test-no-bin"),
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 3_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Test server did not bind to a TCP port");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

describe("CLI option validation", () => {
  test("keeps positionals before normalized options", () => {
    expect(
      validateCliArguments([
        "agent",
        "call",
        "--json",
        "getDeviceStatus",
        "--params={}",
      ]),
    ).toEqual(["agent", "call", "getDeviceStatus", "--json", "--params", "{}"]);
  });

  test.each([
    {
      name: "unknown options",
      args: ["agent", "capabilities", "--unknown"],
      message: "Unknown option: --unknown",
    },
    {
      name: "duplicate options",
      args: ["agent", "capabilities", "--json", "--json"],
      message: "Duplicate option: --json",
    },
    {
      name: "missing option values",
      args: ["agent", "markdown", "--route"],
      message: "Option --route requires a value",
    },
    {
      name: "invalid enum values",
      args: ["capture", "snapshot", "--theme", "neon"],
      message: "Option --theme must be one of: dark, light",
    },
  ])("rejects $name before startup", async ({ args, message }) => {
    const result = await runCli(args);

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("starting the app");
    expect(result.stderr).toContain(message);
  });

  test("accepts option equals syntax for local commands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "napt-cli-options-"));
    const input = join(directory, "sample.iq");
    await writeFile(input, Buffer.from([1, 2, 3, 4]));
    try {
      const result = await runCli([
        "signals",
        "inspect",
        `--input=${input}`,
        "--json",
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        format: "raw-iq",
        iqSamples: 2,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("CLI service-specific readiness", () => {
  test("prints machine-readable devices without requiring the frontend", async () => {
    const sources = [
      {
        id: "rtl-1",
        name: "RTL 1",
        kind: "rtl-sdr",
        capability: "rx",
        status: "connected",
        serial_number: "serial-1",
      },
      {
        id: "mock-apt",
        name: "Mock APT",
        kind: "mock",
        capability: "mock",
        status: "connected",
      },
    ];
    const requests: string[] = [];

    await withServer(
      (request, response) => {
        requests.push(request.url ?? "");
        if (request.url === "/status") {
          sendJson(response, 200, {
            status: { active_source: "rtl-1", sources },
          });
          return;
        }
        sendJson(response, 404, { error: "not found" });
      },
      async (backendUrl) => {
        const result = await runCli(["devices", "--json"], {
          N_APT_BACKEND_URL: backendUrl,
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).not.toContain("starting the app");
        const payload = JSON.parse(result.stdout);
        expect(payload).toMatchObject({
          schemaVersion: 1,
          activeSource: "rtl-1",
          sources: [
            { id: "rtl-1", active: true },
            { id: "mock-apt", active: false },
          ],
        });
        expect(requests).toEqual(["/status", "/status"]);
      },
    );
  });

  test("instructs the user to start the development stack instead of autostarting it", async () => {
    const result = await runCli(["devices", "--json"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("npm run dev");
    expect(result.stderr).not.toContain("starting the app");
  });

  test("prints clean JSON Markdown without requiring the backend", async () => {
    const requests: Array<{ url: string; accept?: string }> = [];

    await withServer(
      (request, response) => {
        requests.push({
          url: request.url ?? "",
          accept: request.headers.accept,
        });
        response.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "x-markdown-tokens": "3",
        });
        response.end("# Agents\n");
      },
      async (frontendUrl) => {
        const result = await runCli(
          ["agent", "markdown", "--route", "/agents", "--json"],
          { N_APT_FRONTEND_URL: frontendUrl },
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).not.toContain("starting the app");
        expect(JSON.parse(result.stdout)).toMatchObject({
          route: "/agents",
          status: 200,
          contentType: "text/markdown; charset=utf-8",
          tokens: "3",
          body: "# Agents\n",
        });
        expect(requests).toEqual([
          { url: "/", accept: "*/*" },
          { url: "/agents", accept: "text/markdown" },
        ]);
      },
    );
  });
});
