import React from "react";
import { FFTCanvas, NoteCards } from "@n-apt/components";
import type { FFTCanvasHandle } from "@n-apt/components";

const VIEWPORT_STYLE: React.CSSProperties = {
  height: "100vh",
  width: "100%",
  background: "#0a0a0a",
  padding: 16,
  boxSizing: "border-box",
};

const BASE_PROPS = {
  frequencyRange: { min: 2300, max: 2500 },
  centerFrequencyHz: 2_400_000_000,
  activeSignalArea: "main",
  snapshotGridPreference: true,
};

const generateSignalFrame = (
  fftSize: number,
  timeSeconds: number,
): Float32Array => {
  const waveform = new Float32Array(fftSize);
  const baseNoise = -82;
  for (let i = 0; i < fftSize; i++) {
    const normalized = i / fftSize;
    let signal = baseNoise + Math.random() * 8;
    signal += Math.exp(-Math.pow((normalized - 0.18) * 32, 2)) * 28;
    signal += Math.exp(-Math.pow((normalized - 0.52) * 18, 2)) * 24;
    signal += Math.exp(-Math.pow((normalized - 0.77) * 26, 2)) * 18;
    signal += Math.sin(normalized * Math.PI * 20 + timeSeconds) * 4;
    waveform[i] = signal;
  }
  return waveform;
};

const useDynamicSignal = (fftSize = 4096) => {
  const dataRef = React.useRef<any>({
    waveform: new Float32Array(fftSize).fill(-100),
    center_frequency_hz: 2_400_000_000,
    sample_rate: 3_200_000,
    data_type: "fft_frame",
  });

  React.useEffect(() => {
    let raf = 0;
    const update = () => {
      const timeSeconds = performance.now() / 1000;
      dataRef.current = {
        ...dataRef.current,
        waveform: generateSignalFrame(fftSize, timeSeconds),
        center_frequency_hz: 2_400_000_000,
        sample_rate: 3_200_000,
        data_type: "fft_frame",
      };
      raf = window.requestAnimationFrame(update);
    };
    raf = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(raf);
  }, [fftSize]);

  return dataRef;
};

const StoryCanvas: React.FC = () => {
  const dataRef = useDynamicSignal();
  const fftCanvasRef = React.useRef<FFTCanvasHandle | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState(0);
  const [dbMin, setDbMin] = React.useState(-120);
  const [dbMax, setDbMax] = React.useState(0);

  return (
    <div style={{ ...VIEWPORT_STYLE, position: "relative" }}>
      <FFTCanvas
        ref={fftCanvasRef}
        {...BASE_PROPS}
        dataRef={dataRef}
        isPaused={false}
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
      <NoteCards fftCanvasRef={fftCanvasRef} />
    </div>
  );
};

export default {
  title: "Notecard/NoteCards",
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = () => <StoryCanvas />;
