/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { ThemeProvider } from "styled-components";
import { Channels } from "@n-apt/components/sidebar/Channels";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { setHardwareInfo } from "@n-apt/redux/slices/demodSlice";
import { createTestStore } from "./testUtils";
import { buildAppTheme } from "@n-apt/components/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import { websocketActions } from "@n-apt/redux";

jest.mock("@n-apt/components/sidebar/FrequencyRangeSlider", () => ({
  __esModule: true,
  default: ({
    label,
    onActivate,
    forceFullWidth,
    minFreq,
    maxFreq,
    sampleRateHz,
  }: any) => (
    <button
      type="button"
      onClick={onActivate}
      data-force-full-width={String(!!forceFullWidth)}
      data-min-freq={String(minFreq)}
      data-max-freq={String(maxFreq)}
      data-sample-rate-hz={String(sampleRateHz)}
    >
      {label}
    </button>
  ),
}));

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("Channels", () => {
  it("sends a clamped integer-Hz range when activating a channel", () => {
    const store = createTestStore();
    store.dispatch(
      setHardwareInfo({
        range: { min: 0, max: 30_000_000_000 },
        sampleRate: 3_200_000,
      }),
    );
    const sendFrequencyRange = jest.fn();
    const dispatch = jest.fn();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "A",
                  frequencyRange: { min: 18_000, max: 3_218_000 },
                  lastKnownRanges: {
                    C: { min: 25_137_826.4, max: 28_337_826.4 },
                  },
                },
                dispatch,
                selectedSourceDerived: {
                  deviceName: "Mock APT SDR",
                  deviceProfile: { kind: "mock_apt" },
                  backend: "mock_apt",
                  sdrSettings: { sample_rate: 4_372_000 },
                },
                effectiveFrames: [
                  { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
                  {
                    id: "c",
                    label: "C",
                    min_hz: 25_000_000,
                    max_hz: 29_000_000,
                  },
                ],
                sampleRateHzEffective: 3_200_000,
                wsConnection: { sendFrequencyRange },
              } as any
            }
          >
            <Channels variant="spectrum" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "C" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SIGNAL_AREA_AND_RANGE",
      area: "C",
      range: { min: 25_137_826, max: 28_337_826 },
    });
    expect(sendFrequencyRange).toHaveBeenCalledWith({
      min: 25_137_826,
      max: 28_337_826,
    });
  });

  it("ignores stale remembered ranges when the selected sample rate covers the channel", () => {
    const store = createTestStore();
    store.dispatch(
      setHardwareInfo({
        range: { min: 0, max: 30_000_000_000 },
        sampleRate: 18_250_000,
      }),
    );
    const sendFrequencyRange = jest.fn();
    const dispatch = jest.fn();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "A",
                  frequencyRange: { min: 18_000, max: 3_218_000 },
                  lastKnownRanges: {
                    C: { min: 4_750_000, max: 9_750_000 },
                  },
                },
                dispatch,
                selectedSourceDerived: {
                  deviceName: "Mock APT SDR",
                  deviceProfile: { kind: "mock_apt" },
                  backend: "mock_apt",
                  sdrSettings: { sample_rate: 4_372_000 },
                },
                effectiveFrames: [
                  { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
                  {
                    id: "c",
                    label: "C",
                    min_hz: 4_750_000,
                    max_hz: 23_000_000,
                  },
                ],
                sampleRateHzEffective: 18_250_000,
                wsConnection: { sendFrequencyRange },
              } as any
            }
          >
            <Channels variant="spectrum" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "C" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SIGNAL_AREA_AND_RANGE",
      area: "C",
      range: { min: 4_750_000, max: 23_000_000 },
    });
    expect(sendFrequencyRange).toHaveBeenCalledWith({
      min: 4_750_000,
      max: 23_000_000,
    });
  });

  it("renders every channel slider full-width while the active sample-rate mode is whole-channel", () => {
    const store = createTestStore();
    const sendFrequencyRange = jest.fn();
    const dispatch = jest.fn();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "A",
                  frequencyRange: { min: 18_000, max: 4_390_000 },
                  lastKnownRanges: {},
                },
                dispatch,
                selectedSourceDerived: {
                  deviceName: "Mock APT SDR",
                  deviceProfile: { kind: "mock_apt" },
                  backend: "mock_apt",
                  sdrSettings: { sample_rate: 4_372_000 },
                },
                effectiveFrames: [
                  { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
                  {
                    id: "b",
                    label: "B",
                    min_hz: 24_720_000,
                    max_hz: 29_880_000,
                  },
                  {
                    id: "c",
                    label: "C",
                    min_hz: 4_750_000,
                    max_hz: 23_000_000,
                  },
                ],
                sampleRateHzEffective: 4_372_000,
                wsConnection: { sendFrequencyRange },
              } as any
            }
          >
            <Channels variant="spectrum" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute(
      "data-force-full-width",
      "true",
    );
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute(
      "data-force-full-width",
      "true",
    );
    expect(screen.getByRole("button", { name: "C" })).toHaveAttribute(
      "data-force-full-width",
      "true",
    );
  });

  it("does not infer whole-channel mode from matching span without a whole-capable source", () => {
    const store = createTestStore();
    const sendFrequencyRange = jest.fn();
    const dispatch = jest.fn();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "A",
                  frequencyRange: { min: 18_000, max: 4_390_000 },
                  lastKnownRanges: {},
                },
                dispatch,
                effectiveFrames: [
                  { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
                ],
                sampleRateHzEffective: 4_372_000,
                wsConnection: { sendFrequencyRange },
              } as any
            }
          >
            <Channels variant="spectrum" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute(
      "data-force-full-width",
      "false",
    );
    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute(
      "data-sample-rate-hz",
      "3200000",
    );
  });

  it("does not treat a stale channel-span sample rate as whole-channel for RTL-SDR", () => {
    const store = createTestStore();
    store.dispatch(
      websocketActions.updateDeviceState({
        backend: "rtl-sdr",
        deviceProfile: { kind: "rtl_sdr", is_rtl_sdr: true } as any,
        sampleRateHz: 4_372_000,
        sdrSettings: { sample_rate: 3_200_000 } as any,
      }),
    );
    const sendFrequencyRange = jest.fn();
    const dispatch = jest.fn();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "A",
                  frequencyRange: { min: 18_000, max: 3_218_000 },
                  lastKnownRanges: {},
                },
                dispatch,
                effectiveFrames: [
                  { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
                  {
                    id: "b",
                    label: "B",
                    min_hz: 24_720_000,
                    max_hz: 29_880_000,
                  },
                ],
                sampleRateHzEffective: 4_372_000,
                wsConnection: { sendFrequencyRange },
              } as any
            }
          >
            <Channels variant="spectrum" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute(
      "data-force-full-width",
      "false",
    );
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute(
      "data-force-full-width",
      "false",
    );
  });

  it("uses selected source RTL identity when websocket device fields have not hydrated yet", () => {
    const store = createTestStore();
    const sendFrequencyRange = jest.fn();
    const dispatch = jest.fn();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "A",
                  frequencyRange: { min: 18_000, max: 3_218_000 },
                  lastKnownRanges: {},
                },
                dispatch,
                selectedSourceDerived: {
                  deviceName: "RTL-SDR v4",
                  deviceProfile: { kind: "rtl_sdr", is_rtl_sdr: true },
                  backend: "rtl-sdr",
                  sdrSettings: { sample_rate: 3_200_000 },
                },
                effectiveFrames: [
                  { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
                  {
                    id: "b",
                    label: "B",
                    min_hz: 24_720_000,
                    max_hz: 29_880_000,
                  },
                ],
                sampleRateHzEffective: 4_372_000,
                wsConnection: {
                  sendFrequencyRange,
                  backend: null,
                  deviceName: null,
                  deviceProfile: null,
                  sdrSettings: null,
                },
              } as any
            }
          >
            <Channels variant="spectrum" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute(
      "data-force-full-width",
      "false",
    );
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute(
      "data-force-full-width",
      "false",
    );
  });

  it("prefers hot-reloaded effective frame bounds over stale websocket channel bounds", () => {
    const store = createTestStore();
    store.dispatch(
      websocketActions.updateDeviceState({
        channels: [
          {
            id: "stale-b",
            label: "B",
            min_hz: 24_100_000,
            max_hz: 30_370_000,
          },
        ] as any,
      }),
    );
    const sendFrequencyRange = jest.fn();
    const dispatch = jest.fn();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "B",
                  frequencyRange: { min: 25_998_000, max: 29_198_000 },
                  lastKnownRanges: {},
                },
                dispatch,
                effectiveFrames: [
                  {
                    id: "updated-b",
                    label: "B",
                    min_hz: 25_998_000,
                    max_hz: 29_198_000,
                  },
                ],
                sampleRateHzEffective: 3_200_000,
                wsConnection: { sendFrequencyRange },
              } as any
            }
          >
            <Channels variant="spectrum" />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute(
      "data-min-freq",
      "25998000",
    );
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute(
      "data-max-freq",
      "29198000",
    );
  });
});
