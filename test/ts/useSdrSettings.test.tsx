import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import type { SdrSettingsConfig } from "@n-apt/hooks/useWebSocket";
import type { SpectrumState } from "@n-apt/hooks/useSpectrumStore";
import { TestWrapper } from "./testUtils";
import spectrumSlice, {
  setSdrSettingsBundle,
} from "@n-apt/redux/slices/spectrumSlice";

jest.mock("@n-apt/hooks/useAuthentication", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
    aesKey: null,
  }),
}));

const mockSdrSettings = {
  sample_rate: 3_200_000,
  center_frequency: 1_600_000,
  gain: { tuner_gain: 49.6, rtl_agc: true, tuner_agc: false },
  ppm: 2,
  fft: {
    default_size: 16384,
    default_frame_rate: 42,
    max_size: 262144,
    max_frame_rate: 48,
    size_to_frame_rate: { "8192": 60, "16384": 42 },
  },
};

jest.mock("@n-apt/hooks/useWebSocket", () => ({
  useWebSocket: (url: any, key: any, enabled: any) => ({
    isConnected: enabled,
    deviceState: "connected",
    sdrSettings: mockSdrSettings,
    spectrumFrames: [],
    dataRef: { current: null },
    sendSettings: jest.fn(),
    sendGetAutoFftOptions: jest.fn(),
    sendPauseCommand: jest.fn(),
    sendFrequencyRange: jest.fn(),
  }),
}));

type HookHarnessProps = {
  sdrSettings: SdrSettingsConfig;
  sampleRateOptions?: number[];
  spectrumStateOverride?: Pick<
    SpectrumState,
    | "fftSize"
    | "fftWindow"
    | "fftFrameRate"
    | "gain"
    | "hackrfLnaGain"
    | "hackrfVgaGain"
    | "hackrfAmpEnabled"
    | "hackrfBasebandBandwidth"
    | "ppm"
    | "tunerAGC"
    | "rtlAGC"
  >;
};

const HookHarness: React.FC<HookHarnessProps> = ({
  sdrSettings,
  sampleRateOptions,
  spectrumStateOverride,
}) => {
  const { fftSize, fftFrameRate, gain, ppm, tunerAGC, rtlAGC, fftSizeOptions } =
    useSdrSettings({
      maxSampleRate: sdrSettings.sample_rate,
      sampleRateOptions,
      onSettingsChange: jest.fn(),
      sdrSettings,
      spectrumStateOverride,
    });

  return (
    <div>
      <div data-testid="fftSize">{fftSize}</div>
      <div data-testid="fftFrameRate">{fftFrameRate}</div>
      <div data-testid="gain">{gain}</div>
      <div data-testid="ppm">{ppm}</div>
      <div data-testid="tunerAGC">{String(tunerAGC)}</div>
      <div data-testid="rtlAGC">{String(rtlAGC)}</div>
      <div data-testid="fftSizeOptions">{fftSizeOptions.join(",")}</div>
      <div data-testid="sampleRateOptions">
        {sampleRateOptions?.join(",")}
      </div>
    </div>
  );
};

describe("useSdrSettings", () => {
  it("initializes from sdr settings config", () => {
    const sdrSettings: SdrSettingsConfig = {
      sample_rate: 3_200_000,
      center_frequency: 1_600_000,
      gain: {
        tuner_gain: 49.6,
        rtl_agc: true,
        tuner_agc: false,
      },
      ppm: 2,
      fft: {
        default_size: 16384,
        default_frame_rate: 42,
        max_size: 262144,
        max_frame_rate: 48,
        size_to_frame_rate: {
          "8192": 60,
          "16384": 42,
        },
      },
      display: {
        min_db: -120,
        max_db: 0,
        padding: 20,
      },
    };

    render(
      <TestWrapper>
        <MemoryRouter>
          <AuthProvider>
            <SpectrumProvider>
              <HookHarness sdrSettings={sdrSettings} />
            </SpectrumProvider>
          </AuthProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(screen.getByTestId("fftSize")).toHaveTextContent("16384");
    expect(screen.getByTestId("fftFrameRate")).toHaveTextContent("42");
    expect(screen.getByTestId("gain")).toHaveTextContent("49.6");
    expect(screen.getByTestId("ppm")).toHaveTextContent("2");
    expect(screen.getByTestId("tunerAGC")).toHaveTextContent("false");
    expect(screen.getByTestId("rtlAGC")).toHaveTextContent("true");
    expect(screen.getByTestId("fftSizeOptions")).toHaveTextContent(
      "8192,16384",
    );
  });

  it("prefers backend sample rate options when provided", () => {
    const backendSampleRates = [
      9_125_000,
      10_000_000,
      12_800_000,
      16_000_000,
      20_000_000,
    ];

    render(
      <TestWrapper>
        <MemoryRouter>
          <AuthProvider>
            <SpectrumProvider>
              <HookHarness
                sdrSettings={mockSdrSettings}
                sampleRateOptions={backendSampleRates}
              />
            </SpectrumProvider>
          </AuthProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(screen.getByTestId("sampleRateOptions")).toHaveTextContent(
      "9125000,10000000,12800000,16000000,20000000",
    );
  });

  it("does not overwrite an existing fft size with the config default", () => {
    render(
      <TestWrapper>
        <MemoryRouter>
          <AuthProvider>
            <SpectrumProvider>
              <HookHarness
                sdrSettings={mockSdrSettings}
                spectrumStateOverride={{
                  fftSize: 8192,
                  fftWindow: "Rectangular",
                  fftFrameRate: 42,
                  gain: 49.6,
                  hackrfLnaGain: 49.6,
                  hackrfVgaGain: 62,
                  hackrfAmpEnabled: false,
                  hackrfBasebandBandwidth: 0,
                  ppm: 2,
                  tunerAGC: false,
                  rtlAGC: true,
                }}
              />
            </SpectrumProvider>
          </AuthProvider>
        </MemoryRouter>
      </TestWrapper>,
    );

    expect(screen.getByTestId("fftSize")).toHaveTextContent("8192");
  });

  it("preserves persisted fft size instead of applying backend defaults on mount", async () => {
    localStorage.setItem(
      "napt-sdr-settings-v2",
      JSON.stringify({
        fftSize: 8192,
      }),
    );

    const store = configureStore({
      reducer: {
        spectrum: spectrumSlice,
      },
    });

    store.dispatch(
      setSdrSettingsBundle({
        fftSize: 8192,
        fftWindow: "Rectangular",
        fftFrameRate: 42,
        gain: 49.6,
        ppm: 2,
        tunerAGC: false,
        rtlAGC: true,
      }),
    );

    render(
      <Provider store={store}>
        <HookHarness
          sdrSettings={{
            ...mockSdrSettings,
            fft: {
              ...mockSdrSettings.fft,
              default_size: 16384,
            },
          }}
        />
      </Provider>,
    );

    await waitFor(() => {
      expect(store.getState().spectrum.fftSize).toBe(8192);
    });
    expect(screen.getByTestId("fftSize")).toHaveTextContent("8192");

    localStorage.removeItem("napt-sdr-settings-v2");
  });
});
