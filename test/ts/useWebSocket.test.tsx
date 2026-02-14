import { renderHook, act } from "@testing-library/react"
import { useWebSocket } from "@n-apt/hooks/useWebSocket"
import { React } from "react"

// Mock WebSocket
const mockWebSocket = {
  readyState: WebSocket.CONNECTING,
  close: jest.fn(),
  send: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}

// Mock WebSocket constructor
global.WebSocket = jest.fn(() => mockWebSocket) as any

describe("useWebSocket Hook", () => {
  const TestComponent: React.FC<{ url?: string; aesKey?: CryptoKey }> = ({ url = "ws://test", aesKey }) => {
    const result = useWebSocket(url, aesKey, true)
    return <div data-testid="websocket-result">{JSON.stringify(result)}</div>
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("should initialize with default values", () => {
    const { result } = renderHook(() => <TestComponent />)
    
    expect(result.current.isConnected).toBe(false)
    expect(result.current.deviceState).toBe(null)
    expect(result.current.isPaused).toBe(false)
    expect(result.current.backend).toBe(null)
    expect(result.current.data).toBe(null)
    expect(result.current.error).toBe(null)
  })

  it("should handle WebSocket connection", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    // Simulate WebSocket connection
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
    })
    
    expect(result.current.isConnected).toBe(true)
  })

  it("should handle WebSocket disconnection", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    // First connect
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
    })
    
    expect(result.current.isConnected).toBe(true)
    
    // Then disconnect
    act(() => {
      mockWebSocket.readyState = WebSocket.CLOSED
      const closeEvent = new Event("close")
      mockWebSocket.dispatchEvent(closeEvent)
    })
    
    expect(result.current.isConnected).toBe(false)
  })

  it("should handle message reception", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    const testData = { type: "test", data: "test data" }
    
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify(testData)
      })
      mockWebSocket.dispatchEvent(messageEvent)
    })
    
    expect(result.current.data).toEqual(testData)
  })

  it("should handle encrypted messages", async () => {
    const mockAesKey = { encrypt: jest.fn(), decrypt: jest.fn() }
    mockAesKey.decrypt.mockResolvedValue("decrypted data")
    
    const { result } = renderHook(() => <TestComponent aesKey={mockAesKey as any} />)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify({
          type: "encrypted_spectrum",
          payload: "encrypted payload"
        })
      })
      mockWebSocket.dispatchEvent(messageEvent)
    })
    
    expect(mockAesKey.decrypt).toHaveBeenCalledWith("encrypted payload", mockAesKey)
  })

  it("should handle frequency range changes", () => {
    const { result } = renderHook(() => <TestComponent />)
    
    const testRange = { min: 1, max: 2 }
    
    act(() => {
      result.current.sendFrequencyRange(testRange)
    })
    
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "frequency_range",
        minFreq: testRange.min,
        maxFreq: testRange.max
      })
    )
  })

  it("should handle pause commands", () => {
    const { result } = renderHook(() => <TestComponent />)
    
    act(() => {
      result.current.sendPauseCommand(true)
    })
    
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "pause",
        paused: true
      })
    )
  })

  it("should handle settings changes", () => {
    const { result } = renderHook(() => <TestComponent />)
    
    const testSettings = { fftSize: 32768, gain: 10 }
    
    act(() => {
      result.current.sendSettings(testSettings)
    })
    
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "settings",
        ...testSettings
      })
    )
  })

  it("should handle device restart", () => {
    const { result } = renderHook(() => <TestComponent />)
    
    act(() => {
      result.current.sendRestartDevice()
    })
    
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "restart_device"
      })
    )
  })

  it("should handle training commands", () => {
    const { result } = renderHook(() => <TestComponent />)
    
    act(() => {
      result.current.sendTrainingCommand("start", "target", "A")
    })
    
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "training_capture",
        action: "start",
        label: "target",
        signalArea: "A"
      })
    )
  })

  it("should handle status messages", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    const statusData = {
      message_type: "status",
      device_state: "connected",
      backend: "mock",
      paused: false
    }
    
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify(statusData)
      })
      mockWebSocket.dispatchEvent(messageEvent)
    })
    
    expect(result.current.deviceState).toBe("connected")
    expect(result.current.backend).toBe("mock")
    expect(result.current.isPaused).toBe(false)
  })

  it("should handle connection errors", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.CONNECTING
      const errorEvent = new Event("error")
      mockWebSocket.dispatchEvent(errorEvent)
    })
    
    expect(result.current.error).toBeTruthy()
  })

  it("should implement reconnection logic", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    // First connection attempt
    act(() => {
      mockWebSocket.readyState = WebSocket.CONNECTING
      const errorEvent = new Event("error")
      mockWebSocket.dispatchEvent(errorEvent)
    })
    
    expect(result.current.error).toBeTruthy()
    
    // Should attempt reconnection after delay
    jest.advanceTimersByTime(2000)
    
    expect(mockWebSocket.constructor).toHaveBeenCalledTimes(2)
  })

  it("should handle backoff schedule", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    // Multiple failures should increase backoff
    act(() => {
      mockWebSocket.readyState = WebSocket.CONNECTING
      const errorEvent = new Event("error")
      mockWebSocket.dispatchEvent(errorEvent)
    })
    
    jest.advanceTimersByTime(2000)
    expect(mockWebSocket.constructor).toHaveBeenCalledTimes(2)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.CONNECTING
      const errorEvent = new Event("error")
      mockWebSocket.dispatchEvent(errorEvent)
    })
    
    jest.advanceTimersByTime(5000)
    expect(mockWebSocket.constructor).toHaveBeenCalledTimes(3)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.CONNECTING
      const errorEvent = new Event("error")
      mockWebSocket.dispatchEvent(errorEvent)
    })
    
    jest.advanceTimersByTime(10000)
    expect(mockWebSocket.constructor).toHaveBeenCalledTimes(4)
  })

  it("should cleanup on unmount", () => {
    const { unmount } = renderHook(() => <TestComponent />)
    
    // Should close WebSocket connection
    unmount()
    
    expect(mockWebSocket.close).toHaveBeenCalled()
  })

  it("should handle rapid state changes", () => {
    const { result } = renderHook(() => <TestComponent />)
    
    // Rapid state changes
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
    })
    
    expect(result.current.isConnected).toBe(true)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.CLOSED
      const closeEvent = new Event("close")
      mockWebSocket.dispatchEvent(closeEvent)
    })
    
    expect(result.current.isConnected).toBe(false)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
    })
    
    expect(result.current.isConnected).toBe(true)
  })

  it("should handle message parsing errors gracefully", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
      
      // Send invalid JSON
      const messageEvent = new MessageEvent("message", {
        data: "invalid json"
      })
      mockWebSocket.dispatchEvent(messageEvent)
    })
    
    // Should not throw, just ignore invalid messages
    expect(result.current.data).toBe(null)
  })

  it("should handle decryption errors gracefully", async () => {
    const mockAesKey = { encrypt: jest.fn(), decrypt: jest.fn() }
    mockAesKey.decrypt.mockRejectedValue(new Error("Decryption failed"))
    
    const { result } = renderHook(() => <TestComponent aesKey={mockAesKey as any} />)
    
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify({
          type: "encrypted_spectrum",
          payload: "invalid payload"
        })
      })
      mockWebSocket.dispatchEvent(messageEvent)
    })
    
    // Should handle decryption error gracefully
    expect(result.current.data).toBe(null)
  })

  it("should handle disabled state", () => {
    const { result } = renderHook(() => <TestComponent url={null} aesKey={null} />)
    
    // Should not attempt connection when disabled
    expect(mockWebSocket.constructor).not.toHaveBeenCalled()
    expect(result.current.isConnected).toBe(false)
  })

  it("should handle large messages efficiently", async () => {
    const { result } = renderHook(() => <TestComponent />)
    
    const largeData = {
      type: "test",
      data: new Array(10000).fill("large data chunk").join("")
    }
    
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
      
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify(largeData)
      })
      mockWebSocket.dispatchEvent(messageEvent)
    })
    
    expect(result.current.data).toEqual(largeData)
  })

  it("should maintain connection state across re-renders", () => {
    const { result, rerender } = renderHook(() => <TestComponent />)
    
    // Connect
    act(() => {
      mockWebSocket.readyState = WebSocket.OPEN
      const openEvent = new Event("open")
      mockWebSocket.dispatchEvent(openEvent)
    })
    
    expect(result.current.isConnected).toBe(true)
    
    // Re-render should maintain state
    rerender(<TestComponent />)
    expect(result.current.isConnected).toBe(true)
  })
})
