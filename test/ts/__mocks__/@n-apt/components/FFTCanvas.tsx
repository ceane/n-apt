import * as React from "react"

interface FFTCanvasProps {
  data: any
  frequencyRange: { min: number; max: number }
  centerFrequencyMHz: number
  activeSignalArea: string
  isPaused: boolean
  isDeviceConnected?: boolean
  onFrequencyRangeChange?: (range: any) => void
  displayTemporalResolution?: "low" | "medium" | "high"
  force2D?: boolean
}

export default function FFTCanvas({
  data,
  frequencyRange,
  centerFrequencyMHz,
  activeSignalArea,
  isPaused,
  isDeviceConnected = true,
  onFrequencyRangeChange,
  displayTemporalResolution = "medium",
  force2D = false
}: FFTCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [webgpuEnabled, setWebgpuEnabled] = React.useState(!force2D)

  React.useEffect(() => {
    // Simulate WebGPU initialization
    if (!force2D && typeof navigator !== "undefined" && "gpu" in navigator) {
      setTimeout(() => {
        setWebgpuEnabled(true)
        console.log("✅ WebGPU initialized successfully - using GPU acceleration")
      }, 100)
    } else {
      console.log("📱 WebGPU not supported - using 2D canvas rendering")
      setWebgpuEnabled(false)
    }
  }, [force2D])

  React.useEffect(() => {
    // Simulate canvas rendering
    if (canvasRef.current && data?.waveform) {
      const ctx = canvasRef.current.getContext("2d")
      if (ctx) {
        // Mock rendering logic
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, 800, 600)
      }
    }
  }, [data])

  return React.createElement("div", {
    "data-testid": "fft-canvas",
    style: { position: "relative", width: "100%", height: "100%" }
  }, [
    React.createElement("canvas", {
      key: "spectrum-canvas",
      ref: canvasRef,
      width: 800,
      height: 300,
      "data-testid": "spectrum-canvas"
    }),
    React.createElement("canvas", {
      key: "waterfall-canvas",
      width: 800,
      height: 300,
      "data-testid": "waterfall-canvas"
    }),
    React.createElement("div", {
      key: "status",
      "data-testid": "canvas-status"
    }, [
      `WebGPU: ${webgpuEnabled ? "Enabled" : "Disabled"}`,
      `Paused: ${isPaused}`,
      `Device: ${isDeviceConnected ? "Connected" : "Disconnected"}`,
      `Resolution: ${displayTemporalResolution}`
    ])
  ])
}
