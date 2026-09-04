/** @jest-environment jsdom */
/**
 * Real-slider behavior for Channels: inactive channel selection remains
 * click-only, while the active channel can be dragged and external tuning
 * re-anchors the highlight without a thumb sweep.
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
  onSampleRateChange,
}: {
  sendFrequencyRange: jest.Mock;
  state?: Record<string, unknown>;
  onSampleRateChange?: jest.Mock;
}) => {
  const store = createTestStore();
  store.dispatch(
    setHardwareInfo({
      range: { min: 0, max: 30_000_000_000 },
      sampleRate: 3_200_000,
    }),
  );
  const rendered = render(
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
          <Channels
            variant="spectrum"
            onSampleRateChange={onSampleRateChange}
          />
        </SpectrumProvider>
      </ThemeProvider>
    </Provider>,
  );
  return { ...rendered, store };
};

describe("Channels real slider (channel selection)", () => {
  it("activates another channel while preserving its fitting sample rate", () => {
    const sendFrequencyRange = jest.fn();
    const onSampleRateChange = jest.fn();
    const { store } = renderChannels({ sendFrequencyRange, onSampleRateChange });
    jest.spyOn(store, "dispatch");

    const channelC = screen.getByText("C").closest("div")?.nextElementSibling;
    expect(channelC).not.toBeNull();
    fireEvent.click(channelC as HTMLElement);

    expect(onSampleRateChange).not.toHaveBeenCalled();
    expect(sendFrequencyRange).toHaveBeenCalledWith({
      min: 12_275_000,
      max: 15_475_000,
    });
    expect(store.getState().spectrum.tuningPreviewActive).toBe(false);
  });

  it("refocuses the active channel when its label is clicked after the VFO moved away", () => {
    const sendFrequencyRange = jest.fn();
    const onSampleRateChange = jest.fn();
    renderChannels({
      sendFrequencyRange,
      onSampleRateChange,
      state: {
        ...baseState,
        activeSignalArea: "C",
        frequencyRange: { min: 196_000_000, max: 201_000_000 },
      },
    });

    fireEvent.click(screen.getByText("C"));

    expect(onSampleRateChange).not.toHaveBeenCalled();
    expect(sendFrequencyRange).toHaveBeenCalledWith({
      min: 12_275_000,
      max: 15_475_000,
    });
  });

  it("focuses a channel when its letter label is clicked", () => {
    const sendFrequencyRange = jest.fn();
    const onSampleRateChange = jest.fn();
    renderChannels({ sendFrequencyRange, onSampleRateChange });

    fireEvent.click(screen.getByText("C"));

    expect(onSampleRateChange).not.toHaveBeenCalled();
    expect(sendFrequencyRange).toHaveBeenCalledWith({
      min: 12_275_000,
      max: 15_475_000,
    });
  });

  it("does not change the selected channel when the viewport is panned over another channel", () => {
    const sendFrequencyRange = jest.fn();
    const onSampleRateChange = jest.fn();
    const { rerender } = renderChannels({
      sendFrequencyRange,
      onSampleRateChange,
    });

    rerender(
      <Provider store={createTestStore()}>
        <ThemeProvider theme={theme}>
          <SpectrumProvider
            mockValue={
              {
                state: {
                  ...baseState,
                  // This is a viewport move, not a channel selection.
                  frequencyRange: { min: 4_750_000, max: 23_000_000 },
                  activeSignalArea: "A",
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
            <Channels
              variant="spectrum"
              onSampleRateChange={onSampleRateChange}
            />
          </SpectrumProvider>
        </ThemeProvider>
      </Provider>,
    );

    const channelC = screen.getByText("C").closest("div")?.nextElementSibling;
    fireEvent.click(channelC as HTMLElement);

    expect(onSampleRateChange).not.toHaveBeenCalled();
    expect(sendFrequencyRange).toHaveBeenCalledWith({
      min: 12_275_000,
      max: 15_475_000,
    });
  });

  it("clicking an inactive channel slider tunes the selected channel", () => {
    const sendFrequencyRange = jest.fn();
    renderChannels({ sendFrequencyRange });

    // Channel A is active and full-width; Channel C is an inactive highlight.
    const channelC = screen.getByText("C").closest("div")?.nextElementSibling;
    expect(channelC).not.toBeNull();

    // Clicking the inactive read-only slider must select and tune the channel,
    // without enabling the slider drag path.
    fireEvent.click(channelC as HTMLElement);

    expect(sendFrequencyRange).toHaveBeenCalledWith({
      min: 12_275_000,
      max: 15_475_000,
    });
  });

  it("allows dragging the active channel track", () => {
    const sendFrequencyRange = jest.fn();
    renderChannels({ sendFrequencyRange });

    const track = document.querySelector(".range-track") as HTMLElement;
    expect(track).toBeInTheDocument();
    Object.defineProperty(track, "clientWidth", {
      configurable: true,
      value: 400,
    });
    jest.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 400,
      width: 400,
      top: 0,
      bottom: 40,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseDown(track, { clientX: 300 });

    expect(sendFrequencyRange).toHaveBeenCalled();
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
