import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AntiAliasingDiagnostics } from "@n-apt/routes/AntiAliasingDiagnostics";
import { SpectrumProvider, INITIAL_SPECTRUM_STATE } from "@n-apt/hooks/useSpectrumStore";
import { ThemeProvider } from "styled-components";
import { buildAppTheme } from "@n-apt/components/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

// Mock canvas
import "jest-canvas-mock";

// Mock Lucide icons that might be problematic or just to keep it clean
jest.mock("lucide-react", () => ({
  Info: () => <div data-testid="info-icon" />,
}));

jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
    aesKey: "mock-key",
  }),
}));

const defaultTheme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("AntiAliasingDiagnostics", () => {
  const mockDispatch = jest.fn();
  
  const defaultMockValue = {
    state: INITIAL_SPECTRUM_STATE,
    dispatch: mockDispatch,
    fftVisualizerMachine: {} as any,
    manualVisualizerPaused: false,
    setManualVisualizerPaused: jest.fn(),
    effectiveFrames: [],
    effectiveSdrSettings: null,
    sampleRateHzEffective: 3200000,
    signalAreaBounds: null,
    lastSentPauseRef: { current: null },
    wsConnection: {
      isConnected: true,
      deviceState: "connected" as const,
      deviceLoadingReason: null,
      isPaused: false,
      serverPaused: false,
      backend: "mock",
      deviceInfo: "Mock Device",
      deviceName: "Mock Device",
      deviceProfile: null,
      maxSampleRateHz: 3200000,
      sampleRateOptions: [3200000],
      sampleRateHz: 3200000,
      sdrSettings: null,
      sdrLimitMarkers: [],
      dataRef: { current: null },
      spectrumFrames: [],
      captureStatus: { status: "started" as const, progress: 0, jobId: "test-job" },
      autoFftOptions: null,
      error: null,
      cryptoCorrupted: false,
      sendFrequencyRange: jest.fn(),
      sendPauseCommand: jest.fn(),
      sendSettings: jest.fn(),
      sendRestartDevice: jest.fn(),
      sendCaptureCommand: jest.fn(),
      sendScanCommand: jest.fn(),
      sendDemodulateCommand: jest.fn(),
      sendTrainingCommand: jest.fn(),
      sendGetAutoFftOptions: jest.fn(),
      sendPowerScaleCommand: jest.fn(),
    },
    toggleVisualizerPause: jest.fn(),
    cryptoCorrupted: false,
    deviceName: "Mock Device",
    deviceProfile: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  const renderComponent = (mockValue = defaultMockValue) => {
    return render(
      <ThemeProvider theme={defaultTheme}>
        <SpectrumProvider mockValue={mockValue}>
          <AntiAliasingDiagnostics />
        </SpectrumProvider>
      </ThemeProvider>
    );
  };

  it("renders initial state correctly", () => {
    renderComponent();
    // Check for containers instead of canvas text which isn't in DOM
    expect(screen.getByText("Raw Hops (A/B Overlap)")).toBeInTheDocument();
    expect(screen.getByText("Stitched Magnitude Output (Backend)")).toBeInTheDocument();
    expect(screen.getByText("Stitched Magnitude Output (Frontend WASM)")).toBeInTheDocument();
  });

  it("triggers diagnostic when diagnosticTrigger increases", async () => {
    const header = JSON.stringify({
      fft_size: 3,
      num_frames: 1,
      hop1_freq_hz: [100e6, 102e6],
      hop2_freq_hz: [101e6, 103e6],
      stitched_freq_hz: [100e6, 103e6],
      timing: {
        total_latency_ms: 100,
        settle_time_ms: 20,
        slice_duration_ms: 50,
        capture_timestamp_ms: Date.now(),
      },
      acquisition_mode: "interleaved",
      hop1_phase_deg: 10,
      hop2_phase_deg: 20,
      correction_angle_deg: 10,
      fm_deviation_khz: 0.1,
    });
    const headerBytes = new TextEncoder().encode(header);
    const fftSize = 3;
    const numFrames = 1;
    const binaryLen = fftSize * numFrames * 3;
    const buffer = new ArrayBuffer(8 + headerBytes.length + binaryLen);
    const view = new DataView(buffer);
    view.setUint8(0, "N".charCodeAt(0));
    view.setUint8(1, "A".charCodeAt(0));
    view.setUint8(2, "P".charCodeAt(0));
    view.setUint8(3, "T".charCodeAt(0));
    view.setUint32(4, headerBytes.length, true);
    new Uint8Array(buffer, 8, headerBytes.length).set(headerBytes);
    new Uint8Array(buffer, 8 + headerBytes.length).fill(128);

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => buffer,
    });

    const { rerender } = renderComponent();

    // Simulate trigger
    const triggeredMockValue = {
      ...defaultMockValue,
      state: {
        ...INITIAL_SPECTRUM_STATE,
        diagnosticTrigger: 1,
      },
    };

    rerender(
      <ThemeProvider theme={defaultTheme}>
        <SpectrumProvider mockValue={triggeredMockValue}>
          <AntiAliasingDiagnostics />
        </SpectrumProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/debug/stitch-diagnostic", expect.any(Object));
    });

    expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_DIAGNOSTIC_RUNNING", running: true });
    expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_DIAGNOSTIC_STATUS", status: "Capturing 10 frames..." });
    
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_DIAGNOSTIC_STATUS", status: "Capture complete" });
    });
  });

  it("handles fetch error gracefully", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      text: async () => "Internal Server Error",
    });

    const { rerender } = renderComponent();

    const triggeredMockValue = {
      ...defaultMockValue,
      state: {
        ...INITIAL_SPECTRUM_STATE,
        diagnosticTrigger: 1,
      },
    };

    rerender(
      <ThemeProvider theme={defaultTheme}>
        <SpectrumProvider mockValue={triggeredMockValue}>
          <AntiAliasingDiagnostics />
        </SpectrumProvider>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_DIAGNOSTIC_STATUS",
        status: "Error: Internal Server Error",
      });
    });
  });
});
