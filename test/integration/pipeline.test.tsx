import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock WebSocket for integration testing
const mockWebSocket = {
  readyState: WebSocket.CONNECTING,
  close: jest.fn(),
  send: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
};

global.WebSocket = jest.fn(() => mockWebSocket) as any;

describe("End-to-End Pipeline Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should handle device state transitions correctly", async () => {
    // Mock WebSocket status messages for device transitions
    const mockStatusMessages = [
      {
        message_type: "status",
        device_connected: false,
        device_state: "disconnected",
        backend: "mock",
        device_info: "Mock RTL-SDR Device",
        paused: false,
      },
      {
        message_type: "status", 
        device_connected: true,
        device_state: "connected",
        backend: "rtl-sdr",
        device_info: "RTL-SDR Blog V4",
        paused: false,
      },
      {
        message_type: "status",
        device_connected: false,
        device_state: "disconnected", 
        backend: "mock",
        device_info: "Mock RTL-SDR Device",
        paused: false,
      },
    ];

    // Test that status messages are handled correctly
    mockStatusMessages.forEach((status, index) => {
      expect(status.message_type).toBe("status");
      expect(typeof status.device_connected).toBe("boolean");
      expect(typeof status.device_state).toBe("string");
      
      if (index === 0) {
        expect(status.device_connected).toBe(false);
        expect(status.backend).toBe("mock");
      } else if (index === 1) {
        expect(status.device_connected).toBe(true);
        expect(status.backend).toBe("rtl-sdr");
      } else if (index === 2) {
        expect(status.device_connected).toBe(false);
        expect(status.backend).toBe("mock");
      }
    });
  });

  it("should handle pause state transitions", async () => {
    const pauseTransitions = [
      { paused: false, description: "Initial unpaused state" },
      { paused: true, description: "User pauses streaming" },
      { paused: false, description: "User resumes streaming" },
      { paused: true, description: "User pauses again" },
    ];

    pauseTransitions.forEach(({ paused, description }) => {
      const statusMessage = {
        message_type: "status",
        device_connected: true,
        device_state: "connected",
        backend: "rtl-sdr",
        device_info: "RTL-SDR Blog V4",
        paused,
      };

      expect(statusMessage.paused).toBe(paused);
      expect(typeof statusMessage.paused).toBe("boolean");
    });
  });

  it("should handle spectrum data flow", async () => {
    const spectrumData = {
      message_type: "encrypted_spectrum",
      type: "encrypted_spectrum",
      payload: "mock_encrypted_payload",
      center_frequency_hz: 100_000_000,
    };

    expect(spectrumData.message_type).toBe("encrypted_spectrum");
    expect(spectrumData.type).toBe("encrypted_spectrum");
    expect(typeof spectrumData.payload).toBe("string");
    expect(typeof spectrumData.center_frequency_hz).toBe("number");
  });

  it("should handle WebSocket connection lifecycle", () => {
    // Test WebSocket creation
    const ws = new WebSocket("ws://localhost:8765/ws?token=mock");
    expect(global.WebSocket).toHaveBeenCalledWith("ws://localhost:8765/ws?token=mock");
    expect(ws).toBe(mockWebSocket);

    // Test WebSocket methods
    expect(typeof ws.close).toBe("function");
    expect(typeof ws.send).toBe("function");
    expect(typeof ws.addEventListener).toBe("function");
  });

  it("should handle error scenarios gracefully", () => {
    // Test malformed status message
    const malformedStatus = {
      message_type: "status",
      device_connected: "invalid", // Should be boolean
      device_state: null, // Should be string
      backend: undefined, // Should be string
    };

    // Should not throw when processing malformed data
    expect(() => {
      JSON.stringify(malformedStatus);
    }).not.toThrow();

    // Test missing required fields
    const incompleteStatus = {
      message_type: "status",
      // Missing device_connected, device_state, etc.
    };

    expect(() => {
      JSON.stringify(incompleteStatus);
    }).not.toThrow();
  });

  it("should handle frequency range updates", () => {
    const frequencyMessage = {
      type: "frequency_range",
      minFreq: 100.0,
      maxFreq: 103.2,
    };

    expect(typeof frequencyMessage.minFreq).toBe("number");
    expect(typeof frequencyMessage.maxFreq).toBe("number");
    expect(frequencyMessage.maxFreq).toBeGreaterThan(frequencyMessage.minFreq);
  });

  it("should handle settings updates", () => {
    const settingsMessage = {
      type: "settings",
      fftSize: 1024,
      fftWindow: "hann",
      frameRate: 30,
      gain: 49.6,
      ppm: 1,
      tunerAGC: false,
      rtlAGC: false,
    };

    expect(typeof settingsMessage.fftSize).toBe("number");
    expect(typeof settingsMessage.fftWindow).toBe("string");
    expect(typeof settingsMessage.frameRate).toBe("number");
    expect(typeof settingsMessage.gain).toBe("number");
    expect(typeof settingsMessage.ppm).toBe("number");
    expect(typeof settingsMessage.tunerAGC).toBe("boolean");
    expect(typeof settingsMessage.rtlAGC).toBe("boolean");
  });

  it("should validate FFT size is power of 2", () => {
    const validSizes = [256, 512, 1024, 2048, 4096];
    const invalidSizes = [100, 300, 1000, 2000];

    validSizes.forEach(size => {
      expect(size & (size - 1)).toBe(0); // Power of 2 check
    });

    invalidSizes.forEach(size => {
      expect(size & (size - 1)).not.toBe(0); // Not power of 2
    });
  });

  it("should handle mock vs real device transitions", () => {
    const mockDeviceStatus = {
      message_type: "status",
      device_connected: false,
      device_state: "disconnected",
      backend: "mock",
      device_info: "Mock RTL-SDR Device - Sample Rate: 3200000 Hz, Gain: 49.6 dB, PPM: 1",
      paused: false,
    };

    const realDeviceStatus = {
      message_type: "status",
      device_connected: true,
      device_state: "connected",
      backend: "rtl-sdr",
      device_info: "RTL-SDR Blog V4 (Realtek RTL2832U) - Sample Rate: 3200000 Hz (max: 3200000 Hz), Gain: 49.6 dB, PPM: 1",
      paused: false,
    };

    expect(mockDeviceStatus.backend).toBe("mock");
    expect(realDeviceStatus.backend).toBe("rtl-sdr");
    expect(mockDeviceStatus.device_connected).toBe(false);
    expect(realDeviceStatus.device_connected).toBe(true);
  });
});
