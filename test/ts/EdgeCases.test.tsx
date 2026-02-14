import * as React from "react"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import "@testing-library/jest-dom"

// Import mocked components
import AuthenticationPrompt from "@n-apt/components/AuthenticationPrompt"
import FFTCanvas from "@n-apt/components/FFTCanvas"
import FFTStitcherCanvas from "@n-apt/components/FFTStitcherCanvas"
import { FileWorkerManager } from "@n-apt/workers/fileWorkerManager"
import { useWebSocket } from "@n-apt/hooks/useWebSocket"

describe("Comprehensive Edge Cases", () => {
  describe("Authentication Edge Cases", () => {
    it("should handle rapid auth state changes", async () => {
      const mockSubmit = jest.fn()
      const { rerender } = render(
        <AuthenticationPrompt 
          authState="ready" 
          error={null}
          hasPasskeys={true}
          onPasswordSubmit={mockSubmit}
          onPasskeyAuth={jest.fn()}
          onRegisterPasskey={jest.fn()}
        />
      )

      // Rapid state changes
      const states = ["connecting", "ready", "authenticating", "failed", "timeout", "ready"] as const
      
      for (const state of states) {
        rerender(
          <AuthenticationPrompt 
            authState={state} 
            error={state === "failed" ? "Test error" : null}
            hasPasskeys={true}
            onPasswordSubmit={mockSubmit}
            onPasskeyAuth={jest.fn()}
            onRegisterPasskey={jest.fn()}
          />
        )
        expect(screen.getByTestId("authentication-prompt")).toBeInTheDocument()
      }
    })

    it("should handle concurrent auth attempts", async () => {
      const mockSubmit = jest.fn()
      const mockPasskey = jest.fn()
      
      render(
        <AuthenticationPrompt 
          authState="ready" 
          error={null}
          hasPasskeys={true}
          onPasswordSubmit={mockSubmit}
          onPasskeyAuth={mockPasskey}
          onRegisterPasskey={jest.fn()}
        />
      )

      // Simulate concurrent attempts
      fireEvent.click(screen.getByRole("button", { name: /Sign in with Passkey/ }))
      fireEvent.click(screen.getByText("Use password instead"))
      
      // Should handle gracefully without crashing
      expect(mockPasskey).toHaveBeenCalled()
      expect(screen.getByRole("textbox", { name: /Password/ })).toBeInTheDocument()
    })

    it("should handle malformed error states", () => {
      render(
        <AuthenticationPrompt 
          authState="failed" 
          error={null}
          hasPasskeys={false}
          onPasswordSubmit={jest.fn()}
          onPasskeyAuth={jest.fn()}
          onRegisterPasskey={jest.fn()}
        />
      )

      // Should handle null error gracefully
      expect(screen.getByTestId("authentication-prompt")).toBeInTheDocument()
      expect(screen.queryByText(/Authentication failed/)).not.toBeInTheDocument()
    })

    it("should handle extremely long passwords", async () => {
      const mockSubmit = jest.fn()
      
      render(
        <AuthenticationPrompt 
          authState="ready" 
          error={null}
          hasPasskeys={false}
          onPasswordSubmit={mockSubmit}
          onPasskeyAuth={jest.fn()}
          onRegisterPasskey={jest.fn()}
        />
      )

      const longPassword = "a".repeat(1000)
      const passwordInput = screen.getByRole("textbox", { name: /Password/ }) as HTMLInputElement
      
      // Use direct value assignment for very long passwords
      passwordInput.value = longPassword
      
      const submitButton = screen.getByRole("button", { name: /Authenticate/ })
      fireEvent.click(submitButton)
      
      expect(mockSubmit).toHaveBeenCalledWith(longPassword)
    })
  })

  describe("FFT Canvas Edge Cases", () => {
    it("should handle extreme frequency ranges", () => {
      render(
        <FFTCanvas
          data={{ waveform: new Float32Array(1024) }}
          frequencyRange={{ min: -1000, max: 10000 }}
          centerFrequencyMHz={1.6}
          activeSignalArea="A"
          isPaused={false}
        />
      )

      expect(screen.getByTestId("fft-canvas")).toBeInTheDocument()
      expect(screen.getByTestId("canvas-status")).toBeInTheDocument()
    })

    it("should handle corrupted waveform data", () => {
      const corruptedData = {
        waveform: new Float32Array(1024).fill(Infinity),
        timestamp: Date.now()
      }
      
      render(
        <FFTCanvas
          data={corruptedData}
          frequencyRange={{ min: 0, max: 3.2 }}
          centerFrequencyMHz={1.6}
          activeSignalArea="A"
          isPaused={false}
        />
      )

      expect(screen.getByTestId("fft-canvas")).toBeInTheDocument()
    })

    it("should handle rapid data updates", () => {
      const { rerender } = render(
        <FFTCanvas
          data={{ waveform: new Float32Array(1024) }}
          frequencyRange={{ min: 0, max: 3.2 }}
          centerFrequencyMHz={1.6}
          activeSignalArea="A"
          isPaused={false}
        />
      )

      // Rapid data updates
      for (let i = 0; i < 100; i++) {
        const newData = {
          waveform: new Float32Array(1024).fill(i),
          timestamp: Date.now() + i
        }
        rerender(
          <FFTCanvas
            data={newData}
            frequencyRange={{ min: 0, max: 3.2 }}
            centerFrequencyMHz={1.6}
            activeSignalArea="A"
            isPaused={false}
          />
        )
      }

      expect(screen.getByTestId("fft-canvas")).toBeInTheDocument()
    })

    it("should handle device disconnection during rendering", () => {
      const { rerender } = render(
        <FFTCanvas
          data={{ waveform: new Float32Array(1024) }}
          frequencyRange={{ min: 0, max: 3.2 }}
          centerFrequencyMHz={1.6}
          activeSignalArea="A"
          isPaused={false}
          isDeviceConnected={true}
        />
      )

      // Disconnect device
      rerender(
        <FFTCanvas
          data={{ waveform: new Float32Array(1024) }}
          frequencyRange={{ min: 0, max: 3.2 }}
          centerFrequencyMHz={1.6}
          activeSignalArea="A"
          isPaused={false}
          isDeviceConnected={false}
        />
      )

      expect(screen.getByTestId("canvas-status")).toBeInTheDocument()
    })
  })

  describe("File Worker Edge Cases", () => {
    it("should handle concurrent file loading", async () => {
      const manager = new FileWorkerManager()
      const files = Array.from({ length: 10 }, (_, i) => 
        new File([new ArrayBuffer(1024)], `test${i}.c64`)
      )

      const promises = files.map(file => manager.loadFile(file))
      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      results.forEach((result, index) => {
        expect(result.name).toBe(`test${index}.c64`)
      })

      manager.terminate()
    })

    it("should handle file loading interruption", async () => {
      const manager = new FileWorkerManager()
      const file = new File([new ArrayBuffer(1024)], "test.c64")

      const promise = manager.loadFile(file)
      
      // Terminate during loading
      setTimeout(() => manager.terminate(), 50)

      await expect(promise).rejects.toThrow("Worker terminated")
    })

    it("should handle memory pressure scenarios", async () => {
      const manager = new FileWorkerManager()
      const largeFile = new File([new ArrayBuffer(50 * 1024 * 1024)], "large.c64")

      // Should handle large files within limits
      const result = await manager.loadFile(largeFile)
      expect(result.name).toBe("large.c64")

      // Test file too large
      const tooLargeFile = new File([new ArrayBuffer(200 * 1024 * 1024)], "toolarge.c64")
      await expect(manager.loadFile(tooLargeFile)).rejects.toThrow("File too large")

      manager.terminate()
    })

    it("should handle frame building with invalid data", async () => {
      const manager = new FileWorkerManager()
      
      // Invalid frame number
      await expect(manager.buildFrame(-1, new Map(), new Map())).rejects.toThrow("Invalid frame number")
      
      // No file data
      await expect(manager.buildFrame(0, new Map(), new Map())).rejects.toThrow("No file data available")

      manager.terminate()
    })

    it("should handle worker crash recovery", async () => {
      const manager = new FileWorkerManager()
      const file = new File([new ArrayBuffer(1024)], "test.c64")

      // Simulate crash
      manager.simulateError('crash')

      // Should handle subsequent requests gracefully
      await expect(manager.loadFile(file)).rejects.toThrow("Worker terminated")
    })
  })

  describe("WebSocket Edge Cases", () => {
    it("should handle connection during rapid state changes", () => {
      const { result, rerender } = renderHook(() => 
        useWebSocket("ws://test", null, true)
      )

      // Rapid enable/disable
      rerender(() => useWebSocket("ws://test", null, false))
      rerender(() => useWebSocket("ws://test", null, true))
      rerender(() => useWebSocket(null, null, true))

      expect(result.current.isConnected).toBe(false)
    })

    it("should handle message sending when disconnected", () => {
      const { result } = renderHook(() => 
        useWebSocket(null, null, true) // Disabled
      )

      // Should handle gracefully
      act(() => {
        result.current.sendFrequencyRange({ min: 0, max: 3.2 })
      })
      
      expect(result.current.error).toBe("Not connected")
    })

    it("should handle malformed settings", () => {
      const { result } = renderHook(() => 
        useWebSocket("ws://test", null, true)
      )

      // Wait for connection
      waitFor(() => expect(result.current.isConnected).toBe(true))

      // Send malformed settings
      act(() => {
        result.current.sendSettings({
          fftSize: -1, // Invalid
          gain: Infinity // Invalid
        })
      })

      // Should handle gracefully
      expect(result.current.error).toBeNull()
    })

    it("should handle rapid command sending", () => {
      const { result } = renderHook(() => 
        useWebSocket("ws://test", null, true)
      )

      // Wait for connection
      waitFor(() => expect(result.current.isConnected).toBe(true))

      // Rapid commands
      act(() => {
        for (let i = 0; i < 100; i++) {
          result.current.sendFrequencyRange({ min: i, max: i + 1 })
          result.current.sendPauseCommand(i % 2 === 0)
          result.current.sendSettings({ fftSize: 1024 + i })
        }
      })

      // Should handle gracefully
      expect(result.current.isConnected).toBe(true)
    })
  })

  describe("Memory and Performance Edge Cases", () => {
    it("should handle memory leak scenarios", () => {
      const { unmount } = render(
        <FFTCanvas
          data={{ waveform: new Float32Array(1024) }}
          frequencyRange={{ min: 0, max: 3.2 }}
          centerFrequencyMHz={1.6}
          activeSignalArea="A"
          isPaused={false}
        />
      )

      // Simulate memory pressure
      const largeData = {
        waveform: new Float32Array(1000000).fill(-60), // Large array
        timestamp: Date.now()
      }

      // Should handle without crashing
      expect(() => {
        for (let i = 0; i < 100; i++) {
          unmount()
          render(
            <FFTCanvas
              data={largeData}
              frequencyRange={{ min: 0, max: 3.2 }}
              centerFrequencyMHz={1.6}
              activeSignalArea="A"
              isPaused={false}
            />
          )
        }
      }).not.toThrow()
    })

    it("should handle CPU intensive operations", async () => {
      const manager = new FileWorkerManager()
      const files = Array.from({ length: 50 }, (_, i) => 
        new File([new ArrayBuffer(1024 * 1024)], `large${i}.c64`)
      )

      // Should handle concurrent large file processing
      const startTime = performance.now()
      const promises = files.map(file => manager.loadFile(file))
      await Promise.all(promises)
      const endTime = performance.now()

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(10000) // 10 seconds

      manager.terminate()
    })
  })

  describe("Network and I/O Edge Cases", () => {
    it("should handle network timeouts", async () => {
      const manager = new FileWorkerManager()
      const file = new File([new ArrayBuffer(1024)], "test.c64")

      // Simulate timeout before loading
      manager.simulateError('timeout')
      
      // Should reject immediately due to timeout
      await expect(manager.loadFile(file)).rejects.toThrow("Worker request timed out")
    })

    it("should handle file system errors", async () => {
      const manager = new FileWorkerManager()

      // Test various file system error scenarios
      const testCases = [
        { file: null, expectedError: "Invalid file" },
        { file: new File([], "empty.c64"), expectedError: "Empty file" },
      ]

      for (const testCase of testCases) {
        await expect(manager.loadFile(testCase.file as any)).rejects.toThrow(testCase.expectedError)
      }

      manager.terminate()
    })

    it("should handle corrupted file data", async () => {
      const manager = new FileWorkerManager()
      const corruptedFile = new File([new ArrayBuffer(1024)], "corrupted.c64")

      // Should handle corrupted data gracefully
      const result = await manager.loadFile(corruptedFile)
      expect(result.name).toBe("corrupted.c64")
      expect(result.data).toBeInstanceOf(ArrayBuffer)

      manager.terminate()
    })
  })

  describe("Security Edge Cases", () => {
    it("should handle malicious input", async () => {
      const mockSubmit = jest.fn()
      
      render(
        <AuthenticationPrompt 
          authState="ready" 
          error={null}
          hasPasskeys={false}
          onPasswordSubmit={mockSubmit}
          onPasskeyAuth={jest.fn()}
          onRegisterPasskey={jest.fn()}
        />
      )

      const maliciousInputs = [
        "<script>alert('xss')</script>",
        "'; DROP TABLE users; --",
        "\x00\x01\x02\x03",
        "a".repeat(100) // Shorter for testing
      ]

      maliciousInputs.forEach(input => {
        const passwordInput = screen.getByRole("textbox", { name: /Password/ }) as HTMLInputElement
        
        // Use direct value assignment for complex inputs
        passwordInput.value = input
        
        const submitButton = screen.getByRole("button", { name: /Authenticate/ })
        fireEvent.click(submitButton)
        
        expect(mockSubmit).toHaveBeenCalledWith(input)
      })
    })

    it("should handle concurrent authentication attempts", async () => {
      const mockSubmit = jest.fn()
      const mockPasskey = jest.fn()
      
      render(
        <AuthenticationPrompt 
          authState="ready" 
          error={null}
          hasPasskeys={false} // Start with password form
          onPasswordSubmit={mockSubmit}
          onPasskeyAuth={mockPasskey}
          onRegisterPasskey={jest.fn()}
        />
      )

      // Simulate rapid concurrent attempts
      const passwordInput = screen.getByRole("textbox", { name: /Password/ }) as HTMLInputElement
      
      // Multiple rapid submissions
      for (let i = 0; i < 10; i++) {
        passwordInput.value = `password${i}`
        
        const submitButton = screen.getByRole("button", { name: /Authenticate/ })
        fireEvent.click(submitButton)
        
        // Small delay to allow React to process
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 1))
        })
      }

      fireEvent.click(screen.getByRole("button", { name: /Register a passkey/ }))

      // Should handle gracefully
      expect(mockSubmit).toHaveBeenCalledTimes(10)
      expect(mockPasskey).toHaveBeenCalledTimes(1)
    })
  })
})
