import * as React from "react";

interface FFTCanvasProps {
  data: any;
  frequencyRange: { min: number; max: number };
  centerFrequencyHz: number;
  activeSignalArea: string;
  isPaused: boolean;
  isDeviceConnected?: boolean;
  onFrequencyRangeChange?: (range: any) => void;
  displayTemporalResolution?: "low" | "medium" | "high";
}

export default function FFTCanvas({
  data,
  frequencyRange: _frequencyRange,
  centerFrequencyHz: _centerFrequencyHz,
  activeSignalArea: _activeSignalArea,
  isPaused,
  isDeviceConnected = true,
  onFrequencyRangeChange: _onFrequencyRangeChange,
  displayTemporalResolution = "medium",
}: FFTCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [webgpuEnabled, setWebgpuEnabled] = React.useState(false);

  React.useEffect(() => {
    // Simulate WebGPU initialization
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      setTimeout(() => {
        setWebgpuEnabled(true);
        console.log(
          "✅ WebGPU initialized successfully - using GPU acceleration",
        );
      }, 100);
    } else {
      console.log("📱 WebGPU not supported - using 2D canvas rendering");
      setWebgpuEnabled(false);
    }
  }, []);

  React.useEffect(() => {
    // Simulate canvas rendering
    if (canvasRef.current && data?.waveform) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        // Mock rendering logic
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 800, 600);
      }
    }
  }, [data]);

  return (
    <div
      data-testid="fft-canvas"
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <div>
        <h2>FFT Signal Display {isPaused && "(Paused)"}</h2>
        <canvas
          key="spectrum-canvas"
          ref={canvasRef}
          width={800}
          height={300}
          data-testid="spectrum-canvas"
        />
      </div>
      <div>
        <h2>Waterfall Display {isPaused && "(Paused)"}</h2>
        <canvas
          key="waterfall-canvas"
          width={800}
          height={300}
          data-testid="waterfall-canvas"
        />
      </div>
      <div data-testid="canvas-status">
        <div>WebGPU: {webgpuEnabled ? "Enabled" : "Disabled"}</div>
        <div>Paused: {isPaused}</div>
        <div>Device: {isDeviceConnected ? "Connected" : "Disconnected"}</div>
        <div>Resolution: {displayTemporalResolution}</div>
      </div>
    </div>
  );
}
