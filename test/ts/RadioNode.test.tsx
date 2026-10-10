import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
let mockNeuralModelReady = false;
let mockOnnxModelAvailable = true;
const mockSetNeuralBackend = jest.fn();

jest.mock("@n-apt/redux", () => {
  const reactRedux = jest.requireActual("react-redux");
  return {
    useAppDispatch: reactRedux.useDispatch,
    useAppSelector: reactRedux.useSelector,
  };
});

jest.mock("@n-apt/redux/thunks/demodThunks", () => ({
  syncRadioDemodFromSource: (payload: unknown) => ({
    type: "test/syncRadioDemodFromSource",
    payload,
  }),
}));

jest.mock("@n-apt/redux/slices/spectrumSlice", () => ({
  __esModule: true,
  default: (state = {}, action: { type: string; payload?: unknown }) =>
    action.type === "spectrum/setPreviewRange"
      ? { ...state, previewRange: action.payload }
      : state,
}));

jest.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useReactFlow: () => ({
    getNodes: () => reactFlowState.nodes,
    getEdges: () => reactFlowState.edges,
  }),
}));

jest.mock("@n-apt/demodulation/context/DemodAudioContext", () => ({
  useDemodAudio: () => ({
    audioPlayback: {
      stopAudio: jest.fn(),
    },
  }),
}));

jest.mock("@n-apt/demodulation/context/DemodContext", () => ({
  useDemod: () => ({
    audioSurveyNeuralModelReady: mockNeuralModelReady,
    audioSurveyNeuralBackend: "typescript",
    audioSurveyOnnxModelAvailable: mockOnnxModelAvailable,
    audioSurveyOnnxLoading: false,
    setAudioSurveyNeuralBackend: mockSetNeuralBackend,
  }),
}));

import { RadioNode } from "@n-apt/demodulation/react-flow/nodes/RadioNode";
import demodReducer from "@n-apt/redux/slices/demodSlice";
import spectrumReducer from "@n-apt/redux/slices/spectrumSlice";
import themeReducer from "@n-apt/redux/slices/themeSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";

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
  beforeEach(() => {
    mockNeuralModelReady = false;
    mockOnnxModelAvailable = true;
    mockSetNeuralBackend.mockClear();
  });

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

  it("offers live neural decoding only after held-out validation succeeds", () => {
    reactFlowState.nodes = [
      {
        id: "radio",
        type: "custom",
        data: { label: "Radio", radioOptions: true },
      },
    ];
    reactFlowState.edges = [];
    const store = createStore();

    const view = render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <RadioNode data={{ label: "Radio" }} />
        </ThemeProvider>
      </Provider>,
    );

    const neuralOption = screen.getByRole("option", {
      name: "Neural (held-out validated)",
    });
    expect(neuralOption).toBeDisabled();

    mockNeuralModelReady = true;
    view.rerender(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <RadioNode data={{ label: "Radio" }} />
        </ThemeProvider>
      </Provider>,
    );

    const readyOption = screen.getByRole("option", {
      name: "Neural (held-out validated)",
    });
    expect(readyOption).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Demod Algorithm"), {
      target: { value: "neural" },
    });
    expect(store.getState().demod.algorithm).toBe("neural");
    const backendSelect = screen.getByLabelText("Neural Backend");
    expect(
      screen.getByRole("option", { name: "ONNX Runtime (local)" }),
    ).toBeEnabled();
    fireEvent.change(backendSelect, { target: { value: "onnx" } });
    expect(mockSetNeuralBackend).toHaveBeenCalledWith("onnx");
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
