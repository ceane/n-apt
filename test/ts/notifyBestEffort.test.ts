import { describe, expect, it, jest } from "@jest/globals";

jest.mock("node-notifier", () => ({ notify: jest.fn() }));

import {
  notifyBestEffort,
  type BuildNotification,
  type NotificationSender,
} from "../../scripts/build/notifyBestEffort";

describe("notifyBestEffort", () => {
  it("does not let desktop notification failures escape the build process", () => {
    let callback: ((error: Error | null) => void) | undefined;
    const notify: NotificationSender = jest.fn(
      (_options: BuildNotification, next: (error: Error | null) => void) => {
        callback = next;
        return undefined;
      },
    );

    expect(() =>
      notifyBestEffort({ title: "N-APT", message: "Ready" }, notify),
    ).not.toThrow();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(callback).toBeDefined();
    expect(() =>
      callback?.(new Error("notification helper unavailable")),
    ).not.toThrow();
  });
});
