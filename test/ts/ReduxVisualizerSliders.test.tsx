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

  test("defaults to true if Redux persist restores an undefined showTxSlider state", () => {
    const store = createStore();
    store.dispatch(setDeviceKind("mock_tx"));
    // explicitly do not set showTxSlider to simulate undefined initial state
    // wait, we can just set it to undefined manually if possible
    // actually, let's just let it fall back

    // since we can't dispatch undefined easily due to typescript, we can just check the initial default state which should have showTxSlider: true
    // but the slice initializes to true anyway, so to simulate Redux persist replacing it with undefined we have to override the state.
    // However, the slice handles it as true initially. So maybe this test isn't strictly necessary since Redux handles `undefined` internally. Let's just pass `undefined` as any to be thorough.
    store.dispatch(setShowTxSlider(undefined as any));

    render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <ReduxVisualizerSliders />
        </ThemeProvider>
      </Provider>,
    );

    const button = screen.getByRole("button", { name: /hide tx slider/i }); // It says 'Hide' because it's active!
    expect(button).toBeInTheDocument();
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

  test("does not show the tx slider toggle when the selected device is a mock rx-only device", () => {
    const store = createStore();
    store.dispatch(setDeviceKind("mock"));
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
