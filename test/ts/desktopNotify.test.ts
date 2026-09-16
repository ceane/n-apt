import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mockSpawn = jest.fn();
const errorHandlers: Array<(error: Error) => void> = [];

jest.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...(args as [])),
}));

const requireNotify = () => {
  let mod: typeof import("../../scripts/build/desktopNotify");
  jest.isolateModules(() => {
    mod = require("../../scripts/build/desktopNotify");
  });
  return mod!;
};

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const setPlatform = (platform: string) => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
};

let binDir: string;

const addBinary = (name: string) => {
  const binaryPath = path.join(binDir, name);
  fs.writeFileSync(binaryPath, "#!/bin/sh\n");
  fs.chmodSync(binaryPath, 0o755);
  return binaryPath;
};

const expectOsascript = (message: string, title: string) => {
  expect(mockSpawn).toHaveBeenCalledWith(
    "/usr/bin/osascript",
    ["-e", `display notification "${message}" with title "${title}"`],
    { stdio: "ignore", detached: true },
  );
};

describe("desktop notifications", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    errorHandlers.length = 0;
    mockSpawn.mockImplementation(() => {
      const child = {
        on: jest.fn((event: string, handler: (error: Error) => void) => {
          if (event === "error") errorHandlers.push(handler);
          return child;
        }),
        unref: jest.fn(),
      };
      return child;
    });

    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "n-apt-notify-"));
    process.env.PATH = binDir;
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    process.env.PATH = originalPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("escapes AppleScript string literals", () => {
    const { toAppleScriptString } = requireNotify();

    expect(toAppleScriptString('say "hi"')).toBe('"say \\"hi\\""');
    expect(toAppleScriptString("C:\\path")).toBe('"C:\\\\path"');
  });

  it("prefers a native terminal-notifier on PATH, keeping icon and open", () => {
    setPlatform("darwin");
    const binary = addBinary("terminal-notifier");

    const { notify } = requireNotify();
    notify({
      title: "N-APT",
      message: "✓ Build done",
      icon: "/tmp/icon.png",
      open: "http://localhost:5173",
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      binary,
      [
        "-title",
        "N-APT",
        "-message",
        "✓ Build done",
        "-appIcon",
        "/tmp/icon.png",
        "-open",
        "http://localhost:5173",
      ],
      { stdio: "ignore", detached: true },
    );
  });

  it("falls back to osascript when no terminal-notifier is installed", () => {
    setPlatform("darwin");

    const { notify } = requireNotify();
    notify({ title: "N-APT", message: "✓ Build done", open: "http://localhost:5173" });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expectOsascript("✓ Build done", "N-APT");
  });

  it("falls back to osascript when terminal-notifier cannot launch", () => {
    setPlatform("darwin");
    const binary = addBinary("terminal-notifier");

    const { notify } = requireNotify();
    notify({ title: "N-APT", message: "✓ Build done" });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0][0]).toBe(binary);

    errorHandlers.forEach(handler => {
      handler(new Error("spawn Unknown system error -86"));
    });

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[1][0]).toBe("/usr/bin/osascript");

    errorHandlers.length = 0;
    notify({ title: "N-APT", message: "✓ And again" });

    expect(mockSpawn).toHaveBeenCalledTimes(3);
    expect(mockSpawn.mock.calls[2][0]).toBe("/usr/bin/osascript");
  });

  it("falls back to osascript when terminal-notifier throws synchronously", () => {
    setPlatform("darwin");
    addBinary("terminal-notifier");

    const error = new Error("spawn Unknown system error -86") as NodeJS.ErrnoException;
    error.code = "Unknown system error -86";
    mockSpawn.mockImplementationOnce(() => {
      throw error;
    });

    const { notify } = requireNotify();
    expect(() => notify({ title: "N-APT", message: "✓ Build done" })).not.toThrow();

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[1][0]).toBe("/usr/bin/osascript");
  });

  it("uses notify-send on Linux when available", () => {
    setPlatform("linux");
    const binary = addBinary("notify-send");

    const { notify } = requireNotify();
    notify({ title: "N-APT", message: "✓ Build done", icon: "/tmp/icon.png" });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      binary,
      ["-i", "/tmp/icon.png", "N-APT", "✓ Build done"],
      { stdio: "ignore", detached: true },
    );
  });

  it("stays silent on Linux without notify-send", () => {
    setPlatform("linux");

    const { notify } = requireNotify();
    expect(() => notify({ title: "N-APT", message: "✓ Build done" })).not.toThrow();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("stays silent on platforms with no supported backend", () => {
    setPlatform("win32");

    const { notify } = requireNotify();
    expect(() => notify({ title: "N-APT", message: "✓ Build done" })).not.toThrow();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("tolerates an empty PATH", () => {
    setPlatform("darwin");
    process.env.PATH = "";

    const { notify } = requireNotify();
    notify({ title: "N-APT", message: "✓ Build done" });

    expectOsascript("✓ Build done", "N-APT");
  });

  it("never propagates a synchronous spawn failure off macOS", () => {
    setPlatform("linux");
    addBinary("notify-send");
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn EACCES");
    });

    const { notify } = requireNotify();
    expect(() => notify({ title: "N-APT", message: "✓ Build done" })).not.toThrow();
  });
});
