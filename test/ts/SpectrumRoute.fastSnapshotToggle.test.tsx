import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";
import authSlice from "@n-apt/redux/slices/authSlice";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import waterfallSlice from "@n-apt/redux/slices/waterfallSlice";
import themeSlice from "@n-apt/redux/slices/themeSlice";
import settingsSlice from "@n-apt/redux/slices/settingsSlice";
import websocketSlice from "@n-apt/redux/slices/websocketSlice";
import snapshotSlice from "@n-apt/redux/slices/snapshotSlice";
import demodSlice from "@n-apt/redux/slices/demodSlice";
import noteCardsSlice from "@n-apt/redux/slices/noteCardsSlice";
import notificationsSlice from "@n-apt/redux/slices/notificationsSlice";
import sourceRoutingSlice from "@n-apt/redux/slices/sourceRoutingSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import { SpectrumProvider } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { SpectrumRoute } from "@n-apt/app/routes/pages/SpectrumRoute";
import { FastSnapshotControl } from "@n-apt/app/routes/pages/spectrum/SpectrumRouteControls";

const fftAndWaterfallMock = jest.fn((_props: any) => (
  <div data-testid="fft-and-waterfall" />
));
const mockFastSnapshotGetLocation = jest.fn();
const mockGeolocationPermissionQuery = jest.fn();

