import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { FrequencyRange, Alignment } from "@n-apt/consts/types";
import type { SignalsSdrDefaults } from "@n-apt/consts/schemas/websocket";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";
import {
  FRONTEND_VISUALIZER_DEFAULTS,
  VISUALIZER_MAX_ZOOM_LIMITS,
  getVisualizerDefaultDbLimits,
} from "@n-apt/consts/visualizerControls";
import { sanitizeMirroredPanOffset } from "@n-apt/math/basebandMirror";

const DEFAULT_DB_LIMITS = getVisualizerDefaultDbLimits("dB");

export interface GpuSpikeAnalysis {
  isNapt: boolean;
  confidence: number;
  baselineIsNapt: boolean;
  baselineConfidence: number;
  multiFrameIsNapt: boolean;
  multiFrameConfidence: number;
  multiFramePersistence: number;
  multiFrameFrameCount: number;
  multiFrameBridgeScore: number;
  multiFrameUDipScore: number;
  floorDbm: number;
  spikes: Array<{ frequencyHz: number; powerDbm: number; index: number }>;
  suspensionBridgeScore: number;
  clumpCount: number;
  bridgeWidthScore: number;
  bridgeShoulderScore: number;
  uDipScore: number;
  floorRelativePowerScore: number;
  temporalStability: number;
  bandwidthPrior: number;
  envelopeFitScore: number;
  envelopeResidualScore: number;
  envelopeSupportCount: number;
  sincPenaltyScore: number;
  unimodalBridgeScore: number;
  partialBridgeScore: number;
  apexProminenceScore: number;
  shoulderSymmetryScore: number;
  captureQualityScore: number;
}
export type PowerScale = "dB" | "dBm";
export type SourceMode = "live" | "file";

export interface TxSafetyResult {
  sourceId: string;
  effectivePowerDbm: number;
  maximumSafePowerDbm: number;
  minimumIqPowerFloorDbm: number;
  recommendedIfftSize: number;
  effectiveIfftSize: number;
  vgaGainDb?: number;
  ampEnabled?: boolean;
  safetyClamped: boolean;
  validationErrors: string[];
}

export interface StitchOptions {
  phaseCorrection: boolean;
  fmDeviationCorrection: boolean;
  antiAliasing: boolean;
  noiseFloorMatching: boolean;
  crossfading: boolean;
  chineseRemainderSynthesis: boolean;
  jsAntiAliasing: boolean;
  jsNoiseFloorMatching: boolean;
  acquisitionMode: "stepwise" | "interleaved";
}

export interface SpectrumState {
  // Signal area and frequency
  activeSignalArea: string;
  frequencyRange: FrequencyRange | null;
  /** True while an opt-in progressive tune owns the range preview. */
  tuningPreviewActive: boolean;
  lastKnownRanges: Record<string, { min: number; max: number }>;
  /** Monotonic marker for device-scoped range hydrations from other subscribers. */
  deviceFrequencyRangeRevision: number;

  // Display settings
  displayTemporalResolution: TemporalResolution;
  powerScale: PowerScale;
  vizZoom: number;
  maxVizZoom: number;
  vizZoomFloor: number;
  vizZoomFloorPan: number;
  autoZoomStability: boolean;
  vizPanOffset: number;
  displayMode: "fft" | "iq";

  // FFT settings
  fftMinDb: number;
  fftMaxDb: number;
  fftSize: number;
  fftSizeOptions: number[];
  fftWindow: string;
  fftFrameRate: number;
  fftAvgEnabled: boolean;
  fftSmoothEnabled: boolean;
  wfSmoothEnabled: boolean;

  // SDR settings
  txSignal: string;
  txSampleRateHz: number;
  txIfftSize: number;
  txViewerSampleRateHz: number;
  txViewerFftSize: number;
  txViewerFftFrameRate: number;
  txViewerFftWindow: string;
  txViewerTemporalResolution: TemporalResolution;
  txViewerPowerScale: PowerScale;
  txCenterFrequencyHz: number;
  txPowerDbm: number;
  txVgaGain: number;
  txSafetyEnabled: boolean;
  txSafetyLimit: "person" | "room" | "min";
  txSafetyResult: TxSafetyResult | null;
  txHopType: "range" | "channels";
  txHopStartFrequencyHz: number;
  txHopEndFrequencyHz: number;
  txHopChannels: string[];
  txHopRateHz: number;
  txHopEnabled: boolean;
  gain: number;
  hackrfLnaGain: number;
  hackrfVgaGain: number;
  hackrfAmpEnabled: boolean;
  hackrfBasebandBandwidth: number | null;
  /** True once the user pins a custom baseband-filter value; auto-tracking
   * resumes when the field is cleared and blurred. */
  basebandFilterPinned: boolean;
  ppm: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  sampleRateHz: number;
  minReceiveSampleRateHz: number;
  deviceKind: string | null;

