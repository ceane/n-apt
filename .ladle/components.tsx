import React, { useEffect } from "react";
import type { GlobalProvider } from "@ladle/react";
import { useLadleContext, ThemeState, ActionType } from "@ladle/react";
import { MemoryRouter } from "react-router-dom";
import ReduxProvider from "../src/ts/components/ReduxProvider";
import ReduxThemeProvider from "../src/ts/components/ReduxThemeProvider";
import { PromptProvider } from "../src/ts/components/ui/PromptProvider";
import { AuthProvider } from "../src/ts/hooks/useAuthentication";
import { Model3DProvider } from "../src/ts/hooks/useModel3D";
import { HotspotEditorProvider } from "../src/ts/hooks/useHotspotEditor";
import {
  SpectrumProvider,
  INITIAL_SPECTRUM_STATE,
} from "../src/ts/hooks/useSpectrumStore";
import type {
  SpectrumStoreContextValue,
  SpectrumState,
} from "../src/ts/hooks/useSpectrumStore";
import type {
  DeviceState,
  DeviceLoadingReason,
} from "../src/ts/hooks/useWebSocket";
import { store, authActions, themeActions, websocketActions, spectrumActions } from "../src/ts/redux";
import { setDisconnected, setConnected } from "../src/ts/redux/slices/websocketSlice";
import { createGlobalStyle } from "styled-components";
import type {
  SpectrumFrame,
  SdrSettingsConfig,
  CaptureRequest,
  CaptureStatus,
} from "../src/ts/consts/schemas/websocket";

const GlobalStyle = createGlobalStyle`
  body, button, input, select, textarea {
    font-family: "JetBrains Mono", monospace !important;
  }
`;

type WsOverrides = {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason | null;
};

const connectedOverrides: WsOverrides = {
  isConnected: true,
  deviceState: "connected",
  deviceLoadingReason: null,
};

const disconnectedOverrides: WsOverrides = {
  isConnected: false,
  deviceState: "disconnected",
  deviceLoadingReason: null,
};

const serverStatus = {
  type: "status" as const,
  device_connected: connectedOverrides.isConnected,
  device_info:
    "Mock APT SDR - Freq: 1600000 Hz, Rate: 3200000 Hz (Sample Rate: 3200000 Hz), Gain: 49.6 dB, PPM: 1",
  device_name: "Mock APT SDR",
  device_loading: Boolean(connectedOverrides.deviceLoadingReason),
  device_loading_reason: connectedOverrides.deviceLoadingReason,
  device_state: connectedOverrides.deviceState,
  paused: false,
  max_sample_rate: 64000000,
  channels: [
    {
      id: "a",
      label: "A",
      min_mhz: 0.018,
      max_mhz: 4.37,
      description: "Area A: 18kHz-4.47 MHz range",
    },
    {
      id: "b",
      label: "B",
      min_mhz: 24.72,
      max_mhz: 29.88,
      description: "Area B: 24.72-29.88 MHz range",
    },
  ],
  sdr_settings: {
    sample_rate: 3200000,
    center_frequency: 1600000,
    gain: {
      tuner_gain: 49.6,
      rtl_agc: false,
      tuner_agc: false,
    },
    ppm: 1.0,
    fft: {
      default_size: 262144,
      default_frame_rate: 12,
      max_size: 262144,
      max_frame_rate: 60,
      size_to_frame_rate: {
        8192: 60,
        16384: 60,
        32768: 60,
        65536: 48,
        131072: 24,
        262144: 12,
      },
    },
    display: {
      min_db: -120,
      max_db: 0,
      padding: 20,
    },
    limits: {
      lower_limit_mhz: 0.5,
      upper_limit_mhz: 28.8,
      lower_limit_label: "RTL-SDR v4 lower limit",
      upper_limit_label: "Potential hardware spur",
    },
  },
  device: "mock_apt" as const,
  device_profile: {
    kind: "mock_apt",
    is_rtl_sdr: false,
    supports_approx_dbm: false,
    supports_raw_iq_stream: false,
  },
};

const createSignalBounds = (frames: SpectrumFrame[]) =>
  frames.reduce<Record<string, { min: number; max: number }>>((acc, frame) => {
    acc[frame.label] = { min: frame.min_mhz, max: frame.max_mhz };
    acc[frame.label.toLowerCase()] = { min: frame.min_mhz, max: frame.max_mhz };
    return acc;
  }, {});

