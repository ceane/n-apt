/** @jest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { ThemeProvider } from "styled-components";
import { configureStore } from "@reduxjs/toolkit";
import { MemoryRouter, useNavigate } from "react-router";
import { SpectrumSidebar } from "@n-apt/spectrum/sidebar/SpectrumSidebar";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import websocketSlice, {
  setConnected,
  updateDeviceState,
} from "@n-apt/redux/slices/websocketSlice";
import authSlice from "@n-apt/redux/slices/authSlice";
import noteCardsSlice from "@n-apt/redux/slices/noteCardsSlice";
import settingsSlice from "@n-apt/redux/slices/settingsSlice";
import waterfallSlice, {
  setSourceMode,
} from "@n-apt/redux/slices/waterfallSlice";
import themeSlice from "@n-apt/redux/slices/themeSlice";
import snapshotSlice from "@n-apt/redux/slices/snapshotSlice";
import demodSlice from "@n-apt/redux/slices/demodSlice";

describe("SpectrumSidebar hot-path diagnostics", () => {
  it("does not log metadata on every animation frame", () => {
    const source = readFileSync(
      join(process.cwd(), "src/ts/features/spectrum/sidebar/SpectrumSidebar.tsx"),
      "utf8",
    );

    expect(source).not.toContain("Metadata Effect: isNapt?");
    expect(source).not.toContain("Metadata Effect: NAPT file but NO aesKey!");
  });
});

let mockLiveState: any;
let mockEffectiveFrames: any[];
let mockSignalAreaBounds: Record<string, { min: number; max: number }> | null;
let mockWsConnection: any;
let mockStoreDispatch: jest.Mock;
let mockToggleVisualizerPause: jest.Mock;
let mockShowPrompt: jest.Mock;
let mockEffectiveSampleRateHz: number | null;

const TRANSMIT_WARNING_ACK_KEY = "napt.transmitWarningAccepted";

jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
    aesKey: new Uint8Array(32),
  }),
}));

jest.mock("@n-apt/maps/hooks/useGeolocation", () => ({
  useGeolocation: () => ({
    getLocation: jest.fn(),
  }),
}));

jest.mock("@n-apt/ui/PromptProvider", () => ({
  usePrompt: () => ({
    showPrompt: mockShowPrompt,
  }),
}));

jest.mock("@n-apt/spectrum/hooks/useSpectrumStore", () => ({
  useOptionalSpectrumStore: () => null,
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
      sample_rate: mockEffectiveSampleRateHz ?? mockLiveState.sampleRateHz,
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
    sampleRateHzEffective:
      mockEffectiveSampleRateHz ?? mockLiveState.sampleRateHz,
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
    selectedSourceDerived: mockLiveState.selectedSourceDerived,
    sources: mockLiveState.sources ?? [],
  }),
}));

jest.mock("@n-apt/spectrum/sidebar/Channels", () => ({
  Channels: () => <div data-testid="channels" />,
}));

jest.mock("@n-apt/spectrum/sidebar/ConnectionStatusSection", () => ({
  ConnectionStatusSection: () => <div data-testid="connection-status" />,
}));

jest.mock("@n-apt/capture/sidebar/FileSelectionSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="file-selection" />,
}));

jest.mock("@n-apt/capture/sidebar/IQCaptureControlsSection", () => ({
  IQCaptureControlsSection: () => <div data-testid="iq-capture" />,
}));

jest.mock("@n-apt/capture/sidebar/SnapshotControlsSection", () => ({
  SnapshotControlsSection: () => <div data-testid="snapshot-controls" />,
}));

jest.mock("@n-apt/spectrum/sidebar/SourceSettingsSection", () => ({
  SourceSettingsSection: () => <div data-testid="source-settings" />,
}));

jest.mock("@n-apt/settings/sidebar/ThemeSection", () => ({
  ThemeSection: () => <div data-testid="theme-section" />,
}));

jest.mock("@n-apt/spectrum/sidebar/SourceInput", () => ({
  __esModule: true,
  default: ({
    devices = [],
    onSelectedDeviceChange,
    onToggleDeviceTxMode,
    selectedDeviceId,
    onSourceModeChange,
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
    onSourceModeChange?: (mode: "live" | "file") => void;
  }) => (
    <div data-testid="source-input">
      <button type="button" onClick={() => onToggleDeviceTxMode?.("device-1")}>
        source-input
      </button>
      <button
        type="button"
        onClick={() => onSourceModeChange?.("file")}
        data-testid="select-file-mode"
      >
        File Selection
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

jest.mock("@n-apt/ui/Collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@n-apt/ui/Button", () => ({
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
  mockEffectiveSampleRateHz = null;
  mockLiveState = {
    activeSignalArea: "C",
    frequencyRange: { min: 24_720_000, max: 29_920_000 },
    displayTemporalResolution: "reduced",
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
    sendTransmitStatus: jest.fn(),
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
    if (action?.type === "SET_SAMPLE_RATE") {
      mockLiveState = { ...mockLiveState, sampleRateHz: action.sampleRateHz };
      return;
    }
    if (action?.type === "SET_FFT_FRAME_RATE") {
      mockLiveState = { ...mockLiveState, fftFrameRate: action.fftFrameRate };
    }
    if (action?.type === "SET_SOURCE_MODE") {
      mockLiveState = { ...mockLiveState, sourceMode: action.mode };
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

  it("renders capture, snapshot, and notes sections beneath channels", () => {
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    const channels = screen.getByTestId("channels");
    const iqCapture = screen.getByTestId("iq-capture");
    const snapshots = screen.getByTestId("snapshot-controls");
    const notes = screen.getByRole("button", { name: /Hide Notes/ });

    expect(
      channels.compareDocumentPosition(iqCapture) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      iqCapture.compareDocumentPosition(snapshots) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      snapshots.compareDocumentPosition(notes) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the Settings navigation cards at the bottom in order", () => {
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    const startPage = screen.getByRole("link", { name: /Start Page/i });
    const lingoAndLearn = screen.getByRole("link", {
      name: /Lingo and Learn/i,
    });

    expect(startPage).toHaveAttribute("href", "/get-started");
    expect(lingoAndLearn).toHaveAttribute("href", "/learn");
    expect(
      startPage.compareDocumentPosition(lingoAndLearn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const startCard = startPage.closest("article");
    expect(startCard).toHaveStyle({ width: "56%" });
    expect(startCard).toHaveStyle({ justifySelf: "start" });
    expect(startCard?.parentElement).toHaveStyle({ marginTop: "180px" });
  });

  it("does not render Tx settings for a TX-capable source while it is receiving", () => {
    const hackrfSource = {
      id: "hackrf-rx",
      name: "HackRF One",
      kind: "hackrf_one",
      capability: "tx_rx",
      status: "connected",
      serial_number: "hackrf-rx",
      supports_approx_dbm: false,
      iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
      sdr: {
        max_sample_rate: 20_000_000,
        sample_rate_options: [2_400_000, 5_200_000, 20_000_000],
        fft_display: { markers: [] },
        settings: {
          center_frequency: 137_100_000,
          sample_rate: 5_200_000,
        },
      },
    };
    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: hackrfSource.id,
      selectedSource: hackrfSource,
      sources: [hackrfSource],
    };
    mockWsConnection = {
      ...mockWsConnection,
      sources: [hackrfSource],
    };

    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.queryByText("Tx Bandwidth")).not.toBeInTheDocument();
    expect(screen.queryByText("Tx Safety")).not.toBeInTheDocument();
  });

  it("renders Tx settings while a TX source is on standby", () => {
    const standbySource = {
      id: "mock-tx",
      name: "Mock Tx SDR",
      kind: "mock_tx",
      capability: "tx",
      status: "standby",
      serial_number: "mock-tx",
      supports_approx_dbm: false,
      iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
      sdr: {
        max_sample_rate: 20_000_000,
        sample_rate_options: [2_400_000, 5_200_000, 20_000_000],
        fft_display: { markers: [] },
        settings: {
          center_frequency: 137_100_000,
          sample_rate: 5_200_000,
        },
      },
    };
    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: standbySource.id,
      selectedSource: standbySource,
      sources: [standbySource],
    };
    mockWsConnection = {
      ...mockWsConnection,
      sources: [standbySource],
    };

    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByText("Tx Bandwidth")).toBeInTheDocument();
  });

  it("keeps Mock APT at its accepted rate until Whole Channel is selected explicitly", async () => {
    mockLiveState = {
      ...mockLiveState,
      activeSignalArea: "A",
      frequencyRange: { min: 18_000, max: 3_218_000 },
      sampleRateHz: 3_200_000,
    };
    mockEffectiveFrames = [
      {
        id: "a",
        label: "A",
        min_hz: 18_000,
        max_hz: 4_390_000,
        description: "Mock APT channel A",
      },
      {
        id: "b",
        label: "B",
        min_hz: 24_100_000,
        max_hz: 30_370_000,
        description: "Mock APT channel B",
      }
    ];
    mockSignalAreaBounds = null;
    mockWsConnection = {
      ...mockWsConnection,
      backend: "mock_apt",
      deviceName: "Mock APT SDR",
      deviceProfile: { kind: "mock_apt" },
      sampleRateOptions: [3_200_000, 18_250_000],
      sampleRateHz: 3_200_000,
      maxSampleRateHz: 18_250_000,
    };

    const channels = [
      {
        id: "a",
        label: "A",
        min_hz: 18_000,
        max_hz: 4_390_000,
        description: "Mock APT channel A",
      },
      {
        id: "b",
        label: "B",
        min_hz: 24_100_000,
        max_hz: 30_370_000,
        description: "Mock APT channel B",
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
            iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
            sdr: {
              max_sample_rate: 18_250_000,
              sample_rate_options: [3_200_000, 18_250_000],
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
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
        name: "Whole Channel (18.25MHz)",
      }),
    ).not.toBeInTheDocument();
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
    const sampleRateSelect = within(sampleRateRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    await waitFor(() => expect(sampleRateSelect).toHaveValue("3200000"));
    expect(
      mockWsConnection.sendSettings.mock.calls.some(
        ([settings]: [{ sampleRate?: number; tunerBandwidth?: number }]) =>
          settings.sampleRate !== undefined ||
          settings.tunerBandwidth !== undefined,
      ),
    ).toBe(false);
    expect(mockWsConnection.sendFrequencyRange).not.toHaveBeenCalled();

    mockWsConnection.sendSettings.mockClear();
    mockWsConnection.sendFrequencyRange.mockClear();
    fireEvent.change(sampleRateSelect, { target: { value: "whole-channel" } });
    await waitFor(() => expect(mockLiveState.sampleRateHz).toBe(4_372_000));
    expect(mockWsConnection.sendSettings).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 4_372_000,
        frameRate: expect.any(Number),
      }),
    );
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenCalledWith({
      min: 18_000,
      max: 4_390_000,
    });

    mockWsConnection.sendSettings.mockClear();
    mockWsConnection.sendFrequencyRange.mockClear();
    fireEvent.change(sampleRateSelect, { target: { value: "3200000" } });

    await waitFor(() => expect(sampleRateSelect).toHaveValue("3200000"));
    expect(mockLiveState.sampleRateHz).toBe(3_200_000);
    expect(mockWsConnection.sendSettings).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 3_200_000,
        frameRate: expect.any(Number),
      }),
    );
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenCalledWith({
      min: 18_000,
      max: 3_218_000,
    });
    expect(sampleRateSelect).not.toHaveValue("whole-channel");
  });

  it("preserves the sample rate when free panning changes the inferred channel", async () => {
    mockLiveState = {
      ...mockLiveState,
      activeSignalArea: "C",
      frequencyRange: { min: 4_750_000, max: 23_000_000 },
      sampleRateHz: 18_250_000,
    };
    mockEffectiveFrames = [
      { id: "c", label: "C", min_hz: 4_750_000, max_hz: 23_000_000 },
      { id: "b", label: "B", min_hz: 24_100_000, max_hz: 30_370_000 },
    ];
    mockSignalAreaBounds = {
      C: { min: 4_750_000, max: 23_000_000 },
      B: { min: 24_100_000, max: 30_370_000 },
    };
    mockWsConnection = {
      ...mockWsConnection,
      backend: "mock_apt",
      deviceName: "Mock APT SDR",
      deviceProfile: { kind: "mock_apt" },
      sampleRateOptions: [3_200_000, 18_250_000],
      sampleRateHz: 18_250_000,
      maxSampleRateHz: 18_250_000,
    };

    const store = createStore();
    store.dispatch(setConnected());
    const { rerender } = render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() =>
      expect(screen.getAllByText("Sample Rate").length).toBeGreaterThan(0),
    );
    mockWsConnection.sendSettings.mockClear();
    mockWsConnection.sendFrequencyRange.mockClear();

    mockLiveState = {
      ...mockLiveState,
      activeSignalArea: "B",
      // Free pan keeps the 18.25 MHz acquisition width even though its center
      // is now inside B's narrower 6.27 MHz channel.
      frequencyRange: { min: 18_110_000, max: 36_360_000 },
    };
    rerender(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    await act(async () => {});
    expect(mockLiveState.sampleRateHz).toBe(18_250_000);
    expect(mockWsConnection.sendSettings).not.toHaveBeenCalled();
    expect(mockWsConnection.sendFrequencyRange).not.toHaveBeenCalled();
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
            iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
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
    expect(mockWsConnection.sendTransmitStatus).not.toHaveBeenCalled();

    await act(async () => {
      mockShowPrompt.mock.calls[0][0].onConfirm();
    });

    expect(window.localStorage.getItem(TRANSMIT_WARNING_ACK_KEY)).toBe("true");
    expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledWith(
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
          iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
          iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    fireEvent.click(getByRole("button", { name: /source-input/i }));

    expect(mockShowPrompt).not.toHaveBeenCalled();
    expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledWith(
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
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
    expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledWith(
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
            <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
          </ThemeProvider>
        </Provider>,
      );

      expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledTimes(1);
      mockWsConnection.sendTransmitStatus.mockClear();

      for (const centerFrequencyHz of [2_205_000, 2_206_000, 2_207_000]) {
        act(() => {
          store.dispatch({
            type: "spectrum/setTxCenterFrequencyHz",
            payload: centerFrequencyHz,
          });
          rerender(
            <Provider store={store}>
              <ThemeProvider theme={theme}>
                <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
              </ThemeProvider>
            </Provider>,
          );
        });
      }

      expect(mockWsConnection.sendTransmitStatus).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(17);
      });

      expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledTimes(1);
      expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledWith(
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
        iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
        iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
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
            <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
          </ThemeProvider>
        </Provider>,
      );

      expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledTimes(1);
      expect(mockWsConnection.sendTransmitStatus).toHaveBeenLastCalledWith(
        true,
        "Mock Tx SDR",
        expect.objectContaining({ bandwidthHz: 2_400_000 }),
      );
      mockWsConnection.sendTransmitStatus.mockClear();

      act(() => {
        store.dispatch({
          type: "spectrum/setTxSampleRateHz",
          payload: 218_000,
        });
        rerender(
          <Provider store={store}>
            <ThemeProvider theme={theme}>
              <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
            </ThemeProvider>
          </Provider>,
        );
      });

      act(() => {
        jest.advanceTimersByTime(17);
      });

      expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledTimes(1);
      expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledWith(
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

  it("records the Whole Channel exit anchor once while changing the live sample rate", async () => {
    mockLiveState = {
      ...mockLiveState,
      activeSignalArea: "A",
      frequencyRange: { min: 18_000, max: 4_390_000 },
      sampleRateHz: 4_372_000,
      selectedSourceDerived: {
        backend: "hackrf_one",
        deviceName: "HackRF One",
        deviceProfile: { kind: "hackrf_one" },
        deviceState: "connected",
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [3_200_000, 4_372_000],
        sampleRateHz: 4_372_000,
        sdrSettings: null,
      },
    };
    mockEffectiveFrames = [
      {
        id: "a",
        label: "A",
        min_hz: 18_000,
        max_hz: 4_390_000,
        description: "HackRF test channel",
      },
    ];
    mockSignalAreaBounds = {
      A: { min: 18_000, max: 4_390_000 },
      a: { min: 18_000, max: 4_390_000 },
    };
    mockWsConnection = {
      ...mockWsConnection,
      backend: "hackrf_one",
      deviceName: "HackRF One",
      deviceProfile: { kind: "hackrf_one" },
      sampleRateHz: 4_372_000,
      sampleRateOptions: [3_200_000, 4_372_000],
    };

    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        deviceState: "connected",
        backend: "hackrf_one",
        deviceName: "HackRF One",
        deviceProfile: { kind: "hackrf_one" } as any,
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [3_200_000, 4_372_000],
        sampleRateHz: 4_372_000,
        sdrSettings: {
          sample_rate: 4_372_000,
          min_receive_sample_rate: 3_200_000,
          fft: {
            default_size: 262144,
            default_frame_rate: 12,
            max_size: 262144,
            max_frame_rate: 12,
            size_to_frame_rate: { "262144": 12 },
          },
        } as any,
      }),
    );
    const dispatchSpy = jest.spyOn(store, "dispatch");

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    const sampleRateLabel = (await screen.findAllByText("Sample Rate")).find(
      (label) =>
        label.closest("div")?.parentElement?.querySelector("select") !== null,
    );
    const sampleRateRow = sampleRateLabel?.closest("div")?.parentElement;
    const sampleRateSelect = within(sampleRateRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    await waitFor(() => expect(sampleRateSelect).toHaveValue("whole-channel"));
    fireEvent.change(sampleRateSelect, { target: { value: "3200000" } });

    const anchorUpdates = dispatchSpy.mock.calls.filter(
      ([action]) => action.type === "spectrum/mergeLastKnownRanges",
    );
    expect(anchorUpdates).toHaveLength(1);
  });

  it("keeps manual sample-rate changes sticky across repeated updates and keeps whole-channel as an explicit option", async () => {
    mockLiveState = {
      ...mockLiveState,
      activeSignalArea: "A",
      frequencyRange: { min: 18_000, max: 5_218_000 },
      sampleRateHz: 5_200_000,
      lastKnownRanges: { A: { min: 18_000, max: 5_218_000 } },
      selectedSourceDerived: {
        backend: "hackrf_one",
        deviceName: "HackRF One",
        deviceProfile: { kind: "hackrf_one" },
        deviceState: "connected",
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [
          2_400_000,
          5_200_000,
          12_800_000,
          20_000_000,
        ],
        sampleRateHz: 5_200_000,
        sdrSettings: null,
      },
    };
    mockEffectiveFrames = [
      {
        id: "a",
        label: "A",
        min_hz: 18_000,
        max_hz: 4_390_000,
        description: "HackRF test channel",
      },
    ];
    mockSignalAreaBounds = {
      A: { min: 18_000, max: 4_390_000 },
      a: { min: 18_000, max: 4_390_000 },
    };
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    const sampleRateLabel = (await screen.findAllByText("Sample Rate")).find(
      (label) =>
        label.closest("div")?.parentElement?.querySelector("select") !== null,
    );
    const sampleRateRow = sampleRateLabel?.closest("div")?.parentElement;
    expect(sampleRateRow).toBeTruthy();
    const sampleRateSelect = within(sampleRateRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    await waitFor(() => {
      expect(sampleRateSelect).toHaveValue("5200000");
    });

    expect(
      within(sampleRateRow as HTMLElement).getByRole("option", {
        name: /Whole Channel \(4\.372MHz\)/,
      }),
    ).toBeInTheDocument();

    mockStoreDispatch.mockClear();
    mockWsConnection.sendSettings.mockClear();
    mockWsConnection.sendFrequencyRange.mockClear();

    fireEvent.change(sampleRateSelect, { target: { value: "12800000" } });
    await waitFor(() => expect(mockLiveState.sampleRateHz).toBe(12_800_000));
    expect(mockLiveState.sampleRateHz).toBe(12_800_000);
    expect(mockWsConnection.sendSettings).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 12_800_000,
        frameRate: expect.any(Number),
        tunerBandwidth: 12_800_000,
      }),
    );
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenCalledWith({
      min: 0,
      max: 12_800_000,
    });

    fireEvent.change(sampleRateSelect, { target: { value: "20000000" } });
    await waitFor(() => expect(mockLiveState.sampleRateHz).toBe(20_000_000));
    expect(mockLiveState.sampleRateHz).toBe(20_000_000);
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenLastCalledWith({
      min: 0,
      max: 20_000_000,
    });

    fireEvent.change(sampleRateSelect, { target: { value: "12800000" } });
    await waitFor(() => expect(mockLiveState.sampleRateHz).toBe(12_800_000));
    expect(mockLiveState.sampleRateHz).toBe(12_800_000);
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
      sampleRateHz: 18_250_000,
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
      sampleRateOptions: [3_200_000, 18_250_000],
      sampleRateHz: 18_250_000,
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
            iq_format: { element_type: "u8", layout: "interleaved_iq", typed_array: "Uint8Array" },
            sdr: {
              max_sample_rate: 18_250_000,
              sample_rate_options: [3_200_000, 18_250_000],
              fft_display: { markers: [] },
              settings: {
                sample_rate: 18_250_000,
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
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
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    mockWsConnection.sendTransmitStatus.mockClear();
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

    expect(mockWsConnection.sendTransmitStatus).toHaveBeenCalledWith(
      false,
      "HackRF One #2",
      expect.objectContaining({
        serialNumber: "tx-2",
      }),
    );
  });

  it("preserves Whole Channel option for HackRF One when txHopType is range", async () => {
    const mockLiveState = {
      sources: [
        {
          id: "hackrf-1",
          kind: "hackrf_one",
          backend: "hackrf",
          deviceName: "HackRF One",
          status: "connected",
          sdr: {
            settings: { sample_rate: 18_250_000 },
          },
        },
      ],
    };

    mockWsConnection = {
      ...mockWsConnection,
      sources: mockLiveState.sources,
      backend: "hackrf",
      deviceProfile: { kind: "hackrf_one", is_rtl_sdr: false },
      deviceName: "HackRF One",
      deviceState: "connected",
    };

    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        activeSourceId: "hackrf-1",
        activeSourceMode: "live",
        sources: mockLiveState.sources,
      } as any),
    );
    store.dispatch({
      type: "spectrum/setTxHopType",
      payload: "range",
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    const sampleRateLabel = (await screen.findAllByText("Sample Rate"))[0];
    const sampleRateRow = sampleRateLabel.closest("div")?.parentElement;
    expect(sampleRateRow).toBeTruthy();

    expect(
      within(sampleRateRow as HTMLElement).getByRole("option", {
        name: /Whole Channel/,
      }),
    ).toBeInTheDocument();
  });

  it("does not restore a stale Whole Channel request over the accepted 3.2MHz source rate on mount", async () => {
    mockEffectiveSampleRateHz = 3_200_000;
    mockEffectiveFrames = [
      {
        id: "c",
        label: "C",
        min_hz: 4_750_000,
        max_hz: 23_000_000,
        description: "Mock APT channel C",
      },
    ];
    mockSignalAreaBounds = {
      C: { min: 4_750_000, max: 23_000_000 },
      c: { min: 4_750_000, max: 23_000_000 },
    };
    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: "hackrf-1",
      sourceMode: "live",
      sampleRateHz: 18_250_000,
      selectedSourceDerived: {
        backend: "hackrf",
        deviceState: "connected",
        deviceName: "HackRF One",
        deviceProfile: { kind: "hackrf_one", is_rtl_sdr: false },
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [
          2_400_000,
          3_200_000,
          5_200_000,
          20_000_000,
        ],
        sampleRateHz: 3_200_000,
        sdrSettings: {
          sample_rate: 3_200_000,
          min_receive_sample_rate: 3_200_000,
        },
        supportsBasebandFilter: true,
      },
      sources: [
        {
          id: "hackrf-1",
          kind: "hackrf_one",
          backend: "hackrf",
          deviceName: "HackRF One",
          status: "connected",
          maxSampleRateHz: 20_000_000,
          sampleRateOptions: [2_400_000, 3_200_000, 5_200_000, 20_000_000],
          sdr: {
            max_sample_rate: 20_000_000,
            sample_rate_options: [
              2_400_000,
              3_200_000,
              5_200_000,
              20_000_000,
            ],
            settings: { sample_rate: 3_200_000 },
          },
        },
      ],
    };

    mockWsConnection = {
      ...mockWsConnection,
      sendSettings: jest.fn(),
      sources: mockLiveState.sources,
      sampleRateOptions: [2_400_000, 3_200_000, 5_200_000, 20_000_000],
      backend: "hackrf",
      deviceProfile: { kind: "hackrf_one", is_rtl_sdr: false },
      deviceName: "HackRF One",
      deviceState: "connected",
    };

    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        activeSourceId: "hackrf-1",
        activeSourceMode: "live",
        sources: mockLiveState.sources,
      } as any),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const sampleRateLabel = (await screen.findAllByText("Sample Rate"))[0];
    const sampleRateRow = sampleRateLabel.closest("div")?.parentElement;
    expect(sampleRateRow).toBeTruthy();
    const sampleRateSelect = within(
      sampleRateRow as HTMLElement,
    ).getByRole("combobox") as HTMLSelectElement;
    expect(
      Array.from(sampleRateSelect.options).some(
        (option) => option.value === "3200000",
      ),
    ).toBe(true);

    const calls = mockWsConnection.sendSettings.mock.calls as Array<
      [{ sampleRate?: number; tunerBandwidth?: number }]
    >;
    expect(
      calls.some(
        ([settings]) =>
          settings?.sampleRate !== undefined ||
          settings?.tunerBandwidth !== undefined,
      ),
    ).toBe(false);
  });

  it("does not fight the user's manual sample-rate change while the backend rate is stale", async () => {
    // Accepted backend rate is 3.2 MHz (websocket/source_info snapshot).
    mockEffectiveSampleRateHz = 3_200_000;
    mockLiveState = {
      ...mockLiveState,
      selectedSourceId: "hackrf-1",
      sourceMode: "live",
      sampleRateHz: 3_200_000,
      frequencyRange: { min: 0, max: 3_200_000 },
      selectedSourceDerived: {
        backend: "hackrf",
        deviceState: "connected",
        deviceName: "HackRF One",
        deviceProfile: { kind: "hackrf_one", is_rtl_sdr: false },
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [
          2_400_000,
          3_200_000,
          5_200_000,
          12_800_000,
          20_000_000,
        ],
        sampleRateHz: 3_200_000,
        sdrSettings: {
          sample_rate: 3_200_000,
          min_receive_sample_rate: 3_200_000,
        },
        supportsBasebandFilter: true,
      },
      sources: [
        {
          id: "hackrf-1",
          kind: "hackrf_one",
          backend: "hackrf",
          deviceName: "HackRF One",
          status: "connected",
          maxSampleRateHz: 20_000_000,
          sampleRateOptions: [
            2_400_000,
            3_200_000,
            5_200_000,
            12_800_000,
            20_000_000,
          ],
          sdr: {
            max_sample_rate: 20_000_000,
            sample_rate_options: [
              2_400_000,
              3_200_000,
              5_200_000,
              12_800_000,
              20_000_000,
            ],
            settings: { sample_rate: 3_200_000 },
          },
        },
      ],
    };

    mockWsConnection = {
      ...mockWsConnection,
      sendSettings: jest.fn(),
      sendFrequencyRange: jest.fn(),
      sources: mockLiveState.sources,
      sampleRateOptions: [2_400_000, 3_200_000, 5_200_000, 12_800_000, 20_000_000],
      sampleRateHz: 3_200_000,
      backend: "hackrf",
      deviceProfile: { kind: "hackrf_one", is_rtl_sdr: false },
      deviceName: "HackRF One",
      deviceState: "connected",
    };

    const store = createStore();
    store.dispatch(setConnected());
    store.dispatch(
      updateDeviceState({
        activeSourceId: "hackrf-1",
        activeSourceMode: "live",
        sources: mockLiveState.sources,
      } as any),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const sampleRateLabel = (await screen.findAllByText("Sample Rate")).find(
      (label) =>
        label.closest("div")?.parentElement?.querySelector("select") !== null,
    );
    const sampleRateRow = sampleRateLabel?.closest("div")?.parentElement;
    expect(sampleRateRow).toBeTruthy();
    const sampleRateSelect = within(sampleRateRow as HTMLElement).getByRole(
      "combobox",
    ) as HTMLSelectElement;

    mockWsConnection.sendSettings.mockClear();
    mockWsConnection.sendFrequencyRange.mockClear();
    mockStoreDispatch.mockClear();

    // User selects 12.8 MHz; the backend has NOT acknowledged yet (effective
    // rate stays 3.2 MHz). The range must follow the requested rate exactly
    // once — no repeated range re-anchoring that would freeze the app.
    fireEvent.change(sampleRateSelect, { target: { value: "12800000" } });
    await waitFor(() => expect(mockLiveState.sampleRateHz).toBe(12_800_000));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mockLiveState.frequencyRange.max - mockLiveState.frequencyRange.min).toBe(
      12_800_000,
    );
    expect(mockWsConnection.sendSettings).toHaveBeenCalledTimes(1);
    expect(mockWsConnection.sendFrequencyRange).toHaveBeenCalledTimes(1);
  });

  it("does not display Tx Settings when Mock APT SDR (Rx mode) is selected", () => {
    mockWsConnection.sources = [
      { id: "mock-apt", name: "Mock APT SDR", capability: "rx", status: "connected" },
      { id: "mock-tx", name: "Mock Tx SDR", capability: "tx", status: "standby" },
    ];
    mockWsConnection.activeSourceId = "mock-apt";

    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.queryByText("Tx Settings")).not.toBeInTheDocument();
  });

  it("resets file-selection mode to live when the source=fileSelection deep link is removed", async () => {
    const store = createStore();
    // Model the app already being in file mode from the deep link.
    mockLiveState = { ...mockLiveState, sourceMode: "file" };
    store.dispatch(setSourceMode("file"));

    const LocationHarness: React.FC = () => {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate("/")}
          data-testid="remove-deep-link"
        >
          Back
        </button>
      );
    };

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter initialEntries={["/?source=fileSelection"]}>
            <LocationHarness />
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    // On mount with the deep link present, file mode is forced.
    expect(store.getState().waterfall.sourceMode).toBe("file");

    fireEvent.click(screen.getByTestId("remove-deep-link"));

    // Once the deep link is gone, the source returns to live.
    await waitFor(() => {
      expect(store.getState().waterfall.sourceMode).toBe("live");
    });
  });

  it("keeps a manual File Selection on the regular app (no deep link)", () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <MemoryRouter initialEntries={["/"]}>
            <SpectrumSidebar />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    );

    // Clicking File Selection on the regular app must not be reset back to live.
    fireEvent.click(screen.getByTestId("select-file-mode"));

    expect(store.getState().waterfall.sourceMode).toBe("file");
  });
});
