import React from "react";
import FFTCanvas from "./FFTCanvas";
import { Provider } from "react-redux";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";

const mockThemeSlice = createSlice({
  name: "theme",
  initialState: {
    appMode: "dark",
    fftColor: "#00ff88",
    waterfallTheme: "viridis",
    primary: "#00d4ff",
    background: "#0a0a0a",
  },
  reducers: {},
});

const mockSpectrumSlice = createSlice({
  name: "spectrum",
  initialState: {
    fftAvgEnabled: false,
    fftSmoothEnabled: false,
    wfSmoothEnabled: false,
  },
  reducers: {},
});

const store = configureStore({
  reducer: {
    theme: mockThemeSlice.reducer,
    spectrum: mockSpectrumSlice.reducer,
  },
});

const theme = {
  primary: "#00d4ff",
  background: "#0a0a0a",
  fft: "#00d4ff",
  mode: "dark",
};

export const Default = () => {
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState(0);
  const [dbMin, setDbMin] = React.useState(-120);
  const [dbMax, setDbMax] = React.useState(0);

  const dataRef = React.useRef({
    waveform: new Float32Array(4096).fill(-100).map((v) => v + Math.random() * 20),
    centerFreq: 2400,
  });

  React.useEffect(() => {
    const interval = setInterval(() => {
      const newData = new Float32Array(4096);
      for (let i = 0; i < 4096; i++) {
        newData[i] = -100 + Math.random() * 20 + Math.sin(i * 0.05) * 15 + Math.cos(i * 0.2) * 5;
      }
      dataRef.current.waveform = newData;
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <div style={{ height: "600px", width: "100%", background: "#0a0a0a" }}>
          <FFTCanvas
            dataRef={dataRef}
            frequencyRange={{ min: 2300, max: 2500 }}
            centerFrequencyMHz={2400}
            activeSignalArea="main"
            isPaused={false}
            snapshotGridPreference={true}
            vizZoom={zoom}
            vizPanOffset={pan}
            fftMin={dbMin}
            fftMax={dbMax}
            onVizZoomChange={setZoom}
            onVizPanChange={setPan}
            onFftDbLimitsChange={(min, max) => {
              setDbMin(min);
              setDbMax(max);
            }}
          />
        </div>
      </ThemeProvider>
    </Provider>
  );
};
