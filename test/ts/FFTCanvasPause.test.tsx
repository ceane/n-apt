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
    saveFrameData: jest.fn(),
    restoreWaveformFromStorage: jest.fn(),
    ensurePausedFrame: jest.fn(() => false),
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
jest.mock("@n-apt/hooks/useSpectrumRendering", () => ({
  useSpectrumRendering: () => ({ renderSpectrum: jest.fn() }),
}));

jest.mock("@n-apt/hooks/useFrequencyDrag", () => ({
  useFrequencyDrag: () => { },
}));

describe("FFTCanvas Pause Functionality", () => {
  const mockFrequencyRange: FrequencyRange = {
    min: 0,
    max: 3.2,
  };

  const mockDataRef = {
    current: {
      waveform: Array.from(
        { length: 1024 },
        (_, i) => -60 + Math.sin(i * 0.1) * 20,
      ),
    }
  };

  const mockProps = {
    dataRef: mockDataRef,
    frequencyRange: mockFrequencyRange,
    centerFrequencyMHz: 100,
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

  const wrapFFTCanvas = (props: any) => (
    <TestWrapper>
      <MemoryRouter>
        <FFTCanvas {...props} />
      </MemoryRouter>
    </TestWrapper>
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render normally when not paused", () => {
    renderFFTCanvas();

    expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();
  });

  it("should show paused status when isPaused is true", () => {
    const pausedProps = { ...mockProps, isPaused: true };

    renderFFTCanvas(pausedProps);

    expect(
      screen.getByText((content, _element) => {
        return (
          content.includes("FFT Signal Display") && content.includes("(Paused)")
        );
      }),
    ).toBeInTheDocument();
  });

  it("should preserve last frame when paused with valid data", () => {
    const pausedProps = { ...mockProps, isPaused: true };

    renderFFTCanvas(pausedProps);

    // Should not show black screen - should have canvas elements
    expect(screen.queryByText(/No data available/)).not.toBeInTheDocument();
  });

  it("should handle pause state with null data gracefully", () => {
    const nullDataRef = { current: null };
    const pausedProps = {
      ...mockProps,
      isPaused: true,
      dataRef: nullDataRef,
    };

    expect(() => renderFFTCanvas(pausedProps)).not.toThrow();
  });

  it("should handle pause state with disconnected device", () => {
    const pausedProps = {
      ...mockProps,
      isPaused: true,
      isDeviceConnected: false,
    };

    expect(() => renderFFTCanvas(pausedProps)).not.toThrow();
  });

  it("should handle pause state with mock backend", () => {
    const pausedProps = {
      ...mockProps,
      isPaused: true,
      isDeviceConnected: false,
    };

    renderFFTCanvas(pausedProps);

    // Should still render UI elements even in mock mode + paused
    expect(screen.getByText(/\(Paused\)/)).toBeInTheDocument();
  });

  it("should transition from paused to unpaused correctly", async () => {
    const { rerender } = renderFFTCanvas({ ...mockProps, isPaused: true });

    // Initially paused
    expect(screen.getByText(/\(Paused\)/)).toBeInTheDocument();

    // Unpause
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: false }));

    await waitFor(() => {
      expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();
    });
  });

  it("should transition from unpaused to paused correctly", async () => {
    const { rerender } = renderFFTCanvas({ ...mockProps, isPaused: false });

    // Initially not paused
    expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();

    // Pause
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: true }));

    await waitFor(() => {
      expect(screen.getByText(/\(Paused\)/)).toBeInTheDocument();
    });
  });

  it("should handle rapid pause/unpause toggles", async () => {
    const { rerender } = renderFFTCanvas({ ...mockProps, isPaused: false });

    // Rapid toggles
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: true }));
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: false }));
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: true }));
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: false }));

    await waitFor(() => {
      expect(screen.queryByText(/\(Paused\)/)).not.toBeInTheDocument();
    });
  });

  it("should maintain waveform data during pause transitions", () => {
    const { rerender } = renderFFTCanvas({ ...mockProps, isPaused: false });

    // Pause with data
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: true }));

    // Unpause - should still have data
    rerender(wrapFFTCanvas({ ...mockProps, isPaused: false }));

    expect(screen.queryByText(/No data available/)).not.toBeInTheDocument();
  });
});
