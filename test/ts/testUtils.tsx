import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";
import authSlice from "../../src/ts/redux/slices/authSlice";
import spectrumSlice from "../../src/ts/redux/slices/spectrumSlice";
import waterfallSlice from "../../src/ts/redux/slices/waterfallSlice";
import themeSlice from "../../src/ts/redux/slices/themeSlice";
import settingsSlice from "../../src/ts/redux/slices/settingsSlice";
import websocketSlice from "../../src/ts/redux/slices/websocketSlice";
import snapshotSlice from "../../src/ts/redux/slices/snapshotSlice";
import { buildAppTheme } from "../../src/ts/components/ui/Theme";
import { THEME_TOKENS } from "../../src/ts/consts";

const defaultTheme = buildAppTheme({
  accentColor: THEME_TOKENS.colors.dark.primary,
  fftColor: THEME_TOKENS.colors.dark.fftLine,
  appMode: "system",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

export function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice,
      spectrum: spectrumSlice,
      waterfall: waterfallSlice,
      theme: themeSlice,
      settings: settingsSlice,
      websocket: websocketSlice,
      snapshot: snapshotSlice,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
  });
}

export function TestWrapper({ children }: { children: React.ReactNode }) {
  const store = createTestStore();

  return (
    <Provider store={store}>
      <ThemeProvider theme={defaultTheme}>
        {children}
      </ThemeProvider>
    </Provider>
  );
}
