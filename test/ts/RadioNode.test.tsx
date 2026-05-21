import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";
import { ThemeProvider } from "styled-components";
import { configureStore } from "@reduxjs/toolkit";

const reactFlowState: {
  nodes: any[];
  edges: any[];
} = {
  nodes: [
    {
      id: "radio",
      type: "custom",
      data: { label: "Radio", radioOptions: true },
    },
    { id: "fm", type: "custom", data: { label: "FM", fmOptions: true } },
  ],
  edges: [{ id: "e-fm-radio", source: "fm", target: "radio" }],
};

jest.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useReactFlow: () => ({
    getNodes: () => reactFlowState.nodes,
    getEdges: () => reactFlowState.edges,
  }),
}));

jest.mock("../../src/ts/contexts/DemodContext", () => ({
  useDemod: () => ({
    audioPlayback: {
      stopAudio: jest.fn(),
    },
  }),
}));

import { RadioNode } from "../../src/ts/components/react-flow/nodes/RadioNode";
import demodReducer from "../../src/ts/redux/slices/demodSlice";
import spectrumReducer from "../../src/ts/redux/slices/spectrumSlice";
import themeReducer from "../../src/ts/redux/slices/themeSlice";
import { buildAppTheme } from "../../src/ts/components/ui/Theme";

const theme = buildAppTheme({
  accentColor: "#00d4ff",
  fftColor: "#00d4ff",
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

function createStore() {
  return configureStore({
    reducer: {
      demod: demodReducer,
      spectrum: spectrumReducer,
      theme: themeReducer,
    } as any,
    preloadedState: {
      demod: {
        spanRange: null,
        hardwareRange: null,
        sampleRateHz: 3_200_000,
        algorithm: "fm",
        bandwidthKhz: 200,
        centerFreqHz: 92_700_000,
        isListening: false,
      },
      spectrum: {
        frequencyRange: { min: 91_100_000, max: 94_300_000 },
        previewRange: { min: 92_600_000, max: 92_800_000 },
      },
    } as any,
  });
}

describe("RadioNode", () => {
  it("shows From Node and uses FM bandwidth when connected upstream from FM", () => {
    reactFlowState.nodes = [
      {
        id: "radio",
        type: "custom",
        data: { label: "Radio", radioOptions: true },
      },
      { id: "fm", type: "custom", data: { label: "FM", fmOptions: true } },
    ];
    reactFlowState.edges = [
      { id: "e-fm-radio", source: "fm", target: "radio" },
    ];
    const store = createStore();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <RadioNode data={{ label: "Radio" }} />
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getAllByText("From Node")[0]).toBeInTheDocument();
    expect(screen.getByText("92.7MHz")).toBeInTheDocument();
    expect(screen.getByText("200kHz")).toBeInTheDocument();
  });

  it("shows From Node and uses the live span bandwidth when connected upstream from Span", () => {
    reactFlowState.nodes = [
      {
        id: "radio",
        type: "custom",
        data: { label: "Radio", radioOptions: true },
      },
      {
        id: "span",
        type: "custom",
        data: { label: "Span", spanOptions: true },
      },
    ];
    reactFlowState.edges = [
      { id: "e-span-radio", source: "span", target: "radio" },
    ];
    const store = createStore();
    store.dispatch({
      type: "spectrum/setPreviewRange",
      payload: { min: 92_500_000, max: 93_000_000 },
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <RadioNode data={{ label: "Radio" }} />
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getAllByText("From Node")[0]).toBeInTheDocument();
    expect(screen.getByText("92.75MHz")).toBeInTheDocument();
    expect(screen.getByText("500kHz")).toBeInTheDocument();
  });

  it("shows From Node and uses the FFT selection bandwidth when connected upstream from FFT", () => {
    reactFlowState.nodes = [
      {
        id: "radio",
        type: "custom",
        data: { label: "Radio", radioOptions: true },
      },
      { id: "fft", type: "custom", data: { label: "FFT", fftOptions: true } },
    ];
    reactFlowState.edges = [
      { id: "e-fft-radio", source: "fft", target: "radio" },
    ];
    const store = createStore();
    store.dispatch({
      type: "spectrum/setPreviewRange",
      payload: { min: 92_500_000, max: 92_858_000 },
    });

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <RadioNode data={{ label: "Radio" }} />
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getAllByText("From Node")[0]).toBeInTheDocument();
    expect(screen.getByText("92.679MHz")).toBeInTheDocument();
    expect(screen.getByText("358kHz")).toBeInTheDocument();
  });
});
