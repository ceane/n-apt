/** @jest-environment jsdom */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { Provider } from "react-redux";
import { PhaseWaterfallNode } from "@n-apt/demodulation/react-flow/nodes/PhaseWaterfallNode";
import { liveFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
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

const FFT_SIZE = 64;
const FREQUENCY_RANGE = { min: 100_000_000, max: 101_000_000 };

let pendingFrames: FrameRequestCallback[] = [];
let frameTime = 1_000_000;

const installRafMock = () => {
  pendingFrames = [];
  frameTime = 1_000_000;
  jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      pendingFrames.push(cb);
      return pendingFrames.length;
    });
  jest
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => undefined);
};

const fireFrames = () => {
  let guard = 0;
  while (pendingFrames.length > 0 && guard < 16) {
    const callback = pendingFrames.shift()!;
    frameTime += 1000 / 60;
    callback(frameTime);
    guard += 1;
  }
};

const buildFrame = (fill: number) => ({
  iq_data: new Uint8Array(FFT_SIZE * 2).fill(fill),
});

const renderNode = (
  props: {
    data?: any;
    frequencyRange?: { min: number; max: number } | null;
  } = {},
  spectrumOverrides: Record<string, unknown> = {},
) => {
  const spectrumState = spectrumSlice(undefined, { type: "@@INIT" } as any);
  const store = createTestStore({
    spectrum: { ...spectrumState, fftSize: FFT_SIZE, ...spectrumOverrides },
  });

  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <PhaseWaterfallNode {...props} />
      </ThemeProvider>
    </Provider>,
  );
};

const latestProps = () => mockFifoProps[mockFifoProps.length - 1];

describe("PhaseWaterfallNode", () => {
  beforeEach(() => {
    mockFifoProps.length = 0;
    installRafMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    liveFrameRuntime.ref.current = null;
  });

  it("shows the device name and FFT size in the header", () => {
    renderNode({ frequencyRange: FREQUENCY_RANGE });

    expect(screen.getByText("SDR Device")).toBeInTheDocument();
    expect(screen.getByText("FFT SIZE:").parentElement).toHaveTextContent(
      `${FFT_SIZE}`,
    );
  });

  it("drives the waterfall on the cyclic phase scale", () => {
    renderNode({
      data: { label: "Phase Probe" },
      frequencyRange: FREQUENCY_RANGE,
    });

    expect(screen.getByTestId("phase-waterfall-node")).toBeInTheDocument();
    expect(screen.getByText("Phase Probe")).toBeInTheDocument();

    const props = latestProps();
    expect(props.fftMin).toBe(-180);
    expect(props.fftMax).toBe(180);
    expect(props.colormapName).toBe("phase");
    expect(props.frequencyRange).toEqual(FREQUENCY_RANGE);
    // The renderer takes the feed path; no state-driven waveform is needed.
    expect(props.waveform).toBeNull();
    expect(typeof props.waveformFeed.getCurrent).toBe("function");
  });

  it("uses a cycling hue wheel so both phase poles share a color", () => {
    renderNode({ frequencyRange: FREQUENCY_RANGE });

    const { colormap } = latestProps();
    expect(colormap).toHaveLength(256);
    expect(colormap[0]).toEqual([255, 0, 0]);
    expect(colormap[colormap.length - 1]).toEqual([255, 0, 0]);
    // A quarter turn in is green.
    expect(colormap[Math.round(255 / 3)]).toEqual([0, 255, 0]);
  });

  it("emits one history row per new frame and skips unchanged frames", () => {
    renderNode({ frequencyRange: FREQUENCY_RANGE });

    const received: Float32Array[] = [];
    const unsubscribe = latestProps().waveformFeed.subscribe(
      (waveform: Float32Array) => received.push(waveform),
    );

    expect(latestProps().waveformFeed.getCurrent()).toBeNull();

    liveFrameRuntime.ref.current = buildFrame(128) as any;
    act(() => {
      fireFrames();
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(FFT_SIZE);
    expect(latestProps().waveformFeed.getCurrent()).toBe(received[0]);

    // Same frame reference again: the history must not advance.
    act(() => {
      fireFrames();
    });
    expect(received).toHaveLength(1);

    liveFrameRuntime.ref.current = buildFrame(0) as any;
    act(() => {
      fireFrames();
    });
    expect(received).toHaveLength(2);

    unsubscribe();
  });

  it("falls back to the store range, then to a safe default", () => {
    renderNode({}, { frequencyRange: { min: 88_000_000, max: 108_000_000 } });
    expect(latestProps().frequencyRange).toEqual({
      min: 88_000_000,
      max: 108_000_000,
    });

    mockFifoProps.length = 0;
    renderNode({ frequencyRange: null }, { frequencyRange: null });
    expect(latestProps().frequencyRange).toEqual({ min: 0, max: 1 });
  });
});
