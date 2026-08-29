/** @jest-environment jsdom */
/**
 * Real-slider behavior for Channels: the sidebar slider is a passive
 * highlight. Clicking an inactive channel activates it (channel selection)
 * but must not drag the device range, and external tuning must re-anchor the
 * highlight without a thumb sweep.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { ThemeProvider } from "styled-components";
import { Channels } from "@n-apt/spectrum/sidebar/Channels";
import { SpectrumProvider } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { setHardwareInfo } from "@n-apt/redux/slices/demodSlice";
import { setFrequencyRange } from "@n-apt/redux/slices/spectrumSlice";
import { createTestStore } from "./testUtils";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const baseState = {
  activeSignalArea: "A",
  frequencyRange: { min: 18_000, max: 3_218_000 },
  sampleRateHz: 3_200_000,
  lastKnownRanges: {},
  vizZoom: 1,
  vizPanOffset: 0,
};

const baseFrames = [
  { id: "a", label: "A", min_hz: 18_000, max_hz: 4_390_000 },
  { id: "c", label: "C", min_hz: 4_750_000, max_hz: 23_000_000 },
];

const renderChannels = ({
  sendFrequencyRange,
  state = baseState,
}: {
  sendFrequencyRange: jest.Mock;
  state?: Record<string, unknown>;
}) => {
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
              state,
              dispatch: jest.fn(),
              selectedSourceDerived: {
                deviceName: "Mock APT SDR",
                deviceProfile: { kind: "mock_apt" },
                backend: "mock_apt",
              },
              effectiveFrames: baseFrames,
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
};

describe("Channels real slider (passive highlight)", () => {
  it("clicking an inactive channel slider activates it without moving the device range", () => {
    const sendFrequencyRange = jest.fn();
    renderChannels({ sendFrequencyRange });

    // Channel A is active and full-width; Channel C is an inactive highlight.
    const channelC = screen.getByText("C").closest("div")?.nextElementSibling;
    expect(channelC).not.toBeNull();

    // Clicking the inactive slider must select the channel (onActivate) but
    // not publish a device range from the slider drag path.
    fireEvent.click(channelC as HTMLElement);

    // The visible window label should re-anchor to Channel C's range without
    // the slider publishing a range back.
    expect(sendFrequencyRange).not.toHaveBeenCalled();
  });

  it("re-anchors the highlight from an external tune without a thumb sweep or publish", async () => {
    const sendFrequencyRange = jest.fn();
    const store = createTestStore();
    store.dispatch(
      setHardwareInfo({
        range: { min: 0, max: 30_000_000_000 },
        sampleRate: 3_200_000,
      }),
    );
    store.dispatch(
      setFrequencyRange({ min: 18_000, max: 3_218_000 }),
    );

    const { rerender } = render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: baseState,
                dispatch: jest.fn(),
                selectedSourceDerived: {
                  deviceName: "Mock APT SDR",
                  deviceProfile: { kind: "mock_apt" },
                  backend: "mock_apt",
                },
                effectiveFrames: baseFrames,
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

    // An external tune (e.g. a channels echo) updates the active range.
    store.dispatch(
      setFrequencyRange({ min: 604_000, max: 3_804_000 }),
    );
    rerender(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  ...baseState,
                  frequencyRange: { min: 604_000, max: 3_804_000 },
                },
                dispatch: jest.fn(),
                selectedSourceDerived: {
                  deviceName: "Mock APT SDR",
                  deviceProfile: { kind: "mock_apt" },
                  backend: "mock_apt",
                },
                effectiveFrames: baseFrames,
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

    await waitFor(() => {
      expect(screen.getByText(/604kHz.*-.*3\.804MHz/)).toBeInTheDocument();
    });
    expect(sendFrequencyRange).not.toHaveBeenCalled();
  });
});
