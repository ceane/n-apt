import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";
import authSlice from "@n-apt/redux/slices/authSlice";
import spectrumSlice from "@n-apt/redux/slices/spectrumSlice";
import waterfallSlice from "@n-apt/redux/slices/waterfallSlice";
import themeSlice from "@n-apt/redux/slices/themeSlice";
import settingsSlice from "@n-apt/redux/slices/settingsSlice";
import websocketSlice from "@n-apt/redux/slices/websocketSlice";
import snapshotSlice from "@n-apt/redux/slices/snapshotSlice";
import demodSlice from "@n-apt/redux/slices/demodSlice";
import sourceRoutingSlice from "@n-apt/redux/slices/sourceRoutingSlice";
import { buildAppTheme } from "@n-apt/ui/Theme";
import { THEME_TOKENS } from "@n-apt/consts";

const defaultTheme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

export function createTestStore(preloadedState?: any) {
  return configureStore({
    reducer: {
      auth: authSlice,
      spectrum: spectrumSlice,
      waterfall: waterfallSlice,
      theme: themeSlice,
      settings: settingsSlice,
      websocket: websocketSlice,
      snapshot: snapshotSlice,
      demod: demodSlice,
      sourceRouting: sourceRoutingSlice,
    },
    middleware: (getDefaultMiddleware: any) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
    preloadedState,
  } as any);
}

export function TestWrapper({
  children,
  preloadedState,
}: {
  children: React.ReactNode;
  preloadedState?: any;
}) {
  const store = createTestStore(preloadedState);

  return (
    <Provider store={store}>
      <ThemeProvider theme={defaultTheme}>{children}</ThemeProvider>
    </Provider>
  );
}
