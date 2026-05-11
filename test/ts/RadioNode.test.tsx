import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Provider } from "react-redux";
import { ThemeProvider } from "styled-components";
import { configureStore } from "@reduxjs/toolkit";

jest.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useReactFlow: () => ({
    getNodes: () => [
      { id: "radio", type: "custom", data: { label: "Radio", radioOptions: true } },
      { id: "fm", type: "custom", data: { label: "FM", fmOptions: true } },
    ],
    getEdges: () => [{ id: "e-fm-radio", source: "fm", target: "radio" }],
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
  it("shows From FM and uses FM bandwidth when connected upstream from FM", () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <RadioNode data={{ label: "Radio" }} />
        </ThemeProvider>
      </Provider>,
    );

    expect(screen.getAllByText("From FM")[0]).toBeInTheDocument();
    expect(screen.getByText("92.7MHz")).toBeInTheDocument();
    expect(screen.getByText("200.0kHz")).toBeInTheDocument();
  });
});
