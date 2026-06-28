import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";
import authSlice from "../../src/ts/redux/slices/authSlice";
import spectrumSlice from "../../src/ts/redux/slices/spectrumSlice";
import waterfallSlice from "../../src/ts/redux/slices/waterfallSlice";
import themeSlice from "../../src/ts/redux/slices/themeSlice";
import settingsSlice from "../../src/ts/redux/slices/settingsSlice";
import websocketSlice from "../../src/ts/redux/slices/websocketSlice";
import snapshotSlice from "../../src/ts/redux/slices/snapshotSlice";
import demodSlice from "../../src/ts/redux/slices/demodSlice";
import noteCardsSlice from "../../src/ts/redux/slices/noteCardsSlice";
import notificationsSlice from "../../src/ts/redux/slices/notificationsSlice";
import {
  setDeviceKind,
  setTxCenterFrequencyHz,
  setTxSampleRateHz,
} from "../../src/ts/redux/slices/spectrumSlice";
import { buildAppTheme } from "../../src/ts/components/ui/Theme";
import { THEME_TOKENS } from "../../src/ts/consts";
import { SpectrumProvider } from "../../src/ts/hooks/useSpectrumStore";
import { SpectrumRoute } from "../../src/ts/routes/SpectrumRoute";

const fftPlaybackCanvasMock = jest.fn((_props: any) => (
  <div data-testid="fft-playback-canvas" />
));
const fftAndWaterfallMock = jest.fn((_props: any) => (
  <div data-testid="fft-and-waterfall" />
));

jest.mock("@n-apt/components/FFTPlaybackCanvas", () => ({
  __esModule: true,
  default: React.forwardRef((props: any, ref: React.Ref<any>) => {
    fftPlaybackCanvasMock(props);
    React.useImperativeHandle(ref, () => ({
      getSpectrumCanvas: () => null,
      getWaterfallCanvas: () => null,
      getSpectrumOverlayCanvas: () => null,
      getWaterfallOverlayCanvas: () => null,
      triggerSnapshotRender: jest.fn(),
      getSnapshotData: () => null,
      getCompositeSnapshot: () => null,
    }));
    return <div data-testid="fft-playback-canvas" />;
  }),
}));

jest.mock("@n-apt/components", () => ({
  FFTAndWaterfall: React.forwardRef((props: any, ref: React.Ref<any>) => {
    fftAndWaterfallMock(props);
    React.useImperativeHandle(ref, () => ({
      getSpectrumCanvas: () => null,
      getWaterfallCanvas: () => null,
      getSpectrumOverlayCanvas: () => null,
      getWaterfallOverlayCanvas: () => null,
      triggerSnapshotRender: jest.fn(),
      getSnapshotData: () => null,
      getCompositeSnapshot: () => null,
    }));
    return <div data-testid="fft-and-waterfall" />;
  }),
  NoteCards: () => <div data-testid="note-cards" />,
}));

jest.mock("@n-apt/components/Layout", () => ({
  InitializingContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="initializing-container">{children}</div>
  ),
  InitializingTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="initializing-title">{children}</div>
  ),
  InitializingText: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="initializing-text">{children}</div>
  ),
}));

jest.mock("@n-apt/hooks/useSnapshot", () => ({
  useSnapshot: () => ({
    handleSnapshot: jest.fn(),
    isRecording: false,
    recordingSecondsRemaining: null,
    supportedVideoFormat: null,
    startFastRecording: jest.fn(),
    stopFastRecording: jest.fn(),
    takeFastSnapshot: jest.fn(),
  }),
}));

jest.mock("@n-apt/components/TxSliderOverlay", () => ({
  __esModule: true,
  default: () => <div data-testid="tx-slider-overlay" />,
}));

jest.mock("@n-apt/hooks/useSnapshotListener", () => ({
  useSnapshotListener: jest.fn(),
  buildSnapshotSettingsLabel: jest.fn(() => "mock-settings-label"),
}));