jest.mock("@n-apt/spectrum/FFTPlaybackCanvas", () => ({
  __esModule: true,
  default: React.forwardRef((props: any, ref: React.Ref<any>) => {
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

jest.mock("@n-apt/spectrum", () => ({
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

jest.mock("@n-apt/app/Layout", () => ({
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

const stableUseSnapshot = (() => {
  // Real useSnapshot memoizes these callbacks (useCallback), so return the
  // same object identity across renders to mirror production behavior.
  return {
    handleSnapshot: jest.fn(),
    isRecording: false,
    recordingCountdown: null,
    supportedVideoFormat: null,
    startFastRecording: jest.fn(),
    stopFastRecording: jest.fn(),
    takeFastSnapshot: jest.fn(),
  };
})();

jest.mock("@n-apt/capture/hooks/useSnapshot", () => ({
  useSnapshot: () => stableUseSnapshot,
}));

jest.mock("@n-apt/maps/public/useGeolocation", () => ({
  useGeolocation: () => ({
    getLocation: mockFastSnapshotGetLocation,
  }),
}));

jest.mock("@n-apt/transmit/TxSliderOverlay", () => ({
  __esModule: true,
  default: () => <div data-testid="tx-slider-overlay" />,
}));

jest.mock("@n-apt/capture/hooks/useSnapshotListener", () => ({
  useSnapshotListener: jest.fn(),
  buildSnapshotSettingsLabel: jest.fn(() => "mock-settings-label"),
}));

jest.mock("@n-apt/app/hooks/useDeviceConnectionState", () => ({
  useDeviceConnectionState: jest.fn(),
}));

jest.mock("@n-apt/capture/hooks/useCaptureWholeChannelSegments", () => ({
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
      sourceRouting: sourceRoutingSlice,
    } as any,
    preloadedState: {
      ...preloadedState,
      sourceRouting: {
        ...sourceRoutingSlice(undefined, { type: "@@INIT" as any }),
        bindings: { "tx-suite:tx": "mock-tx" },
        ...preloadedState?.sourceRouting,
      },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });

const baseMockValue = () => ({
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
    displayTemporalResolution: "reduced",
    frequencyRange: { min: 137_000_000, max: 138_000_000 },
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
    status: "connected",
  } as any,
  selectedSourceDerived: {
    deviceState: "connected",
    deviceName: "Mock APT SDR",
    deviceProfile: null,
    deviceInfo: null,
    backend: null,
    maxSampleRateHz: 4_372_000,
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
    sendTransmitStatus: jest.fn(),
  },
  toggleVisualizerPause: jest.fn(),
  cryptoCorrupted: false,
  deviceName: null,
  deviceProfile: null,
  sources: [],
} as any);

/** Find the FastSnapshotControl element rendered inside the memoized headerActionContent. */
const findSnapshotControl = (
  content: React.ReactNode,
): React.ReactElement<any> | null => {
  const node = content as React.ReactElement<any> | null;
  if (!node || typeof node !== "object") return null;
  if (node.type === FastSnapshotControl) return node;
  const kids = Array.isArray(node.props?.children)
    ? (node.props.children as React.ReactNode[])
    : node.props?.children
      ? [node.props.children]
      : [];
  for (const kid of kids) {
    const found = findSnapshotControl(kid);
    if (found) return found;
  }
  return null;
};

/** Extract the FastSnapshotControl element from the latest mock call. */
const latestControl = (): React.ReactElement<any> | null => {
  const calls = fftAndWaterfallMock.mock.calls;
  const props = calls[calls.length - 1]?.[0];
  return findSnapshotControl(props?.headerActionContent);
};

describe("SpectrumRoute fast snapshot three-state toggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: mockGeolocationPermissionQuery },
    });
    mockGeolocationPermissionQuery.mockReset();
    mockGeolocationPermissionQuery.mockResolvedValue({ state: "prompt" });
    mockFastSnapshotGetLocation.mockReset();
    mockFastSnapshotGetLocation.mockResolvedValue({
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 10,
      timestamp: Date.now(),
    });
  });

  it("renders a live three-state toggle whose state prop stays in sync across mode changes", async () => {
    const mockValue = baseMockValue();
    const store = createStore({
      spectrum: {
        ...spectrumSlice(undefined, { type: "@@INIT" as any }),
        ...mockValue.state,
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

    const initialControl = latestControl();
    expect(initialControl).toBeTruthy();
    expect(initialControl?.props?.fastSnapshotMode).toBe(0);

    // Drive the control the same way the three-state Toggle does: each click
    // passes (state + 1) % 3 to onFastSnapshotModeChange. The memoized
    // element must recompute (regression: missing fastSnapshotMode dep froze
    // the control at state 1 so it could never reach "On + Geo" or "Off").
    let onChange = initialControl?.props?.onFastSnapshotModeChange as (
      mode?: 0 | 1 | 2,
    ) => void;

    await act(async () => {
      onChange(1);
    });
    await waitFor(() => {
      expect(latestControl()?.props?.fastSnapshotMode).toBe(1);
    });

    await act(async () => {
      // Re-read the latest closure so the test mirrors a real click.
      const before = latestControl()?.props?.onFastSnapshotModeChange;
      onChange = before as (mode?: 0 | 1 | 2) => void;
      onChange(2);
    });
    await waitFor(() => {
      expect(latestControl()?.props?.fastSnapshotMode).toBe(2);
    });

    await act(async () => {
      onChange = latestControl()?.props?.onFastSnapshotModeChange as (
        mode?: 0 | 1 | 2,
      ) => void;
      onChange(0);
    });
    await waitFor(() => {
      expect(latestControl()?.props?.fastSnapshotMode).toBe(0);
    });
  });

  it("falls back to On when geolocation permission is denied", async () => {
    mockFastSnapshotGetLocation.mockResolvedValue(null);
    const mockValue = baseMockValue();
    const store = createStore({
      spectrum: {
        ...spectrumSlice(undefined, { type: "@@INIT" as any }),
        ...mockValue.state,
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

    await act(async () => {
      latestControl()?.props?.onFastSnapshotModeChange(2);
    });

    await waitFor(() => {
      expect(latestControl()?.props?.fastSnapshotMode).toBe(1);
    });

    await act(async () => {
      // The next physical click from On normally selects On + Geo. Once that
      // request has been denied, it must skip the unavailable mode and turn
      // the switch Off instead of prompting forever.
      latestControl()?.props?.onFastSnapshotModeChange(2);
    });

    await waitFor(() => {
      expect(latestControl()?.props?.fastSnapshotMode).toBe(0);
    });
  });

  it("uses the compact two-option toggle when permission is denied on load", async () => {
    mockGeolocationPermissionQuery.mockResolvedValue({ state: "denied" });
    const mockValue = baseMockValue();
    const store = createStore({
      spectrum: {
        ...spectrumSlice(undefined, { type: "@@INIT" as any }),
        ...mockValue.state,
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
      expect(latestControl()?.props?.fastSnapshotMode).toBeUndefined();
      expect(latestControl()?.props?.onFastSnapshotModeChange).toBeUndefined();
    });
  });
});