  // Visualization state
  visualizerPaused: boolean;
  detectedFrameRate: number | null;
  isWaterfallCleared: boolean;
  showSpikeOverlay: boolean;
  removeDcSpike: boolean;
  gpuSpikeCount: number;
  gpuSpikeAnalysis: GpuSpikeAnalysis | null;
  hoveredSpikeIndex: number | null;
  showTxSlider: boolean;

  // Diagnostic state
  diagnosticStatus: string;
  isDiagnosticRunning: boolean;
  diagnosticTrigger: number;

  // Live preview range (from SpanNode)
  previewRange: FrequencyRange | null;
  previewAlignment: Alignment;
  stitchOptions: StitchOptions;
}

const LIVE_CONTROL_DEFAULTS = {
  displayTemporalResolution: "reduced" as const,
  powerScale: "dB" as const,
  vizZoom: FRONTEND_VISUALIZER_DEFAULTS.zoom,
  maxVizZoom: FRONTEND_VISUALIZER_DEFAULTS.maxZoom,
  vizZoomFloor: FRONTEND_VISUALIZER_DEFAULTS.zoomFloor,
  vizZoomFloorPan: FRONTEND_VISUALIZER_DEFAULTS.zoomFloorPan,
  autoZoomStability: true,
  vizPanOffset: 0,
  fftMinDb: DEFAULT_DB_LIMITS.min,
  fftMaxDb: DEFAULT_DB_LIMITS.max,
  previewRange: null,
  fftSizeOptions: [] as number[],
  fftWindow: "Rectangular",
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,
  txSignal: "wifi",
  txSampleRateHz: 2_400_000,
  txIfftSize: 2048,
  txViewerSampleRateHz: 2_400_000,
  txViewerFftSize: 65_536,
  txViewerFftFrameRate: 60,
  txViewerFftWindow: "Rectangular",
  txViewerTemporalResolution: "lossless" as const,
  txViewerPowerScale: "dB" as const,
  txCenterFrequencyHz: 137_100_000,
  txPowerDbm: -18,
  txVgaGain: 16,
  txSafetyEnabled: false,
  txSafetyLimit: "room" as "person" | "room" | "min",
  txSafetyResult: null,
  txHopType: "range" as const,
  txHopStartFrequencyHz: 10_000_000,
  txHopEndFrequencyHz: 20_000_000,
  txHopChannels: ["a"],
  txHopRateHz: 10,
  txHopEnabled: false,
};

/** Numeric slice keys whose bundles must never hold non-finite or wrong-typed values. */
const SETTINGS_BUNDLE_NUMERIC_KEYS = new Set([
  "fftSize",
  "fftFrameRate",
  "fftMinDb",
  "fftMaxDb",
  "gain",
  "ppm",
  "sampleRateHz",
  "minReceiveSampleRateHz",
  "txSampleRateHz",
  "txIfftSize",
  "txViewerSampleRateHz",
  "txViewerFftSize",
  "txViewerFftFrameRate",
  "txCenterFrequencyHz",
  "txPowerDbm",
  "txVgaGain",
  "txHopStartFrequencyHz",
  "txHopEndFrequencyHz",
  "txHopRateHz",
  "hackrfLnaGain",
  "hackrfVgaGain",
  "hackrfBasebandBandwidth",
  "vizZoom",
  "maxVizZoom",
  "vizZoomFloor",
  "vizZoomFloorPan",
  "vizPanOffset",
  "gpuSpikeCount",
]);

/**
 * Keep settings bundles from ever pushing non-finite numbers or wrong-typed
 * values into the slice: numeric keys accept only finite numbers; everything
 * else accepts only non-null scalars.
 */
function sanitizeSettingsBundle(
  payload: Partial<SpectrumState>,
): Partial<SpectrumState> {
  const cleanPayload: Partial<SpectrumState> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (SETTINGS_BUNDLE_NUMERIC_KEYS.has(key)) {
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
    } else if (val === null || typeof val === "function") {
      continue;
    }
    (cleanPayload as Record<string, unknown>)[key] = val;
  }
  return cleanPayload;
}

