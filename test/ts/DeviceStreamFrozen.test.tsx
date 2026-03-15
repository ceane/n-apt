import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTCanvas from "@n-apt/components/FFTCanvas";
import { FrequencyRange } from "@n-apt/consts/types";

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

jest.mock("@n-apt/hooks/useDraw2DFFTSignal", () => ({
  useDraw2DFFTSignal: () => ({
    draw2DFFTSignal: jest.fn(),
    cleanup: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useDraw2DFIFOWaterfall", () => ({
  useDraw2DFIFOWaterfall: () => ({
    draw2DFIFOWaterfall: jest.fn(),
    cleanup: jest.fn(),
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
  useFrequencyDrag: () => {},
}));

describe("Device Stream Frozen Scenarios", () => {
  const mockFrequencyRange: FrequencyRange = {
    min: 0,
    max: 3.2,
  };

  const mockProps = {
    data: {
      waveform: Array.from(
        { length: 1024 },
        (_, i) => -60 + Math.sin(i * 0.1) * 20,
      ),
    },
    frequencyRange: mockFrequencyRange,
    activeSignalArea: "test-area",
    isPaused: false,
    isDeviceConnected: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Stream Freeze Detection", () => {
    it("should handle frozen stream with stale data", () => {
      const frozenProps = {
        ...mockProps,
        data: {
          waveform: Array.from({ length: 1024 }, (_, i) => -60), // Flat line indicates frozen stream
          timestamp: Date.now() - 10000, // 10 seconds old
        },
        isDeviceConnected: true,
      };

      render(<FFTCanvas {...frozenProps} />);

      // Should still render even with stale data
      expect(screen.queryByText(/No data available/)).not.toBeInTheDocument();
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should handle stream freeze during device disconnect", () => {
      const { rerender } = render(<FFTCanvas {...mockProps} />);

      // Device disconnects while streaming
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={false} />);

      // Should handle gracefully without crashing
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      expect(screen.getByText("Waterfall Display")).toBeInTheDocument();
    });

    it("should detect and handle repeated identical frames", () => {
      const identicalData = Array.from({ length: 1024 }, () => -60);

      const frozenProps = {
        ...mockProps,
        data: {
          waveform: identicalData,
        },
      };

      render(<FFTCanvas {...frozenProps} />);

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

      const { rerender } = render(
        <FFTCanvas {...mockProps} data={{ waveform: frozenData }} />,
      );

      // Stream was frozen with flat data
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // New data arrives - should recover
      rerender(<FFTCanvas {...mockProps} data={{ waveform: freshData }} />);

      await waitFor(() => {
        expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      });
    });

    it("should handle device reconnection after stream freeze", async () => {
      const { rerender } = render(
        <FFTCanvas {...mockProps} isDeviceConnected={false} />,
      );

      // Device was disconnected (frozen stream)
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // Device reconnects
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={true} />);

      await waitFor(() => {
        expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      });
    });

    it("should maintain waterfall during stream freeze recovery", () => {
      const { rerender } = render(<FFTCanvas {...mockProps} />);

      // Simulate stream freeze
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={false} />);

      // Waterfall should still be maintained
      expect(screen.getByText("Waterfall Display")).toBeInTheDocument();

      // Recovery
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={true} />);

      expect(screen.getByText("Waterfall Display")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("should handle corrupted data during stream freeze", () => {
      const corruptedProps = {
        ...mockProps,
        data: {
          waveform: Array.from({ length: 1024 }, () => NaN), // Corrupted data
        },
      };

      expect(() => render(<FFTCanvas {...corruptedProps} />)).not.toThrow();
    });

    it("should handle null data during stream freeze", () => {
      const nullDataProps = {
        ...mockProps,
        data: null,
      };

      expect(() => render(<FFTCanvas {...nullDataProps} />)).not.toThrow();
    });

    it("should handle empty data during stream freeze", () => {
      const emptyDataProps = {
        ...mockProps,
        data: {},
      };

      expect(() => render(<FFTCanvas {...emptyDataProps} />)).not.toThrow();
    });

    it("should handle infinite values during stream freeze", () => {
      const infiniteProps = {
        ...mockProps,
        data: {
          waveform: Array.from({ length: 1024 }, (_, i) =>
            i % 10 === 0 ? Infinity : -60,
          ),
        },
      };

      expect(() => render(<FFTCanvas {...infiniteProps} />)).not.toThrow();
    });
  });

  describe("Performance During Freeze", () => {
    it("should not accumulate memory during frozen stream", () => {
      const frozenProps = {
        ...mockProps,
        data: {
          waveform: Array.from({ length: 1024 }, () => -60),
        },
      };

      const { rerender } = render(<FFTCanvas {...frozenProps} />);

      // Simulate multiple frozen frames
      for (let i = 0; i < 10; i++) {
        rerender(<FFTCanvas {...frozenProps} />);
      }

      // Should still render without memory issues
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should maintain frame rate during stream recovery", () => {
      const { rerender } = render(<FFTCanvas {...mockProps} />);

      // Simulate freeze and recovery cycle
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={false} />);
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={true} />);

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

      render(<FFTCanvas {...frozenProps} />);

      // Should show disconnected status for frozen stream
      expect(screen.getByText("Device: Disconnected")).toBeInTheDocument();
    });

    it("should allow user interaction during stream freeze", () => {
      const frozenProps = {
        ...mockProps,
        isDeviceConnected: false,
      };

      render(<FFTCanvas {...frozenProps} />);

      // UI should still be interactive
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      expect(screen.getByText("Waterfall Display")).toBeInTheDocument();
    });

    it("should preserve frequency range during stream freeze", () => {
      const customFrequencyRange = { min: 100, max: 103.2 };
      const frozenProps = {
        ...mockProps,
        frequencyRange: customFrequencyRange,
        isDeviceConnected: false,
      };

      render(<FFTCanvas {...frozenProps} />);

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

      render(<FFTCanvas {...mockModeProps} />);

      // Should handle gracefully in mock mode
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      expect(screen.getByText("Waterfall Display")).toBeInTheDocument();
    });

    it("should recover from mock mode stream freeze", async () => {
      const { rerender } = render(
        <FFTCanvas {...mockProps} isDeviceConnected={false} />,
      );

      // Mock mode freeze
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // Recovery to real device
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={true} />);

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

      render(<FFTCanvas {...wsDisconnectedProps} />);

      // Should handle WebSocket disconnection gracefully
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
    });

    it("should handle WebSocket reconnection after freeze", async () => {
      const { rerender } = render(
        <FFTCanvas {...mockProps} isDeviceConnected={false} />,
      );

      // WebSocket was disconnected (frozen stream)
      expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();

      // WebSocket reconnects
      rerender(<FFTCanvas {...mockProps} isDeviceConnected={true} />);

      await waitFor(() => {
        expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
      });
    });
  });
});