jest.mock("@n-apt/hooks/useDeviceConnectionState", () => ({
  useDeviceConnectionState: jest.fn(),
}));

jest.mock("@n-apt/hooks/useCaptureWholeChannelSegments", () => ({
  useCaptureWholeChannelSegments: () => jest.fn(),
}));

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const createStore = (preloadedState?: any) =>
  configureStore({
    reducer: {
      auth: authSlice,
      spectrum: spectrumSlice,
      waterfall: waterfallSlice,
      theme: themeSlice,
      settings: settingsSlice,
      websocket: websocketSlice,
      noteCards: noteCardsSlice,
      notifications: notificationsSlice,
      demod: demodSlice,
      snapshot: snapshotSlice,
    } as any,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });

describe("SpectrumRoute file mode", () => {
  beforeEach(() => {
    fftPlaybackCanvasMock.mockClear();
    fftAndWaterfallMock.mockClear();
  });

  it("forwards zoom and temporal resolution state to file playback", async () => {
    const mockValue = {
      state: {
        sourceMode: "file",
        selectedFiles: [{ id: "file-1", name: "capture.napt" }],
        stitchTrigger: 0,
        stitchSourceSettings: { gain: 0, ppm: 0 },
        isStitchPaused: false,
        fftSize: 2048,
        displayMode: "fft",
        powerScale: "dB",
        snapshotGridPreference: true,
        displayTemporalResolution: "high",
        frequencyRange: { min: 137_000_000, max: 138_000_000 },
        activeSignalArea: "A",
        vizZoom: 3.5,
        vizZoomFloor: 2.25,
        vizZoomFloorPan: 1250,
        vizPanOffset: 42,
        fftMinDb: -120,
        fftMaxDb: 0,
        fftWindow: "Rectangular",
        autoZoomStability: false,
        fftFrameRate: 60,
        showSpikeOverlay: false,
        heterodyningVerifyRequestId: 0,
        heterodyningHighlightedBins: [],
        isWaterfallCleared: false,
        selectedFilesCount: 1,
      },
      dispatch: jest.fn(),
      fftVisualizerMachine: {} as any,
      manualVisualizerPaused: true,
      setManualVisualizerPaused: jest.fn(),
      selectedSourceId: "source-1",
      setSelectedSourceId: jest.fn(),
      selectedSource: { id: "source-1" } as any,
      selectedSourceDerived: {
        deviceState: "connected",
        deviceName: "Mock Source",
        deviceProfile: null,
        deviceInfo: null,
        backend: null,
        maxSampleRateHz: null,
        sampleRateOptions: [],
        sampleRateHz: null,
        sdrSettings: null,
      },
      effectiveFrames: [],
      effectiveSdrSettings: null,
      sampleRateHzEffective: null,
      signalAreaBounds: null,
      lastSentPauseRef: { current: null },
      wsConnection: {
        isConnected: false,
        activeSourceId: null,
        deviceState: "connected",
        deviceLoadingReason: null,
        isPaused: false,
        serverPaused: false,
        backend: null,
        deviceInfo: null,
        deviceName: null,
        deviceProfile: null,
        maxSampleRateHz: null,
        sampleRateOptions: [],
        sampleRateHz: null,
        sdrSettings: null,
        sdrLimitMarkers: [
          {
            kind: "lower_limit",
            freq_hz: 1_000_000,
            label: "HackRF One, lower limit",
          },
        ],
        dataRef: { current: null },
        spectrumFrames: [],
        sources: [],
        captureStatus: { status: "idle" },
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
        sendPowerScaleCommand: jest.fn(),
        sendTransmitMode: jest.fn(),
      },
      toggleVisualizerPause: jest.fn(),
      cryptoCorrupted: false,
      deviceName: null,
      deviceProfile: null,
      sources: [],
    } as any;

    const store = createStore();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider mockValue={mockValue}>
            <SpectrumRoute activeTab="visualizer" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(fftPlaybackCanvasMock).toHaveBeenCalled();
    });

    const playbackProps =
      fftPlaybackCanvasMock.mock.calls[
        fftPlaybackCanvasMock.mock.calls.length - 1
      ]?.[0];
    expect(playbackProps).toMatchObject({
      displayTemporalResolution: "high",
      fftMin: -120,
      fftMax: 0,
      vizZoom: 3.5,
      vizZoomFloor: 2.25,
      vizZoomFloorPan: 1250,
      vizPanOffset: 42,
    });
    expect(typeof playbackProps?.onVizZoomChange).toBe("function");
    expect(typeof playbackProps?.onVizZoomFloorChange).toBe("function");
    expect(typeof playbackProps?.onVizZoomFloorPanChange).toBe("function");
    expect(typeof playbackProps?.onVizPanChange).toBe("function");
  });

  it("shows stopped mock tx as a placeholder without rendering the live mock apt stream", async () => {
    const mockValue = {
      state: {
        sourceMode: "live",
        selectedFiles: [],
        stitchTrigger: 0,
        stitchSourceSettings: { gain: 0, ppm: 0 },
        isStitchPaused: false,
        fftSize: 16384,
        displayMode: "fft",
        powerScale: "dB",
        snapshotGridPreference: true,
        displayTemporalResolution: "medium",
        frequencyRange: { min: 0, max: 4_372_000 },
        activeSignalArea: "A",
        vizZoom: 1,
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        vizPanOffset: 0,
        fftMinDb: -120,
        fftMaxDb: 0,
        fftWindow: "Rectangular",
        autoZoomStability: false,
        fftFrameRate: 60,
        showSpikeOverlay: false,
        heterodyningVerifyRequestId: 0,
        heterodyningHighlightedBins: [],
        isWaterfallCleared: false,
        selectedFilesCount: 0,
      },
      dispatch: jest.fn(),
      fftVisualizerMachine: {} as any,
      manualVisualizerPaused: false,
      setManualVisualizerPaused: jest.fn(),
      selectedSourceId: "mock-tx",
      setSelectedSourceId: jest.fn(),
      selectedSource: {
        id: "mock-tx",
        name: "Mock Tx SDR",
        kind: "mock_tx",
        capability: "tx",
        status: "connected",
      } as any,
      selectedSourceDerived: {
        deviceState: "connected",
        deviceName: null,
        deviceProfile: null,
        deviceInfo: null,
        backend: null,
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [],
        sampleRateHz: 4_372_000,
        sdrSettings: { sample_rate: 4_372_000 },
      },
      effectiveFrames: [{ waveform: new Float32Array([0, 1]) }],
      effectiveSdrSettings: { sample_rate: 4_372_000 },
      sampleRateHzEffective: 4_372_000,
      signalAreaBounds: null,
      lastSentPauseRef: { current: null },
      wsConnection: {
        isConnected: true,
        activeSourceId: "mock-apt",
        deviceState: "connected",
        deviceLoadingReason: null,
        isPaused: false,
        serverPaused: false,
        backend: null,
        deviceInfo: null,
        deviceName: null,
        deviceProfile: null,
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [],
        sampleRateHz: 4_372_000,
        sdrSettings: { sample_rate: 4_372_000 },
        sdrLimitMarkers: [],
        dataRef: { current: [{ waveform: new Float32Array([0, 1]) }] },
        spectrumFrames: [{ waveform: new Float32Array([0, 1]) }],
        sources: [],
        captureStatus: { status: "idle" },
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
        sendPowerScaleCommand: jest.fn(),
        sendTransmitMode: jest.fn(),
      },
      toggleVisualizerPause: jest.fn(),
      cryptoCorrupted: false,
      deviceName: null,
      deviceProfile: null,
      sources: [],
    } as any;

    const store = createStore({
      spectrum: {
        ...spectrumSlice(undefined, { type: "@@INIT" as any }),
        deviceKind: "mock_tx",
        txCenterFrequencyHz: Number.NaN,
      },
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider mockValue={mockValue}>
            <SpectrumRoute activeTab="visualizer" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(fftAndWaterfallMock).toHaveBeenCalled();
    });

    const visualizerProps =
      fftAndWaterfallMock.mock.calls[
        fftAndWaterfallMock.mock.calls.length - 1
      ]?.[0];
    expect(visualizerProps.txSlider).toMatchObject({
      visible: true,
      signalLabel: "WIFI",
      visibleMinHz: 0,
      visibleMaxHz: 4_372_000,
      txCenterHz: 2_186_000,
      txSampleRateHz: 2_400_000,
    });
    expect(visualizerProps.limitMarkers).toEqual([]);
    expect(visualizerProps.deviceProfile).toMatchObject({ kind: "mock_tx" });
    expect(visualizerProps.isDeviceConnected).toBe(true);
    expect(visualizerProps.dataRef.current?.iq_data).toBeUndefined();
    expect(visualizerProps.placeholderState).toMatchObject({
      kind: "idle",
      title: "Start Tx to transmit",
    });
    expect(mockValue.wsConnection.sendTransmitMode).not.toHaveBeenCalled();
  });

  it("keeps Mock Tx standby paused until transmit starts", async () => {
    const mockValue = {
      state: {
        sourceMode: "live",
        selectedFiles: [],
        stitchTrigger: 0,
        stitchSourceSettings: { gain: 0, ppm: 0 },
        isStitchPaused: false,
        fftSize: 2048,
        displayMode: "fft",
        powerScale: "dBm",
        snapshotGridPreference: true,
        displayTemporalResolution: "medium",
        frequencyRange: { min: 135_500_000, max: 138_700_000 },
        activeSignalArea: "A",
        vizZoom: 1,
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        vizPanOffset: 0,
        fftMinDb: -100,
        fftMaxDb: 30,
        fftWindow: "Rectangular",
        autoZoomStability: false,
        fftFrameRate: 60,
        showSpikeOverlay: false,
        heterodyningVerifyRequestId: 0,
        heterodyningHighlightedBins: [],
        isWaterfallCleared: false,
        selectedFilesCount: 0,
      },
      dispatch: jest.fn(),
      fftVisualizerMachine: {} as any,
      manualVisualizerPaused: false,
      setManualVisualizerPaused: jest.fn(),
      selectedSourceId: "mock-tx",
      setSelectedSourceId: jest.fn(),
      selectedSource: {
        id: "mock-tx",
        name: "Mock Tx SDR",
        kind: "mock_tx",
        capability: "tx",
        status: "connected",
      } as any,
      selectedSourceDerived: {
        deviceState: "connected",
        deviceName: "Mock Tx SDR",
        deviceProfile: {
          kind: "mock_tx",
          is_rtl_sdr: false,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
        },
        deviceInfo: null,
        backend: "mock_tx",
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [3_200_000],
        sampleRateHz: 3_200_000,
        sdrSettings: { sample_rate: 3_200_000 },
      },
      effectiveFrames: [],
      effectiveSdrSettings: { sample_rate: 3_200_000 },
      sampleRateHzEffective: 3_200_000,
      signalAreaBounds: null,
      lastSentPauseRef: { current: null },
      wsConnection: {
        isConnected: true,
        activeSourceId: "mock-tx",
        deviceState: "connected",
        deviceLoadingReason: null,
        isPaused: false,
        serverPaused: false,
        backend: "mock_tx",
        deviceInfo: null,
        deviceName: "Mock Tx SDR",
        deviceProfile: {
          kind: "mock_tx",
          is_rtl_sdr: false,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
        },
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [3_200_000],
        sampleRateHz: 3_200_000,
        sdrSettings: { sample_rate: 3_200_000 },
        sdrLimitMarkers: [],
        dataRef: { current: null },
        spectrumFrames: [],
        sources: [],
        captureStatus: { status: "idle" },
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
        sendPowerScaleCommand: jest.fn(),
        sendTransmitMode: jest.fn(),
      },
      toggleVisualizerPause: jest.fn(),
      cryptoCorrupted: false,
      deviceName: "Mock Tx SDR",
      deviceProfile: {
        kind: "mock_tx",
        is_rtl_sdr: false,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
      },
      sources: [],
    } as any;

    const store = createStore({
      spectrum: {
        ...spectrumSlice(undefined, { type: "@@INIT" as any }),
        deviceKind: "mock_tx",
      },
      websocket: {
        ...websocketSlice(undefined, { type: "@@INIT" as any }),
        sourceStatuses: { "mock-tx": "connected" },
      },
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider mockValue={mockValue}>
            <SpectrumRoute activeTab="visualizer" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(fftAndWaterfallMock).toHaveBeenCalled();
    });

    const visualizerProps =
      fftAndWaterfallMock.mock.calls[
        fftAndWaterfallMock.mock.calls.length - 1
      ]?.[0];
    expect(visualizerProps.isPaused).toBe(true);
    expect(visualizerProps.placeholderState).toMatchObject({
      title: "Start Tx to transmit",
    });
  });

  it("keeps the live mock tx monitor centered on tx center instead of frame metadata", async () => {
    const liveMockTxFrame = {
      type: "spectrum" as const,
      data_type: "iq_raw" as const,
      center_frequency_hz: 1_600_000,
      sample_rate: 1_000_000,
      timestamp: 1,
      iq_data: new Uint8Array(4096).fill(128),
    };
    const mockValue = {
      state: {
        sourceMode: "live",
        selectedFiles: [],
        stitchTrigger: 0,
        stitchSourceSettings: { gain: 0, ppm: 0 },
        isStitchPaused: false,
        fftSize: 16384,
        displayMode: "fft",
        powerScale: "dB",
        snapshotGridPreference: true,
        displayTemporalResolution: "medium",
        frequencyRange: { min: 0, max: 3_200_000 },
        activeSignalArea: "A",
        vizZoom: 1,
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        vizPanOffset: 0,
        fftMinDb: -120,
        fftMaxDb: 0,
        fftWindow: "Rectangular",
        autoZoomStability: false,
        fftFrameRate: 60,
        showSpikeOverlay: false,
        heterodyningVerifyRequestId: 0,
        heterodyningHighlightedBins: [],
        isWaterfallCleared: false,
        selectedFilesCount: 0,
      },
      dispatch: jest.fn(),
      fftVisualizerMachine: {} as any,
      manualVisualizerPaused: false,
      setManualVisualizerPaused: jest.fn(),
      selectedSourceId: "mock-tx",
      setSelectedSourceId: jest.fn(),
      selectedSource: {
        id: "mock-tx",
        name: "Mock Tx SDR",
        kind: "mock_tx",
        capability: "tx",
        status: "transmitting",
      } as any,
      selectedSourceDerived: {
        deviceState: "connected",
        deviceName: "Mock Tx SDR",
        deviceProfile: {
          kind: "mock_tx",
          is_rtl_sdr: false,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
        },
        deviceInfo: null,
        backend: "mock_tx",
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [3_200_000],
        sampleRateHz: 3_200_000,
        sdrSettings: { sample_rate: 3_200_000 },
      },
      effectiveFrames: [],
      effectiveSdrSettings: { sample_rate: 3_200_000 },
      sampleRateHzEffective: 3_200_000,
      signalAreaBounds: null,
      lastSentPauseRef: { current: null },
      wsConnection: {
        isConnected: true,
        activeSourceId: "mock-tx",
        deviceState: "connected",
        deviceLoadingReason: null,
        isPaused: false,
        serverPaused: false,
        backend: "mock_tx",
        deviceInfo: null,
        deviceName: "Mock Tx SDR",
        deviceProfile: {
          kind: "mock_tx",
          is_rtl_sdr: false,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
        },
        maxSampleRateHz: 20_000_000,
        sampleRateOptions: [3_200_000],
        sampleRateHz: 3_200_000,
        sdrSettings: { sample_rate: 3_200_000 },
        sdrLimitMarkers: [],
        dataRef: { current: liveMockTxFrame },
        spectrumFrames: [liveMockTxFrame],
        sources: [],
        captureStatus: { status: "idle" },
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
        sendPowerScaleCommand: jest.fn(),
        sendTransmitMode: jest.fn(),
      },
      toggleVisualizerPause: jest.fn(),
      cryptoCorrupted: false,
      deviceName: "Mock Tx SDR",
      deviceProfile: {
        kind: "mock_tx",
        is_rtl_sdr: false,
        supports_approx_dbm: true,
        supports_raw_iq_stream: true,
      },
      sources: [],
    } as any;

    const store = createStore({
      spectrum: {
        ...spectrumSlice(undefined, { type: "@@INIT" as any }),
        deviceKind: "mock_tx",
        txCenterFrequencyHz: 137_100_000,
        txSampleRateHz: 2_400_000,
      },
      websocket: {
        ...websocketSlice(undefined, { type: "@@INIT" as any }),
        sourceStatuses: { "mock-tx": "transmitting" },
      },
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider mockValue={mockValue}>
            <SpectrumRoute activeTab="visualizer" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(fftAndWaterfallMock).toHaveBeenCalled();
    });

    const visualizerProps =
      fftAndWaterfallMock.mock.calls[
        fftAndWaterfallMock.mock.calls.length - 1
      ]?.[0];
    expect(visualizerProps.frequencyRange).toEqual({
      min: 135_500_000,
      max: 138_700_000,
    });
    expect(visualizerProps.centerFrequencyHz).toBe(137_100_000);
    expect(visualizerProps.hardwareSampleRateHz).toBe(3_200_000);
    expect(visualizerProps.dataRef.current).toBe(liveMockTxFrame);
    expect(visualizerProps.txSlider).toMatchObject({
      visible: true,
      visibleMinHz: 135_500_000,
      visibleMaxHz: 138_700_000,
      txCenterHz: 137_100_000,
      txSampleRateHz: 2_400_000,
    });
    expect(mockValue.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SET_SAMPLE_RATE",
        sampleRateHz: 2_400_000,
      }),
    );
  });

  it("syncs canvas Tx bandwidth changes to the active backend transmitter while viewing Mock APT", async () => {
    jest.useFakeTimers();
    try {
      const sendTransmitMode = jest.fn();
      const mockAptSource = {
        id: "mock-apt",
        name: "Mock APT SDR",
        kind: "mock_apt",
        capability: "mock",
        status: "streaming",
      };
      const mockTxSource = {
        id: "mock-tx",
        name: "Mock Tx SDR",
        kind: "mock_tx",
        capability: "tx",
        status: "transmitting",
        serial_number: "mock-tx",
      };
      const mockValue = {
        state: {
          sourceMode: "live",
          selectedFiles: [],
          stitchTrigger: 0,
          stitchSourceSettings: { gain: 0, ppm: 0 },
          isStitchPaused: false,
          fftSize: 2048,
          displayMode: "fft",
          powerScale: "dBm",
          snapshotGridPreference: true,
          displayTemporalResolution: "medium",
          frequencyRange: { min: 134_914_000, max: 139_286_000 },
          activeSignalArea: "A",
          vizZoom: 1,
          vizZoomFloor: 1,
          vizZoomFloorPan: 0,
          vizPanOffset: 0,
          fftMinDb: -100,
          fftMaxDb: 30,
          fftWindow: "Rectangular",
          autoZoomStability: false,
          fftFrameRate: 60,
          showSpikeOverlay: false,
          heterodyningVerifyRequestId: 0,
          heterodyningHighlightedBins: [],
          isWaterfallCleared: false,
          selectedFilesCount: 0,
        },
        dispatch: jest.fn(),
        fftVisualizerMachine: {} as any,
        manualVisualizerPaused: false,
        setManualVisualizerPaused: jest.fn(),
        selectedSourceId: "mock-apt",
        setSelectedSourceId: jest.fn(),
        selectedSource: mockAptSource,
        selectedSourceDerived: {
          deviceState: "streaming",
          deviceName: "Mock APT SDR",
          deviceProfile: {
            kind: "mock_apt",
            is_rtl_sdr: true,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
          },
          deviceInfo: null,
          backend: "mock_apt",
          maxSampleRateHz: 4_372_000,
          sampleRateOptions: [4_372_000],
          sampleRateHz: 4_372_000,
          sdrSettings: { sample_rate: 4_372_000 },
        },
        effectiveFrames: [],
        effectiveSdrSettings: { sample_rate: 4_372_000 },
        sampleRateHzEffective: 4_372_000,
        signalAreaBounds: null,
        lastSentPauseRef: { current: null },
        wsConnection: {
          isConnected: true,
          activeSourceId: "mock-apt",
          deviceState: "streaming",
          deviceLoadingReason: null,
          isPaused: false,
          serverPaused: false,
          backend: "mock_apt",
          deviceInfo: null,
          deviceName: "Mock APT SDR",
          deviceProfile: {
            kind: "mock_apt",
            is_rtl_sdr: true,
            supports_approx_dbm: true,
            supports_raw_iq_stream: true,
          },
          maxSampleRateHz: 4_372_000,
          sampleRateOptions: [4_372_000],
          sampleRateHz: 4_372_000,
          sdrSettings: { sample_rate: 4_372_000 },
          sdrLimitMarkers: [],
          dataRef: { current: null },
          spectrumFrames: [],
          sources: [mockAptSource, mockTxSource],
          captureStatus: { status: "idle" },
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
          sendPowerScaleCommand: jest.fn(),
          sendTransmitMode,
        },
        toggleVisualizerPause: jest.fn(),
        cryptoCorrupted: false,
        deviceName: "Mock APT SDR",
        deviceProfile: {
          kind: "mock_apt",
          is_rtl_sdr: true,
          supports_approx_dbm: true,
          supports_raw_iq_stream: true,
        },
        sources: [mockAptSource, mockTxSource],
      } as any;

      const store = createStore({
        spectrum: {
          ...spectrumSlice(undefined, { type: "@@INIT" as any }),
          deviceKind: "mock_apt",
          txCenterFrequencyHz: 137_100_000,
          txSampleRateHz: 2_400_000,
          txPowerDbm: -18,
        },
        websocket: {
          ...websocketSlice(undefined, { type: "@@INIT" as any }),
          sourceStatuses: { "mock-tx": "transmitting" },
        },
      });

      const { rerender } = render(
        <Provider store={store}>
          <ThemeProvider theme={theme}>
            <SpectrumProvider mockValue={mockValue}>
              <SpectrumRoute activeTab="visualizer" />
            </SpectrumProvider>
          </ThemeProvider>
        </Provider>,
      );

      expect(sendTransmitMode).toHaveBeenCalledWith(
        true,
        "Mock Tx SDR",
        expect.objectContaining({ bandwidthHz: 2_400_000 }),
      );
      sendTransmitMode.mockClear();

      act(() => {
        store.dispatch(setTxSampleRateHz(873_000));
        rerender(
          <Provider store={store}>
            <ThemeProvider theme={theme}>
              <SpectrumProvider mockValue={mockValue}>
                <SpectrumRoute activeTab="visualizer" />
              </SpectrumProvider>
            </ThemeProvider>
          </Provider>,
        );
      });
      act(() => {
        jest.advanceTimersByTime(17);
      });

      expect(sendTransmitMode).toHaveBeenCalledWith(
        true,
        "Mock Tx SDR",
        expect.objectContaining({
          serialNumber: "mock-tx",
          centerFrequencyHz: 137_100_000,
          bandwidthHz: 873_000,
          powerDbm: -18,
          txSignal: "wifi",
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not show the tx slider controls for rx-only mock apt sources", async () => {
    const mockValue = {
      state: {
        sourceMode: "live",
        selectedFiles: [],
        stitchTrigger: 0,
        stitchSourceSettings: { gain: 0, ppm: 0 },
        isStitchPaused: false,
        fftSize: 2048,
        displayMode: "fft",
        powerScale: "dB",
        snapshotGridPreference: true,
        displayTemporalResolution: "medium",
        frequencyRange: { min: 18_000, max: 4_372_000 },
        activeSignalArea: "A",
        vizZoom: 1,
        vizZoomFloor: 1,
        vizZoomFloorPan: 0,
        vizPanOffset: 0,
        fftMinDb: -120,
        fftMaxDb: 0,
        fftWindow: "Rectangular",
        autoZoomStability: false,
        fftFrameRate: 60,
        showSpikeOverlay: false,
        heterodyningVerifyRequestId: 0,
        heterodyningHighlightedBins: [],
        isWaterfallCleared: false,
        selectedFilesCount: 0,
      },
      dispatch: jest.fn(),
      fftVisualizerMachine: {} as any,
      manualVisualizerPaused: false,
      setManualVisualizerPaused: jest.fn(),
      selectedSourceId: "mock-apt",
      setSelectedSourceId: jest.fn(),
      selectedSource: {
        id: "mock-apt",
        name: "Mock APT SDR",
        kind: "mock_apt",
        capability: "mock",
        status: "streaming",
      } as any,
      selectedSourceDerived: {
        deviceState: "connected",
        deviceName: "Mock APT SDR",
        deviceProfile: {
          kind: "mock_apt",
          is_rtl_sdr: false,
          supports_approx_dbm: false,
          supports_raw_iq_stream: false,
        },
        deviceInfo: null,
        backend: "mock_apt",
        maxSampleRateHz: 3_200_000,
        sampleRateOptions: [3_200_000],
        sampleRateHz: 3_200_000,
        sdrSettings: { sample_rate: 3_200_000 },
      },
      effectiveFrames: [{ waveform: new Float32Array([0, 1]) }],
      effectiveSdrSettings: { sample_rate: 3_200_000 },
      sampleRateHzEffective: 3_200_000,
      signalAreaBounds: null,
      lastSentPauseRef: { current: null },
      wsConnection: {
        isConnected: true,
        activeSourceId: "mock-apt",
        deviceState: "connected",
        deviceLoadingReason: null,
        isPaused: false,
        serverPaused: false,
        backend: "mock_apt",
        deviceInfo: null,
        deviceName: "Mock APT SDR",
        deviceProfile: {
          kind: "mock_apt",
          is_rtl_sdr: false,
          supports_approx_dbm: false,
          supports_raw_iq_stream: false,
        },
        maxSampleRateHz: 3_200_000,
        sampleRateOptions: [3_200_000],
        sampleRateHz: 3_200_000,
        sdrSettings: { sample_rate: 3_200_000 },
        sdrLimitMarkers: [],
        dataRef: { current: [{ waveform: new Float32Array([0, 1]) }] },
        spectrumFrames: [{ waveform: new Float32Array([0, 1]) }],
        sources: [],
        captureStatus: { status: "idle" },
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
        sendPowerScaleCommand: jest.fn(),
        sendTransmitMode: jest.fn(),
      },
      toggleVisualizerPause: jest.fn(),
      cryptoCorrupted: false,
      deviceName: "Mock APT SDR",
      deviceProfile: {
        kind: "mock_apt",
        is_rtl_sdr: false,
        supports_approx_dbm: false,
        supports_raw_iq_stream: false,
      },
      sources: [],
    } as any;

    const store = createStore({
      spectrum: {
        ...spectrumSlice(undefined, { type: "@@INIT" as any }),
        deviceKind: "mock_apt",
      },
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider mockValue={mockValue}>
            <SpectrumRoute activeTab="visualizer" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(fftAndWaterfallMock).toHaveBeenCalled();
    });

    const visualizerProps =
      fftAndWaterfallMock.mock.calls[
        fftAndWaterfallMock.mock.calls.length - 1
      ]?.[0];
    expect(visualizerProps.txSlider).toBeUndefined();
  });
});