const initialState: SpectrumState = {
  activeSignalArea: "A",
  frequencyRange: null,
  tuningPreviewActive: false,
  lastKnownRanges: {},
  deviceFrequencyRangeRevision: 0,

  displayTemporalResolution: "reduced",
  powerScale: "dB",
  vizZoom: FRONTEND_VISUALIZER_DEFAULTS.zoom,
  maxVizZoom: FRONTEND_VISUALIZER_DEFAULTS.maxZoom,
  vizZoomFloor: FRONTEND_VISUALIZER_DEFAULTS.zoomFloor,
  vizZoomFloorPan: FRONTEND_VISUALIZER_DEFAULTS.zoomFloorPan,
  autoZoomStability: true,
  vizPanOffset: 0,
  displayMode: "fft",

  fftMinDb: DEFAULT_DB_LIMITS.min,
  fftMaxDb: DEFAULT_DB_LIMITS.max, // This will be updated based on powerScale
  fftSize: 2048,
  fftSizeOptions: [],
  fftWindow: "Rectangular",
  fftFrameRate: 60,
  fftAvgEnabled: false,
  fftSmoothEnabled: false,
  wfSmoothEnabled: false,

  gain: 49.6,
  txSignal: "wifi",
  txSampleRateHz: 2_400_000,
  txIfftSize: 2048,
  txViewerSampleRateHz: 2_400_000,
  txViewerFftSize: 65_536,
  txViewerFftFrameRate: 60,
  txViewerFftWindow: "Rectangular",
  txViewerTemporalResolution: "lossless",
  txViewerPowerScale: "dB",
  txCenterFrequencyHz: 137_100_000,
  txPowerDbm: -18,
  txVgaGain: 16,
  txSafetyEnabled: false,
  txSafetyLimit: "room",
  txSafetyResult: null,
  txHopType: "range",
  txHopStartFrequencyHz: 10_000_000,
  txHopEndFrequencyHz: 20_000_000,
  txHopChannels: ["a"],
  txHopRateHz: 10,
  txHopEnabled: false,
  hackrfLnaGain: 0.0,
  hackrfVgaGain: 30.0,
  hackrfAmpEnabled: false,
  hackrfBasebandBandwidth: 3_200_000,
  basebandFilterPinned: false,
  ppm: 1,
  tunerAGC: false,
  rtlAGC: false,
  sampleRateHz: 3_200_000,
  minReceiveSampleRateHz: 3_200_000,
  deviceKind: null,

  visualizerPaused: false,
  detectedFrameRate: null,
  isWaterfallCleared: false,
  showSpikeOverlay: false,
  removeDcSpike: false,
  gpuSpikeCount: 0,
  gpuSpikeAnalysis: null,
  hoveredSpikeIndex: null,
  showTxSlider: true,
  previewRange: null,
  previewAlignment: "centered",
  stitchOptions: {
    phaseCorrection: true,
    fmDeviationCorrection: true,
    antiAliasing: true,
    noiseFloorMatching: true,
    crossfading: true,
    chineseRemainderSynthesis: false,
    jsAntiAliasing: false,
    jsNoiseFloorMatching: false,
    acquisitionMode: "interleaved",
  },

  diagnosticStatus: "Ready",
  isDiagnosticRunning: false,
  diagnosticTrigger: 0,
};

