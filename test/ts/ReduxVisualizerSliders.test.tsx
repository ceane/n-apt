import React from "react";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import spectrumSlice from "../../src/ts/redux/slices/spectrumSlice";
import authSlice from "../../src/ts/redux/slices/authSlice";
import waterfallSlice from "../../src/ts/redux/slices/waterfallSlice";
import themeSlice from "../../src/ts/redux/slices/themeSlice";
import settingsSlice from "../../src/ts/redux/slices/settingsSlice";
import websocketSlice from "../../src/ts/redux/slices/websocketSlice";
import snapshotSlice from "../../src/ts/redux/slices/snapshotSlice";
import demodSlice from "../../src/ts/redux/slices/demodSlice";
import ReduxVisualizerSliders from "../../src/ts/components/sidebar/ReduxVisualizerSliders";
import { setDeviceKind, setShowTxSlider } from "../../src/ts/redux";
import { ThemeProvider } from "styled-components";
import { buildAppTheme } from "../../src/ts/components/ui/Theme";
import { THEME_TOKENS } from "../../src/ts/consts";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const createStore = () =>
  configureStore({
    reducer: {
      auth: authSlice,
      spectrum: spectrumSlice,
      waterfall: waterfallSlice,
      theme: themeSlice,
      settings: settingsSlice,
      websocket: websocketSlice,
      snapshot: snapshotSlice,
      demod: demodSlice,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });

describe("ReduxVisualizerSliders", () => {
  test("shows the tx slider toggle for tx-capable devices", () => {
    const store = createStore();
    store.dispatch(setDeviceKind("hackrf_one"));
    store.dispatch(setShowTxSlider(false));

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReduxVisualizerSliders />
        </ThemeProvider>
      </Provider>,
    );

    expect(
      screen.getByRole("button", { name: /show tx slider/i }),
    ).toBeInTheDocument();
  });

  test("shows the tx slider toggle for the mock tx device", () => {
    const store = createStore();
    store.dispatch(setDeviceKind("mock_tx"));
    store.dispatch(setShowTxSlider(false));

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReduxVisualizerSliders />
        </ThemeProvider>
      </Provider>,
    );

    expect(
      screen.getByRole("button", { name: /show tx slider/i }),
    ).toBeInTheDocument();
  });

  test("does not show the tx slider toggle when the selected device is rx-only", () => {
    const store = createStore();
    store.dispatch(setDeviceKind(null));
    store.dispatch(setShowTxSlider(false));

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReduxVisualizerSliders />
        </ThemeProvider>
      </Provider>,
    );

    expect(
      screen.queryByRole("button", { name: /show tx slider/i }),
    ).not.toBeInTheDocument();
  });
});
