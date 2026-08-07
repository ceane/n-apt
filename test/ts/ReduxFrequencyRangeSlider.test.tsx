/** @jest-environment jsdom */
import React from "react";
import { Provider } from "react-redux";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import ReduxFrequencyRangeSlider from "../../src/ts/components/sidebar/ReduxFrequencyRangeSlider";
import { SpectrumProvider } from "@n-apt/hooks/useSpectrumStore";
import { buildAppTheme } from "@n-apt/components/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import { createTestStore } from "./testUtils";
import { setHardwareInfo } from "@n-apt/redux/slices/demodSlice";
import { setFrequencyRange } from "@n-apt/redux/slices/spectrumSlice";
import { websocketActions } from "@n-apt/redux";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

describe("ReduxFrequencyRangeSlider", () => {
  it("follows the Redux spectrum range when the embedded store snapshot is stale", async () => {
    const store = createTestStore();
    store.dispatch(
      setFrequencyRange({
        min: 1_200_000,
        max: 2_800_000,
      }),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "A",
                  frequencyRange: { min: 18_000, max: 1_618_000 },
                  lastKnownRanges: {},
                  vizZoom: 1,
                  vizPanOffset: 0,
                },
                dispatch: jest.fn(),
                effectiveFrames: [
                  { id: "a", label: "A", min_hz: 0, max_hz: 4_000_000 },
                ],
                sampleRateHzEffective: 1_600_000,
                wsConnection: { sendFrequencyRange: jest.fn() },
              } as any
            }
          >
            <ReduxFrequencyRangeSlider
              label="A"
              minFreq={0}
              maxFreq={4_000_000}
              sampleRateHz={1_600_000}
              isActive
            />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/1\.2MHz.*-.*2\.8MHz/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/18kHz.*-.*1\.618MHz/)).not.toBeInTheDocument();
  });

  it("renders all channel cards full-width in whole-channel mode", () => {
    const store = createTestStore();
    store.dispatch(
      setHardwareInfo({
        range: { min: 0, max: 30_000_000_000 },
        sampleRate: 5_200_000,
      }),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "B",
                  frequencyRange: { min: 24_720_000, max: 29_920_000 },
                  lastKnownRanges: {
                    C: { min: 4_750_000, max: 9_910_000 },
                  },
                  vizZoom: 1,
                  vizPanOffset: 0,
                },
                dispatch: jest.fn(),
                effectiveFrames: [
                  {
                    id: "b",
                    label: "B",
                    min_hz: 24_720_000,
                    max_hz: 29_920_000,
                  },
                ],
                sampleRateHzEffective: 5_200_000,
                wsConnection: { sendFrequencyRange: jest.fn() },
              } as any
            }
          >
            <ReduxFrequencyRangeSlider
              label="C"
              minFreq={4_750_000}
              maxFreq={23_000_000}
              sampleRateHz={5_200_000}
              isWholeChannelMode={false}
              forceFullWidth={true}
              allowWideSampleRateOverscan={true}
            />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByText(/4\.75MHz.*-.*9\.95MHz/)).toBeInTheDocument();
    expect(screen.queryByText(/4\.75MHz.*-.*23MHz/)).not.toBeInTheDocument();
  });

  it("anchors a stale full-channel active range at the left edge instead of recentering it", async () => {
    const store = createTestStore();
    store.dispatch(
      setHardwareInfo({
        range: { min: 0, max: 30_000_000_000 },
        sampleRate: 3_200_000,
      }),
    );

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
                  vizZoom: 1,
                  vizPanOffset: 0,
                },
                dispatch: jest.fn(),
                effectiveFrames: [
                  {
                    id: "a",
                    label: "A",
                    min_hz: 18_000,
                    max_hz: 4_390_000,
                  },
                ],
                sampleRateHzEffective: 3_200_000,
                wsConnection: { sendFrequencyRange: jest.fn() },
              } as any
            }
          >
            <ReduxFrequencyRangeSlider
              label="A"
              minFreq={18_000}
              maxFreq={4_390_000}
              sampleRateHz={3_200_000}
              isActive={true}
            />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/18kHz.*-.*3\.218MHz/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/604kHz.*-.*3\.804MHz/)).not.toBeInTheDocument();
  });

  it("supports center and end starting anchors for stale ranges", async () => {
    const renderSlider = (startingAnchorPosition: "center" | "end") => {
      const store = createTestStore();
      store.dispatch(
        setHardwareInfo({
          range: { min: 0, max: 30_000_000_000 },
          sampleRate: 3_200_000,
        }),
      );

      return render(
        <Provider store={store}>
          <ThemeProvider theme={theme}>
            <SpectrumProvider
              mockValue={
                {
                  state: {
                    activeSignalArea: "A",
                    frequencyRange: { min: 18_000, max: 4_390_000 },
                    lastKnownRanges: {},
                    vizZoom: 1,
                    vizPanOffset: 0,
                  },
                  dispatch: jest.fn(),
                  effectiveFrames: [],
                  sampleRateHzEffective: 3_200_000,
                  wsConnection: { sendFrequencyRange: jest.fn() },
                } as any
              }
            >
              <ReduxFrequencyRangeSlider
                label="A"
                minFreq={18_000}
                maxFreq={4_390_000}
                sampleRateHz={3_200_000}
                isActive={true}
                startingAnchorPosition={startingAnchorPosition}
              />
            </SpectrumProvider>
          </ThemeProvider>
        </Provider>,
      );
    };

    const centerRender = renderSlider("center");
    await waitFor(() => {
      expect(screen.getByText(/604kHz.*-.*3\.804MHz/)).toBeInTheDocument();
    });
    centerRender.unmount();

    renderSlider("end");
    await waitFor(() => {
      expect(screen.getByText(/1\.19MHz.*-.*4\.39MHz/)).toBeInTheDocument();
    });
  });

  it("keeps the last valid position instead of applying the starting anchor", async () => {
    const store = createTestStore();
    store.dispatch(
      setHardwareInfo({
        range: { min: 0, max: 30_000_000_000 },
        sampleRate: 3_200_000,
      }),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  activeSignalArea: "B",
                  frequencyRange: { min: 24_720_000, max: 27_920_000 },
                  lastKnownRanges: {
                    A: { min: 900_000, max: 4_100_000 },
                  },
                  vizZoom: 1,
                  vizPanOffset: 0,
                },
                dispatch: jest.fn(),
                effectiveFrames: [],
                sampleRateHzEffective: 3_200_000,
                wsConnection: { sendFrequencyRange: jest.fn() },
              } as any
            }
          >
            <ReduxFrequencyRangeSlider
              label="A"
              minFreq={18_000}
              maxFreq={4_390_000}
              sampleRateHz={3_200_000}
              startingAnchorPosition="end"
            />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/900kHz.*-.*4\.1MHz/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/1\.19MHz.*-.*4\.39MHz/)).not.toBeInTheDocument();
  });

  it("does not clamp RTL-SDR sliders against stale centered demod hardware bounds", async () => {
    const store = createTestStore();
    store.dispatch(
      websocketActions.updateDeviceState({
        backend: "rtl-sdr",
        deviceProfile: { kind: "rtl_sdr", is_rtl_sdr: true } as any,
      }),
    );
    store.dispatch(
      setHardwareInfo({
        range: { min: 604_000, max: 3_804_000 },
        sampleRate: 3_200_000,
      }),
    );

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
                  vizZoom: 1,
                  vizPanOffset: 0,
                },
                dispatch: jest.fn(),
                effectiveFrames: [],
                sampleRateHzEffective: 3_200_000,
                wsConnection: { sendFrequencyRange: jest.fn() },
              } as any
            }
          >
            <ReduxFrequencyRangeSlider
              label="A"
              minFreq={18_000}
              maxFreq={4_390_000}
              sampleRateHz={3_200_000}
              isActive={true}
            />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/18kHz.*-.*3\.218MHz/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/604kHz.*-.*3\.804MHz/)).not.toBeInTheDocument();
  });
});
