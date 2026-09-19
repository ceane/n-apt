/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { Provider } from "react-redux";
import { PhaseWaterfallNode } from "@n-apt/demodulation/react-flow/nodes/PhaseWaterfallNode";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";
import { createTestStore } from "./testUtils";

const mockFifoProps: any[] = [];

jest.mock("@n-apt/spectrum/public/FIFOWaterfall", () => ({
  // The barrel also re-exports newestIqWindow, which the node needs for real.
  ...jest.requireActual("@n-apt/spectrum/public/FIFOWaterfall"),
  FIFOWaterfall: (props: any) => {
    mockFifoProps.push(props);
    return null;
  },
}));

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const FREQUENCY_RANGE = { min: 100_000_000, max: 101_000_000 };

const renderNode = () => {
  const spectrumState = spectrumSlice(undefined, { type: "@@INIT" } as any);
  const store = createTestStore({
    spectrum: {
      ...spectrumState,
      fftSize: 64,
      frequencyRange: FREQUENCY_RANGE,
    },
  });

  render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <PhaseWaterfallNode frequencyRange={FREQUENCY_RANGE} />
      </ThemeProvider>
    </Provider>,
  );

  return store;
};

const latestProps = () => mockFifoProps[mockFifoProps.length - 1];
const vfo = () => screen.getByTestId("phase-waterfall-vfo");
const viewport = () => screen.getByTestId("phase-waterfall-viewport");

describe("PhaseWaterfallNode VFO", () => {
  beforeEach(() => {
    mockFifoProps.length = 0;
  });

  it("renders a frequency axis so the visible span is readable", () => {
    renderNode();

    expect(vfo()).toBeInTheDocument();
    // The axis labels the window in frequency units.
    expect(screen.getAllByText(/MHz/).length).toBeGreaterThan(0);
  });

  it("zooms the retained history on a ctrl+wheel pinch", () => {
    renderNode();
    expect(latestProps().historyZoom).toBe(1);

    fireEvent.wheel(viewport(), { deltaY: -300, ctrlKey: true });

    expect(latestProps().historyZoom).toBeGreaterThan(1);
  });

  it("pans the retained history when scrolling a zoomed view", () => {
    renderNode();

    fireEvent.wheel(viewport(), { deltaY: -300, ctrlKey: true });
    expect(latestProps().historyZoom).toBeGreaterThan(1);
    expect(latestProps().historyPan).toBe(0);

    fireEvent.wheel(vfo(), { deltaY: 120 });

    expect(latestProps().historyPan).not.toBe(0);
  });

  it("moves the view window when scrolling an unzoomed VFO", () => {
    renderNode();
    const before = latestProps().frequencyRange;

    fireEvent.wheel(vfo(), { deltaY: 200 });

    const after = latestProps().frequencyRange;
    // Scrolling down lowers the tuned center.
    expect(after.min).toBeLessThan(before.min);
    expect(after.max).toBeLessThan(before.max);
  });

  it("opens the center-frequency editor on double click and closes on Escape", () => {
    renderNode();

    expect(
      screen.queryByText(/Center Frequency \/ Onscreen Canvas/i),
    ).not.toBeInTheDocument();

    fireEvent.doubleClick(vfo());

    expect(
      screen.getByText(/Center Frequency \/ Onscreen Canvas/i),
    ).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(
      screen.queryByText(/Center Frequency \/ Onscreen Canvas/i),
    ).not.toBeInTheDocument();
  });

  it("blocks tuning and the editor while the VFO is locked", () => {
    renderNode();
    const before = latestProps().frequencyRange;

    const lock = screen.getByRole("button", { name: "Lock VFO" });
    fireEvent.click(lock);

    expect(screen.getByRole("button", { name: "Unlock VFO" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.wheel(vfo(), { deltaY: 200 });
    expect(latestProps().frequencyRange).toEqual(before);

    fireEvent.doubleClick(vfo());
    expect(
      screen.queryByText(/Center Frequency \/ Onscreen Canvas/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the phase scale and colormap on the canvas", () => {
    renderNode();

    const props = latestProps();
    expect(props.fftMin).toBe(-180);
    expect(props.fftMax).toBe(180);
    expect(props.colormapName).toBe("phase");
    expect(props.waterfallHistoryFill).toBe("immutable");
  });
});
