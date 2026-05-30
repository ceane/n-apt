/** @jest-environment node */
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

describe("Backend Health Integration", () => {
  let backendProcess: ChildProcess;
  const PORT = 44999;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    // Start the backend from project root
    const projectRoot = path.resolve(process.cwd());
    const binaryPath =
      process.env.BACKEND_BINARY_PATH ||
      path.join(projectRoot, "target/debug/n-apt-backend");

    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `Backend binary not found at ${binaryPath}. Run npm run build:rust before BackendHealth.`,
      );
    }

    let backendOutput = "";
    const appendBackendOutput = (data: Buffer | string) => {
      backendOutput = `${backendOutput}${data.toString()}`.slice(-8000);
    };

    backendProcess = spawn(binaryPath, [], {
      cwd: projectRoot,
      env: {
        ...process.env,
        WEBSOCKETS_URL: `http://127.0.0.1:${PORT}`,
        UNSAFE_LOCAL_USER_PASSWORD: "test-password-123",
        RUST_LOG: "info",
      },
    });

    backendProcess.stdout?.on("data", (data) => {
      appendBackendOutput(data);
      if (process.env.BACKEND_HEALTH_VERBOSE === "1") {
        process.stdout.write(`[Backend STDOUT] ${data}`);
      }
    });

    backendProcess.stderr?.on("data", (data) => {
      appendBackendOutput(data);
      if (process.env.BACKEND_HEALTH_VERBOSE === "1") {
        process.stderr.write(`[Backend STDERR] ${data}`);
      }
    });

    const exited = new Promise<never>((_, reject) => {
      backendProcess.once("exit", (code, signal) => {
        reject(
          new Error(
            `Backend exited before it became healthy (code: ${code ?? "null"}, signal: ${
              signal ?? "null"
            }).\n${backendOutput.trim()}`,
          ),
        );
      });
      backendProcess.once("error", (error) => {
        reject(new Error(`Backend failed to start: ${error.message}`));
      });
    });

    // Wait for it to start and respond to status check
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      const ready = await Promise.race([
        (async () => {
          try {
            const response = await fetch(`${BASE_URL}/status`);
            if (response.ok) {
              console.log(
                `✅ Backend responded with 200 OK after ${attempts}s`,
              );
              return true;
            }
            console.log(
              `⏳ Backend status: ${response.status} (attempt ${attempts})`,
            );
          } catch (e) {
            console.log(
              `⏳ Backend not ready (attempt ${attempts}): ${(e as Error).message}`,
            );
          }
          return false;
        })(),
        exited,
      ]);

      if (ready) {
        return; // Success
      }
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // If we got here, it failed to start. Capture exit code if any.
    const exitCode = backendProcess.exitCode;
    throw new Error(
      `Backend failed to start in time. Exit code: ${exitCode}.\n${backendOutput.trim()}`,
    );
  }, 45000); // 45s timeout for compilation/startup

  afterAll(async () => {
    if (backendProcess) {
      if (backendProcess.exitCode !== null) {
        return;
      }

      backendProcess.kill();
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        backendProcess.once("exit", () => {
          clearTimeout(timeout);
          resolve(undefined);
        });
      });
    }
  });

  it("should return a healthy status", async () => {
    const response = await fetch(`${BASE_URL}/status`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("device_connected");
    expect(data).toHaveProperty("device_state");
    expect(data).toHaveProperty("device_name");
  });

  it("should have loaded channels from signals.yaml", async () => {
    const response = await fetch(`${BASE_URL}/status`);
    const data = await response.json();
    expect(Array.isArray(data.channels)).toBe(true);
    expect(data.channels.length).toBeGreaterThan(0);
  });

  it("should respond to authentication challenges", async () => {
    const response = await fetch(`${BASE_URL}/auth/challenge`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("challenge_id");
    expect(data).toHaveProperty("nonce");
  });
});
