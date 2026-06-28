/** @jest-environment jsdom */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import { Provider } from "react-redux";
import { ThemeProvider } from "styled-components";
import { configureStore } from "@reduxjs/toolkit";
import { SpectrumSidebar } from "../../src/ts/components/sidebar/SpectrumSidebar";
import { buildAppTheme } from "@n-apt/components/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import spectrumSlice from "../../src/ts/redux/slices/spectrumSlice";
import websocketSlice, {
  setConnected,
  updateDeviceState,
} from "../../src/ts/redux/slices/websocketSlice";
import authSlice from "../../src/ts/redux/slices/authSlice";
import noteCardsSlice from "../../src/ts/redux/slices/noteCardsSlice";
import settingsSlice from "../../src/ts/redux/slices/settingsSlice";
import waterfallSlice from "../../src/ts/redux/slices/waterfallSlice";
import themeSlice from "../../src/ts/redux/slices/themeSlice";
import snapshotSlice from "../../src/ts/redux/slices/snapshotSlice";
import demodSlice from "../../src/ts/redux/slices/demodSlice";

let mockLiveState: any;
let mockEffectiveFrames: any[];
let mockSignalAreaBounds: Record<string, { min: number; max: number }> | null;
let mockWsConnection: any;
let mockStoreDispatch: jest.Mock;
let mockToggleVisualizerPause: jest.Mock;
let mockShowPrompt: jest.Mock;

const TRANSMIT_WARNING_ACK_KEY = "napt.transmitWarningAccepted";

jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
    aesKey: new Uint8Array(32),
  }),
}));

jest.mock("@n-apt/hooks/useGeolocation", () => ({
  useGeolocation: () => ({
    getLocation: jest.fn(),
  }),
}));

jest.mock("@n-apt/components/ui/PromptProvider", () => ({
  usePrompt: () => ({
    showPrompt: mockShowPrompt,
  }),
}));

jest.mock("@n-apt/hooks/useSpectrumStore", () => ({
  LIVE_CONTROL_DEFAULTS: {
    ppm: 0,
    tunerAGC: false,
    rtlAGC: false,
  },
  useSpectrumStore: () => ({
    state: mockLiveState,
    dispatch: mockStoreDispatch,
    effectiveFrames: mockEffectiveFrames,
    effectiveSdrSettings: {
      sample_rate: mockLiveState.sampleRateHz,
      min_receive_sample_rate: 3_200_000,
      fft: {
        default_size: mockLiveState.fftSize,
        default_frame_rate: mockLiveState.fftFrameRate,
        max_size: mockLiveState.fftSize,
        max_frame_rate: mockLiveState.fftFrameRate,
        size_to_frame_rate: mockLiveState.size_to_frame_rate ?? {
          [String(mockLiveState.fftSize)]: mockLiveState.fftFrameRate,
        },
      },
    },
    sampleRateHzEffective: mockLiveState.sampleRateHz,
    signalAreaBounds: mockSignalAreaBounds,
    wsConnection: mockWsConnection,
    manualVisualizerPaused: null,
    toggleVisualizerPause: mockToggleVisualizerPause,
    cryptoCorrupted: false,
    deviceName: mockWsConnection?.deviceName ?? "HackRF One",
    deviceProfile: mockWsConnection?.deviceProfile ?? { kind: "hackrf_one" },
    selectedSourceId: mockLiveState.selectedSourceId ?? "",
    setSelectedSourceId: jest.fn(),
    selectedSource: mockLiveState.selectedSource ?? null,
    sources: mockLiveState.sources ?? [],
  }),
}));

jest.mock("@n-apt/components/sidebar/Channels", () => ({
  Channels: () => <div data-testid="channels" />,
}));

jest.mock("@n-apt/components/sidebar/ConnectionStatusSection", () => ({
  ConnectionStatusSection: () => <div data-testid="connection-status" />,
}));

jest.mock("@n-apt/components/sidebar/FileSelectionSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="file-selection" />,
}));

jest.mock("@n-apt/components/sidebar/IQCaptureControlsSection", () => ({
  IQCaptureControlsSection: () => <div data-testid="iq-capture" />,
}));

jest.mock("@n-apt/components/sidebar/SnapshotControlsSection", () => ({
  SnapshotControlsSection: () => <div data-testid="snapshot-controls" />,
}));

jest.mock("@n-apt/components/sidebar/SourceSettingsSection", () => ({
  SourceSettingsSection: () => <div data-testid="source-settings" />,
}));

