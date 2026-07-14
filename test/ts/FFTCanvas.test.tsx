/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import FFTCanvas from "../../src/ts/components/FFTCanvas";
import type { FFTCanvasHandle } from "../../src/ts/components/FFTCanvas";
import {
  getLatestLiveFrame,
  getLiveFrameSignature,
  resolveEffectiveDbmOffsetDb,
  resolveTxModeDeviceName,
  resolveLiveFrameRenderableFrequencyRange,
  shouldRenderWaterfallWithFrameOrRestore,
  shouldCreatePausedFallbackWaveform,
  resolveDemodFocusOverlay,
  shouldDrawZoomMarkersForCanvas,
  getNodePreviewSelectionBarLabels,
  getNodePreviewVfoScaleTicks,
} from "../../src/ts/components/FFTCanvas";
import { SpectrumProvider } from "../../src/ts/hooks/useSpectrumStore";
import { MemoryRouter } from "react-router-dom";
import { TestWrapper } from "./testUtils";
import { ThemeProvider } from "styled-components";
import { THEME_TOKENS } from "@n-apt/consts/theme";
import { createFFTVisualizerMachine } from "../../src/ts/utils/fftVisualizerMachine";
import { createRef } from "react";

const processIqToDbmSpectrumMock = jest.fn(() => new Float32Array([1, 2, 3]));
const cleanupSpectrumMock = jest.fn();
const drawSpectrumMock = jest.fn(() => true);

// Mock useAuthentication to avoid auth errors during state init
jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    sessionToken: "mock-token",
    aesKey: new Uint8Array(32),
    isAuthenticated: true,
  }),
}));

jest.mock("@n-apt/hooks/useWasmSimdMath", () => ({
  useWasmSimdMath: () => ({
    isWasmLoaded: true,
    isSimdAvailable: false,
    resampleSpectrum: jest.fn(),
    processIqToSpectrum: jest.fn(),
    processIqToDbmSpectrum: processIqToDbmSpectrumMock,
    shiftWaterfallBuffer: jest.fn(),
    applyColorMapping: jest.fn(),
    getZoomedData: jest.fn((params) => ({
      slicedWaveform: params.fullWaveform,
      visualRange: params.fullRange,
      clampedPan: 0,
    })),
    transformToScreenCoords: jest.fn(() => []),
    calculateFrequencyDrag: jest.fn(),
    detectProminentSpikes: jest.fn(() => []),
    resampleSpectrumEnhanced: jest.fn(),
    matchNoiseFloorDb: jest.fn((ref, target) => target),
  }),
}));

jest.mock("@n-apt/hooks/useSpectrumRenderer", () => ({
  useSpectrumRenderer: () => ({
    drawSpectrum: drawSpectrumMock,
    cleanup: cleanupSpectrumMock,
  }),
}));

jest.unmock("@n-apt/components/FFTCanvas");

