import React from "react";
import { Provider } from "react-redux";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { ThemeProvider } from "styled-components";
import FFTCanvas from "@n-apt/components/FFTCanvas";
import type { FFTCanvasHandle } from "@n-apt/components/FFTCanvas";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import {
  useSnapshot,
  getSupportedSnapshotVideoFormat,
  type SnapshotVideoFormat,
} from "@n-apt/hooks/useSnapshot";

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

const VIEWPORT_STYLE: React.CSSProperties = {
  height: "600px",
  width: "100%",
  background: "#0a0a0a",
  padding: 16,
  boxSizing: "border-box",
};

const BASE_PROPS = {
  frequencyRange: { min: 2300, max: 2500 },
  centerFrequencyMHz: 2400,
  activeSignalArea: "main",
  snapshotGridPreference: true,
};

const StoryShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Provider store={store}>
    <ThemeProvider theme={theme as any}>
      <div style={VIEWPORT_STYLE}>{children}</div>
    </ThemeProvider>
  </Provider>
);

type SignalType = "peaks" | "sweep" | "noise" | "realistic";

const SIGNAL_TYPES: SignalType[] = ["peaks", "sweep", "noise", "realistic"];


const generateSignalFrame = (
  fftSize: number,
  signalType: SignalType,
  timeSeconds: number,
): Float32Array => {
  const waveform = new Float32Array(fftSize);
  const baseNoise = -80;
  for (let i = 0; i < fftSize; i++) {
    const normalized = i / fftSize;
    let signal = baseNoise + Math.random() * 10;
    switch (signalType) {
      case "peaks":
        signal += Math.exp(-Math.pow((normalized - 0.2) * 20, 2)) * 40;
        signal += Math.exp(-Math.pow((normalized - 0.5) * 15, 2)) * 35;
        signal += Math.exp(-Math.pow((normalized - 0.8) * 25, 2)) * 30;
        break;
      case "sweep": {
        const sweepPos = (Math.sin(timeSeconds * 0.5) + 1) / 2;
        signal += Math.exp(-Math.pow((normalized - sweepPos) * 30, 2)) * 45;
        break;
      }
      case "noise": {
        const noiseFreq = normalized * 10;
        signal += Math.sin(noiseFreq * timeSeconds * 2) * 20;
        signal += Math.cos(noiseFreq * timeSeconds * 3) * 15;
        break;
      }
      case "realistic":
      default:
        signal += Math.exp(-Math.pow((normalized - 0.15) * 50, 2)) * 35;
        signal += Math.exp(-Math.pow((normalized - 0.3) * 8, 2)) * 25;
        signal += Math.exp(-Math.pow((normalized - 0.6) * 12, 2)) * 20;
        signal += Math.sin(normalized * Math.PI * 20 + timeSeconds) * 5;
        break;
    }
    waveform[i] = signal;
  }
  return waveform;
};

const useDynamicSignal = (fftSize = 4096) => {
  const [signalType, setSignalType] = React.useState<SignalType>("realistic");
  const dataRef = React.useRef<any>({
    waveform: new Float32Array(fftSize).fill(-100),
    center_frequency_hz: 2_400_000_000,
    sample_rate: 3_200_000,
    data_type: "fft_frame",
  });

  React.useEffect(() => {
    let raf: number;
    const update = () => {
      const timeSeconds = performance.now() / 1000;
      const waveform = generateSignalFrame(fftSize, signalType, timeSeconds);
      dataRef.current = {
        ...dataRef.current,
        waveform,
        center_frequency_hz: 2_400_000_000,
        sample_rate: 3_200_000,
        data_type: "fft_frame",
        timestamp: timeSeconds,
      };
      raf = window.requestAnimationFrame(update);
    };
    raf = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(raf);
  }, [fftSize, signalType]);

  return { dataRef, signalType, setSignalType };
};

const useStaticWaveform = () => {
  return React.useRef<any>({
    waveform: new Float32Array(4096).map((_, idx) => -95 + Math.sin(idx * 0.01) * 10),
    center_frequency_hz: 2_400_000_000,
    sample_rate: 3_200_000,
    data_type: "fft_frame",
  });
};

const useEmptyWaveform = () => {
  return React.useRef<any>({
    waveform: null,
    center_frequency_hz: 2_400_000_000,
    sample_rate: 3_200_000,
    data_type: "fft_frame",
  });
};

type StoryFFTCanvasProps = Partial<React.ComponentProps<typeof FFTCanvas>> & {
  dataRef: React.ComponentProps<typeof FFTCanvas>["dataRef"];
  canvasRef?: React.Ref<FFTCanvasHandle>;
};

const StatefulCanvas: React.FC<StoryFFTCanvasProps> = ({ canvasRef, ...props }) => {
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState(0);
  const [dbMin, setDbMin] = React.useState(-120);
  const [dbMax, setDbMax] = React.useState(0);

  return (
    <FFTCanvas
      ref={canvasRef}
      {...BASE_PROPS}
      {...props}
      vizZoom={zoom}
      vizPanOffset={pan}
      fftMin={dbMin}
      fftMax={dbMax}
      isPaused={props.isPaused ?? false}
      onVizZoomChange={setZoom}
      onVizPanChange={setPan}
      onFftDbLimitsChange={(min, max) => {
        setDbMin(min);
        setDbMax(max);
      }}
    />
  );
};

