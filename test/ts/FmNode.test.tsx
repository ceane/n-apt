import React from "react";
import { Provider } from "react-redux";
import { render, screen, fireEvent } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";
import { FmNode } from "@n-apt/demodulation/react-flow/nodes/FmNode";
import demodReducer from "@n-apt/redux/slices/demodSlice";
import spectrumReducer from "@n-apt/redux/slices/spectrumSlice";
import websocketReducer from "@n-apt/redux/slices/websocketSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";

describe("FmNode station selection", () => {
  it("commits the complete FM selection before the range command reads Redux", () => {
    const store = configureStore({ reducer: { demod: demodReducer, spectrum: spectrumReducer, websocket: websocketReducer } as any });
    render(
      <Provider store={store}>
        <ThemeProvider theme={buildAppTheme({ accentColor: "#00d4ff", fftColor: "#00d4ff", appMode: "system", resolvedMode: "dark", waterfallTheme: "classic" })}>
          <FmNode data={{ label: "FM Radio" }} />
        </ThemeProvider>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "92.7" }));
    expect(store.getState().demod).toMatchObject({
      centerFreqHz: 92_700_000,
      bandwidthCenterFreqHz: 92_700_000,
      bandwidthHz: 200_000,
      bandwidthStartHz: 92_600_000,
      bandwidthKhz: 200,
      fmTuneIntentHz: 92_700_000,
    });
    expect(store.getState().spectrum.frequencyRange).toEqual({ min: 92_600_000, max: 92_800_000 });
    expect(store.getState().spectrum).toMatchObject({
      fftSize: 32_768,
      fftFrameRate: 60,
      displayTemporalResolution: "lossless",
      gain: 30,
      ppm: 0,
    });
  });
});
