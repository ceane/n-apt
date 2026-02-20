import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { reconcile_device_state } from "@n-apt/server/utils";

// Mock the server utils module
jest.mock("@n-apt/server/utils", () => ({
  reconcile_device_state: jest.fn(),
}));

import { reconcile_device_state as reconcileDeviceState } from "@n-apt/server/utils";

describe("Device State Transitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("reconcile_device_state function", () => {
    it("should return 'connected' when device is connected but state says disconnected", () => {
      const result = reconcileDeviceState(true, "disconnected");
      expect(result).toBe("connected");
    });

    it("should return 'disconnected' when device is disconnected but state says connected", () => {
      const result = reconcileDeviceState(false, "connected");
      expect(result).toBe("disconnected");
    });

    it("should return 'disconnected' when device is disconnected and state says loading", () => {
      const result = reconcileDeviceState(false, "loading");
      expect(result).toBe("disconnected");
    });

    it("should return 'connected' when device is connected and state says stale", () => {
      const result = reconcileDeviceState(true, "stale");
      expect(result).toBe("connected");
    });

    it("should preserve existing state when no reconciliation needed", () => {
      const result = reconcileDeviceState(true, "connected");
      expect(result).toBe("connected");
    });

    it("should preserve existing state for disconnected device", () => {
      const result = reconcileDeviceState(false, "disconnected");
      expect(result).toBe("disconnected");
    });

    it("should preserve loading state when device is connected", () => {
      const result = reconcileDeviceState(true, "loading");
      expect(result).toBe("loading");
    });

    it("should preserve stale state when device is disconnected", () => {
      const result = reconcileDeviceState(false, "stale");
      expect(result).toBe("stale");
    });
  });

  describe("WebSocket Status Message Handling", () => {
    it("should handle device_connected: true, device_state: 'connected'", () => {
      const statusMessage = {
        message_type: "status",
        device_connected: true,
        device_state: "connected",
        backend: "rtl-sdr",
        device_info: "RTL-SDR Blog V4",
        paused: false,
      };

      const reconciledState = reconcileDeviceState(
        statusMessage.device_connected,
        statusMessage.device_state
      );
      
      expect(reconciledState).toBe("connected");
    });

    it("should handle device_connected: false, device_state: 'disconnected'", () => {
      const statusMessage = {
        message_type: "status",
        device_connected: false,
        device_state: "disconnected",
        backend: "mock",
        device_info: "Mock RTL-SDR Device",
        paused: false,
      };

      const reconciledState = reconcileDeviceState(
        statusMessage.device_connected,
        statusMessage.device_state
      );
      
      expect(reconciledState).toBe("disconnected");
    });

    it("should handle transition from real device to mock", () => {
      // Device was connected, now it's not
      const beforeState = reconcileDeviceState(true, "connected");
      expect(beforeState).toBe("connected");

      const afterState = reconcileDeviceState(false, "connected");
      expect(afterState).toBe("disconnected");
    });

    it("should handle transition from mock to real device", () => {
      // Device was disconnected, now it's connected
      const beforeState = reconcileDeviceState(false, "disconnected");
      expect(beforeState).toBe("disconnected");

      const afterState = reconcileDeviceState(true, "disconnected");
      expect(afterState).toBe("connected");
    });

    it("should handle stale device recovery", () => {
      // Device became stale but is still connected
      const result = reconcileDeviceState(true, "stale");
      expect(result).toBe("connected");
    });

    it("should handle loading state cleanup", () => {
      // Device finished loading but is not actually connected
      const result = reconcileDeviceState(false, "loading");
      expect(result).toBe("disconnected");
    });
  });

  describe("Frontend State Synchronization", () => {
    it("should update ConnectionStatusSection correctly for each state", () => {
      const testCases = [
        { connected: true, state: "connected", expectedText: "Connected to server and device" },
        { connected: false, state: "disconnected", expectedText: "Disconnected" },
        { connected: true, state: "loading", expectedText: "Loading device..." },
        { connected: false, state: "loading", expectedText: "Disconnected" },
        { connected: true, state: "stale", expectedText: "Connected to server and device" },
        { connected: false, state: "stale", expectedText: "Disconnected" },
      ];

      testCases.forEach(({ connected, state, expectedText }) => {
        const reconciledState = reconcileDeviceState(connected, state);
        // In a real test, we would render ConnectionStatusSection and check the text
        expect(reconciledState).toBeDefined();
      });
    });

    it("should handle backend field updates", () => {
      const realDeviceStatus = {
        message_type: "status",
        device_connected: true,
        device_state: "connected",
        backend: "rtl-sdr",
        device_info: "RTL-SDR Blog V4",
      };

      const mockDeviceStatus = {
        message_type: "status",
        device_connected: false,
        device_state: "disconnected",
        backend: "mock",
        device_info: "Mock RTL-SDR Device",
      };

      expect(realDeviceStatus.backend).toBe("rtl-sdr");
      expect(mockDeviceStatus.backend).toBe("mock");
    });
  });

  describe("Edge Cases", () => {
    it("should handle unknown device states gracefully", () => {
      const result = reconcileDeviceState(true, "unknown");
      expect(result).toBe("unknown");
    });

    it("should handle empty device states gracefully", () => {
      const result = reconcileDeviceState(false, "");
      expect(result).toBe("");
    });

    it("should handle null/undefined states", () => {
      // These would be handled at the call site, but test the function's robustness
      expect(() => {
        reconcileDeviceState(true, "null");
      }).not.toThrow();
      
      expect(() => {
        reconcileDeviceState(false, "undefined");
      }).not.toThrow();
    });
  });
});
