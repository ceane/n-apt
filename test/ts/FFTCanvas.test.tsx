import * as React from "react";
import { render, screen } from "@testing-library/react";
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

jest.mock("@n-apt/hooks/useWebGPUInit", () => ({
  useWebGPUInit: () => ({
    isWebGPUSupported: false,
    initWebGPU: jest.fn(),
  }),
}));

describe("FFTCanvas", () => {
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render without crashing", () => {
    render(<FFTCanvas {...mockProps} />);
  });

  it("should display spectrum analyzer section", () => {
    render(<FFTCanvas {...mockProps} />);

    expect(screen.getByText("FFT Signal Display")).toBeInTheDocument();
  });

  it("should display waterfall section", () => {
    render(<FFTCanvas {...mockProps} />);

    expect(screen.getByText("Waterfall Display")).toBeInTheDocument();
  });

  it("should show paused status when isPaused is true", () => {
    const pausedProps = { ...mockProps, isPaused: true };

    render(<FFTCanvas {...pausedProps} />);

    expect(
      screen.getByText((content, _element) => {
        return (
          content.includes("FFT Signal Display") && content.includes("(Paused)")
        );
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content, _element) => {
        return (
          content.includes("Waterfall Display") && content.includes("(Paused)")
        );
      }),
    ).toBeInTheDocument();
  });

  it("should not show paused status when isPaused is false", () => {
    render(<FFTCanvas {...mockProps} />);

    expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();
  });

  it("should handle null data gracefully", () => {
    const nullDataProps = {
      ...mockProps,
      data: null,
    };

    expect(() => render(<FFTCanvas {...nullDataProps} />)).not.toThrow();
  });

  it("should handle data without waveform gracefully", () => {
    const noWaveformProps = {
      ...mockProps,
      data: {},
    };

    expect(() => render(<FFTCanvas {...noWaveformProps} />)).not.toThrow();
  });
});