const mockTheme = {
  mode: "dark" as const,
  requestedMode: "system" as const,
  waterfallTheme: "magma",
  colors: THEME_TOKENS.colors.dark,
  typography: THEME_TOKENS.typography,
  spacing: THEME_TOKENS.spacing,
  layout: THEME_TOKENS.layout,
  primary: "#00d4ff",
  primaryAlpha: "#00d4ff33",
  primaryAnchor: "#00d4ff1a",
  fft: "#00d4ff",
  cssVariables: {},
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

  it("does not draw VFO zoom markers in an FFT node preview", () => {
    expect(shouldDrawZoomMarkersForCanvas(true)).toBe(false);
    expect(shouldDrawZoomMarkersForCanvas(false)).toBe(true);
  });

  it("uses only the selection overlay for FFT node range selection", () => {
    expect(
      resolveDemodFocusOverlay({
        selectionMode: "range",
        selectionRange: { min: 100, max: 110 },
        demodulationCenterFreqHz: null,
        demodulationRangeHz: null,
        bandwidthAlignment: "centered",
      }),
    ).toBeNull();
  });

  it("keeps the FFT node selection status in a separate bottom row", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas
              {...defaultProps}
              nodePreview
              selectionMode="range"
              selectionRange={{ min: 101, max: 103 }}
            />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("fft-node-selection-bar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("fft-node-selection-bar")).toHaveAttribute(
      "data-has-selection",
      "true",
    );
    expect(screen.getByTestId("fft-node-mini-vfo")).toHaveAttribute(
      "data-center",
      "102 Hz",
    );
  });

  it("keeps center and bandwidth labels visible before a selection exists", () => {
    expect(
      getNodePreviewSelectionBarLabels(undefined, {
        min: 100_000_000,
        max: 110_000_000,
      }),
    ).toEqual({ center: "○ 105.000 MHz", bandwidth: "| 10.000 MHz |" });
  });

  it("generates a compact frequency ruler for the FFT node VFO", () => {
    expect(
      getNodePreviewVfoScaleTicks({ min: 100_000_000, max: 110_000_000 }),
    ).toEqual([
      { frequencyHz: 100_000_000, positionPercent: 0 },
      { frequencyHz: 102_000_000, positionPercent: 20 },
      { frequencyHz: 104_000_000, positionPercent: 40 },
      { frequencyHz: 106_000_000, positionPercent: 60 },
      { frequencyHz: 108_000_000, positionPercent: 80 },
      { frequencyHz: 110_000_000, positionPercent: 100 },
    ]);
  });

  it("renders two compact FFT node stats rows", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas
              {...defaultProps}
              nodePreview
              fftSize={65536}
              hardwareSampleRateHz={1_000_000}
              deviceName="Mock SDR"
              selectionMode="range"
              selectionRange={{ min: 101, max: 103 }}
            />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("fft-node-stats-selection")).toHaveTextContent(
        "○ 102 Hz",
      );
    });
    expect(screen.getByTestId("fft-node-stats-meta")).toHaveTextContent(
      "FFT Size: 65,536",
    );
    expect(screen.getByTestId("fft-node-stats-meta")).toHaveTextContent(
      "Sample Rate: 1.000 MHz",
    );
    expect(screen.getByTestId("fft-node-stats-meta")).toHaveTextContent(
      "Mock SDR",
    );
  });

  it("shows no bandwidth selection instead of using the full display range", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas {...defaultProps} nodePreview />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("fft-node-stats-selection")).toHaveTextContent(
        "No current bandwidth selection",
      );
    });
  });

  it("should render spectrum and waterfall sections", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas {...defaultProps} />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
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
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
    });

    // Verify FFT display renders (WebGPU may fail in test environment but UI should still appear)
    expect(screen.getByText(/FFT Signal Display/i)).toBeInTheDocument();
  });

  it("renders the Tx row from Redux state even when no parent slider prop is passed", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas
              {...defaultProps}
              frequencyRange={{ min: 0, max: 4_372_000 }}
            />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(
      await screen.findByTestId("tx-slider-visual-row"),
    ).toBeInTheDocument();
    expect(screen.getByText(/137\.100 MHz/)).toBeInTheDocument();
  });

  it("does not show a Tx Mode label when no source is transmitting", () => {
    expect(
      resolveTxModeDeviceName(
        [
          {
            id: "mock-tx",
            name: "Mock Tx SDR",
            status: "connected",
          } as any,
        ],
        "Mock Tx SDR",
        true,
        false,
      ),
    ).toBeNull();
  });

  it("shows the device name in standby for a tx-capable device", () => {
    expect(
      resolveTxModeDeviceName(
        [
          {
            id: "mock-tx",
            name: "Mock Tx SDR",
            status: "connected",
          } as any,
        ],
        "Mock Tx SDR",
        true,
        true,
      ),
    ).toBe("Mock Tx SDR");
  });

  it("retunes to the offscreen Tx slider center instead of panning into empty bins", async () => {
    const onFrequencyRangeChange = jest.fn();
    const onVizPanChange = jest.fn();

    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas
              {...defaultProps}
              frequencyRange={{ min: 100, max: 110 }}
              onFrequencyRangeChange={onFrequencyRangeChange}
              onVizPanChange={onVizPanChange}
              txSlider={{
                visible: true,
                visibleMinHz: 100,
                visibleMaxHz: 110,
                txCenterHz: 150,
                txSampleRateHz: 60,
                signalLabel: "APT",
                powerDbm: -18,
              }}
            />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    const goToButton = await screen.findByRole("button", {
      name: /kHz|MHz|Hz.*→/i,
    });
    fireEvent.click(goToButton);

    expect(onFrequencyRangeChange).toHaveBeenCalledWith({
      min: 145,
      max: 155,
    });
    expect(onVizPanChange).toHaveBeenCalledWith(0);
  });

  it("shows a loading placeholder with the source label while awaiting data", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas
              {...defaultProps}
              dataRef={{ current: { waveform: null } }}
              awaitingDeviceData
              placeholderSourceLabel="Mock SDR"
            />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(
      screen.getAllByText((_, node) => node?.textContent === "Loading FFT..."),
    ).toHaveLength(2);
    expect(screen.getByText("from Mock SDR")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for the first frame to arrive."),
    ).toBeInTheDocument();
  });

  it("shows an error placeholder with a specific playback reason", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <FFTCanvas
              {...defaultProps}
              dataRef={{ current: { waveform: null } }}
              placeholderSourceLabel="Playback file"
              placeholderErrorReason="file stream ended unexpectedly"
            />
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(
      await screen.findByText("Error / file stream ended unexpectedly"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Can't playback from Playback file. Reason: file stream ended unexpectedly",
      ),
    ).toBeInTheDocument();
  });

  it("shows a server down placeholder when the device disconnects", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: { waveform: null } }}
                isDeviceConnected={false}
                placeholderSourceLabel="Live SDR"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(await screen.findByText("Server Down")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The server was disconnected due to being manually exited or an error.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a disconnected placeholder when the websocket is still connected", async () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: { waveform: null } }}
                isDeviceConnected={true}
                placeholderState={{
                  kind: "disconnected",
                  sourceLabel: "Live SDR",
                  message:
                    "The device disconnected. The backend is retrying the connection.",
                }}
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(await screen.findByText("Device Disconnected")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The device disconnected. The backend is retrying the connection.",
      ),
    ).toBeInTheDocument();
  });

  it("clears cached live frames when an explicit placeholder replaces the spectrum", async () => {
    drawSpectrumMock.mockClear();

    const liveFrame = {
      waveform: new Float32Array(1024).fill(-42),
    };
    const onCanvasLoadingChange = jest.fn();

    const { rerender } = render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: liveFrame }}
                onCanvasLoadingChange={onCanvasLoadingChange}
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(drawSpectrumMock).toHaveBeenCalled();
    });
    drawSpectrumMock.mockClear();

    rerender(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: liveFrame }}
                frequencyRange={{ min: 134_914_000, max: 139_286_000 }}
                centerFrequencyHz={137_100_000}
                onCanvasLoadingChange={onCanvasLoadingChange}
                placeholderState={{
                  kind: "idle",
                  title: "Start Tx to transmit",
                  sourceLabel: "Mock Tx SDR",
                  message: "Start Tx to view backend-generated monitor I/Q.",
                }}
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(onCanvasLoadingChange).toHaveBeenCalledWith(true);
    });
    expect(screen.getByText("Standby")).toBeInTheDocument();
    expect(screen.getByText("Start Tx to transmit")).toBeInTheDocument();
    expect(
      screen.getByText("Start Tx to view backend-generated monitor I/Q."),
    ).toBeInTheDocument();
    drawSpectrumMock.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(drawSpectrumMock).not.toHaveBeenCalled();
  });

  it("renders a requested Mock Tx preview frame while standby is paused", async () => {
    drawSpectrumMock.mockClear();
    processIqToDbmSpectrumMock.mockClear();
    processIqToDbmSpectrumMock.mockReturnValueOnce(new Float32Array([7, 8, 9]));

    const previewFrame = {
      type: "spectrum",
      data_type: "iq_raw",
      is_mock_apt: false,
      center_frequency_hz: 137_100_000,
      sample_rate: 2_400_000,
      iq_data: new Uint8Array([128, 129, 127, 126]),
    };

    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: previewFrame }}
                frequencyRange={{ min: 135_900_000, max: 138_300_000 }}
                centerFrequencyHz={137_100_000}
                isPaused={true}
                isStandby={true}
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(drawSpectrumMock).toHaveBeenCalled();
    });

    const drawSpectrumCalls = drawSpectrumMock.mock.calls as unknown as Array<
      [{ waveform?: ArrayLike<number> }]
    >;
    const renderedWaveform =
      drawSpectrumCalls[drawSpectrumCalls.length - 1]?.[0]?.waveform;
    const processIqCalls = processIqToDbmSpectrumMock.mock
      .calls as unknown as Array<[ArrayLike<number>]>;
    expect(processIqToDbmSpectrumMock).toHaveBeenCalled();
    expect(Array.from(processIqCalls[0]?.[0] ?? [])).toEqual(
      Array.from(previewFrame.iq_data),
    );
    const renderedValues = Array.from(renderedWaveform ?? []);
    expect(renderedValues.length).toBeGreaterThan(0);
    expect(Math.min(...renderedValues)).toBeGreaterThan(0);
    expect(screen.queryByText("Start Tx to transmit")).not.toBeInTheDocument();
  });

  it("does not process a frame owned by the previous source", async () => {
    drawSpectrumMock.mockClear();
    processIqToDbmSpectrumMock.mockClear();

    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{
                  current: {
                    source_id: "mock-apt",
                    iq_data: new Uint8Array([128, 129, 127, 126]),
                    center_frequency_hz: 2_186_000,
                    sample_rate: 4_372_000,
                  },
                }}
                expectedSourceId="rtl-sdr-00000001"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(processIqToDbmSpectrumMock).not.toHaveBeenCalled();
    expect(drawSpectrumMock).not.toHaveBeenCalled();
  });

  it("draws Mock Tx standby preview spectrum unchanged from backend I/Q processing", async () => {
    drawSpectrumMock.mockClear();
    processIqToDbmSpectrumMock.mockClear();
    const processedSpectrum = new Float32Array([
      -80, -81, -55, -20, -20, -20, -54, -82, -79,
    ]);
    processIqToDbmSpectrumMock.mockReturnValue(processedSpectrum);

    const previewFrame = {
      type: "spectrum",
      data_type: "iq_raw",
      is_mock_apt: false,
      center_frequency_hz: 137_100_000,
      sample_rate: 2_400_000,
      iq_data: new Uint8Array([128, 129, 127, 126]),
    };
    const renderCanvas = (txSampleRateHz: number) => (
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: previewFrame }}
                frequencyRange={{ min: 135_900_000, max: 138_300_000 }}
                centerFrequencyHz={137_100_000}
                isPaused={true}
                isStandby={true}
                placeholderState={{
                  kind: "top-bar",
                  title: "Start Tx to transmit",
                  sourceLabel: "Mock Tx SDR",
                }}
                txSlider={{
                  visible: true,
                  visibleMinHz: 135_900_000,
                  visibleMaxHz: 138_300_000,
                  txCenterHz: 137_100_000,
                  txSampleRateHz,
                  signalLabel: "Mock WiFi",
                  powerDbm: -18,
                }}
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    const { rerender } = render(renderCanvas(2_400_000));

    await waitFor(() => {
      expect(drawSpectrumMock).toHaveBeenCalled();
    });
    drawSpectrumMock.mockClear();

    rerender(renderCanvas(600_000));

    await waitFor(() => {
      expect(drawSpectrumMock).toHaveBeenCalled();
    });

    const drawSpectrumCalls = drawSpectrumMock.mock.calls as unknown as Array<
      [{ waveform?: ArrayLike<number> }]
    >;
    const renderedWaveform =
      drawSpectrumCalls[drawSpectrumCalls.length - 1]?.[0]?.waveform;
    const renderedValues = Array.from(renderedWaveform ?? []);

    expect(renderedValues).toEqual(Array.from(processedSpectrum));
  });

  it("preserves a restored waterfall snapshot across mount, unmount, and remount", async () => {
    const machine = createFFTVisualizerMachine();
    const seededSnapshot = {
      waveform: new Float32Array([1, 2, 3, 4]),
      waterfallTextureSnapshot: new Uint8Array([
        10, 20, 30, 255, 40, 50, 60, 255,
      ]),
      waterfallTextureMeta: {
        width: 1,
        height: 2,
        writeRow: 1,
      },
      waterfallBuffer: new Uint8ClampedArray([
        10, 20, 30, 255, 40, 50, 60, 255,
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
        </TestWrapper>,
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
        10, 20, 30, 255, 40, 50, 60, 255,
      ]),
      waterfallTextureMeta: {
        width: 1,
        height: 2,
        writeRow: 1,
      },
      waterfallBuffer: new Uint8ClampedArray([
        10, 20, 30, 255, 40, 50, 60, 255,
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
        </TestWrapper>,
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

  it("persists and restores waterfall snapshots when the visualizer session key changes", async () => {
    const machine = createFFTVisualizerMachine();
    const sourceASnapshot = {
      waveform: new Float32Array([1, 2, 3, 4]),
      waterfallTextureSnapshot: new Uint8Array([10, 20, 30, 255]),
      waterfallTextureMeta: {
        width: 1,
        height: 1,
        writeRow: 0,
      },
      waterfallBuffer: new Uint8ClampedArray([10, 20, 30, 255]),
      waterfallDims: {
        width: 1,
        height: 1,
      },
    };
    const sourceBSnapshot = {
      waveform: new Float32Array([5, 6, 7, 8]),
      waterfallTextureSnapshot: new Uint8Array([40, 50, 60, 255]),
      waterfallTextureMeta: {
        width: 1,
        height: 1,
        writeRow: 0,
      },
      waterfallBuffer: new Uint8ClampedArray([40, 50, 60, 255]),
      waterfallDims: {
        width: 1,
        height: 1,
      },
    };
    machine.persist("source-a", sourceASnapshot);
    machine.persist("source-b", sourceBSnapshot);

    const renderWithSession = (sessionKey: string) => (
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                isPaused={true}
                visualizerMachine={machine}
                visualizerSessionKey={sessionKey}
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>
    );

    const view = render(renderWithSession("source-a"));

    await waitFor(() => {
      expect(machine.restore("source-a")?.waterfallBuffer).toEqual(
        sourceASnapshot.waterfallBuffer,
      );
    });

    view.rerender(renderWithSession("source-b"));

    await waitFor(() => {
      expect(machine.restore("source-a")?.waterfallBuffer).toEqual(
        sourceASnapshot.waterfallBuffer,
      );
      expect(machine.restore("source-b")?.waterfallBuffer).toEqual(
        sourceBSnapshot.waterfallBuffer,
      );
    });

    view.rerender(renderWithSession("source-a"));

    await waitFor(() => {
      expect(machine.restore("source-a")?.waterfallBuffer).toEqual(
        sourceASnapshot.waterfallBuffer,
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
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(machine.restore("live")).toBeNull();
      expect(onResetWaterfallCleared).toHaveBeenCalledTimes(1);
    });
  });

  it("uses the latest frame when live data is queued as an array", () => {
    const firstFrame = { iq_data: new Uint8Array([1, 2]) };
    const latestFrame = { iq_data: new Uint8Array([3, 4, 5]) };

    expect(getLatestLiveFrame([firstFrame, latestFrame])).toBe(latestFrame);
    expect(getLatestLiveFrame(firstFrame)).toBe(firstFrame);
    expect(getLatestLiveFrame([])).toBeNull();
  });

  it("renders a waterfall restore even before the next live frame arrives", () => {
    expect(shouldRenderWaterfallWithFrameOrRestore(true, false, true)).toBe(
      true,
    );
    expect(shouldRenderWaterfallWithFrameOrRestore(true, false, false)).toBe(
      false,
    );
    expect(shouldRenderWaterfallWithFrameOrRestore(false, false, true)).toBe(
      false,
    );
  });

  it("distinguishes live frames that share a millisecond timestamp", () => {
    const frame = {
      type: "spectrum" as const,
      iq_data: new Uint8Array([1, 2, 3]),
      data_type: "iq_raw" as const,
      timestamp: 12345,
    };
    const nextFrame = {
      type: "spectrum" as const,
      iq_data: new Uint8Array([4, 5, 6]),
      data_type: "iq_raw" as const,
      timestamp: 12345,
    };

    expect(getLiveFrameSignature(frame)).not.toBe(
      getLiveFrameSignature(nextFrame),
    );
    expect(
      getLiveFrameSignature({
        type: "spectrum",
        iq_data: new Uint8Array([1, 2, 3]),
        data_type: "iq_raw",
      }),
    ).toEqual(expect.objectContaining({ iq_data: expect.any(Uint8Array) }));
    expect(getLiveFrameSignature(null)).toBeNull();
  });

  it("uses route monitor props instead of mock tx frame metadata for live range placement", () => {
    expect(
      resolveLiveFrameRenderableFrequencyRange({
        currentFrame: {
          center_frequency_hz: 1_600_000,
          sample_rate: 1_000_000,
        } as any,
        requestedRange: { min: 135_500_000, max: 138_700_000 },
        propsCenterFrequencyHz: 137_100_000,
        propsHardwareSampleRateHz: 3_200_000,
        deviceKind: "mock_tx",
        backend: "mock_tx",
        deviceName: "Mock Tx SDR",
        isRtlSdr: false,
      }),
    ).toEqual({
      min: 135_500_000,
      max: 138_700_000,
    });
  });

  it("uses Mock Tx dBm calibration for Mock APT receive view while Tx is active", () => {
    expect(
      resolveEffectiveDbmOffsetDb({
        powerScale: "dBm",
        deviceKind: "mock_apt",
        backend: "mock",
        deviceName: "Mock APT SDR",
        isTransmitting: true,
        tunerGainDb: 49.6,
      }),
    ).toBeCloseTo(15.0, 6);
  });

  it("processes non-empty live mock tx IQ instead of rendering an empty flatline", async () => {
    processIqToDbmSpectrumMock.mockClear();
    const iqData = new Uint8Array(2048);
    for (let index = 0; index < iqData.length; index += 2) {
      iqData[index] = index % 4 === 0 ? 129 : 127;
      iqData[index + 1] = 128;
    }
    const liveFrame = {
      type: "spectrum" as const,
      data_type: "iq_raw" as const,
      iq_data: iqData,
      sample_rate: 3_200_000,
      center_frequency_hz: 137_100_000,
      timestamp: 42,
    };

    render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: liveFrame }}
                frequencyRange={{ min: 135_500_000, max: 138_700_000 }}
                centerFrequencyHz={137_100_000}
                hardwareSampleRateHz={3_200_000}
                deviceProfile={{
                  kind: "mock_tx",
                  is_rtl_sdr: false,
                  supports_approx_dbm: true,
                  supports_raw_iq_stream: true,
                }}
                deviceBackend="mock_tx"
                deviceName="Mock Tx SDR"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(processIqToDbmSpectrumMock).toHaveBeenCalled();
    });

    const calls = processIqToDbmSpectrumMock.mock.calls as unknown as any[][];
    const lastCall = calls[calls.length - 1];
    const firstArg = lastCall?.[0] as Uint8Array | undefined;
    expect(firstArg).toBe(iqData);
    expect(Array.from(firstArg ?? []).some((byte) => byte !== 128)).toBe(true);
  });

  it("reprocesses the live frame when fftWindow changes without temporal resolution changes", async () => {
    processIqToDbmSpectrumMock.mockClear();
    const liveFrame = {
      iq_data: new Uint8Array(2048).fill(128),
      sample_rate: 2_000_000,
      center_frequency_hz: 100_000_000,
    };

    const { rerender } = render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: liveFrame }}
                fftWindow="Rectangular"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(processIqToDbmSpectrumMock).toHaveBeenCalled();
    });

    const callCountAfterRect = processIqToDbmSpectrumMock.mock.calls.length;

    rerender(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                dataRef={{ current: liveFrame }}
                fftWindow="Nuttall"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(processIqToDbmSpectrumMock.mock.calls.length).toBeGreaterThan(
        callCountAfterRect,
      );
    });

    const lastCall = processIqToDbmSpectrumMock.mock.calls[
      processIqToDbmSpectrumMock.mock.calls.length - 1
    ] as any[] | undefined;
    expect(lastCall?.[3]).toBe("Nuttall");
  });

  it("does not clear the waterfall or persist premature snapshot on state rerender (e.g. pause/unpause)", async () => {
    const machine = createFFTVisualizerMachine();
    const seededSnapshot = {
      waveform: new Float32Array([1, 2, 3, 4]),
      waterfallTextureSnapshot: new Uint8Array([10, 20, 30, 255]),
      waterfallTextureMeta: { width: 1, height: 1, writeRow: 0 },
      waterfallBuffer: new Uint8ClampedArray([10, 20, 30, 255]),
      waterfallDims: { width: 1, height: 1 },
    };
    machine.persist("live", seededSnapshot);

    const { rerender } = render(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                isPaused={true}
                visualizerMachine={machine}
                visualizerSessionKey="live"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    // Verify machine has the data initially
    expect(machine.restore("live")?.waterfallBuffer).toEqual(
      seededSnapshot.waterfallBuffer,
    );

    // Rerender with isPaused=false (which triggers callback/forceRender recreation)
    rerender(
      <TestWrapper>
        <MemoryRouter>
          <SpectrumProvider>
            <ThemeProvider theme={mockTheme}>
              <FFTCanvas
                {...defaultProps}
                isPaused={false}
                visualizerMachine={machine}
                visualizerSessionKey="live"
              />
            </ThemeProvider>
          </SpectrumProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    // The machine's snapshot MUST still be intact and not reset
    expect(machine.restore("live")?.waterfallBuffer).toEqual(
      seededSnapshot.waterfallBuffer,
    );
  });

  it("does not replace an existing paused waveform with the black fallback", () => {
    expect(
      shouldCreatePausedFallbackWaveform(new Float32Array(1024).fill(-47)),
    ).toBe(false);
    expect(shouldCreatePausedFallbackWaveform(null)).toBe(true);
  });
});
