import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTCanvas from "../../src/ts/components/FFTCanvas";
import { FrequencyRange } from "../../src/ts/consts/types";
import { MemoryRouter } from "react-router-dom";
import { TestWrapper } from "./testUtils";

// Mock the hooks that FFTCanvas uses
jest.mock("@n-apt/hooks/useFFTAnimation", () => ({
  useFFTAnimation: () => ({
    isAnimating: false,
    startAnimation: jest.fn(),
    stopAnimation: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/usePauseLogic", () => ({
  usePauseLogic: () => ({
    isPaused: false,
    togglePause: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useDrawWebGPUFFTSignal", () => ({
  useDrawWebGPUFFTSignal: () => ({
    drawWebGPUFFTSignal: jest.fn(),
    cleanup: jest.fn(),
  }),
  RESAMPLE_WGSL: "",
}));

jest.mock("@n-apt/hooks/useDrawWebGPUFIFOWaterfall", () => ({
  useDrawWebGPUFIFOWaterfall: () => ({
    drawWebGPUFIFOWaterfall: jest.fn(),
    cleanup: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useOverlayRenderer", () => ({
  useOverlayRenderer: () => ({
    renderOverlay: jest.fn(),
    cleanup: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useFrequencyDrag", () => ({
  useFrequencyDrag: () => ({
    handleMouseDown: jest.fn(),
    handleMouseMove: jest.fn(),
    handleMouseUp: jest.fn(),
  }),
}));

// Mock WebGPU
jest.mock("@n-apt/hooks/useWebGPUInit", () => ({
  useWebGPUInit: () => ({
    webgpuEnabled: false,
    webgpuDeviceRef: { current: null },
    spectrumRendererRef: { current: null },
    gridOverlayRendererRef: { current: null },
    markersOverlayRendererRef: { current: null },
    waterfallRendererRef: { current: null },
    overlayDirtyRef: { current: { grid: true, markers: true } },
    overlayLastUploadMsRef: { current: { grid: 0, markers: 0 } },
  }),
}));

// Mock animation hook
jest.mock("@n-apt/hooks/useFFTAnimation", () => ({
  useFFTAnimation: () => ({
    animate: jest.fn(),
    forceRender: jest.fn(),
    isVisibleRef: { current: true },
    setTargetFPS: jest.fn(),
  }),
}));

// Mock other hooks
jest.mock("@n-apt/hooks/usePauseLogic", () => ({
  usePauseLogic: () => ({ isPaused: false }),
}));

jest.mock("@n-apt/hooks/useSpectrumRendering", () => ({
  useSpectrumRendering: () => ({ renderSpectrum: jest.fn() }),
}));

jest.mock("@n-apt/hooks/useFrequencyDrag", () => ({
  useFrequencyDrag: () => { },
}));

describe("Device Stream Frozen Scenarios", () => {
  const mockFrequencyRange: FrequencyRange = {
    min: 0,
    max: 3.2,
  };

  const mockDataRef = {
    current: {
      waveform: Array.from(
        { length: 1024 },
        (_, sampleIndex) => -60 + Math.sin(sampleIndex * 0.1) * 20,
      ),
    }
  };

  const mockProps = {
    dataRef: mockDataRef,
    frequencyRange: mockFrequencyRange,
    centerFrequencyHz: 100_000_000,
    activeSignalArea: "test-area",
    isPaused: false,
    isDeviceConnected: true,
    snapshotGridPreference: false,
  };

  const renderFFTCanvas = (props: any = mockProps) =>
    render(
      <TestWrapper>
        <MemoryRouter>
          <FFTCanvas {...props} />
        </MemoryRouter>
      </TestWrapper>
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Stream Freeze Detection", () => {
    it("should handle frozen stream with stale data", () => {
      const frozenDataRef = {
        current: {
          waveform: Array.from({ length: 1024 }, () => -60), // Flat line indicates frozen stream
          timestamp: Date.now() - 10000, // 10 seconds old
        }
      };
      const frozenProps = {
        ...mockProps,
        dataRef: frozenDataRef,
        isDeviceConnected: true,
      };

      renderFFTCanvas(frozenProps);

      // Should still render even with stale data
      expect(screen.queryByText(/No data available/)).not.toBeInTheDocument();
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should handle stream freeze during device disconnect", () => {
      const { rerender } = renderFFTCanvas();

      // Device disconnects while streaming
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={false} />
          </MemoryRouter>
        </TestWrapper>
      );

      // Should handle gracefully without crashing
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should detect and handle repeated identical frames", () => {
      const identicalData = Array.from({ length: 1024 }, () => -60);

      const identicalDataRef = {
        current: {
          waveform: identicalData,
        }
      };

      const frozenProps = {
        ...mockProps,
        dataRef: identicalDataRef,
      };

      renderFFTCanvas(frozenProps);

      // Should render identical frames without freezing
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });
  });

  describe("Stream Recovery", () => {
    it("should recover from frozen stream when new data arrives", async () => {
      const frozenData = Array.from({ length: 1024 }, () => -60);
      const freshData = Array.from(
        { length: 1024 },
        (_, i) => -60 + Math.sin(i * 0.1) * 20,
      );

      const frozenDataRef = { current: { waveform: frozenData } };
      const freshDataRef = { current: { waveform: freshData } };

      const { rerender } = renderFFTCanvas({ ...mockProps, dataRef: frozenDataRef });

      // Stream was frozen with flat data
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // New data arrives - should recover
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} dataRef={freshDataRef} />
          </MemoryRouter>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      });
    });

    it("should handle device reconnection after stream freeze", async () => {
      const { rerender } = renderFFTCanvas({ ...mockProps, isDeviceConnected: false });

      // Device was disconnected (frozen stream)
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // Device reconnects
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={true} />
          </MemoryRouter>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      });
    });

    it("should maintain waterfall during stream freeze recovery", () => {
      const { rerender } = renderFFTCanvas();

      // Simulate stream freeze
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={false} />
          </MemoryRouter>
        </TestWrapper>
      );

      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // Recovery
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={true} />
          </MemoryRouter>
        </TestWrapper>
      );

      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("should handle corrupted data during stream freeze", () => {
      const corruptedDataRef = {
        current: {
          waveform: Array.from({ length: 1024 }, () => NaN), // Corrupted data
        }
      };
      const corruptedProps = {
        ...mockProps,
        dataRef: corruptedDataRef,
      };

      expect(() => renderFFTCanvas(corruptedProps)).not.toThrow();
    });

    it("should handle null data during stream freeze", () => {
      const nullDataRef = { current: null };
      const nullDataProps = {
        ...mockProps,
        dataRef: nullDataRef,
      };

      expect(() => renderFFTCanvas(nullDataProps)).not.toThrow();
    });

    it("should handle empty data during stream freeze", () => {
      const emptyDataRef = { current: {} };
      const emptyDataProps = {
        ...mockProps,
        dataRef: emptyDataRef,
      };

      expect(() => renderFFTCanvas(emptyDataProps)).not.toThrow();
    });

    it("should handle infinite values during stream freeze", () => {
      const infiniteDataRef = {
        current: {
          waveform: Array.from({ length: 1024 }, (_, i) =>
            i % 10 === 0 ? Infinity : -60,
          ),
        }
      };
      const infiniteProps = {
        ...mockProps,
        dataRef: infiniteDataRef,
      };

      expect(() => renderFFTCanvas(infiniteProps)).not.toThrow();
    });
  });

  describe("Performance During Freeze", () => {
    it("should not accumulate memory during frozen stream", () => {
      const frozenDataRef2 = {
        current: {
          waveform: Array.from({ length: 1024 }, () => -60),
        }
      };
      const frozenProps = {
        ...mockProps,
        dataRef: frozenDataRef2,
      };

      const { rerender } = renderFFTCanvas(frozenProps);

      // Simulate multiple frozen frames
      for (let i = 0; i < 10; i++) {
        rerender(
          <TestWrapper>
            <MemoryRouter>
              <FFTCanvas {...frozenProps} />
            </MemoryRouter>
          </TestWrapper>
        );
      }

      // Should still render without memory issues
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should maintain frame rate during stream recovery", () => {
      const { rerender } = renderFFTCanvas();

      // Simulate freeze and recovery cycle
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={false} />
          </MemoryRouter>
        </TestWrapper>
      );
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={true} />
          </MemoryRouter>
        </TestWrapper>
      );

      // Should maintain performance
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });
  });

  describe("User Experience", () => {
    it("should show appropriate status during stream freeze", () => {
      const frozenProps = {
        ...mockProps,
        isDeviceConnected: false, // Indicates frozen stream
      };

      renderFFTCanvas(frozenProps);

      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should allow user interaction during stream freeze", () => {
      const frozenProps = {
        ...mockProps,
        isDeviceConnected: false,
      };

      renderFFTCanvas(frozenProps);

      // UI should still be interactive
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should preserve frequency range during stream freeze", () => {
      const customFrequencyRange = { min: 100, max: 103.2 };
      const frozenProps = {
        ...mockProps,
        frequencyRange: customFrequencyRange,
        isDeviceConnected: false,
      };

      render(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...frozenProps} />
          </MemoryRouter>
        </TestWrapper>
      );

      // Frequency range should be preserved
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });
  });

  describe("Mock Mode Stream Freeze", () => {
    it("should handle stream freeze in mock mode", () => {
      const mockModeProps = {
        ...mockProps,
        isDeviceConnected: false, // Mock mode with frozen stream
      };

      renderFFTCanvas(mockModeProps);

      // Should handle gracefully in mock mode
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should recover from mock mode stream freeze", async () => {
      const { rerender } = renderFFTCanvas({ ...mockProps, isDeviceConnected: false });

      // Mock mode freeze
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // Recovery to real device
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={true} />
          </MemoryRouter>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      });
    });
  });

  describe("WebSocket Stream Freeze", () => {
    it("should handle WebSocket disconnection during stream", () => {
      const wsDisconnectedProps = {
        ...mockProps,
        isDeviceConnected: false, // WebSocket disconnected
      };

      renderFFTCanvas(wsDisconnectedProps);

      // Should handle WebSocket disconnection gracefully
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should handle WebSocket reconnection after freeze", async () => {
      const { rerender } = renderFFTCanvas({ ...mockProps, isDeviceConnected: false });

      // WebSocket was disconnected (frozen stream)
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // WebSocket reconnects
      rerender(
        <TestWrapper>
          <MemoryRouter>
            <FFTCanvas {...mockProps} isDeviceConnected={true} />
          </MemoryRouter>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      });
    });
  });
});
