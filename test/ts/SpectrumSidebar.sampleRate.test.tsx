/** @jest-environment jsdom */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
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
    showPrompt: jest.fn(),
  }),
}));

jest.mock("@n-apt/hooks/useSpectrumStore", () => ({
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
        size_to_frame_rate: {
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
    deviceName: "HackRF One",
    deviceProfile: { kind: "hackrf_one" },
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
  default: () => <div data-testid="source-input" />,
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
});