const spectrumSlice = createSlice({
  name: "spectrum",
  initialState,
  reducers: {
    // Signal area and frequency
    setActiveSignalArea: (state, action: PayloadAction<string>) => {
      state.activeSignalArea = action.payload;
    },

    setFrequencyRange: (state, action: PayloadAction<FrequencyRange>) => {
      // Avoid redundant updates
      if (
        state.frequencyRange &&
        state.frequencyRange.min === action.payload.min &&
        state.frequencyRange.max === action.payload.max
      ) {
        return;
      }

      state.frequencyRange = action.payload;
      if (state.activeSignalArea) {
        if (
          !state.lastKnownRanges ||
          typeof state.lastKnownRanges !== "object"
        ) {
          state.lastKnownRanges = {};
        }
        state.lastKnownRanges[state.activeSignalArea] = action.payload;
      }
    },

    setTuningPreviewActive: (state, action: PayloadAction<boolean>) => {
      state.tuningPreviewActive = action.payload;
    },

    setSignalAreaAndRange: (
      state,
      action: PayloadAction<{ area: string; range: FrequencyRange }>,
    ) => {
      state.activeSignalArea = action.payload.area;
      state.frequencyRange = action.payload.range;
      // Channel selection is an explicit positive tune. Leaving a stale
      // mirrored pan here trapped the viewport below 0 Hz after every click.
      state.vizPanOffset = 0;
      if (!state.lastKnownRanges || typeof state.lastKnownRanges !== "object") {
        state.lastKnownRanges = {};
      }
      state.lastKnownRanges[action.payload.area] = action.payload.range;
    },

    setDeviceSignalAreaAndRange: (
      state,
      action: PayloadAction<{
        area: string;
        range: FrequencyRange;
        vizPanOffset?: number;
      }>,
    ) => {
      state.activeSignalArea = action.payload.area;
      state.frequencyRange = action.payload.range;
      if (
        typeof action.payload.vizPanOffset === "number" &&
        Number.isFinite(action.payload.vizPanOffset)
      ) {
        state.vizPanOffset = sanitizeMirroredPanOffset({
          panOffsetHz: action.payload.vizPanOffset,
          hardwareRange: action.payload.range,
          zoom: state.vizZoom ?? 1,
        });
      }
      if (!state.lastKnownRanges || typeof state.lastKnownRanges !== "object") {
        state.lastKnownRanges = {};
      }
      state.lastKnownRanges[action.payload.area] = action.payload.range;
      state.deviceFrequencyRangeRevision += 1;
    },

    // Atomic hop-preview update: the hop cycler retunes view + planned Tx on
    // every tick, and five separate dispatches meant five subscriber passes
    // per tick. Semantics mirror the individual reducers exactly.
    setTxHopPreviewState: (
      state,
      action: PayloadAction<{
        frequencyRange?: FrequencyRange;
        txCenterFrequencyHz?: number;
        txSampleRateHz?: number;
        sampleRateHz?: number;
        activeSignalArea?: string;
      }>,
    ) => {
      const { payload } = action;
      if (
        payload.frequencyRange &&
        (payload.frequencyRange.min !== state.frequencyRange?.min ||
          payload.frequencyRange.max !== state.frequencyRange?.max)
      ) {
        state.frequencyRange = payload.frequencyRange;
      }
      if (
        payload.txCenterFrequencyHz !== undefined &&
        Number.isFinite(payload.txCenterFrequencyHz)
      ) {
        state.txCenterFrequencyHz = payload.txCenterFrequencyHz;
      }
      if (
        payload.txSampleRateHz !== undefined &&
        Number.isFinite(payload.txSampleRateHz)
      ) {
        state.txSampleRateHz = payload.txSampleRateHz;
      }
      if (
        payload.sampleRateHz !== undefined &&
        Number.isFinite(payload.sampleRateHz)
      ) {
        state.sampleRateHz = payload.sampleRateHz;
      }
      if (payload.activeSignalArea !== undefined) {
        state.activeSignalArea = payload.activeSignalArea;
      }
    },

    tuneToChannels: (
      state,
      action: PayloadAction<{
        channels: Array<{ label: string; min: number; max: number }>;
        selectedLabels?: string[];
        frequencyRange?: FrequencyRange;
      }>,
    ) => {
      const { channels, selectedLabels } = action.payload;
      if (!channels || channels.length === 0) return;

      const primary = channels[0];
      const primaryMin = primary.min;
      const primaryMax = primary.max;
      const primaryBw = Math.max(1, primaryMax - primaryMin);
      const primaryCenter = Math.round((primaryMin + primaryMax) / 2);
      const primaryLabel = primary.label.toUpperCase();
      const lowerLabels = (selectedLabels ?? channels.map((ch) => ch.label)).map(
        (l) => l.toLowerCase(),
      );

      state.activeSignalArea = primaryLabel;
      const initialRange = action.payload.frequencyRange ?? {
        min: primaryMin,
        max: primaryMax,
      };
      state.frequencyRange = initialRange;
      state.vizPanOffset = 0;
      if (!state.lastKnownRanges || typeof state.lastKnownRanges !== "object") {
        state.lastKnownRanges = {};
      }
      state.lastKnownRanges[primaryLabel] = initialRange;

      state.txCenterFrequencyHz = primaryCenter;
      state.txSampleRateHz = primaryBw;
      state.sampleRateHz = primaryBw;
      state.txHopChannels = lowerLabels;
    },

    mergeLastKnownRanges: (
      state,
      action: PayloadAction<Record<string, FrequencyRange>>,
    ) => {
      if (!state.lastKnownRanges || typeof state.lastKnownRanges !== "object") {
        state.lastKnownRanges = {};
      }
      state.lastKnownRanges = {
        ...state.lastKnownRanges,
        ...action.payload,
      };
    },

    // Display settings
    setTemporalResolution: (
      state,
      action: PayloadAction<TemporalResolution>,
    ) => {
      state.displayTemporalResolution = action.payload;
    },

    setPowerScale: (state, action: PayloadAction<PowerScale>) => {
      const isSwitchingToDbm = action.payload === "dBm";

      // Auto-adjust dB limits when switching scales
      if (isSwitchingToDbm && state.powerScale !== "dBm") {
        state.fftMinDb = -120;
        state.fftMaxDb = 30;
      } else if (!isSwitchingToDbm && state.powerScale === "dBm") {
        state.fftMinDb = -150;
        state.fftMaxDb = 0;
      }

      state.powerScale = action.payload;
    },

    setVizZoom: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizZoom = action.payload;
    },

    setMaxVizZoom: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      const maxZoom = Math.min(
        VISUALIZER_MAX_ZOOM_LIMITS.max,
        Math.max(VISUALIZER_MAX_ZOOM_LIMITS.min, action.payload),
      );
      state.maxVizZoom = maxZoom;
      state.vizZoom = Math.min(state.vizZoom, maxZoom);
    },

    setVizZoomFloor: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizZoomFloor = action.payload;
    },

    setVizZoomFloorPan: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizZoomFloorPan = action.payload;
    },

    setAutoZoomStability: (state, action: PayloadAction<boolean>) => {
      state.autoZoomStability = action.payload;
    },

    setVizPan: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.vizPanOffset =
        state.frequencyRange &&
        Number.isFinite(state.frequencyRange.min) &&
        Number.isFinite(state.frequencyRange.max)
          ? sanitizeMirroredPanOffset({
              panOffsetHz: action.payload,
              hardwareRange: state.frequencyRange,
              zoom: state.vizZoom ?? 1,
            })
          : Math.abs(action.payload) > 50_000_000
            ? 0
            : action.payload;
    },

    setDisplayMode: (state, action: PayloadAction<"fft" | "iq">) => {
      state.displayMode = action.payload;
    },

    // FFT settings
    setFftDbLimits: (
      state,
      action: PayloadAction<{ min: number; max: number }>,
    ) => {
      if (
        !Number.isFinite(action.payload.min) ||
        !Number.isFinite(action.payload.max)
      )
        return;
      state.fftMinDb = Math.round(action.payload.min);
      state.fftMaxDb = Math.round(action.payload.max);
    },

    setFftSize: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.fftSize = action.payload;
    },

    setFftSizeOptions: (state, action: PayloadAction<number[]>) => {
      state.fftSizeOptions = action.payload;
    },

    setFftWindow: (state, action: PayloadAction<string>) => {
      state.fftWindow = action.payload;
    },

    setFftFrameRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.fftFrameRate = action.payload;
    },

    setFftAvgEnabled: (state, action: PayloadAction<boolean>) => {
      state.fftAvgEnabled = action.payload;
    },

    setFftSmoothEnabled: (state, action: PayloadAction<boolean>) => {
      state.fftSmoothEnabled = action.payload;
    },

    setWfSmoothEnabled: (state, action: PayloadAction<boolean>) => {
      state.wfSmoothEnabled = action.payload;
    },

    // SDR settings
    setTxSignal: (state, action: PayloadAction<string>) => {
      state.txSignal = action.payload;
    },

    setTxSampleRateHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txSampleRateHz = action.payload;
    },

    setTxIfftSize: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txIfftSize = action.payload;
    },

    setTxViewerSampleRateHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload) || action.payload <= 0) return;
      state.txViewerSampleRateHz = action.payload;
    },

    setTxViewerFftSize: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload) || action.payload <= 0) return;
      state.txViewerFftSize = action.payload;
    },

    setTxViewerFftFrameRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload) || action.payload <= 0) return;
      state.txViewerFftFrameRate = action.payload;
    },

    setTxViewerFftWindow: (state, action: PayloadAction<string>) => {
      state.txViewerFftWindow = action.payload;
    },

    setTxViewerTemporalResolution: (
      state,
      action: PayloadAction<TemporalResolution>,
    ) => {
      state.txViewerTemporalResolution = action.payload;
    },

    setTxViewerPowerScale: (state, action: PayloadAction<PowerScale>) => {
      state.txViewerPowerScale = action.payload;
    },

    setTxCenterFrequencyHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txCenterFrequencyHz = action.payload;
    },

    setTxGeometry: (
      state,
      action: PayloadAction<{
        centerFrequencyHz: number;
        sampleRateHz: number;
      }>,
    ) => {
      state.txCenterFrequencyHz = action.payload.centerFrequencyHz;
      state.txSampleRateHz = action.payload.sampleRateHz;
    },
    setTxPowerDbm: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txPowerDbm = action.payload;
    },

    setTxVgaGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txVgaGain = action.payload;
    },

    setTxSafetyEnabled: (state, action: PayloadAction<boolean>) => {
      state.txSafetyEnabled = action.payload;
    },

    setTxSafetyLimit: (
      state,
      action: PayloadAction<"person" | "room" | "min">,
    ) => {
      state.txSafetyLimit = action.payload;
    },

    setTxSafetyResult: (
      state,
      action: PayloadAction<TxSafetyResult | null>,
    ) => {
      state.txSafetyResult = action.payload;
    },

    setTxHopType: (state, action: PayloadAction<"range" | "channels">) => {
      state.txHopType = action.payload;
    },

    setTxHopStartFrequencyHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txHopStartFrequencyHz = action.payload;
    },

    setTxHopEndFrequencyHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txHopEndFrequencyHz = action.payload;
    },

    setTxHopChannels: (state, action: PayloadAction<string[]>) => {
      state.txHopChannels = action.payload;
    },

    setTxHopRateHz: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.txHopRateHz = action.payload;
    },

    setTxHopEnabled: (state, action: PayloadAction<boolean>) => {
      state.txHopEnabled = action.payload;
    },

    setGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.gain = action.payload;
    },

    setHackrfLnaGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.hackrfLnaGain = action.payload;
    },

    setHackrfVgaGain: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.hackrfVgaGain = action.payload;
    },

    setHackrfAmpEnabled: (state, action: PayloadAction<boolean>) => {
      state.hackrfAmpEnabled = action.payload;
    },

    setPpm: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.ppm = action.payload;
    },

    setTunerAGC: (state, action: PayloadAction<boolean>) => {
      state.tunerAGC = action.payload;
    },

    setRtlAGC: (state, action: PayloadAction<boolean>) => {
      state.rtlAGC = action.payload;
    },

    setSampleRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.sampleRateHz = action.payload;
    },

    setMinReceiveSampleRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.minReceiveSampleRateHz = action.payload;
    },

    setSdrSettingsBundle: (
      state,
      action: PayloadAction<Partial<SpectrumState>>,
    ) => {
      Object.assign(state, sanitizeSettingsBundle(action.payload));
    },

    setDeviceSdrSettingsBundle: (
      state,
      action: PayloadAction<Partial<SpectrumState>>,
    ) => {
      Object.assign(state, sanitizeSettingsBundle(action.payload));
      if (action.payload.frequencyRange !== undefined) {
        const frequencyRange = action.payload.frequencyRange;
        const area =
          typeof action.payload.activeSignalArea === "string" &&
          action.payload.activeSignalArea.length > 0
            ? action.payload.activeSignalArea
            : state.activeSignalArea;
        if (area && frequencyRange) {
          if (!state.lastKnownRanges || typeof state.lastKnownRanges !== "object") {
            state.lastKnownRanges = {};
          }
          state.lastKnownRanges[area] = frequencyRange;
        }
        state.deviceFrequencyRangeRevision += 1;
      }
    },

    setBasebandFilterPinned: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.basebandFilterPinned = action.payload;
    },

    setDeviceKind: (state, action: PayloadAction<string | null>) => {
      state.deviceKind = action.payload;
    },

    // Visualization state
    setVisualizerPaused: (state, action: PayloadAction<boolean>) => {
      state.visualizerPaused = action.payload;
    },

    setDetectedFrameRate: (state, action: PayloadAction<number | null>) => {
      state.detectedFrameRate =
        action.payload === null || Number.isFinite(action.payload)
          ? action.payload
          : null;
    },

    clearWaterfall: (state) => {
      state.isWaterfallCleared = true;
    },

    resetWaterfallCleared: (state) => {
      state.isWaterfallCleared = false;
    },

    leaveVisualizer: (state) => {
      state.visualizerPaused = true;
    },

    setShowSpikeOverlay: (state, action: PayloadAction<boolean>) => {
      state.showSpikeOverlay = action.payload;
      if (!action.payload) {
        state.gpuSpikeCount = 0;
        state.gpuSpikeAnalysis = null;
      }
    },

    setRemoveDcSpike: (state, action: PayloadAction<boolean>) => {
      state.removeDcSpike = action.payload;
    },

    setGpuSpikeCount: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.gpuSpikeCount = Math.max(0, Math.floor(action.payload));
    },

    setGpuSpikeAnalysis: (state, action: PayloadAction<GpuSpikeAnalysis | null>) => {
      state.gpuSpikeAnalysis = action.payload;
    },

    setHoveredSpikeIndex: (state, action: PayloadAction<number | null>) => {
      state.hoveredSpikeIndex = action.payload;
    },

    setShowTxSlider: (state, action: PayloadAction<boolean>) => {
      state.showTxSlider = action.payload;
    },

    // Diagnostic state
    setDiagnosticStatus: (state, action: PayloadAction<string>) => {
      state.diagnosticStatus = action.payload;
    },

    setDiagnosticRunning: (state, action: PayloadAction<boolean>) => {
      state.isDiagnosticRunning = action.payload;
    },

    triggerDiagnostic: (state) => {
      state.diagnosticTrigger += 1;
    },

    setPreviewRange: (state, action: PayloadAction<FrequencyRange | null>) => {
      state.previewRange = action.payload;
    },

    setPreviewAlignment: (state, action: PayloadAction<Alignment>) => {
      state.previewAlignment = action.payload;
    },

    setStitchOption: <K extends keyof StitchOptions>(
      state: SpectrumState,
      action: PayloadAction<{ option: K; enabled: StitchOptions[K] }>,
    ) => {
      state.stitchOptions[action.payload.option] = action.payload.enabled;
    },

    setStitchOptionValue: <K extends keyof StitchOptions>(
      state: SpectrumState,
      action: PayloadAction<{ option: K; value: StitchOptions[K] }>,
    ) => {
      state.stitchOptions[action.payload.option] = action.payload.value;
    },

    // Reset actions
    resetZoomAndDb: (state) => {
      const defaultDbLimits = getVisualizerDefaultDbLimits(state.powerScale);
      state.vizZoom = FRONTEND_VISUALIZER_DEFAULTS.zoom;
      state.vizZoomFloor = FRONTEND_VISUALIZER_DEFAULTS.zoomFloor;
      state.vizZoomFloorPan = FRONTEND_VISUALIZER_DEFAULTS.zoomFloorPan;
      state.autoZoomStability = true;
      state.vizPanOffset = 0;
      // dBm reset: 30dBm to -100dBm
      // dB reset: 0dB to -120dB
      state.fftMinDb = defaultDbLimits.min;
      state.fftMaxDb = defaultDbLimits.max;
    },

  resetLiveControls: (
      state,
      action: PayloadAction<{
        fftSize?: number;
        fftFrameRate?: number;
        sdrDefaults?: SignalsSdrDefaults | null;
      } | undefined>,
    ) => {
      return {
        ...state,
        displayTemporalResolution:
          LIVE_CONTROL_DEFAULTS.displayTemporalResolution,
        txViewerTemporalResolution:
          LIVE_CONTROL_DEFAULTS.txViewerTemporalResolution,
        txViewerPowerScale: LIVE_CONTROL_DEFAULTS.txViewerPowerScale,
        vizZoom: LIVE_CONTROL_DEFAULTS.vizZoom,
        vizZoomFloor: LIVE_CONTROL_DEFAULTS.vizZoomFloor,
        vizZoomFloorPan: 0,
        autoZoomStability: true,
        vizPanOffset: LIVE_CONTROL_DEFAULTS.vizPanOffset,
        fftMinDb: getVisualizerDefaultDbLimits(state.powerScale).min,
        fftMaxDb: getVisualizerDefaultDbLimits(state.powerScale).max,
        fftWindow: LIVE_CONTROL_DEFAULTS.fftWindow,
        txViewerFftWindow: LIVE_CONTROL_DEFAULTS.txViewerFftWindow,
        ...(action.payload?.sdrDefaults
          ? {
              gain: action.payload.sdrDefaults.gain.tuner_gain,
              ...(typeof action.payload.sdrDefaults.gain.hackrf_lna_gain ===
              "number"
                ? {
                    hackrfLnaGain:
                      action.payload.sdrDefaults.gain.hackrf_lna_gain,
                  }
                : {}),
              ...(typeof action.payload.sdrDefaults.gain.hackrf_vga_gain ===
              "number"
                ? {
                    hackrfVgaGain:
                      action.payload.sdrDefaults.gain.hackrf_vga_gain,
                  }
                : {}),
              hackrfAmpEnabled:
                action.payload.sdrDefaults.gain.hackrf_amp_enable ?? false,
              ...(typeof action.payload.sdrDefaults.gain.tuner_bandwidth ===
              "number"
                ? {
                    hackrfBasebandBandwidth:
                      action.payload.sdrDefaults.gain.tuner_bandwidth,
                  }
                : {}),
              ppm: action.payload.sdrDefaults.ppm,
              tunerAGC: action.payload.sdrDefaults.gain.tuner_agc,
              rtlAGC: action.payload.sdrDefaults.gain.rtl_agc,
            }
          : {}),
        fftAvgEnabled: false,
        fftSmoothEnabled: false,
        wfSmoothEnabled: false,
        fftSize: action.payload?.fftSize ?? state.fftSize,
        fftFrameRate: action.payload?.fftFrameRate ?? state.fftFrameRate,
        txViewerSampleRateHz: LIVE_CONTROL_DEFAULTS.txViewerSampleRateHz,
        txViewerFftSize: LIVE_CONTROL_DEFAULTS.txViewerFftSize,
        txViewerFftFrameRate: LIVE_CONTROL_DEFAULTS.txViewerFftFrameRate,
      };
    },
  },
});

