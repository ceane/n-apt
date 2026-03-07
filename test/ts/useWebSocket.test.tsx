import { renderHook } from "@testing-library/react";
import { useWebSocket } from "@n-apt/hooks/useWebSocket";

jest.unmock("@n-apt/hooks/useWebSocket");

// Mock WebSocket
const mockWebSocket = {
  readyState: WebSocket.CONNECTING,
  close: jest.fn(),
  send: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
};

// Mock WebSocket constructor
global.WebSocket = jest.fn(() => mockWebSocket) as any;

describe("useWebSocket Hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return expected structure", () => {
    const { result } = renderHook(() => useWebSocket("ws://test", null, true));

    // Check that all expected properties exist
    console.log("Keys in useWebSocket return:", Object.keys(result.current));
    expect(typeof result.current.isConnected).toBe("boolean");
    expect(typeof result.current.isPaused).toBe("boolean");
    expect(
      result.current.deviceState === null ||
      typeof result.current.deviceState === "string",
    ).toBe(true);
    expect(
      result.current.backend === null ||
      typeof result.current.backend === "string",
    ).toBe(true);
    expect(
      result.current.data === null || typeof result.current.data === "object",
    ).toBe(true);
    expect(
      result.current.error === null || typeof result.current.error === "string",
    ).toBe(true);
    expect(typeof result.current.sendFrequencyRange).toBe("function");
    expect(typeof result.current.sendPauseCommand).toBe("function");
    expect(typeof result.current.sendSettings).toBe("function");
    expect(typeof result.current.sendRestartDevice).toBe("function");
    expect(typeof result.current.sendTrainingCommand).toBe("function");
    expect(typeof result.current.sendCaptureCommand).toBe("function");
    expect(typeof result.current.sendGetAutoFftOptions).toBe("function");
    expect(result.current.dataRef).toBeDefined();
    expect(result.current.dataRef.current).toBeDefined();
  });

  it("should handle disabled state", () => {
    const { result } = renderHook(() => useWebSocket("ws://test", null, false));

    // When disabled, should not attempt connection
    expect(global.WebSocket).not.toHaveBeenCalled();
  });
});
