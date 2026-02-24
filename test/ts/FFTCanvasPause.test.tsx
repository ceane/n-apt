import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTCanvas from "@n-apt/components/FFTCanvas";
import { FrequencyRange } from "@n-apt/fft/FFTCanvasRenderer";

// Mock the canvas renderers
jest.mock("@n-apt/fft/FFTCanvasRenderer", () => ({
  drawSpectrum: jest.fn(),
  drawSpectrumGrid: jest.fn(),
  drawSpectrumMarkers: jest.fn(),
  zoomFFT: jest.fn(),
  FrequencyRange: {} as any,
}));

jest.mock("@n-apt/waterfall/FIFOWaterfallRenderer", () => ({
  drawWaterfall: jest.fn(),
  createWaterfallLine: jest.fn(() => new ImageData(800, 1)),
  addWaterfallFrame: jest.fn(),
  spectrumToAmplitude: jest.fn((spectrum: number[]) => spectrum.map(() => 0)),
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

describe("FFTCanvas Pause Functionality", () => {
  const mockFrequencyRange: FrequencyRange = {
    min: 0,
    max: 3.2,
  };

  const mockProps = {
    data: {
      waveform: Array.from({ length: 1024 }, (_, i) => -60 + Math.sin(i * 0.1) * 20),
    },
    frequencyRange: mockFrequencyRange,
    activeSignalArea: "test-area",
    isPaused: false,
    isDeviceConnected: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render normally when not paused", () => {
    render(<FFTCanvas {...mockProps} />);

    expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();
  });

  it("should show paused status when isPaused is true", () => {
    const pausedProps = { ...mockProps, isPaused: true };

    render(<FFTCanvas {...pausedProps} />);

    expect(
      screen.getByText((content, element) => {
        return content.includes("FFT Signal Display") && content.includes("(Paused)");
      }),
    ).toBeInTheDocument();
  });

  it("should preserve last frame when paused with valid data", () => {
    const pausedProps = { ...mockProps, isPaused: true };

    render(<FFTCanvas {...pausedProps} />);

    // Should not show black screen - should have canvas elements
    expect(screen.queryByText(/No data available/)).not.toBeInTheDocument();
  });

  it("should handle pause state with null data gracefully", () => {
    const pausedProps = {
      ...mockProps,
      isPaused: true,
      data: null,
    };

    expect(() => render(<FFTCanvas {...pausedProps} />)).not.toThrow();
  });

  it("should handle pause state with disconnected device", () => {
    const pausedProps = {
      ...mockProps,
      isPaused: true,
      isDeviceConnected: false,
    };

    expect(() => render(<FFTCanvas {...pausedProps} />)).not.toThrow();
  });

  it("should handle pause state with mock backend", () => {
    const pausedProps = {
      ...mockProps,
      isPaused: true,
      isDeviceConnected: false,
    };

    render(<FFTCanvas {...pausedProps} />);

    // Should still render UI elements even in mock mode + paused
    expect(screen.getAllByText(/\(Paused\)/)).toHaveLength(2);
  });

  it("should transition from paused to unpaused correctly", async () => {
    const { rerender } = render(<FFTCanvas {...mockProps} isPaused={true} />);

    // Initially paused
    expect(screen.getAllByText(/\(Paused\)/)).toHaveLength(2);

    // Unpause
    rerender(<FFTCanvas {...mockProps} isPaused={false} />);

    await waitFor(() => {
      expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();
    });
  });

  it("should transition from unpaused to paused correctly", async () => {
    const { rerender } = render(<FFTCanvas {...mockProps} isPaused={false} />);

    // Initially not paused
    expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();

    // Pause
    rerender(<FFTCanvas {...mockProps} isPaused={true} />);

    await waitFor(() => {
      expect(screen.getAllByText(/\(Paused\)/)).toHaveLength(2);
    });
  });

  it("should handle rapid pause/unpause toggles", async () => {
    const { rerender } = render(<FFTCanvas {...mockProps} isPaused={false} />);

    // Rapid toggles
    rerender(<FFTCanvas {...mockProps} isPaused={true} />);
    rerender(<FFTCanvas {...mockProps} isPaused={false} />);
    rerender(<FFTCanvas {...mockProps} isPaused={true} />);
    rerender(<FFTCanvas {...mockProps} isPaused={false} />);

    await waitFor(() => {
      expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();
    });
  });

  it("should maintain waveform data during pause transitions", () => {
    const { rerender } = render(<FFTCanvas {...mockProps} isPaused={false} />);

    // Pause with data
    rerender(<FFTCanvas {...mockProps} isPaused={true} />);

    // Unpause - should still have data
    rerender(<FFTCanvas {...mockProps} isPaused={false} />);

    expect(screen.queryByText(/No data available/)).not.toBeInTheDocument();
  });
});