const createMutableRef = <T,>(value: T): React.MutableRefObject<T> => ({ current: value });

const createMockSpectrumStoreValue = (
  route: string,
  overrides: WsOverrides,
): SpectrumStoreContextValue => {
  const frames = serverStatus.channels;
  const fallbackRange = {
    min: frames[0]?.min_mhz ?? 0,
    max: frames[0]?.max_mhz ?? 1,
  };
  const spectrumState: SpectrumState = {
    ...INITIAL_SPECTRUM_STATE,
    frequencyRange: fallbackRange,
    activeSignalArea: frames[0]?.label ?? "A",
    sampleRateHz: serverStatus.sdr_settings.sample_rate,
    sourceMode: route.includes("draw") ? "file" : "live",
  };

  const noop = () => { };
  const _noopPromise = async () => { };

  return {
    state: spectrumState,
    dispatch: () => undefined,
    manualVisualizerPaused: false,
    setManualVisualizerPaused: () => undefined,
    effectiveFrames: frames,
    effectiveSdrSettings: serverStatus.sdr_settings as SdrSettingsConfig,
    sampleRateHzEffective: serverStatus.sdr_settings.sample_rate,
    sampleRateMHz: serverStatus.sdr_settings.sample_rate / 1_000_000,
    signalAreaBounds: createSignalBounds(frames),
    lastSentPauseRef: createMutableRef<boolean | null>(null),
    wsConnection: {
      isConnected: overrides.isConnected,
      deviceState: overrides.deviceState,
      deviceLoadingReason: overrides.deviceLoadingReason,
      isPaused: false,
      serverPaused: false,
      backend: serverStatus.device,
      deviceInfo: serverStatus.device_info,
      deviceName: serverStatus.device_name,
      deviceProfile: serverStatus.device_profile,
      maxSampleRateHz: serverStatus.max_sample_rate,
      sampleRateHz: serverStatus.sdr_settings.sample_rate,
      sdrSettings: serverStatus.sdr_settings as SdrSettingsConfig,
      dataRef: createMutableRef<any>([]),
      spectrumFrames: frames,
      captureStatus: null as CaptureStatus,
      autoFftOptions: null,
      error: null,
      cryptoCorrupted: false,
      sendFrequencyRange: noop,
      sendPauseCommand: noop,
      sendSettings: noop,
      sendRestartDevice: noop,
      sendCaptureCommand: (_req: CaptureRequest) => noop(),
      sendScanCommand: noop,
      sendDemodulateCommand: noop,
      sendTrainingCommand: noop,
      sendGetAutoFftOptions: noop,
      sendPowerScaleCommand: noop,
    },
    toggleVisualizerPause: noop,
    cryptoCorrupted: false,
    deviceName: serverStatus.device_name,
    deviceProfile: serverStatus.device_profile,
  };
};

const LadleBootstrap = ({ wsOverrides }: { wsOverrides: WsOverrides }) => {
  useEffect(() => {
    const fallbackRange = {
      min: serverStatus.channels[0]?.min_mhz ?? 0,
      max: serverStatus.channels[0]?.max_mhz ?? 1,
    };

    store.dispatch(
      themeActions.updateThemeSettings({
        appMode: "dark",
        accentColor: "#00d4ff",
        fftColor: "#00d4ff",
        waterfallTheme: "classic",
      }),
    );
    store.dispatch(authActions.setHasPasskeys(false));
    store.dispatch(websocketActions.setSpectrumFrames(serverStatus.channels));
    store.dispatch(spectrumActions.setActiveSignalArea(serverStatus.channels[0]?.label ?? "A"));
    store.dispatch(spectrumActions.setFrequencyRange(fallbackRange));
    store.dispatch(spectrumActions.setSampleRate(serverStatus.sdr_settings.sample_rate));
    store.dispatch(spectrumActions.setGain(serverStatus.sdr_settings.gain.tuner_gain));
    store.dispatch(spectrumActions.setPpm(serverStatus.sdr_settings.ppm));
    store.dispatch(spectrumActions.setTunerAGC(serverStatus.sdr_settings.gain.tuner_agc));
    store.dispatch(spectrumActions.setRtlAGC(serverStatus.sdr_settings.gain.rtl_agc));
    store.dispatch(spectrumActions.setFftSize(serverStatus.sdr_settings.fft.default_size));
    store.dispatch(spectrumActions.setFftFrameRate(serverStatus.sdr_settings.fft.default_frame_rate));
  }, []);

  useEffect(() => {
    if (wsOverrides.isConnected) {
      store.dispatch(setConnected());
    } else {
      store.dispatch(setDisconnected());
    }

    store.dispatch(
      websocketActions.updateDeviceState({
        isConnected: wsOverrides.isConnected,
        deviceInfo: wsOverrides.isConnected ? serverStatus.device_info : null,
        deviceName: wsOverrides.isConnected ? serverStatus.device_name : null,
        deviceLoadingReason: wsOverrides.deviceLoadingReason,
        deviceState: wsOverrides.deviceState,
        isPaused: serverStatus.paused,
        backend: wsOverrides.isConnected ? serverStatus.device : null,
        maxSampleRateHz: wsOverrides.isConnected
          ? serverStatus.max_sample_rate
          : null,
        sampleRateHz: wsOverrides.isConnected
          ? serverStatus.sdr_settings.sample_rate
          : null,
        sdrSettings: wsOverrides.isConnected ? serverStatus.sdr_settings : null,
        deviceProfile: wsOverrides.isConnected ? serverStatus.device_profile : null,
      }),
    );
  }, [wsOverrides]);

  return null;
};

