import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { SignalConfigNode } from "@n-apt/demodulation/react-flow/nodes/SignalConfigNode";
import spectrumReducer from "@n-apt/redux/slices/spectrumSlice";
import websocketReducer from "@n-apt/redux/slices/websocketSlice";
import sourceRoutingReducer from "@n-apt/redux/slices/sourceRoutingSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";

const mockSignalDisplayProps: Record<string, unknown>[] = [];
const mockSetFftSize = jest.fn();
const mockSetFftFrameRate = jest.fn();

jest.mock("@n-apt/spectrum/public/SignalDisplaySection", () => ({
  SignalDisplaySection: (props: { temporalResolution: string }) => {
    mockSignalDisplayProps.push(props as unknown as Record<string, unknown>);
    return (
      <select
        aria-label="Temporal Resolution"
        value={props.temporalResolution}
        onChange={() => undefined}
      >
        <option value="slow">Slow</option>
        <option value="reduced">Reduced</option>
        <option value="lossless">Lossless</option>
      </select>
    );
  },
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
    setFftFrameRate: mockSetFftFrameRate,
    setFftSize: mockSetFftSize,
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
  it("enforces Lossless for demod and reports unmet FFT/source requirements", () => {
    mockSetFftSize.mockClear();
    mockSetFftFrameRate.mockClear();
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

    expect(screen.getByRole("combobox", { name: "Temporal Resolution" })).toHaveValue("lossless");
    expect(store.getState().spectrum.displayTemporalResolution).toBe("lossless");
    expect(screen.getByTestId("demod-quality-status")).toHaveAttribute("data-quality-fit", "unmet");
    expect(screen.getByTestId("demod-quality-status")).toHaveTextContent(/32768|receive-capable/);
    const props = mockSignalDisplayProps[mockSignalDisplayProps.length - 1];
    expect(props.fftSizeOptions).toEqual([]);
    (props.onFftSizeChange as (size: number) => void)(2048);
    (props.onFftFrameRateChange as (rate: number) => void)(20);
    expect(mockSetFftSize).not.toHaveBeenCalled();
    expect(mockSetFftFrameRate).not.toHaveBeenCalled();
  });

  it("passes the Remove DC Spike toggle through to the signal display section", () => {
    mockSignalDisplayProps.length = 0;
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

    // The section only renders the control when this callback is supplied.
    const props = mockSignalDisplayProps[mockSignalDisplayProps.length - 1];
    expect(props.removeDcSpike).toBe(false);
    expect(typeof props.onRemoveDcSpikeChange).toBe("function");

    act(() => {
      (props.onRemoveDcSpikeChange as (enabled: boolean) => void)(true);
    });

    expect(store.getState().spectrum.removeDcSpike).toBe(true);
  });
});
