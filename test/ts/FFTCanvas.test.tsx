/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTCanvas from "@n-apt/components/FFTCanvas";
import type { FFTCanvasHandle } from "@n-apt/components/FFTCanvas";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { MemoryRouter } from "react-router-dom";
import { TestWrapper } from "./testUtils";
import { ThemeProvider } from "styled-components";
import { createFFTVisualizerMachine } from "@n-apt/utils/fftVisualizerMachine";
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
    centerFrequencyMHz: 105,
    activeSignalArea: "test",
    isPaused: false,
    snapshotGridPreference: true,
  };

  it("should render spectrum and waterfall sections", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas {...defaultProps} />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Waterfall Display/i)).toBeInTheDocument();
  });

  it("should render visualizer sliders", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas {...defaultProps} showVisualizerSliders={true} />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Zoom")).toBeInTheDocument();
    });
  });

  it("respects hideWaterfall and hideSliders in standalone mode", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                hideWaterfall={true}
                hideSliders={true}
                showVisualizerSliders={true}
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Waterfall Display/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Zoom")).not.toBeInTheDocument();
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
      expect(fftCanvasRef.current?.getSnapshotData()?.waterfallBuffer).toEqual(
        seededSnapshot.waterfallBuffer,
      );
    });

    firstRender.unmount();

    expect(machine.restore("live")?.waterfallBuffer).toEqual(
      seededSnapshot.waterfallBuffer,
    );

    renderCanvas();

    await waitFor(() => {
      expect(fftCanvasRef.current?.getSnapshotData()?.waterfallBuffer).toEqual(
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
      expect(machine.restore("live")?.waterfallBuffer).toBeNull();
      expect(machine.restore("live")?.waterfallTextureSnapshot).toBeNull();
      expect(machine.restore("live")?.waterfallTextureMeta).toBeNull();
      expect(onResetWaterfallCleared).toHaveBeenCalledTimes(1);
    });
  });
});
