import { spawnSync } from "node:child_process";
import { join } from "node:path";
import packageJson from "../../package.json";

const cliPath = join(process.cwd(), "scripts", "cli", "index.ts");
const unavailableUrl = "http://127.0.0.1:1";

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      N_APT_BACKEND_URL: unavailableUrl,
      N_APT_FRONTEND_URL: unavailableUrl,
      PATH: join(process.cwd(), ".test-no-bin"),
    },
    timeout: 3_000,
  });
}

const helpCases: Array<{ name: string; args: string[]; expected: string[] }> = [
  {
    name: "top-level help",
    args: ["--help"],
    expected: [
      "Usage:",
      "npm run dev",
      "devices",
      "capture",
      "signals",
      "agent",
      "--option=value",
      "--version",
    ],
  },
  {
    name: "capture help",
    args: ["capture", "--help"],
    expected: ["Usage:", "capture snapshot", "capture iq", "Options:"],
  },
  {
    name: "snapshot help",
    args: ["capture", "snapshot", "--help"],
    expected: ["--device", "--waterfall", "--fft-size", "--output"],
  },
  {
    name: "I/Q capture help",
    args: ["capture", "iq", "--help"],
    expected: [
      "--center-frequency",
      "--sample-rate",
      "--duration",
      "--acquisition-mode",
      "--file-type",
      "--frame-rate",
      "--output",
    ],
  },
  {
    name: "short I/Q capture help",
    args: ["capture", "iq", "-h"],
    expected: ["Usage:", "capture iq", "--allow-mutations"],
  },
  {
    name: "signals help",
    args: ["signals", "--help"],
    expected: ["inspect", "spectrum", "validate", "demod", "capture"],
  },
  {
    name: "signals inspect help",
    args: ["signals", "inspect", "--help"],
    expected: ["Usage:", "signals inspect", "--json"],
  },
  {
    name: "signals demod help",
    args: ["signals", "demod", "--help"],
    expected: [
      "--algorithm",
      "--center-frequency",
      "--min-frequency",
      "--output",
    ],
  },
  {
    name: "agent help",
    args: ["agent", "--help"],
    expected: ["capabilities", "tools", "markdown", "call"],
  },
  {
    name: "agent call help",
    args: ["agent", "call", "--help"],
    expected: ["--params", "--allow-mutations", "--json"],
  },
  {
    name: "devices help",
    args: ["devices", "--help"],
    expected: ["Usage:", "devices", "--json"],
  },
  {
    name: "demod help",
    args: ["demod", "--help"],
    expected: ["--input", "--algorithm", "--output"],
  },
  {
    name: "help lookup",
    args: ["help", "capture", "iq"],
    expected: ["Usage:", "capture iq", "--file-type"],
  },
];

describe("CLI help", () => {
  test.each(helpCases)(
    "prints $name without side effects",
    ({ args, expected }) => {
      const result = runCli(args);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expected.forEach((text) => expect(result.stdout).toContain(text));
    },
  );

  test("prints the package version", () => {
    const result = runCli(["--version"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("prints full help on an unknown command", () => {
    const result = runCli(["unknown-command"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Global options:");
    expect(result.stderr).toContain("Command help:");
    expect(result.stderr).toContain("Environment:");
  });

  test("requires mutation opt-in before readiness checks for I/Q capture", () => {
    const result = runCli(["capture", "iq"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("starting the app");
    expect(result.stderr).toContain("capture iq requires --allow-mutations");
  });
});