export const Placeholder = () => {
  const dataRef = useEmptyWaveform();
  return (
    <StoryShell>
      <StatefulCanvas dataRef={dataRef} isPaused={false} awaitingDeviceData />
    </StoryShell>
  );
};

export const Snapshot = () => {
  const { dataRef, signalType, setSignalType } = useDynamicSignal();
  const fftCanvasRef = React.useRef<FFTCanvasHandle | null>(null);
  const { handleSnapshot } = useSnapshot(BASE_PROPS.frequencyRange, true);

  const [snapshotWhole, setSnapshotWhole] = React.useState(false);
  const [snapshotShowWaterfall, setSnapshotShowWaterfall] = React.useState(true);
  const [snapshotShowStats, setSnapshotShowStats] = React.useState(true);
  const [snapshotShowGeolocation, setSnapshotShowGeolocation] = React.useState(false);
  const [snapshotFormat, setSnapshotFormat] = React.useState<"png" | "svg" | SnapshotVideoFormat>("png");
  const [snapshotGridPreference, setSnapshotGridPreference] = React.useState(true);
  const [snapshotGeolocationError, setSnapshotGeolocationError] = React.useState<string | null>(null);
  const supportedSnapshotVideoFormat = React.useMemo(
    () => getSupportedSnapshotVideoFormat(),
    [],
  );
  const handleSnapshotFormatChange = React.useCallback(
    (value: "png" | "svg" | SnapshotVideoFormat) => {
      setSnapshotFormat(value);
    },
    [],
  );

  const triggerSnapshot = React.useCallback(() => {
    const snapshotData = fftCanvasRef.current?.getSnapshotData() ?? null;
    if (!snapshotData) {
      return;
    }
    void handleSnapshot({
      whole: snapshotWhole,
      showWaterfall: snapshotShowWaterfall,
      showStats: snapshotShowStats,
      showGeolocation: snapshotShowGeolocation,
      geolocation: snapshotShowGeolocation
        ? { lat: "37.7749", lon: "-122.4194" }
        : undefined,
      showGrid: snapshotGridPreference,
      format: snapshotFormat,
      getSnapshotData: () => snapshotData,
      signalAreaBounds: { main: BASE_PROPS.frequencyRange },
      activeSignalArea: "main",
      sourceName: `FFTCanvas Ladle (${signalType})`,
      sdrSettingsLabel: "Gain: Auto | PPM: 0",
    });
  }, [
    handleSnapshot,
    snapshotFormat,
    snapshotGridPreference,
    snapshotShowGeolocation,
    snapshotShowStats,
    snapshotShowWaterfall,
    snapshotWhole,
    signalType,
  ]);

  return (
    <StoryShell>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
          height: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ color: "#ccc", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
            Signal preset:
            <select
              value={signalType}
              onChange={(event) => setSignalType(event.target.value as SignalType)}
              style={{ marginLeft: 8 }}
            >
              {SIGNAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <div style={{ flex: 1, minHeight: 0 }}>
            <StatefulCanvas
              dataRef={dataRef}
              isPaused={false}
              canvasRef={fftCanvasRef}
              snapshotGridPreference={snapshotGridPreference}
            />
          </div>
        </div>

        <div
          style={{
            background: "#111",
            border: "1px solid #1f1f1f",
            borderRadius: 12,
            padding: 16,
            overflowY: "auto",
          }}
        >
          <SnapshotControlsSection
            snapshotWhole={snapshotWhole}
            snapshotShowWaterfall={snapshotShowWaterfall}
            snapshotShowStats={snapshotShowStats}
            snapshotShowGeolocation={snapshotShowGeolocation}
            snapshotGeolocationError={snapshotGeolocationError}
            snapshotFormat={snapshotFormat}
            supportedSnapshotVideoFormat={supportedSnapshotVideoFormat}
            snapshotGridPreference={snapshotGridPreference}
            snapshotAspectRatio="default"
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotShowGeolocationChange={(value) => {
              setSnapshotShowGeolocation(value);
              setSnapshotGeolocationError(null);
            }}
            onSnapshotFormatChange={handleSnapshotFormatChange}
            onSnapshotGridPreferenceChange={setSnapshotGridPreference}
            onSnapshotAspectRatioChange={() => {}}
            onSnapshot={triggerSnapshot}
          />
        </div>
      </div>
    </StoryShell>
  );
};

export const Paused = () => {
  const dataRef = useStaticWaveform();
  return (
    <StoryShell>
      <StatefulCanvas dataRef={dataRef} isPaused />
    </StoryShell>
  );
};

export const Playing = () => {
  const { dataRef, signalType, setSignalType } = useDynamicSignal();

  return (
    <StoryShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
        <label style={{ color: "#ccc", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
          Signal preset:
          <select
            value={signalType}
            onChange={(event) => setSignalType(event.target.value as SignalType)}
            style={{ marginLeft: 8 }}
          >
            {SIGNAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <div style={{ flex: 1, minHeight: 0 }}>
          <StatefulCanvas dataRef={dataRef} isPaused={false} />
        </div>
      </div>
    </StoryShell>
  );
};
