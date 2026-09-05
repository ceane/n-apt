import { describe, expect, it } from "@jest/globals";

describe("build step completion labels", () => {
  it("uses past tense for checks and completed state for services/artifacts", () => {
    const { getCompletedStepLabel } = require("../../scripts/build/buildStepLabels");

    expect(getCompletedStepLabel("Cleaning up existing processes")).toBe("Cleaned up existing processes.");
    expect(getCompletedStepLabel("Validating Rust backend code")).toBe("Validated Rust backend.");
    expect(getCompletedStepLabel("Validating signals.yaml")).toBe("Validated signals.yaml.");
    expect(getCompletedStepLabel("Starting Redis database server")).toBe("Running Redis DB server.");
    expect(getCompletedStepLabel("Restoring OpenCellID tower database from disk")).toBe("Restored cell tower data.");
    expect(getCompletedStepLabel("Building WASM SIMD module")).toBe("Built WASM SIMD modules.");
    expect(getCompletedStepLabel("Building and starting Rust backend")).toBe("Rust backend running...");
    expect(getCompletedStepLabel("Starting frontend server")).toBe("Frontend server running...");
  });
});
