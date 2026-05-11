import React from "react";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";
import { ThemeProvider } from "styled-components";
import { configureStore } from "@reduxjs/toolkit";
import { ReactFlow } from "@xyflow/react";
// @ts-ignore
import {
  SpanNode,
  clampBandwidthStartHz,
  SPAN_PRESETS_STORAGE_KEY,
} from "../../src/ts/components/react-flow/nodes/SpanNode";
import * as websocketThunks from "../../src/ts/redux/thunks/websocketThunks";
import demodReducer, { setHardwareInfo } from "../../src/ts/redux/slices/demodSlice";
import spectrumReducer from "../../src/ts/redux/slices/spectrumSlice";
import themeReducer from "../../src/ts/redux/slices/themeSlice";
import websocketReducer from "../../src/ts/redux/slices/websocketSlice";
import { buildAppTheme } from "../../src/ts/components/ui/Theme";
import { formatFrequency } from "../../src/ts/utils/frequency";

// Minimal mock theme
const theme = buildAppTheme({
  accentColor: "#00d4ff",
  fftColor: "#00d4ff",
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const defaultDemodState = {
  spanRange: null,
  hardwareRange: { min: 0, max: 2_000_000_000 },
  sampleRateHz: 3_200_000,
  algorithm: "fm",
  bandwidthKhz: 200,
  centerFreqHz: 26_000_000,
  isListening: false,
};

function createMockStore(
  initialDemodState = {},
  websocketState: Partial<any> = {},
  spectrumRange?: { min: number; max: number },
) {
  const center = (initialDemodState as any).centerFreqHz || 26_000_000;
  const rate = (initialDemodState as any).sampleRateHz || 3_200_000;
  const range =
    spectrumRange ?? {
      min: center - rate / 2,
      max: center + rate / 2,
    };
  return configureStore({
    reducer: {
      demod: demodReducer,
      spectrum: spectrumReducer,
      websocket: websocketReducer,
      theme: themeReducer,
    } as any,
    preloadedState: {
      demod: {
        ...defaultDemodState,
        ...initialDemodState,
      },
      spectrum: {
        frequencyRange: range,
      },
      websocket: {
        isConnected: false,
        connectionStatus: "disconnected",
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        deviceState: null,
        deviceLoadingReason: null,
        isPaused: false,
        serverPaused: false,
        backend: null,
        deviceInfo: null,
        deviceName: null,
        deviceProfile: null,
        maxSampleRateHz: null,
        sampleRateHz: null,
        sdrSettings: null,
        spectrumFrames: [],
        dataFrameCounter: 0,
        captureStatus: null,
        autoFftOptions: null,
        error: null,
        cryptoCorrupted: false,
        queuedMessages: [],
        ...websocketState,
      },
    } as any,
  });
}

describe("clampBandwidthStartHz", () => {
  it("clamps selection start inside the capture window", () => {
    expect(
      clampBandwidthStartHz({
        centerHz: 100_000_000,
        bandwidthHz: 1_000_000,
        captureSpanHz: 10_000_000,
        startHz: 0,
      }),
    ).toBe(95_000_000);
  });
});

describe("SpanNode Integration", () => {
  beforeEach(() => {
    localStorage.removeItem(SPAN_PRESETS_STORAGE_KEY);
  });

  it("calculates the correct frequency floor based on sample rate", () => {
    const store = createMockStore({ sampleRateHz: 3_200_000, centerFreqHz: 16_000_000 });
    
    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>
    );

    const startInput = screen.getByLabelText("Bandwidth Start");
    expect(startInput).toHaveValue("25.750");
  });

  it("enforces the floor and displays correct labels", async () => {
    const store = createMockStore({ 
      sampleRateHz: 1_000_000, 
      centerFreqHz: 500_000 
    });
    
    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>
    );

    expect(screen.getByLabelText("Center Frequency")).toHaveValue("26.000");
    expect(screen.getByLabelText("Sample Rate")).toHaveValue("3.200");
    expect(screen.getByLabelText("Bandwidth")).toHaveValue("500.000");
  });

  it("updates hardware range on center/span change", async () => {
    const store = createMockStore({ sampleRateHz: 3_200_000, centerFreqHz: 26_000_000 });
    
    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>
    );

    const centerInput = screen.getByLabelText("Center Frequency");
    const spanInput = screen.getByLabelText("Sample Rate");

    fireEvent.change(centerInput, { target: { value: "30.000" } });
    fireEvent.change(spanInput, { target: { value: "2.000" } });

    await waitFor(() => {
      expect(store.getState().spectrum.frequencyRange).toEqual({
        min: 29_000_000,
        max: 31_000_000,
      });
    });
  });

  it("shifts hardware center only when selection crosses edge (Paging)", async () => {
    const store = createMockStore({
      sampleRateHz: 3_200_000,
      centerFreqHz: 26_000_000,
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );

    // Set Sample Rate to 1MHz
    const spanInput = screen.getByLabelText("Sample Rate");
    fireEvent.change(spanInput, { target: { value: "1.000" } });
    
    // Current window is [25.5, 26.5]
    
    // Set Bandwidth Start to 26.6MHz (crosses right edge)
    const startInput = screen.getByLabelText("Bandwidth Start");
    fireEvent.change(startInput, { target: { value: "27.500" } });

    await waitFor(() => {
      // Hardware should have paged right. Center 26 -> 26.5. New window [26.0, 27.0]
      expect(store.getState().spectrum.frequencyRange).toEqual({
        min: 26_000_000,
        max: 27_000_000,
      });
    });
  });

  it("saves and loads a preset from localStorage", async () => {
    const store = createMockStore({ sampleRateHz: 3_200_000 });

    const { unmount } = render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );

    const nameInput = screen.getByLabelText("Preset name");
    fireEvent.change(nameInput, { target: { value: "NOAA-19" } });
    fireEvent.click(screen.getByLabelText("Save preset"));

    await waitFor(() => {
      const raw = localStorage.getItem(SPAN_PRESETS_STORAGE_KEY);
      expect(raw).toBeTruthy();
    });

    unmount();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getByLabelText("Load preset NOAA-19")).toBeInTheDocument();
  });

  it("requests a paused frame when bandwidth start crosses the capture edge", async () => {
    const store = createMockStore({
      sampleRateHz: 3_200_000,
      centerFreqHz: 26_000_000,
    }, {
      isConnected: true,
      connectionStatus: "connected",
      isPaused: true,
    });

    const pausedFrameSpy = jest
      .spyOn(websocketThunks, "requestNextPausedFrame")
      .mockImplementation((() => () => Promise.resolve()) as any);

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );

    const startInput = screen.getByLabelText("Bandwidth Start");
    fireEvent.change(startInput, { target: { value: "27.500" } });

    await waitFor(() => {
      expect(pausedFrameSpy).toHaveBeenCalled();
    });
  });

  it("does not request a paused frame for in-window decreases", async () => {
    const store = createMockStore(
      {
        sampleRateHz: 3_200_000,
        centerFreqHz: 26_000_000,
      },
      {
        isConnected: true,
        connectionStatus: "connected",
        isPaused: true,
      },
    );

    const pausedFrameSpy = jest
      .spyOn(websocketThunks, "requestNextPausedFrame")
      .mockImplementation((() => () => Promise.resolve()) as any);

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );

    const startInput = screen.getByLabelText("Bandwidth Start");
    fireEvent.change(startInput, { target: { value: "25.900" } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pausedFrameSpy).not.toHaveBeenCalled();
  });

  it("preserves bandwidth start when toggling alignment modes", async () => {
    const store = createMockStore({
      sampleRateHz: 3_200_000,
      centerFreqHz: 26_000_000,
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );

    const startInput = screen.getByLabelText("Bandwidth Start");
    const alignment = screen.getByLabelText("Bandwidth Alignment");

    fireEvent.change(startInput, { target: { value: "26.250" } });
    expect(startInput).toHaveValue("26.250");

    fireEvent.change(alignment, { target: { value: "start" } });
    fireEvent.change(alignment, { target: { value: "centered" } });

    expect(startInput).toHaveValue("26.250");
  });

  it("does not request a paused frame at the 0/min boundary", async () => {
    const store = createMockStore(
      {
        sampleRateHz: 3_200_000,
        centerFreqHz: 1_600_000,
      },
      {
        isConnected: true,
        connectionStatus: "connected",
        isPaused: true,
      },
      { min: 0, max: 3_200_000 },
    );

    const pausedFrameSpy = jest
      .spyOn(websocketThunks, "requestNextPausedFrame")
      .mockImplementation((() => () => Promise.resolve()) as any);

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );
    pausedFrameSpy.mockClear();

    const startInput = screen.getByLabelText("Bandwidth Start");
    fireEvent.change(startInput, { target: { value: "0.000" } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pausedFrameSpy).not.toHaveBeenCalled();
  });

  it("does not request a paused frame at the max boundary", async () => {
    const store = createMockStore(
      {
        sampleRateHz: 3_200_000,
        centerFreqHz: 1_600_000,
      },
      {
        isConnected: true,
        connectionStatus: "connected",
        isPaused: true,
      },
      { min: 0, max: 3_200_000 },
    );

    const pausedFrameSpy = jest
      .spyOn(websocketThunks, "requestNextPausedFrame")
      .mockImplementation((() => () => Promise.resolve()) as any);

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );
    pausedFrameSpy.mockClear();

    const startInput = screen.getByLabelText("Bandwidth Start");
    fireEvent.change(startInput, { target: { value: "2.700" } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pausedFrameSpy).not.toHaveBeenCalled();
  });
});