jest.mock("@n-apt/components/sidebar/ThemeSection", () => ({
  ThemeSection: () => <div data-testid="theme-section" />,
}));

jest.mock("@n-apt/components/sidebar/SourceInput", () => ({
  __esModule: true,
  default: ({
    devices = [],
    onSelectedDeviceChange,
    onToggleDeviceTxMode,
    selectedDeviceId,
  }: {
    devices?: Array<{
      id: string;
      name: string;
      status?: {
        actionLabel?: string;
        onAction?: () => void;
      };
    }>;
    onSelectedDeviceChange?: (id: string) => void;
    onToggleDeviceTxMode?: (id: string) => void;
    selectedDeviceId?: string;
  }) => (
    <div data-testid="source-input">
      <button type="button" onClick={() => onToggleDeviceTxMode?.("device-1")}>
        source-input
      </button>
      {devices.map((device) => (
        <div key={device.id}>
          <button
            type="button"
            onClick={() => onSelectedDeviceChange?.(device.id)}
            aria-pressed={selectedDeviceId === device.id}
          >
            {device.name}
          </button>
          {device.status?.actionLabel ? (
            <button type="button" onClick={device.status.onAction}>
              {device.status.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  ),
}));

jest.mock("@n-apt/components/ui/Collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@n-apt/components/ui/Button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const createStore = () =>
  configureStore({
    reducer: {
      auth: authSlice,
      spectrum: spectrumSlice,
      waterfall: waterfallSlice,
      noteCards: noteCardsSlice,
      theme: themeSlice,
      settings: settingsSlice,
      websocket: websocketSlice,
      snapshot: snapshotSlice,
      demod: demodSlice,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });

const initMockState = () => {
  mockLiveState = {
    activeSignalArea: "C",
    frequencyRange: { min: 24_720_000, max: 29_920_000 },
    displayTemporalResolution: "medium",
    powerScale: "dB",
    selectedFiles: [],
    snapshotGridPreference: true,
    drawParams: [],
    activeClumpIndex: 0,
    globalNoiseFloor: -60,
    sourceMode: "live",
    stitchStatus: "Ready",
    visualizerPaused: false,
    isTrainingCapturing: false,
    trainingCaptureLabel: null,
    trainingCapturedSamples: 0,
    stitchTrigger: 0,
    stitchSourceSettings: { gain: 49.6, ppm: 1 },
    isStitchPaused: false,
    fftFrameRate: 12,
    detectedFrameRate: null,
    isAutoFftApplied: true,
    isWaterfallCleared: false,
    vizZoom: 1,
    vizPanOffset: 0,
    fftMinDb: -120,
    fftMaxDb: 0,
    fftSize: 262144,
    fftWindow: "Rectangular",
    showSpikeOverlay: false,
    gain: 49.6,
    ppm: 1,
    tunerAGC: false,
    rtlAGC: false,
    sampleRateHz: 5_200_000,
    minReceiveSampleRateHz: 3_200_000,
    sample_size: 0,
    heterodyningVerifyRequestId: 0,
    heterodyningStatusText: "",
    heterodyningVerifyDisabled: false,
    heterodyningDetected: false,
    heterodyningConfidence: null,
    heterodyningHighlightedBins: [],
    lastKnownRanges: {
      C: { min: 24_720_000, max: 29_920_000 },
    },
    diagnosticStatus: "Ready",
    isDiagnosticRunning: false,
    diagnosticTrigger: 0,
    drawSignal3D: false,
    displayMode: "fft",
    fftAvgEnabled: false,
    fftSmoothEnabled: false,
    wfSmoothEnabled: false,
    vizZoomFloor: 1,
    vizZoomFloorPan: 0,
    autoZoomStability: true,
    stitchOptions: {
      phaseCorrection: true,
      fmDeviationCorrection: true,
      antiAliasing: true,
      noiseFloorMatching: true,
      crossfading: true,
      chineseRemainderSynthesis: true,
      jsAntiAliasing: true,
      jsNoiseFloorMatching: true,
      acquisitionMode: "stepwise",
    },
  };
  mockEffectiveFrames = [
    {
      id: "c",
      label: "C",
      min_hz: 24_720_000,
      max_hz: 29_920_000,
      description: "HackRF test channel",
    },
  ];
  mockSignalAreaBounds = {
    C: { min: 24_720_000, max: 29_920_000 },
    c: { min: 24_720_000, max: 29_920_000 },
  };
  mockWsConnection = {
    backend: "hackrf_one",
    deviceState: "connected",
    deviceLoadingReason: null,
    isConnected: true,
    isPaused: false,
    captureStatus: null,
    autoFftOptions: null,
    sampleRateOptions: [
      3_200_000, 4_000_000, 5_000_000, 6_400_000, 8_000_000, 10_000_000,
      12_800_000, 16_000_000, 20_000_000,
    ],
    sampleRateHz: 5_200_000,
    deviceName: "HackRF One",
    deviceProfile: { kind: "hackrf_one" },
    sendSettings: jest.fn(),
    sendFrequencyRange: jest.fn(),
    sendTransmitMode: jest.fn(),
  };
  mockStoreDispatch = jest.fn((action: any) => {
    if (action?.type === "SET_SDR_SETTINGS_BUNDLE" && action.settings) {
      mockLiveState = {
        ...mockLiveState,
        ...action.settings,
        sampleRateHz:
          action.settings.sampleRateHz ?? mockLiveState.sampleRateHz,
      };
      mockWsConnection.sampleRateHz = mockLiveState.sampleRateHz;
      return;
    }
    if (action?.type === "SET_FREQUENCY_RANGE" && action.range) {
      mockLiveState = {
        ...mockLiveState,
        frequencyRange: action.range,
        lastKnownRanges: {
          ...mockLiveState.lastKnownRanges,
          [mockLiveState.activeSignalArea]: action.range,
        },
      };
      return;
    }
    if (action?.type === "SET_SIGNAL_AREA_AND_RANGE" && action.area) {
      mockLiveState = {
        ...mockLiveState,
        activeSignalArea: action.area,
        frequencyRange: action.range,
        lastKnownRanges: {
          ...mockLiveState.lastKnownRanges,
          [action.area]: action.range,
        },
      };
      return;
    }
    if (action?.type === "SET_VIZ_PAN") {
      mockLiveState = { ...mockLiveState, vizPanOffset: action.pan };
      return;
    }
    if (action?.type === "SET_FFT_FRAME_RATE") {
      mockLiveState = { ...mockLiveState, fftFrameRate: action.fftFrameRate };
    }
  });
  mockToggleVisualizerPause = jest.fn();
};

describe("SpectrumSidebar sample rate behavior", () => {
  beforeEach(() => {
    initMockState();
    mockShowPrompt = jest.fn();
    window.localStorage.removeItem(TRANSMIT_WARNING_ACK_KEY);
  });

  it("uses the active channel span for mock whole-channel mode instead of the mock device rate", async () => {
    mockLiveState = {
      ...mockLiveState,
      activeSignalArea: "A",
      frequencyRange: { min: 18_000, max: 3_218_000 },
      sampleRateHz: 3_200_000,
    };
    mockEffectiveFrames = [];
    mockSignalAreaBounds = null;
    mockWsConnection = {
      ...mockWsConnection,
      backend: "mock_apt",
      deviceName: "Mock APT SDR",
      deviceProfile: { kind: "mock_apt" },
      sampleRateOptions: [3_200_000],
      sampleRateHz: 3_200_000,
    };

    const channels = [
      {
        id: "a",
        label: "A",
        min_hz: 18_000,
        max_hz: 4_390_000,
        description: "Mock APT channel A",
      },
    ];
    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        activeSourceId: "mock-apt",
        activeSourceMode: "live",
        sources: [
          {
            id: "mock-apt",
            name: "Mock APT SDR",
            kind: "mock_apt",
            capability: "mock",
            status: "streaming",
            loading_attempt: 0,
            loading_attempt_max: 2,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
            sdr: {
              max_sample_rate: 3_200_000,
              sample_rate_options: [3_200_000],
              fft_display: { markers: [] },
              settings: {
                sample_rate: 3_200_000,
                min_receive_sample_rate: 3_200_000,
                center_frequency: 1_600_000,
                fft: {
                  default_size: 262144,
                  default_frame_rate: 12,
                  max_size: 262144,
                  max_frame_rate: 60,
                  size_to_frame_rate: { "262144": 12 },
                },
              },
            },
          },
        ],
        channels,
      } as any),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    const sampleRateLabel = (await screen.findAllByText("Sample Rate"))[0];
    const sampleRateRow = sampleRateLabel.closest("div")?.parentElement;
    expect(sampleRateRow).toBeTruthy();

    expect(
      within(sampleRateRow as HTMLElement).getByRole("option", {
        name: "Whole Channel (4.372MHz)",
      }),
    ).toBeInTheDocument();
    expect(
      within(sampleRateRow as HTMLElement).queryByRole("option", {
        name: "Whole Channel (3.2MHz)",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(sampleRateRow as HTMLElement).queryByRole("option", {
        name: "4.4MHz",
      }),
    ).not.toBeInTheDocument();
  });

  it("prompts before enabling transmit and only sends the transmit command after confirmation", async () => {
    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        activeSourceId: "mock-apt",
        activeSourceMode: "live",
        sources: [
          {
            id: "mock-apt",
            name: "Mock APT SDR",
            kind: "mock_apt",
            capability: "tx_rx",
            status: "connected",
            loading_attempt: 0,
            loading_attempt_max: 2,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
            sdr: {
              max_sample_rate: 3_200_000,
              sample_rate_options: [3_200_000],
              fft_display: { markers: [] },
              settings: {
                sample_rate: 3_200_000,
                min_receive_sample_rate: 3_200_000,
                center_frequency: 1_600_000,
                fft: {
                  default_size: 262144,
                  default_frame_rate: 12,
                  max_size: 262144,
                  max_frame_rate: 60,
                  size_to_frame_rate: { "262144": 12 },
                },
              },
            },
          },
        ],
        channels: [],
      } as any),
    );

    const { getByRole } = render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    fireEvent.click(getByRole("button", { name: /source-input/i }));

    expect(mockShowPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Check Before You Transmit",
        confirmText: "Continue (Accept Responsibility)",
        cancelText: "Let me think about it...",
      }),
    );
    expect(mockWsConnection.sendTransmitMode).not.toHaveBeenCalled();

    await act(async () => {
      mockShowPrompt.mock.calls[0][0].onConfirm();
    });

    expect(window.localStorage.getItem(TRANSMIT_WARNING_ACK_KEY)).toBe("true");
    expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledWith(
      true,
      "Mock APT SDR",
      expect.objectContaining({
        serialNumber: "device-1",
        centerFrequencyHz: 137_100_000,
        bandwidthHz: 2_400_000,
        powerDbm: -18,
        vgaGainDb: 16,
      }),
    );
  });

  it("binds the source pause button to the clicked source id", () => {
    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: "mock-apt",
      selectedSource: {
        id: "mock-apt",
        name: "Mock APT SDR",
        capability: "mock",
        status: "connected",
      },
      sources: [
        {
          id: "mock-apt",
          name: "Mock APT SDR",
          kind: "mock_apt",
          capability: "mock",
          status: "connected",
          loading_attempt: 0,
          loading_attempt_max: 2,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
          paused: false,
          sdr: {
            max_sample_rate: 3_200_000,
            sample_rate_options: [3_200_000],
            fft_display: { markers: [] },
            settings: {
              sample_rate: 3_200_000,
              min_receive_sample_rate: 3_200_000,
              center_frequency: 1_600_000,
              fft: {
                default_size: 262144,
                default_frame_rate: 12,
                max_size: 262144,
                max_frame_rate: 60,
                size_to_frame_rate: { "262144": 12 },
              },
            },
          },
        },
        {
          id: "mock-tx",
          name: "Mock Tx SDR",
          kind: "mock_tx",
          capability: "tx",
          status: "connected",
          loading_attempt: 0,
          loading_attempt_max: 2,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
          paused: false,
          sdr: {
            max_sample_rate: 20_000_000,
            sample_rate_options: [20_000_000],
            fft_display: { markers: [] },
            settings: {
              sample_rate: 20_000_000,
              center_frequency: 136_900_000,
              fft: {
                default_size: 262144,
                default_frame_rate: 12,
                max_size: 262144,
                max_frame_rate: 60,
              },
            },
          },
        },
      ],
    };

    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    const sourceInput = screen.getByTestId("source-input");
    fireEvent.click(
      within(sourceInput).getByRole("button", { name: "Mock APT SDR" }),
    );
    fireEvent.click(
      within(sourceInput).getByRole("button", { name: /pause/i }),
    );

    expect(mockToggleVisualizerPause).toHaveBeenCalledWith("mock-apt");
  });

  it("skips the transmit warning after responsibility has already been accepted", async () => {
    window.localStorage.setItem(TRANSMIT_WARNING_ACK_KEY, "true");

    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: "mock-apt",
      selectedSource: {
        id: "mock-apt",
        name: "Mock APT SDR",
        kind: "mock_apt",
        capability: "tx_rx",
        status: "connected",
        serial_number: "device-1",
      },
      sources: [
        {
          id: "mock-apt",
          name: "Mock APT SDR",
          kind: "mock_apt",
          capability: "tx_rx",
          status: "connected",
          serial_number: "device-1",
          sdr: {
            settings: {
              center_frequency: 137_100_000,
              sample_rate: 2_400_000,
              hackrf_vga_gain: 16,
              hackrf_lna_gain: 0,
              hackrf_amp_enable: false,
              tuner_agc: false,
              rtl_agc: false,
              ppm: 1,
              fft: {
                default_size: 262144,
                default_frame_rate: 12,
                max_size: 262144,
                max_frame_rate: 60,
              },
            },
          },
        },
      ],
    };
    mockWsConnection = {
      ...mockWsConnection,
      sources: mockLiveState.sources,
    };

    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        activeSourceId: "mock-apt",
        activeSourceMode: "live",
        sources: mockLiveState.sources,
      } as any),
    );

    const { getByRole } = render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    fireEvent.click(getByRole("button", { name: /source-input/i }));

    expect(mockShowPrompt).not.toHaveBeenCalled();
    expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledWith(
      true,
      "Mock APT SDR",
      expect.objectContaining({
        serialNumber: "device-1",
        centerFrequencyHz: 137_100_000,
        bandwidthHz: 2_400_000,
        vgaGainDb: 16,
      }),
    );
  });

  it("starts tx from Tx Settings on first load before Redux sources are hydrated", async () => {
    window.localStorage.setItem(TRANSMIT_WARNING_ACK_KEY, "true");

    const mockTxSource = {
      id: "mock-tx",
      name: "Mock Tx SDR",
      kind: "mock_tx",
      capability: "tx",
      status: "connected",
      serial_number: "mock-tx",
      supports_approx_dbm: false,
      supports_raw_iq_stream: false,
      sdr: {
        max_sample_rate: 20_000_000,
        sample_rate_options: [5_200_000, 10_000_000, 20_000_000],
        fft_display: { markers: [] },
        settings: {
          center_frequency: 137_100_000,
          sample_rate: 5_200_000,
          hackrf_vga_gain: 16,
          hackrf_lna_gain: 0,
          hackrf_amp_enable: false,
          tuner_agc: false,
          rtl_agc: false,
          ppm: 1,
          fft: {
            default_size: 262144,
            default_frame_rate: 12,
            max_size: 262144,
            max_frame_rate: 60,
          },
        },
      },
    };
    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: "",
      selectedSource: null,
      sources: [mockTxSource],
    };
    mockWsConnection = {
      ...mockWsConnection,
      sources: [mockTxSource],
    };

    const store = createStore();
    store.dispatch(setConnected());

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    const sourceInput = screen.getByTestId("source-input");
    const startTxButton = within(
      within(sourceInput).getByRole("button", { name: "Mock Tx SDR" })
        .parentElement as HTMLElement,
    ).getByRole("button", {
      name: /start tx/i,
    });

    fireEvent.click(startTxButton);

    expect(mockShowPrompt).not.toHaveBeenCalled();
    expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledWith(
      true,
      "Mock Tx SDR",
      expect.objectContaining({
        serialNumber: "mock-tx",
        centerFrequencyHz: 137_100_000,
        bandwidthHz: 2_400_000,
      }),
    );
  });

  it("coalesces rapid TX setting changes while transmit mode is active", async () => {
    jest.useFakeTimers();
    try {
      const mockTxSource = {
        id: "mock-tx",
        name: "Mock Tx SDR",
        kind: "mock_tx",
        capability: "tx",
        status: "transmitting",
        serial_number: "mock-tx",
        supports_approx_dbm: false,
        supports_raw_iq_stream: false,
        sdr: {
          max_sample_rate: 20_000_000,
          sample_rate_options: [5_200_000, 10_000_000, 20_000_000],
          fft_display: { markers: [] },
          settings: {
            center_frequency: 137_100_000,
            sample_rate: 5_200_000,
            hackrf_vga_gain: 16,
            hackrf_lna_gain: 0,
            hackrf_amp_enable: false,
            tuner_agc: false,
            rtl_agc: false,
            ppm: 1,
          },
        },
      };
      mockLiveState = {
        ...mockLiveState,
        selectedSourceId: "mock-tx",
        selectedSource: mockTxSource,
        sources: [mockTxSource],
      };
      mockWsConnection = {
        ...mockWsConnection,
        sources: [mockTxSource],
      };

      const store = createStore();
      store.dispatch(setConnected());

      const { rerender } = render(
        <Provider store={store}>
          <ThemeProvider theme={theme}>
            <SpectrumSidebar />
          </ThemeProvider>
        </Provider>,
      );

      expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledTimes(1);
      mockWsConnection.sendTransmitMode.mockClear();

      for (const centerFrequencyHz of [2_205_000, 2_206_000, 2_207_000]) {
        act(() => {
          store.dispatch({
            type: "spectrum/setTxCenterFrequencyHz",
            payload: centerFrequencyHz,
          });
          rerender(
            <Provider store={store}>
              <ThemeProvider theme={theme}>
                <SpectrumSidebar />
              </ThemeProvider>
            </Provider>,
          );
        });
      }

      expect(mockWsConnection.sendTransmitMode).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(17);
      });

      expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledTimes(1);
      expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledWith(
        true,
        "Mock Tx SDR",
        expect.objectContaining({
          centerFrequencyHz: 2_207_000,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("syncs TX sample-rate changes to the transmitting source while viewing Mock APT", async () => {
    jest.useFakeTimers();
    try {
      const mockAptSource = {
        id: "mock-apt",
        name: "Mock APT SDR",
        kind: "mock_apt",
        capability: "mock",
        status: "streaming",
        serial_number: "mock-apt",
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
        sdr: {
          max_sample_rate: 3_200_000,
          sample_rate_options: [3_200_000],
          fft_display: { markers: [] },
          settings: {
            center_frequency: 137_100_000,
            sample_rate: 3_200_000,
            min_receive_sample_rate: 3_200_000,
          },
        },
      };
      const mockTxSource = {
        id: "mock-tx",
        name: "Mock Tx SDR",
        kind: "mock_tx",
        capability: "tx",
        status: "transmitting",
        serial_number: "mock-tx",
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
        sdr: {
          max_sample_rate: 20_000_000,
          sample_rate_options: [2_400_000, 3_200_000, 5_200_000],
          fft_display: { markers: [] },
          settings: {
            center_frequency: 137_100_000,
            sample_rate: 2_400_000,
            hackrf_vga_gain: 16,
            hackrf_amp_enable: false,
          },
        },
      };
      mockLiveState = {
        ...mockLiveState,
        selectedSourceId: "mock-apt",
        selectedSource: mockAptSource,
        sources: [mockAptSource, mockTxSource],
      };
      mockWsConnection = {
        ...mockWsConnection,
        sources: [mockAptSource, mockTxSource],
      };

      const store = createStore();
      store.dispatch(setConnected());

      const { rerender } = render(
        <Provider store={store}>
          <ThemeProvider theme={theme}>
            <SpectrumSidebar />
          </ThemeProvider>
        </Provider>,
      );

      expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledTimes(1);
      expect(mockWsConnection.sendTransmitMode).toHaveBeenLastCalledWith(
        true,
        "Mock Tx SDR",
        expect.objectContaining({ bandwidthHz: 2_400_000 }),
      );
      mockWsConnection.sendTransmitMode.mockClear();

      act(() => {
        store.dispatch({
          type: "spectrum/setTxSampleRateHz",
          payload: 218_000,
        });
        rerender(
          <Provider store={store}>
            <ThemeProvider theme={theme}>
              <SpectrumSidebar />
            </ThemeProvider>
          </Provider>,
        );
      });

      act(() => {
        jest.advanceTimersByTime(17);
      });

      expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledTimes(1);
      expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledWith(
        true,
        "Mock Tx SDR",
        expect.objectContaining({
          serialNumber: "mock-tx",
          bandwidthHz: 218_000,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.skip("keeps manual sample-rate changes sticky across repeated updates and keeps whole-channel as an explicit option", async () => {
    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        deviceState: "connected",
        backend: "hackrf_one",
        deviceName: "HackRF One",
        deviceProfile: { kind: "hackrf_one" } as any,
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: mockWsConnection.sampleRateOptions,
        sampleRateHz: 5_200_000,
        sdrSettings: {
          sample_rate: 5_200_000,
          min_receive_sample_rate: 3_200_000,
          fft: {
            default_size: 262144,
            default_frame_rate: 12,
            max_size: 262144,
            max_frame_rate: 12,
            size_to_frame_rate: { "262144": 12 },
          },
          gain: { tuner_gain: 49.6, rtl_agc: false, tuner_agc: false },
          ppm: 1,
        } as any,
      }),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    const sampleRateLabel = await screen.findByText("Sample Rate");
    const sampleRateRow = sampleRateLabel.closest("div")?.parentElement;
    expect(sampleRateRow).toBeTruthy();
    const sampleRateSelect = within(sampleRateRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    await waitFor(() => {
      expect(sampleRateSelect).toHaveValue("5200000");
    });

    expect(
      within(sampleRateRow as HTMLElement).getByRole("option", {
        name: /Whole Channel \(5\.2MHz\)/,
      }),
    ).toBeInTheDocument();

    mockStoreDispatch.mockClear();
    mockWsConnection.sendSettings.mockClear();
    mockWsConnection.sendFrequencyRange.mockClear();

    fireEvent.change(sampleRateSelect, { target: { value: "12800000" } });
    await waitFor(() => expect(sampleRateSelect).toHaveValue("12800000"));

    expect(mockLiveState.sampleRateHz).toBe(12_800_000);
    expect(mockWsConnection.sendSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ sampleRate: 12_800_000 }),
    );
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenLastCalledWith({
      min: 20_920_000,
      max: 33_720_000,
    });

    fireEvent.change(sampleRateSelect, { target: { value: "20000000" } });
    await waitFor(() => expect(sampleRateSelect).toHaveValue("20000000"));
    expect(mockLiveState.sampleRateHz).toBe(20_000_000);
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenLastCalledWith({
      min: 17_320_000,
      max: 37_320_000,
    });

    fireEvent.change(sampleRateSelect, { target: { value: "12800000" } });
    await waitFor(() => expect(sampleRateSelect).toHaveValue("12800000"));
    expect(mockLiveState.sampleRateHz).toBe(12_800_000);
    expect(sampleRateSelect).not.toHaveDisplayValue("Whole Channel (5.2MHz)");
  });

  it("asserts active device details, sample rates, and fft sizes for mock_apt", async () => {
    const store = createStore();
    store.dispatch(setConnected());

    const channels = [
      {
        id: "a",
        label: "A",
        min_hz: 18_000,
        max_hz: 4_408_000, // 4.39 MHz span
        description: "Mock APT channel A",
      },
      {
        id: "b",
        label: "B",
        min_hz: 24_720_000,
        max_hz: 29_880_000, // 5.16 MHz span
        description: "Mock APT channel B",
      },
      {
        id: "c",
        label: "C",
        min_hz: 4_750_000,
        max_hz: 23_000_000, // 18.25 MHz span
        description: "Mock APT channel C",
      },
    ];

    mockLiveState = {
      ...mockLiveState,
      activeSignalArea: "C",
      frequencyRange: { min: 4_750_000, max: 23_000_000 },
      sampleRateHz: 3_200_000,
      size_to_frame_rate: {
        "2048": 1562,
        "4096": 781,
        "8192": 390,
        "16384": 195,
        "32768": 97,
        "65536": 48,
        "131072": 24,
        "262144": 12,
      },
    };
    mockEffectiveFrames = [];
    mockSignalAreaBounds = null;
    mockWsConnection = {
      ...mockWsConnection,
      backend: "mock_apt",
      deviceName: "Mock APT SDR",
      deviceProfile: { kind: "mock_apt" },
      sampleRateOptions: [3_200_000],
      sampleRateHz: 3_200_000,
    };

    store.dispatch(
      updateDeviceState({
        activeSourceId: "mock-apt",
        activeSourceMode: "live",
        sources: [
          {
            id: "mock-apt",
            name: "Mock APT SDR",
            kind: "mock_apt",
            capability: "mock",
            status: "streaming",
            loading_attempt: 0,
            loading_attempt_max: 2,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
            sdr: {
              max_sample_rate: 3_200_000,
              sample_rate_options: [3_200_000],
              fft_display: { markers: [] },
              settings: {
                sample_rate: 3_200_000,
                min_receive_sample_rate: 3_200_000,
                center_frequency: 1_600_000,
                fft: {
                  default_size: 262144,
                  default_frame_rate: 12,
                  max_size: 262144,
                  max_frame_rate: 60,
                  size_to_frame_rate: {
                    "2048": 1562,
                    "4096": 781,
                    "8192": 390,
                    "16384": 195,
                    "32768": 97,
                    "65536": 48,
                    "131072": 24,
                    "262144": 12,
                  },
                },
              },
            },
          },
        ],
        channels,
      } as any),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    // 1. Assert active device name is "Mock APT SDR"
    const sourceInputButton = await screen.findByRole("button", {
      name: /source-input/i,
    });
    expect(sourceInputButton).toBeInTheDocument();

    // 2. Assert sample rate options:
    const sampleRateLabel = (await screen.findAllByText("Sample Rate"))[0];
    const sampleRateRow = sampleRateLabel.closest("div")?.parentElement;
    expect(sampleRateRow).toBeTruthy();

    const sampleRateSelect = within(sampleRateRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    const optionTexts = Array.from(sampleRateSelect.options).map(
      (opt) => opt.text,
    );
    expect(optionTexts).toContain("Whole Channel (18.25MHz)");
    expect(optionTexts).toContain("3.2MHz");

    // 3. Assert FFT Sizes dropdown has values from 2^11 (2048) to 2^18 (262144)
    const fftSizeLabel =
      screen
        .getAllByText("FFT Size")
        .find((el) => el.tagName.toLowerCase() === "span") ||
      screen.getAllByText("FFT Size")[0];
    const fftSizeRow = fftSizeLabel.closest("div")?.parentElement;
    expect(fftSizeRow).toBeTruthy();
    const fftSizeSelect = within(fftSizeRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    const fftSizeOptionValues = Array.from(fftSizeSelect.options).map(
      (opt) => opt.value,
    );
    expect(fftSizeOptionValues).toContain("2048");
    expect(fftSizeOptionValues).toContain("4096");
    expect(fftSizeOptionValues).toContain("262144");
  });

  it("targets the currently transmitting source when stopping tx from Tx Settings", async () => {
    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: "tx-1",
      selectedSource: {
        id: "tx-1",
        name: "HackRF One #1",
        kind: "hackrf_one",
        capability: "tx_rx",
        status: "connected",
      },
      sources: [
        {
          id: "tx-1",
          name: "HackRF One #1",
          kind: "hackrf_one",
          capability: "tx_rx",
          status: "connected",
          serial_number: "tx-1",
          sdr: {
            settings: {
              center_frequency: 137_100_000,
              sample_rate: 5_200_000,
              hackrf_vga_gain: 16,
              hackrf_lna_gain: 0,
              hackrf_amp_enable: false,
              tuner_agc: false,
              rtl_agc: false,
              ppm: 1,
              fft: {
                default_size: 262144,
                default_frame_rate: 12,
                max_size: 262144,
                max_frame_rate: 60,
              },
            },
          },
        },
        {
          id: "tx-2",
          name: "HackRF One #2",
          kind: "hackrf_one",
          capability: "tx_rx",
          status: "transmitting",
          serial_number: "tx-2",
          sdr: {
            settings: {
              center_frequency: 137_100_000,
              sample_rate: 5_200_000,
              hackrf_vga_gain: 16,
              hackrf_lna_gain: 0,
              hackrf_amp_enable: false,
              tuner_agc: false,
              rtl_agc: false,
              ppm: 1,
              fft: {
                default_size: 262144,
                default_frame_rate: 12,
                max_size: 262144,
                max_frame_rate: 60,
              },
            },
          },
        },
      ],
    };
    mockWsConnection = {
      ...mockWsConnection,
      sources: mockLiveState.sources,
    };

    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        activeSourceId: "tx-1",
        activeSourceMode: "live",
        sources: mockLiveState.sources,
      } as any),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumSidebar />
        </ThemeProvider>
      </Provider>,
    );

    mockWsConnection.sendTransmitMode.mockClear();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(100);

    const sourceInput = screen.getByTestId("source-input");
    const txButton = within(
      within(sourceInput).getByRole("button", { name: "HackRF One #2" })
        .parentElement as HTMLElement,
    ).getByRole("button", {
      name: /stop tx/i,
    });
    fireEvent.click(txButton);

    nowSpy.mockRestore();

    expect(mockWsConnection.sendTransmitMode).toHaveBeenCalledWith(
      false,
      "HackRF One #2",
      expect.objectContaining({
        serialNumber: "tx-2",
      }),
    );
  });
});
