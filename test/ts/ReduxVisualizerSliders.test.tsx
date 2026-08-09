import React from "react";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import authSlice from "@n-apt/redux/slices/authSlice";
import waterfallSlice from "@n-apt/redux/slices/waterfallSlice";
import themeSlice from "@n-apt/redux/slices/themeSlice";
import settingsSlice from "@n-apt/redux/slices/settingsSlice";
import websocketSlice from "@n-apt/redux/slices/websocketSlice";
import snapshotSlice from "@n-apt/redux/slices/snapshotSlice";
import demodSlice from "@n-apt/redux/slices/demodSlice";
import ReduxVisualizerSliders from "@n-apt/spectrum/sidebar/ReduxVisualizerSliders";
import { setShowTxSlider } from "@n-apt/redux";
import { ThemeProvider } from "styled-components";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

const theme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const createStore = (preloadedState?: any) =>
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
    } as any,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });

describe("ReduxVisualizerSliders", () => {
  test("shows the tx slider toggle for tx-capable devices", () => {
    const store = createStore({
      websocket: {
        activeSourceId: "hackrf-1",
        sources: [
          {
            id: "hackrf-1",
            capability: "tx_rx",
            kind: "hackrf_one",
            name: "HackRF One",
            active_duplex_mode: "tx",
          },
        ],
        sourceStatuses: {},
        channels: [],
      },
    });
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
    const store = createStore({
      websocket: {
        activeSourceId: "mock-tx",
        sources: [
          {
            id: "mock-tx",
            capability: "tx",
            kind: "mock_tx",
            name: "Mock Tx SDR",
          },
        ],
        sourceStatuses: {},
        channels: [],
      },
    });
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

  test("defaults to true if Redux persist restores an undefined showTxSlider state", () => {
    const store = createStore({
      websocket: {
        activeSourceId: "mock-tx",
        sources: [
          {
            id: "mock-tx",
            capability: "tx",
            kind: "mock_tx",
            name: "Mock Tx SDR",
          },
        ],
        sourceStatuses: {},
        channels: [],
      },
    });
    store.dispatch(setShowTxSlider(undefined as any));

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReduxVisualizerSliders />
        </ThemeProvider>
      </Provider>,
    );

    const button = screen.getByRole("button", { name: /hide tx slider/i });
    expect(button).toBeInTheDocument();
  });

  test("does not show the tx slider toggle when the selected device is rx-only", () => {
    const store = createStore();
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

  test("does not show the tx slider toggle when the selected device is a mock rx-only device", () => {
    const store = createStore();
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

  test("does not show the tx slider toggle for a mock APT source", () => {
    const store = createStore({
      websocket: {
        activeSourceId: "mock-apt-1",
        sources: [
          {
            id: "mock-apt-1",
            capability: "mock",
            kind: "mock_apt",
            name: "Mock APT SDR",
          },
        ],
        sourceStatuses: {},
        channels: [],
      },
    });
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
