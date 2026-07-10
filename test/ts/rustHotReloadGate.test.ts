import { describe, expect, it, jest } from "@jest/globals";

describe("Rust hot reload gate", () => {
  it("waits for a quiet window before reporting readiness", () => {
    jest.useFakeTimers();
    const { createRustHotReloadGate } = require("../../src/ts/utils/rustHotReloadGate");

    const gate = createRustHotReloadGate(1000);

    gate.recordChange(undefined, 0);
    expect(gate.shouldAttemptValidation(0)).toBe(false);
    expect(gate.shouldAttemptValidation(999)).toBe(false);
    expect(gate.shouldAttemptValidation(1000)).toBe(true);

    gate.recordChange(undefined, 1200);
    expect(gate.shouldAttemptValidation(1999)).toBe(false);
    expect(gate.shouldAttemptValidation(2200)).toBe(true);

    jest.useRealTimers();
  });

  it("stops after cargo check fails", async () => {
    const { runRustHotReloadValidation } = require("../../src/ts/utils/rustHotReloadGate");

    const cargoCheck = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    cargoCheck.mockResolvedValue({ success: false, output: "check failed" });
    const cargoBuild = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    const restart = jest.fn() as unknown as jest.MockedFunction<() => Promise<boolean>>;
    const log = jest.fn();
    const updateStatus = jest.fn();

    const result = await runRustHotReloadValidation({
      cargoCheck,
      cargoBuild,
      restart,
      log,
      updateStatus,
    });

    expect(cargoCheck).toHaveBeenCalledTimes(1);
    expect(cargoBuild).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      "warning",
      "Rust check failed - running old binary",
      "Rust backend running (old)",
    );
    expect(result.stage).toBe("check_failed");
  });

  it("checks, builds, then restarts on success", async () => {
    const { runRustHotReloadValidation } = require("../../src/ts/utils/rustHotReloadGate");

    const cargoCheck = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    cargoCheck.mockResolvedValue({ success: true, output: "check ok" });
    const cargoBuild = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    cargoBuild.mockResolvedValue({ success: true, output: "build ok" });
    const restart = jest.fn() as unknown as jest.MockedFunction<() => Promise<boolean>>;
    restart.mockResolvedValue(true);
    const log = jest.fn();
    const updateStatus = jest.fn();

    const result = await runRustHotReloadValidation({
      cargoCheck,
      cargoBuild,
      restart,
      log,
      updateStatus,
    });

    expect(cargoCheck).toHaveBeenCalledTimes(1);
    expect(cargoBuild).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledWith(
      "success",
      "Rust backend running...",
      expect.any(String),
    );
    expect(result.stage).toBe("restarted");
  });

  it("stops before restart when cancelled during validation", async () => {
    const { runRustHotReloadValidation } = require("../../src/ts/utils/rustHotReloadGate");

    const cargoCheck = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    cargoCheck.mockResolvedValue({ success: true, output: "check ok" });
    let cancelled = false;
    const cargoBuild = jest.fn(async () => {
      cancelled = true;
      return { success: true, output: "build ok" };
    }) as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    const restart = jest.fn() as unknown as jest.MockedFunction<() => Promise<boolean>>;
    const log = jest.fn();
    const updateStatus = jest.fn();

    const result = await runRustHotReloadValidation({
      cargoCheck,
      cargoBuild,
      restart,
      log,
      updateStatus,
      isCancelled: () => cancelled,
    });

    cancelled = true;

    expect(cargoCheck).toHaveBeenCalledTimes(1);
    expect(cargoBuild).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
    expect(result.stage).toBe("build_failed");
  });

  it("builds a targeted rust backend stop command for hot reload", () => {
    const {
      buildRustBackendStopCommand,
    } = require("../../src/ts/utils/rustHotReloadGate");

    expect(buildRustBackendStopCommand(38510, "darwin")).toContain("38510");
    expect(buildRustBackendStopCommand(38510, "win32")).toContain("38510");
    expect(buildRustBackendStopCommand(38510, "darwin")).not.toContain("pkill");
    expect(buildRustBackendStopCommand(38510, "win32")).not.toContain("pkill");
  });
});
