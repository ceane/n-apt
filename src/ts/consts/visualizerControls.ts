import { FFT_MAX_DB, FFT_MIN_DB } from "./fft";

export type VisualizerPowerScale = "dB" | "dBm";

export const FRONTEND_VISUALIZER_DEFAULTS = {
  maxFrameRate: 100,
  zoom: 1,
  zoomFloor: 1,
  zoomFloorPan: 0,
  maxZoom: 1125,
  powerScale: "dB" as VisualizerPowerScale,
  dbLimits: {
    dB: { min: -120, max: 0 },
    dBm: { min: -100, max: 30 },
  },
} as const;

export const VISUALIZER_MAX_ZOOM_LIMITS = {
  min: 100,
  max: 10_000,
  step: 25,
} as const;

export const VISUALIZER_DEFAULT_ZOOM = FRONTEND_VISUALIZER_DEFAULTS.zoom;
export const VISUALIZER_MAX_ZOOM = FRONTEND_VISUALIZER_DEFAULTS.maxZoom;

export const VISUALIZER_DEFAULT_DB_LIMITS: Record<
  VisualizerPowerScale,
  { min: number; max: number }
> = {
  dB: { ...FRONTEND_VISUALIZER_DEFAULTS.dbLimits.dB },
  dBm: { ...FRONTEND_VISUALIZER_DEFAULTS.dbLimits.dBm },
};

export const getVisualizerDefaultDbLimits = (
  powerScale: VisualizerPowerScale,
) => ({ ...VISUALIZER_DEFAULT_DB_LIMITS[powerScale] });

export const getVisualizerDbRanges = (powerScale: VisualizerPowerScale) => ({
  max:
    powerScale === "dBm"
      ? { min: -100, max: 30 }
      : { min: FFT_MIN_DB, max: FFT_MAX_DB },
  min:
    powerScale === "dBm"
      ? { min: -120, max: -10 }
      : { min: FFT_MIN_DB, max: -10 },
});
