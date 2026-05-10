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
import demodReducer, { setHardwareInfo } from "../../src/ts/redux/slices/demodSlice";
import spectrumReducer from "../../src/ts/redux/slices/spectrumSlice";
import themeReducer from "../../src/ts/redux/slices/themeSlice";
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
  centerFreqHz: 137_500_000,
  isListening: false,
};

function createMockStore(
  initialDemodState = {},
  spectrumRange?: { min: number; max: number },
) {
  const center = (initialDemodState as any).centerFreqHz || 137_500_000;
  const range =
    spectrumRange ?? {
      min: center - 1_600_000,
      max: center + 1_600_000,
    };
  return configureStore({
    reducer: {
      demod: demodReducer,
      spectrum: spectrumReducer,
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
    const store = createMockStore({ sampleRateHz: 3_200_000 });
    
    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>
    );

    expect(screen.getByText("3.2MHz")).toBeInTheDocument();
    expect(screen.getByText("135.900MHz")).toBeInTheDocument();
  });

  it("enforces the 1.6MHz floor (0Hz start) even if frequency is set lower", async () => {
    const store = createMockStore({ 
      sampleRateHz: 3_200_000, 
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

    await waitFor(() => {
      const startFreqElements = screen.queryAllByText(/0Hz/);
      expect(startFreqElements.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 2000 });

    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    expect(inputs[0].value).toBe("1.600");
    expect(inputs[1].value).toBe("3.200");
    expect(inputs[2].value).toBe("0.000");
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("MHz");
    expect(selects[1]).toHaveValue("MHz");
    expect(selects[2]).toHaveValue("Hz");
  });

  it("updates the floor dynamically when sample rate changes", async () => {
    const store = createMockStore({ sampleRateHz: 3_200_000 });
    
    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>
    );

    expect(screen.getByText("135.900MHz")).toBeInTheDocument();

    act(() => {
      store.dispatch(setHardwareInfo({
        range: { min: 0, max: 2_000_000_000 },
        sampleRate: 10_000_000
      }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(formatFrequency(10_000_000)),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("135.900MHz")).toBeInTheDocument();
  });

  it("clamps center so the span window stays within 0 Hz and 30 GHz (end touches 30 GHz)", async () => {
    const spanHz = 3_200_000;
    const store = createMockStore(
      { sampleRateHz: spanHz },
      {
        min: 30_000_000_000 - spanHz / 2,
        max: 30_000_000_000 + spanHz / 2,
      },
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReactFlow>
            <SpanNode data={{ label: "Span Control" }} />
          </ReactFlow>
        </ThemeProvider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/30\.000GHz/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/29\.997GHz/).length).toBeGreaterThan(0);
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
      expect(raw!).toContain("NOAA-19");
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
});
