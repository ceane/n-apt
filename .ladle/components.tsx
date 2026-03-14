import React, { useEffect } from "react";
import type { GlobalProvider } from "@ladle/react";
import { useLadleContext } from "@ladle/react";
import { MemoryRouter } from "react-router-dom";
import ReduxProvider from "../src/ts/components/ReduxProvider";
import ReduxThemeProvider from "../src/ts/components/ReduxThemeProvider";
import { PromptProvider } from "../src/ts/components/ui/PromptProvider";
import { AuthProvider } from "../src/ts/hooks/useAuthentication";
import { Model3DProvider } from "../src/ts/hooks/useModel3D";
import { HotspotEditorProvider } from "../src/ts/hooks/useHotspotEditor";
import { SpectrumProvider } from "../src/ts/hooks/useSpectrumStore";
import { store, authActions, themeActions, websocketActions } from "../src/ts/redux";
import { createGlobalStyle } from "styled-components";

const GlobalStyle = createGlobalStyle`
  body, button, input, select, textarea {
    font-family: "JetBrains Mono", monospace !important;
  }
`;

const serverStatus = {
  type: "status" as const,
  device_connected: false,
  device_info:
    "Mock APT SDR - Freq: 1600000 Hz, Rate: 3200000 Hz (Sample Rate: 3200000 Hz), Gain: 49.6 dB, PPM: 1",
  device_name: "Mock APT SDR",
  device_loading: false,
  device_loading_reason: null,
  device_state: "disconnected" as const,
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

const LadleBootstrap = () => {
  useEffect(() => {
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
    store.dispatch(
      websocketActions.updateDeviceState({
        isConnected: serverStatus.device_connected,
        deviceInfo: serverStatus.device_info,
        deviceName: serverStatus.device_name,
        deviceLoadingReason: serverStatus.device_loading_reason,
        deviceState: serverStatus.device_state,
        isPaused: serverStatus.paused,
        backend: serverStatus.device,
        maxSampleRateHz: serverStatus.max_sample_rate,
        sampleRateHz: serverStatus.sdr_settings.sample_rate,
        sdrSettings: serverStatus.sdr_settings,
        deviceProfile: serverStatus.device_profile,
      }),
    );
  }, []);

  return null;
};

const RouterSync = ({ children }: { children: React.ReactNode }) => {
  const { globalState } = useLadleContext();
  const storyId = globalState.story || "";

  // Instead of direct navigation, we rely on the MemoryRouter's initialEntries
  // but we want to re-render the router when the story changes to force a "navigation"
  return <React.Fragment key={storyId}>{children}</React.Fragment>;
};

const routeToTab = (storyId: string) => {
  if (storyId.includes("draw")) return "/draw-signal";
  if (storyId.includes("demod")) return "/demodulate";
  if (storyId.includes("3d-model") || storyId.includes("human-model")) return "/3d-model";
  if (storyId.includes("3d/") || storyId.includes("brain") || storyId.includes("radiation-lobe") || storyId.includes("polar-radio") || storyId.includes("horizon-focus")) return "/3d-components";
  if (storyId.includes("map")) return "/map-endpoints";
  return "/visualizer";
};

export const Provider: GlobalProvider = ({ children }) => {
  const { globalState } = useLadleContext();
  const storyId = globalState.story || "";
  const activeRoute = routeToTab(storyId);

  return (
    <MemoryRouter initialEntries={[activeRoute]}>
      <ReduxProvider>
        <ReduxThemeProvider>
          <AuthProvider>
            <Model3DProvider>
              <HotspotEditorProvider>
                <SpectrumProvider>
                  <PromptProvider>
                    <GlobalStyle />
                    <LadleBootstrap />
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
