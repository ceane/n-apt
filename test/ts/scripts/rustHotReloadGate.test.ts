import { describe, expect, it, jest } from "@jest/globals";
import {
  buildRustBackendStopCommand,
  canKeepRustHotReloadWatcherAttached,
  createRustHotReloadGate,
  getRustHotReloadProcessLabel,
  getRustHotReloadRuntimeLabel,
  getRustHotReloadStepLabel,
  isProcessSpinnerActive,
  runRustHotReloadValidation,
} from "../../../scripts/build/rustHotReloadGate";

describe("Rust hot reload gate", () => {
  it("keeps the watcher attached while the Rust process is rebuilding", () => {
    expect(canKeepRustHotReloadWatcherAttached(101, 102, 103)).toBe(true);
    expect(canKeepRustHotReloadWatcherAttached(101, 102, undefined)).toBe(false);
  });

  it("animates the spinner whenever a process is running", () => {
    expect(isProcessSpinnerActive("running")).toBe(true);
    expect(isProcessSpinnerActive("warning")).toBe(false);
    expect(isProcessSpinnerActive("success")).toBe(false);
  });

  it("waits for a quiet window before reporting readiness", () => {
    const gate = createRustHotReloadGate(1000, 30_000);

    gate.recordChange(undefined, 0);
    expect(gate.shouldAttemptValidation(0)).toBe(false);
    expect(gate.shouldAttemptValidation(999)).toBe(false);
    expect(gate.shouldAttemptValidation(1000)).toBe(true);

    gate.recordChange(undefined, 1200);
    expect(gate.shouldAttemptValidation(1999)).toBe(false);
    expect(gate.shouldAttemptValidation(2200)).toBe(true);
  });

  it("forces validation after the max coalesce window even if edits keep arriving", () => {
    const gate = createRustHotReloadGate(5000, 30_000);

    gate.recordChange("a.rs", 0);
    gate.recordChange("b.rs", 4000);
    gate.recordChange("c.rs", 8000);
    gate.recordChange("d.rs", 12_000);
    gate.recordChange("e.rs", 29_000);

    expect(gate.shouldAttemptValidation(29_000)).toBe(false);
    expect(gate.shouldAttemptValidation(30_000)).toBe(true);
    expect(gate.getRemainingMs(29_000)).toBe(1000);
  });

  it("resets the coalesce window after clear", () => {
    const gate = createRustHotReloadGate(1000, 5000);
    gate.recordChange("a.rs", 0);
    expect(gate.shouldAttemptValidation(5000)).toBe(true);
    gate.clear();
    gate.recordChange("b.rs", 6000);
    expect(gate.shouldAttemptValidation(6500)).toBe(false);
    expect(gate.shouldAttemptValidation(7000)).toBe(true);
  });

  it("stops after cargo check fails", async () => {
    const cargoCheck = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    cargoCheck.mockResolvedValue({ success: false, output: "check failed" });
    const cargoBuild = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    const restart = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<boolean>
    >;
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
      "[HOT-RELOAD] Rust backend running (old)",
    );
    expect(result.stage).toBe("check_failed");
  });

  it("checks, builds, then restarts on success", async () => {
    const cargoCheck = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    cargoCheck.mockResolvedValue({ success: true, output: "check ok" });
    const cargoBuild = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<{ success: boolean; output: string }>
    >;
    cargoBuild.mockResolvedValue({ success: true, output: "build ok" });
    const restart = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<boolean>
    >;
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
    expect(result.stage).toBe("restarted");
    expect(updateStatus.mock.calls).toEqual([
      ["running", "Checking Rust backend...", "[HOT-RELOAD] Checking Rust backend..."],
      ["running", "Building Rust backend...", "[HOT-RELOAD] Rebuilding Rust backend..."],
      ["running", "Restarting Rust backend...", "Restarting Rust backend..."],
      ["success", "Running new build", "[HOT-RELOAD] Rust backend reloaded"],
    ]);
  });

  it("reports a restart exception as a failed restart", async () => {
    const updateStatus = jest.fn();

    const result = await runRustHotReloadValidation({
      cargoCheck: async () => ({ success: true, output: "check ok" }),
      cargoBuild: async () => ({ success: true, output: "build ok" }),
      restart: async () => {
        throw new Error("address already in use");
      },
      log: jest.fn(),
      updateStatus,
    });

    expect(result.stage).toBe("restart_failed");
    expect(updateStatus).toHaveBeenLastCalledWith(
      "error",
      "Failed to restart Rust backend: address already in use",
      "Rust backend failed",
    );
  });

  it("stops before restart when cancelled during validation", async () => {
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
    const restart = jest.fn() as unknown as jest.MockedFunction<
      () => Promise<boolean>
    >;

    const result = await runRustHotReloadValidation({
      cargoCheck,
      cargoBuild,
      restart,
      log: jest.fn(),
      updateStatus: jest.fn(),
      isCancelled: () => cancelled,
    });

    expect(cargoCheck).toHaveBeenCalledTimes(1);
    expect(cargoBuild).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
    expect(result.stage).toBe("build_failed");
  });

  it("builds a targeted rust backend stop command for hot reload", () => {
    expect(buildRustBackendStopCommand(38510, "darwin")).toContain("38510");
    expect(buildRustBackendStopCommand(38510, "win32")).toContain("38510");
    expect(buildRustBackendStopCommand(38510, "darwin")).not.toContain("pkill");
    expect(buildRustBackendStopCommand(38510, "win32")).not.toContain("pkill");
  });

  it("formats hot-reload process and runtime labels separately", () => {
    expect(getRustHotReloadProcessLabel("running", "Checking Rust backend..."))
      .toBe("[HOT-RELOAD] Rebuilding Rust backend...");
    expect(getRustHotReloadProcessLabel("running", "Restarting Rust backend..."))
      .toBe("Restarting Rust backend...");
    expect(getRustHotReloadRuntimeLabel(2, "Running"))
      .toBe("✓ Updated (+2)");
    expect(getRustHotReloadRuntimeLabel(0, "Running"))
      .toBe("Running");
    expect(getRustHotReloadStepLabel("waiting"))
      .toBe("[HOT-RELOAD] Waiting for Rust changes to settle...");
    expect(getRustHotReloadStepLabel("ready"))
      .toBe("[HOT-RELOAD] Rust backend reloaded");
    expect(getRustHotReloadStepLabel("idle")).toBeUndefined();
  });
});