export const {
  setActiveSignalArea,
  setFrequencyRange,
  setTuningPreviewActive,
  setSignalAreaAndRange,
  setDeviceSignalAreaAndRange,
  setTxHopPreviewState,
  tuneToChannels,
  mergeLastKnownRanges,
  setTemporalResolution,
  setPowerScale,
  setVizZoom,
  setMaxVizZoom,
  setVizZoomFloor,
  setVizZoomFloorPan,
  setAutoZoomStability,
  setVizPan,
  setDisplayMode,
  setFftDbLimits,
  setFftSize,
  setFftSizeOptions,
  setFftWindow,
  setFftFrameRate,
  setFftAvgEnabled,
  setFftSmoothEnabled,
  setWfSmoothEnabled,
  setTxSignal,
  setTxSampleRateHz,
  setTxIfftSize,
  setTxViewerSampleRateHz,
  setTxViewerFftSize,
  setTxViewerFftFrameRate,
  setTxViewerFftWindow,
  setTxViewerTemporalResolution,
  setTxViewerPowerScale,
  setTxCenterFrequencyHz,
  setTxGeometry,
  setDeviceKind,
  setTxPowerDbm,
  setTxVgaGain,
  setTxSafetyEnabled,
  setTxSafetyLimit,
  setTxSafetyResult,
  setTxHopType,
  setTxHopStartFrequencyHz,
  setTxHopEndFrequencyHz,
  setTxHopChannels,
  setTxHopRateHz,
  setTxHopEnabled,
  setGain,
  setHackrfLnaGain,
  setHackrfVgaGain,
  setHackrfAmpEnabled,
  setPpm,
  setTunerAGC,
  setRtlAGC,
  setSampleRate,
  setMinReceiveSampleRate,
  setSdrSettingsBundle,
  setDeviceSdrSettingsBundle,
  setBasebandFilterPinned,
  setVisualizerPaused,
  setDetectedFrameRate,
  clearWaterfall,
  resetWaterfallCleared,
  leaveVisualizer,
  setDiagnosticStatus,
  setDiagnosticRunning,
  triggerDiagnostic,
  resetZoomAndDb,
  resetLiveControls,
  setShowSpikeOverlay,
  setRemoveDcSpike,
  setGpuSpikeCount,
  setGpuSpikeAnalysis,
  setHoveredSpikeIndex,
  setPreviewRange,
  setPreviewAlignment,
  setStitchOption,
  setStitchOptionValue,
  setShowTxSlider,
} = spectrumSlice.actions;

export default spectrumSlice.reducer;
