import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { SignalConfigNode } from "@n-apt/demodulation/react-flow/nodes/SignalConfigNode";
import spectrumReducer from "@n-apt/redux/slices/spectrumSlice";
import websocketReducer from "@n-apt/redux/slices/websocketSlice";
import sourceRoutingReducer from "@n-apt/redux/slices/sourceRoutingSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";

jest.mock("@n-apt/spectrum/public/SignalDisplaySection", () => ({
  SignalDisplaySection: ({
    temporalResolution,
  }: {
    temporalResolution: string;
  }) => (
    <select
      aria-label="Temporal Resolution"
      value={temporalResolution}
      onChange={() => undefined}
    >
      <option value="slow">Slow</option>
      <option value="reduced">Reduced</option>
      <option value="lossless">Lossless</option>
    </select>
  ),
}));

jest.mock("@n-apt/spectrum/public/SourceSettingsSection", () => ({
  SourceSettingsSection: () => null,
}));

jest.mock("@n-apt/settings/public/useSdrSettings", () => ({
  useSdrSettings: () => ({
    sdrSettings: {},
    sampleRateOptions: [3_200_000],
    fftFrameRate: 60,
    maxFrameRate: 60,
    fftSizeOptions: [2048],
    setSampleRate: jest.fn(),
    setFftFrameRate: jest.fn(),
    setFftSize: jest.fn(),
    setFftWindow: jest.fn(),
    setPpm: jest.fn(),
    setGain: jest.fn(),
    setHackrfLnaGain: jest.fn(),
    setHackrfVgaGain: jest.fn(),
    setHackrfAmpEnabled: jest.fn(),
    setHackrfBasebandBandwidth: jest.fn(),
    setTunerAGC: jest.fn(),
    setRtlAGC: jest.fn(),
    scheduleCoupledAdjustment: jest.fn(),
  }),
}));

jest.mock("@n-apt/spectrum/public/useLiveSampleRateControl", () => ({
  useLiveSampleRateControl: () => ({
    handleSampleRateChange: jest.fn(),
  }),
}));

jest.mock("@n-apt/spectrum/public/useSpectrumStore", () => ({
  useSpectrumStore: () => ({
    wsConnection: {
      sdrSettings: {},
      backend: "mock",
      deviceProfile: { kind: "mock" },
      sampleRateOptions: [3_200_000],
      isConnected: true,
      sendSettings: jest.fn(),
    },
  }),
}));

jest.mock("@n-apt/spectrum/public/useSpectrumTransport", () => ({
  useSpectrumTransport: () => ({ sendFrequencyRange: jest.fn() }),
}));

describe("SignalConfigNode", () => {
  it("starts demod signal configuration at Lossless temporal resolution", () => {
    const store = configureStore({
      reducer: {
        spectrum: spectrumReducer,
        websocket: websocketReducer,
        sourceRouting: sourceRoutingReducer,
      },
    });

    render(
      <Provider store={store}>
        <ThemeProvider
          theme={buildAppTheme({
            accentColor: "#00d4ff",
            fftColor: "#00d4ff",
            appMode: "system",
            resolvedMode: "dark",
            waterfallTheme: "classic",
          })}
        >
          <SignalConfigNode
            data={{
              signalOptions: true,
              label: "Signal Configuration",
            }}
          />
        </ThemeProvider>
      </Provider>,
    );

    expect(
      screen.getByRole("combobox", { name: "Temporal Resolution" }),
    ).toHaveValue("lossless");
    expect(store.getState().spectrum.displayTemporalResolution).toBe(
      "lossless",
    );
  });
});
