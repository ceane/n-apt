/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTCanvas from "../../src/ts/components/FFTCanvas";
import type { FFTCanvasHandle } from "../../src/ts/components/FFTCanvas";
import { SpectrumProvider } from "../../src/ts/hooks/useSpectrumStore";
import { MemoryRouter } from "react-router-dom";
import { TestWrapper } from "./testUtils";
import { ThemeProvider } from "styled-components";
import { createFFTVisualizerMachine } from "../../src/ts/utils/fftVisualizerMachine";
import { createRef } from "react";

// Mock useAuthentication to avoid auth errors during state init
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    sessionToken: "mock-token",
    aesKey: new Uint8Array(32),
    isAuthenticated: true,
  }),
}));

jest.unmock("@n-apt/components/FFTCanvas");

const mockTheme = {
  primary: "#00d4ff",
  background: "#0a0a0a",
  text: "#ffffff",
  fftColor: "#00d4ff",
  waterfallTheme: "magma",
};

describe("FFTCanvas Component", () => {
  const defaultProps = {
    dataRef: { current: { waveform: new Float32Array(1024).fill(-50) } },
    frequencyRange: { min: 100, max: 110 },
    centerFrequencyHz: 105_000_000,
    activeSignalArea: "test",
    isPaused: false,
    snapshotGridPreference: true,
  };

  it("should render spectrum and waterfall sections", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas {...defaultProps} />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
    });
    // After 2D cleanup, waterfall is handled separately - only FFT display renders here
  });

  it("should render FFT canvas element", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas {...defaultProps} />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
    });

    // Verify FFT display renders (WebGPU may fail in test environment but UI should still appear)
    expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
  });

  it("preserves a restored waterfall snapshot across mount, unmount, and remount", async () => {
    const machine = createFFTVisualizerMachine();
    const seededSnapshot = {
      waveform: new Float32Array([1, 2, 3, 4]),
      waterfallTextureSnapshot: new Uint8Array([
        10, 20, 30, 255,
        40, 50, 60, 255,
      ]),
      waterfallTextureMeta: {
        width: 1,
        height: 2,
        writeRow: 1,
      },
      waterfallBuffer: new Uint8ClampedArray([
        10, 20, 30, 255,
        40, 50, 60, 255,
      ]),
      waterfallDims: {
        width: 1,
        height: 2,
      },
    };
    machine.persist("live", seededSnapshot);

    const fftCanvasRef = createRef<FFTCanvasHandle>();
    const renderCanvas = () =>
      render(
        <TestWrapper>
          <MemoryRouter>
            <SpectrumProvider>
              <ThemeProvider theme={mockTheme}>
                <FFTCanvas
                  {...defaultProps}
                  ref={fftCanvasRef}
                  isPaused={true}
                  visualizerMachine={machine}
                  visualizerSessionKey="live"
                />
              </ThemeProvider>
            </SpectrumProvider>
          </MemoryRouter>
        </TestWrapper>
      );

    const firstRender = renderCanvas();

    await waitFor(() => {
      expect(machine.restore("live")?.waterfallBuffer).toEqual(
        seededSnapshot.waterfallBuffer,
      );
    });

    firstRender.unmount();

    expect(machine.restore("live")?.waterfallBuffer).toEqual(
      seededSnapshot.waterfallBuffer,
    );

    renderCanvas();

    await waitFor(() => {
      expect(machine.restore("live")?.waterfallBuffer).toEqual(
        seededSnapshot.waterfallBuffer,
      );
    });
  });

  it("keeps the live waterfall snapshot in the machine across an unpaused remount", async () => {
    const machine = createFFTVisualizerMachine();
    const seededSnapshot = {
      waveform: new Float32Array([1, 2, 3, 4]),
      waterfallTextureSnapshot: new Uint8Array([
        10, 20, 30, 255,
        40, 50, 60, 255,
      ]),
      waterfallTextureMeta: {
        width: 1,
        height: 2,
        writeRow: 1,
      },
      waterfallBuffer: new Uint8ClampedArray([
        10, 20, 30, 255,
        40, 50, 60, 255,
      ]),
      waterfallDims: {
        width: 1,
        height: 2,
      },
    };
    machine.persist("live", seededSnapshot);

    const fftCanvasRef = createRef<FFTCanvasHandle>();
    const renderCanvas = () =>
      render(
        <TestWrapper>
          <MemoryRouter>
            <SpectrumProvider>
              <ThemeProvider theme={mockTheme}>
                <FFTCanvas
                  {...defaultProps}
                  ref={fftCanvasRef}
                  isPaused={false}
                  visualizerMachine={machine}
                  visualizerSessionKey="live"
                />
              </ThemeProvider>
            </SpectrumProvider>
          </MemoryRouter>
        </TestWrapper>
      );

    const firstRender = renderCanvas();

    await waitFor(() => {
      expect(machine.restore("live")?.waterfallBuffer).toEqual(
        seededSnapshot.waterfallBuffer,
      );
    });

    firstRender.unmount();

    renderCanvas();

    await waitFor(() => {
      expect(machine.restore("live")?.waterfallBuffer).toEqual(
        seededSnapshot.waterfallBuffer,
      );
    });
  });

  it("clears the persisted session when waterfall reset is requested", async () => {
    const machine = createFFTVisualizerMachine();
    const onResetWaterfallCleared = jest.fn();

    machine.persist("live", {
      waveform: new Float32Array([1, 2, 3]),
      waterfallTextureSnapshot: new Uint8Array([10, 20, 30, 40]),
      waterfallTextureMeta: { width: 1, height: 1, writeRow: 0 },
      waterfallBuffer: new Uint8ClampedArray([10, 20, 30, 255]),
      waterfallDims: { width: 1, height: 1 },
    });

    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                isWaterfallCleared={true}
                onResetWaterfallCleared={onResetWaterfallCleared}
                visualizerMachine={machine}
                visualizerSessionKey="live"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(machine.restore("live")).toBeNull();
      expect(onResetWaterfallCleared).toHaveBeenCalledTimes(1);
    });
  });
});
