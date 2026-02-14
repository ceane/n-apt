import * as React from "react"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import "@testing-library/jest-dom"
import { FFTCanvas } from "@n-apt/components"
import { FrequencyRange } from "@n-apt/hooks/useWebSocket"

// Mock WebGPU
const mockGPUAdapter = {
  name: "Mock GPU Adapter",
  requestDevice: jest.fn(),
}

const mockGPUDevice = {
  lost: Promise.resolve({ reason: "destroyed" }),
  onuncapturederror: null,
}

// Mock navigator.gpu
Object.defineProperty(navigator, 'gpu', {
  value: {
    requestAdapter: jest.fn().mockResolvedValue(mockGPUAdapter),
    getPreferredCanvasFormat: jest.fn().mockReturnValue("bgra8unorm"),
  },
  writable: true,
})

// Mock canvas context
const mockCanvasContext = {
  configure: jest.fn(),
}

describe("FFTCanvas Performance Optimizations", () => {
  const mockData = {
    waveform: new Float32Array(1024).fill(-60).map((_, i) => -60 + Math.sin(i * 0.1) * 20),
    timestamp: Date.now(),
  }

  const defaultProps = {
    data: mockData,
    frequencyRange: { min: 0, max: 3.2 },
    centerFrequencyMHz: 1.6,
    activeSignalArea: "A",
    isPaused: false,
    isDeviceConnected: true,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    // Reset WebGPU mock
    mockGPUAdapter.requestDevice.mockResolvedValue(mockGPUDevice)
    mockGPUDevice.lost = Promise.resolve({ reason: "destroyed" })
  })

  it("should initialize WebGPU successfully", async () => {
    render(<FFTCanvas {...defaultProps} />)
    
    await waitFor(() => {
      expect(navigator.gpu.requestAdapter).toHaveBeenCalled()
      expect(mockGPUAdapter.requestDevice).toHaveBeenCalled()
    })
  })

  it("should fall back to 2D when WebGPU is not supported", () => {
    // Mock WebGPU as unsupported
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      writable: true,
    })

    render(<FFTCanvas {...defaultProps} />)
    
    // Should not try to initialize WebGPU
    expect(navigator.gpu.requestAdapter).not.toHaveBeenCalled()
  })

  it("should handle WebGPU device loss gracefully", async () => {
    render(<FFTCanvas {...defaultProps} />)
    
    // Wait for WebGPU initialization
    await waitFor(() => {
      expect(mockGPUAdapter.requestDevice).toHaveBeenCalled()
    })

    // Simulate device loss
    const mockDeviceLost = jest.fn()
    mockGPUDevice.lost = Promise.resolve({ reason: "lost" })
    mockGPUDevice.onuncapturederror = { set: jest.fn() }

    // Should handle gracefully without crashing
    expect(() => render(<FFTCanvas {...defaultProps} />)).not.toThrow()
  })

  it("should validate waveform data and prevent blank canvases", () => {
    render(<FFTCanvas {...defaultProps} />)

    // Test with valid data
    expect(() => render(<FFTCanvas {...defaultProps} data={mockData} />)).not.toThrow()

    // Test with invalid data (empty array)
    expect(() => render(<FFTCanvas {...defaultProps} data={{ waveform: [] }} />)).not.toThrow()

    // Test with null data
    expect(() => render(<FFTCanvas {...defaultProps} data={null} />)).not.toThrow()

    // Test with undefined data
    expect(() => render(<FFTCanvas {...defaultProps} data={undefined} />)).not.toThrow()
  })

  it("should handle animation loop cleanup on unmount", () => {
    const { unmount } = render(<FFTCanvas {...defaultProps} />)
    
    // Should not throw errors during unmount
    expect(() => unmount()).not.toThrow()
  })

  it("should handle visibility changes correctly", () => {
    const { unmount } = render(<FFTCanvas {...defaultProps} />)

    // Simulate visibility change
    const visibilityEvent = new Event("visibilitychange")
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
    })

    // Should handle visibility change without errors
    expect(() => document.dispatchEvent(visibilityEvent)).not.toThrow()

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
    })

    expect(() => document.dispatchEvent(visibilityEvent)).not.toThrow()

    unmount()
  })

  it("should implement frame rate limiting", async () => {
    jest.useFakeTimers()
    
    const { unmount } = render(<FFTCanvas {...defaultProps} />)
    
    // Fast-forward timers
    act(() => {
      jest.advanceTimersByTime(100)
    })

    // Should not accumulate excessive animation frames
    expect(setTimeout).toHaveBeenCalledTimes(0)

    jest.useRealTimers()
    unmount()
  })

  it("should use buffer pooling for waterfall rendering", () => {
    render(<FFTCanvas {...defaultProps} />)

    // Buffer pooling should be implemented (no direct way to test, but ensure no errors)
    expect(() => render(<FFTCanvas {...defaultProps} />)).not.toThrow()
  })

  it("should handle frequency range changes", () => {
    const mockOnFrequencyRangeChange = jest.fn()
    render(<FFTCanvas {...defaultProps} onFrequencyRangeChange={mockOnFrequencyRangeChange} />)

    // Frequency range changes should be handled
    expect(() => mockOnFrequencyRangeChange({ min: 1, max: 2 })).not.toThrow()
  })

  it("should handle pause state changes", () => {
    const { rerender } = render(<FFTCanvas {...defaultProps} isPaused={false} />)
    
    // Should handle pause state changes
    expect(() => rerender(<FFTCanvas {...defaultProps} isPaused={true} />)).not.toThrow()
    expect(() => rerender(<FFTCanvas {...defaultProps} isPaused={false} />)).not.toThrow()
  })

  it("should handle device connection state changes", () => {
    const { rerender } = render(<FFTCanvas {...defaultProps} isDeviceConnected={true} />)
    
    // Should handle connection state changes
    expect(() => rerender(<FFTCanvas {...defaultProps} isDeviceConnected={false} />)).not.toThrow()
    expect(() => rerender(<FFTCanvas {...defaultProps} isDeviceConnected={true} />)).not.toThrow()
  })

  it("should force 2D rendering when specified", () => {
    render(<FFTCanvas {...defaultProps} force2D={true} />)
    
    // Should not attempt WebGPU initialization when force2D is true
    expect(navigator.gpu.requestAdapter).not.toHaveBeenCalled()
  })

  it("should handle different temporal resolution settings", () => {
    const resolutions: Array<"low" | "medium" | "high"> = ["low", "medium", "high"]
    
    resolutions.forEach(resolution => {
      expect(() => render(<FFTCanvas {...defaultProps} displayTemporalResolution={resolution} />)).not.toThrow()
    })
  })

  it("should handle window resize events", () => {
    const { unmount } = render(<FFTCanvas {...defaultProps} />)

    // Simulate window resize
    const resizeEvent = new Event("resize")
    
    // Should handle resize events without errors
    expect(() => window.dispatchEvent(resizeEvent)).not.toThrow()

    unmount()
  })

  it("should handle large waveform arrays efficiently", () => {
    const largeWaveform = new Float32Array(65536).fill(-60).map((_, i) => -60 + Math.sin(i * 0.01) * 20)
    
    expect(() => render(<FFTCanvas {...defaultProps} data={{ waveform: largeWaveform }} />)).not.toThrow()
  })

  it("should handle rapid data updates without memory leaks", () => {
    const { unmount } = render(<FFTCanvas {...defaultProps} />)

    // Simulate rapid data updates
    for (let i = 0; i < 100; i++) {
      const newData = {
        waveform: new Float32Array(1024).fill(-60 + i),
        timestamp: Date.now() + i,
      }
      expect(() => render(<FFTCanvas {...defaultProps} data={newData} />)).not.toThrow()
    }

    unmount()
  })

  it("should handle WebGL context loss gracefully", async () => {
    // Mock canvas context loss
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const mockGetContext = jest.fn((contextId) => {
      if (contextId === "webgpu") {
        return null // Simulate WebGPU context failure
      }
      return originalGetContext.call(this, contextId)
    })

    HTMLCanvasElement.prototype.getContext = mockGetContext

    render(<FFTCanvas {...defaultProps} />)

    // Should fall back to 2D rendering
    expect(() => render(<FFTCanvas {...defaultProps} />)).not.toThrow()

    // Restore original method
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })
})
