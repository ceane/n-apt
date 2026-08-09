import { describe, expect, it } from "@jest/globals";
import {
  formatRebuildNotificationMessage,
  shouldShowRebuildNotification,
} from "@n-apt/app/infrastructure/services/rebuildStatusMessage";

describe("rebuild status notifications", () => {
  it("prefers an explicit progress string from rebuild status", () => {
    expect(
      formatRebuildNotificationMessage({
        phase: "building",
        progress: "Compiling n-apt-backend v0.5.0",
      }),
    ).toBe("Compiling n-apt-backend v0.5.0");
  });

  it("does not keep a toast alive during the settle/waiting window", () => {
    expect(
      shouldShowRebuildNotification({
        rebuilding: false,
        pending: true,
        phase: "waiting",
        progress: "Changed: foo.rs. Rebuilding in 5s...",
      }),
    ).toBe(false);
  });

  it("shows a toast only while cargo/restart is actually running", () => {
    expect(
      shouldShowRebuildNotification({
        rebuilding: true,
        phase: "building",
        progress: "Compiling serde v1.0.210",
      }),
    ).toBe(true);
  });
});
