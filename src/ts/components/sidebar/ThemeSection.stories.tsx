import React from "react";
import { ThemeSection } from "./ThemeSection";
import { Provider } from "react-redux";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";

const themeSlice = createSlice({
  name: "theme",
  initialState: {
    appMode: "dark",
    accentColor: "#00d4ff",
    fftColor: "#00ff88",
    waterfallTheme: "viridis",
    primary: "#00d4ff",
  },
  reducers: {
    setAppMode: (state, action) => { state.appMode = action.payload; },
    setAccentColor: (state, action) => { state.accentColor = action.payload; },
    setFftColor: (state, action) => { state.fftColor = action.payload; },
    setWaterfallTheme: (state, action) => { state.waterfallTheme = action.payload; },
    resetTheme: (state) => {
      state.appMode = "dark";
      state.accentColor = "#00d4ff";
      state.fftColor = "#00ff88";
      state.waterfallTheme = "viridis";
    },
  },
});

const store = configureStore({
  reducer: {
    theme: themeSlice.reducer,
  },
});

const theme = {
  primary: "#00d4ff",
};

export const Default = () => (
  <Provider store={store}>
    <ThemeProvider theme={theme}>
      <div style={{ padding: "20px", background: "#0a0a0a", width: "350px" }}>
        <ThemeSection />
      </div>
    </ThemeProvider>
  </Provider>
);
