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

jest.mock("@n-apt/components/sidebar/FrequencyRangeSlider", () => ({
  __esModule: true,
  default: ({ label, onActivate }: any) => (
    <button type="button" onClick={onActivate}>
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
});