const RouterSync = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

const routeToTab = (storyId: string) => {
  if (storyId.includes("draw")) return "/draw-signal";
  if (storyId.includes("demod")) return "/demodulate";
  if (
    storyId.includes("model3-d") ||
    storyId.includes("3d-model") ||
    storyId.includes("human-model")
  ) {
    return "/3d-model";
  }
  if (storyId.includes("stitch-test")) return "/stitch-test";
  if (storyId.includes("3d/") || storyId.includes("brain") || storyId.includes("radiation-lobe") || storyId.includes("polar-radio") || storyId.includes("horizon-focus")) return "/3d-components";
  if (storyId.includes("map")) return "/map-endpoints";
  return "/visualizer";
};

const getRouteDefaultOverrides = (route: string): WsOverrides => {
  if (route === "/visualizer") return disconnectedOverrides;
  return connectedOverrides;
};

export const Provider: GlobalProvider = ({ children }) => {
  const { globalState, dispatch } = useLadleContext();
  const storyId = globalState.story || "";
  const activeRoute = routeToTab(storyId);
  const [wsOverrides, setWsOverrides] = React.useState<WsOverrides>(
    getRouteDefaultOverrides(activeRoute),
  );

  useEffect(() => {
    const base = getRouteDefaultOverrides(activeRoute);
    const url = new URL(window.location.href);
    const stateParam = url.searchParams.get("deviceState") as DeviceState | null;
    const connectedParam = url.searchParams.get("connected");
    const loadingParam = url.searchParams.get("loadingReason") as DeviceLoadingReason | null;
    setWsOverrides({
      isConnected:
        connectedParam === "true"
          ? true
          : connectedParam === "false"
            ? false
            : base.isConnected,
      deviceState: stateParam ?? base.deviceState,
      deviceLoadingReason:
        typeof loadingParam === "string" && loadingParam.length > 0
          ? loadingParam
          : base.deviceLoadingReason,
    });
  }, [activeRoute]);

  const spectrumMockValue = React.useMemo(
    () => createMockSpectrumStoreValue(activeRoute, wsOverrides),
    [activeRoute, wsOverrides],
  );

  useEffect(() => {
    if (globalState.theme !== ThemeState.Dark) {
      dispatch({
        type: ActionType.UpdateTheme,
        value: ThemeState.Dark,
      });
    }
  }, [dispatch, globalState.theme]);

  return (
    <MemoryRouter key={`${storyId}:${activeRoute}`} initialEntries={[activeRoute]}>
      <ReduxProvider>
        <ReduxThemeProvider>
          <AuthProvider skipBackendBootstrap={true}>
            <Model3DProvider>
              <HotspotEditorProvider>
                <SpectrumProvider mockValue={spectrumMockValue}>
                  <PromptProvider>
                    <GlobalStyle />
                    <LadleBootstrap wsOverrides={wsOverrides} />
                    <RouterSync>{children}</RouterSync>
                  </PromptProvider>
                </SpectrumProvider>
              </HotspotEditorProvider>
            </Model3DProvider>
          </AuthProvider>
        </ReduxThemeProvider>
      </ReduxProvider>
    </MemoryRouter>
  );
};
