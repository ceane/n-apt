import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  memo,
  Suspense,
  type ReactNode,
} from "react";
import styled, { keyframes } from "styled-components";
import { Lock, Unlock } from "lucide-react";
import { useFFTAnimation } from "@n-apt/hooks/useFFTAnimation";
import type { LiveCanvasStatusRow } from "@n-apt/hooks/useDraw2DFFTSignal";
import { usePauseLogic } from "@n-apt/hooks/usePauseLogic";
import { useSpectrumRenderer } from "@n-apt/hooks/useSpectrumRenderer";
import { useUnifiedFFTWaterfall } from "@n-apt/hooks/useUnifiedFFTWaterfall";
import { RESAMPLE_WGSL } from "@n-apt/shaders";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";
import { useWaterfallRetuneCompute } from "@n-apt/hooks/useWaterfallRetuneCompute";
import {
  useFrequencyDrag,
  type CanvasTxSliderState,
} from "@n-apt/hooks/useFrequencyDrag";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
  setGpuSpikeCount,
  setTxCenterFrequencyHz,
  setTxSampleRateHz,
} from "@n-apt/redux/slices/spectrumSlice";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import CanvasPlaceholder, {
  type CanvasPlaceholderState,
} from "@n-apt/components/ui/CanvasPlaceholder";
import { Tooltip } from "@n-apt/components/ui/Tooltip";
import type { DeviceProfile } from "@n-apt/consts/schemas/websocket";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import type { Alignment, FrequencyRange } from "@n-apt/consts/types";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
import {
  isRtlSdrDevice,
  resolveRenderableFrequencyRange,
} from "@n-apt/utils/sdrSampleRateGuards";
// New hooks
import { useCanvasState } from "@n-apt/hooks/useCanvasState";
import { useWaterfallBufferPool } from "@n-apt/hooks/useWaterfallBufferPool";
import {
  averageTemporalWaveforms,
  getTemporalResolutionWindow,
} from "@n-apt/utils/temporalResolution";
// spectrumToAmplitude removed — dB normalisation now handled in the waterfall WGSL shader
import {
  VISUALIZER_GAP,
  SECTION_TITLE_COLOR,
  SECTION_TITLE_AFTER_COLOR,
  FFT_MIN_DB,
  FFT_MAX_DB,
} from "@n-apt/consts";
import { detectHeterodyningFromHistory } from "@n-apt/utils/detectHeterodyning";
import type {
  FFTVisualizerMachine,
  FFTVisualizerSnapshot,
} from "@n-apt/utils/fftVisualizerMachine";
import {
  resolvePendingWaterfallRestore,
  type PendingWaterfallRestore,
} from "@n-apt/utils/waterfallRestore";
import { getWaterfallMotion } from "@n-apt/utils/waterfallMotion";
import {
  copyValidWaterfallRow,
  peakResampleWaterfallRow,
  synthesizeWaterfallTransitionRow,
} from "@n-apt/utils/waterfallRows";
import {
  clampCenteredFrequencyRangeToZeroHz,
  roundDbValue,
} from "@n-apt/utils/frequency";
import { computeHackrfApproxDbmOffsetDb } from "@n-apt/utils/hackrfCalibration";
import {
  TX_SLIDER_ROW_HEIGHT,
  useOverlayRenderer,
  type DemodFocusOverlay,
} from "@n-apt/hooks/useOverlayRenderer";
import { useResolvedThemeMode } from "@n-apt/components/ui/Theme";

type FrameRenderRangeInput = {
  currentFrame: Pick<LiveFrameData, "center_frequency_hz" | "sample_rate">;
  requestedRange: FrequencyRange;
  propsCenterFrequencyHz: number;
  propsHardwareSampleRateHz?: number | null;
  preferRequestedRange?: boolean;
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isRtlSdr?: boolean | null;
};

const isMockTxIdentity = ({
  deviceKind,
  backend,
  deviceName,
}: {
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
}) => {
  const normalizedKind = deviceKind?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedBackend = backend?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedName = deviceName?.toLowerCase?.() ?? "";
  return (
    normalizedKind === "mock-tx" ||
    normalizedBackend === "mock-tx" ||
    normalizedName.includes("mock tx")
  );
};

const isMockAptIdentity = ({
  deviceKind,
  backend,
  deviceName,
}: {
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
}) => {
  const normalizedKind = deviceKind?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedBackend = backend?.toLowerCase?.().replace(/_/g, "-") ?? "";
  const normalizedName = deviceName?.toLowerCase?.() ?? "";
  return (
    normalizedKind === "mock-apt" ||
    normalizedBackend === "mock-apt" ||
    normalizedName.includes("mock apt")
  );
};

export const resolveEffectiveDbmOffsetDb = ({
  powerScale,
  deviceKind,
  backend,
  deviceName,
  isTransmitting,
  tunerGainDb,
}: {
  powerScale: "dB" | "dBm";
  deviceKind?: string | null;
  backend?: string | null;
  deviceName?: string | null;
  isTransmitting?: boolean;
  tunerGainDb?: number | null;
}): number => {
  if (powerScale !== "dBm") return 0.0;

  const isMockTxDevice = isMockTxIdentity({ deviceKind, backend, deviceName });
  const isMockAptDevice = isMockAptIdentity({
    deviceKind,
    backend,
    deviceName,
  });
  if (isMockTxDevice || (isMockAptDevice && isTransmitting)) {
    return 15.0;
  }

  if (deviceKind === "hackrf_one") {
    return computeHackrfApproxDbmOffsetDb({
      totalGainDb: tunerGainDb ?? 0,
    });
  }

  return 30.0;
};

export const resolveLiveFrameRenderableFrequencyRange = ({
  currentFrame,
  requestedRange,
  propsCenterFrequencyHz,
  propsHardwareSampleRateHz,
  preferRequestedRange,
  deviceKind,
  backend,
  deviceName,
  isRtlSdr,
}: FrameRenderRangeInput): FrequencyRange => {
  const mockTxMonitor = isMockTxIdentity({ deviceKind, backend, deviceName });
  return resolveRenderableFrequencyRange({
    requestedRange,
    centerFrequencyHz: mockTxMonitor
      ? propsCenterFrequencyHz
      : currentFrame.center_frequency_hz,
    hardwareSampleRateHz: mockTxMonitor
      ? propsHardwareSampleRateHz
      : currentFrame.sample_rate,
    preferRequestedRange,
    deviceKind,
    backend,
    deviceName,
    isRtlSdr,
  });
};

// Use dynamic import for WASM module loading
(async () => {
  try {
    const wasmModule = await import("n_apt_canvas");
    const initWasm = wasmModule.default;
    const test_wasm_simd_availability = (
      wasmModule as typeof wasmModule & {
        test_wasm_simd_availability?: () => void;
      }
    ).test_wasm_simd_availability;

    // Initialize the WASM module first
    await initWasm();

    // Test WASM SIMD availability
    if (test_wasm_simd_availability) {
      test_wasm_simd_availability();

      // Expose globally for manual testing
      (window as any).testWasmSimd = test_wasm_simd_availability;
    }

    // sdrProcessor = new SIMDRenderingProcessor(); // Removed as sdrProcessor is unused
  } catch {
    // Silently handle WASM loading errors
  }
})();

const VisualizerContainer = memo(styled.div`
  flex: 1.25;
  display: flex;
  flex-direction: row;
  position: relative;
  overflow: hidden;
`);

const VisualizerContent = memo(styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${VISUALIZER_GAP}px;
  min-height: 0;
`);

const SpectrumSection = memo(styled.div`
  flex: 2;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  padding: 2px 2px 12px;
  box-sizing: border-box;
`);

const SectionTitle = memo(styled.div`
  font-size: 11px;
  color: ${SECTION_TITLE_COLOR};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: ${SECTION_TITLE_AFTER_COLOR};
  }
`);

const SectionTitleRow = memo(styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  padding: 0 0 10px;
  margin-bottom: 0;
`);

const SectionTitleActions = memo(styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  gap: 8px;
  flex-shrink: 0;
  transition: opacity 0.15s ease;

  &[data-disabled="true"] {
    opacity: 0.5;
    pointer-events: none;
  }
`);

const CanvasWrapper = memo(styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid ${(props) => props.theme.canvasBorder};
  border-radius: 8px;
  overflow: hidden;
  background-color: ${(props) => props.theme.background};

  &.cursor-grab {
    cursor: grab !important;
  }
  &.cursor-grabbing {
    cursor: grabbing !important;
  }
  &.cursor-crosshair {
    cursor: crosshair !important;
  }
`);

const NodePreviewCanvasWrapper = memo(styled(CanvasWrapper)`
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  border: none;
  border-radius: 0;
`);

const SpectrumRow = memo(styled.div`
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
`);

const CanvasLayer = memo(styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  will-change: width, height;
`);

const HighlightOverlay = memo(styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`);

const TxSliderInfoLayer = memo(styled.div`
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 0;
  height: ${TX_SLIDER_ROW_HEIGHT}px;
  z-index: 135;
  pointer-events: none;
  display: flex;
  justify-content: flex-end;
  align-items: center;
`);

const TxInfoTrigger = styled.button`
  pointer-events: auto;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface}cc;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: help;
  padding: 0;
  line-height: 1;
`;

const TxSliderVisualRow = memo(styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${TX_SLIDER_ROW_HEIGHT}px;
  z-index: 130;
  overflow: visible;
  background: transparent;
  border: none;
  box-shadow: none;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  display: flex;
  align-items: center;
  isolation: isolate;
`);

const TxSliderVisualLabel = styled.div`
  padding-left: 14px;
  font-size: 12px;
  font-weight: 700;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  z-index: 1;
`;

const TxSliderLockButton = styled.button`
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
    border-color: ${({ theme }) => theme.colors.border};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const TxBlinkingDot = styled.div`
  position: absolute;
  top: -1px;
  right: -8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary};
  box-shadow: 0 0 8px ${({ theme }) => theme.colors.primary}66;
  z-index: 1;
`;

const TxSliderVisualTrack = styled.div`
  position: absolute;
  left: 50px;
  right: 40px;
  top: 0;
  bottom: 0;
  z-index: 1;
`;

const TxSliderVisualBase = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 4px;
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.border};
  z-index: 1;
`;

const TxSliderVisualBand = styled.div<{
  $width: number;
  $centerLeft: number;
  $isTransmitting: boolean;
}>`
  position: absolute;
  left: ${({ $centerLeft }) => `${$centerLeft}%`};
  width: ${({ $width }) => `max(${$width}%, 6px)`};
  top: 50%;
  transform: translate(-50%, -50%);
  height: 8px;
  border-radius: 999px;
  background: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.primary : theme.colors.textDisabled};
  transition: background 0.3s ease;
  z-index: 1;
`;

const TxSliderVisualText = styled.div<{
  $left: number;
  $isTransmitting: boolean;
}>`
  position: absolute;
  left: ${({ $left }) => `${$left}%`};
  top: calc(50% + 7px);
  transform: translate(-50%, 0);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 14px;
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 10px;
  font-weight: 800;
  line-height: 1.05;
  white-space: nowrap;
  transition: color 0.3s ease;
  pointer-events: none;
  z-index: 1;
`;

const TxSliderVisualCenterFrequencyText = styled.div<{
  $left: number;
  $isTransmitting: boolean;
  $isLocked: boolean;
}>`
  position: absolute;
  left: ${({ $left }) => `${$left}%`};
  bottom: calc(50% + 7px);
  transform: translate(-50%, 0);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 14px;
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 10px;
  font-weight: 800;
  line-height: 1.05;
  white-space: nowrap;
  transition: color 0.3s ease;
  pointer-events: none;
  z-index: 1;
`;

const TxSliderCenterLockIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  filter: none;
`;

const TxSliderVisualPower = styled.span<{ $isTransmitting: boolean }>`
  color: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.textPrimary : theme.colors.textDisabled};
  font-size: 10px;
  font-weight: 600;
`;

const TxSliderVisualOffScreenIndicator = styled.button<{
  $direction: "left" | "right";
  $isTransmitting: boolean;
}>`
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  ${({ $direction }) => ($direction === "left" ? "left: 3px;" : "right: 3px;")}
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.surface : theme.colors.textPrimary};
  background: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.primary : theme.colors.surfaceHover};
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 0 0 1px
    ${({ theme, $isTransmitting }) =>
      $isTransmitting ? theme.colors.primary : theme.colors.border};
  border: none;
  cursor: pointer;
  pointer-events: auto;
  z-index: 1;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  &:hover {
    opacity: 0.9;
    transform: translateY(-50%) scale(1.03);
  }
  &:active {
    transform: translateY(-50%) scale(0.97);
  }
`;

const SelectionTooltip = memo(styled.div`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 120;
  pointer-events: none;
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(7, 10, 18, 0.82);
  border: 1px solid rgba(255, 206, 84, 0.45);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  color: rgba(255, 247, 225, 0.98);
  font-size: 11px;
  line-height: 1.35;
  letter-spacing: 0.02em;
  backdrop-filter: blur(8px);

  strong {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(255, 206, 84, 0.92);
  }
`);

const HighlightBand = memo(styled.div<{
  $left: number;
  $width: number;
  $waterfall?: boolean;
}>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $left }) => `${$left}%`};
  width: ${({ $width }) => `${$width}%`};
  background: ${({ $waterfall }) =>
    $waterfall ? "rgba(255, 206, 84, 0.18)" : "rgba(255, 206, 84, 0.12)"};
  box-shadow: inset 0 0 0 1px rgba(255, 206, 84, 0.7);
`);

const LOADING_PLACEHOLDER_TEXT = "Loading data from source...";
const LOADING_PLACEHOLDER_FONT = "24px 'JetBrains Mono', monospace";
const WATERFALL_PLACEHOLDER_FONT = "20px 'JetBrains Mono', monospace";
const LOADING_PLACEHOLDER_COLOR = "#888888";
const MIN_FFT_DB_SPAN = 5;
const NODE_PREVIEW_BACKGROUND_STYLE = { backgroundColor: "#05070d" } as const;
const COMPACT_VISUALIZER_STYLE = {
  backgroundColor: "#05070d",
  minHeight: 0,
} as const;
const COMPACT_VISUALIZER_CONTENT_STYLE = { gap: 0 } as const;
const EMPTY_STYLE = {} as const;

const DB_MAX_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: FFT_MAX_DB },
  dBm: { min: -100, max: 30 },
};

const DB_MIN_RANGE: Record<"dB" | "dBm", { min: number; max: number }> = {
  dB: { min: FFT_MIN_DB, max: -10 },
  dBm: { min: -120, max: -10 },
};
const RETUNE_ROW_BLEND_PROGRESS = 0.65;

const clampDbMaxValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MAX_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const clampDbMinValue = (value: number, scale: "dB" | "dBm") => {
  const bounds = DB_MIN_RANGE[scale];
  return Math.min(Math.max(value, bounds.min), bounds.max);
};

const ensureValidDbRange = (
  minVal: number,
  maxVal: number,
  scale: "dB" | "dBm",
) => {
  let nextMin = clampDbMinValue(minVal, scale);
  let nextMax = clampDbMaxValue(maxVal, scale);

  if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
    nextMax = clampDbMaxValue(nextMin + MIN_FFT_DB_SPAN, scale);
    if (nextMax - nextMin < MIN_FFT_DB_SPAN) {
      nextMin = clampDbMinValue(nextMax - MIN_FFT_DB_SPAN, scale);
    }
  }

  return { min: nextMin, max: nextMax };
};

const toUnifiedWindowType = (
  windowType?: string,
): "rectangular" | "hanning" | "hamming" | "blackman" | "nuttall" => {
  switch ((windowType ?? "Rectangular").toLowerCase()) {
    case "rectangular":
    case "none":
      return "rectangular";
    case "hann":
    case "hanning":
      return "hanning";
    case "hamming":
      return "hamming";
    case "blackman":
      return "blackman";
    case "nuttall":
      return "nuttall";
    default:
      return "rectangular";
  }
};

/**
 * Props for FFTCanvas component
 */
export interface FFTCanvasProps {
  /** Reference to FFT data containing waveform and metadata */
  dataRef: React.MutableRefObject<any>;
  /** Frequency range to display */
  frequencyRange: FrequencyRange;
  /** Current center frequency in Hz (for overlay label) */
  centerFrequencyHz: number;
  /** Currently active signal area identifier */
  activeSignalArea: string;
  /** Signal area bounds for VFO drag clamping */
  signalAreaBounds?: Record<string, { min: number; max: number }>;
  /** Whether the visualization is paused */
  isPaused: boolean;
  /** Target frame rate for the visualization */
  fftFrameRate?: number;
  fftSize?: number;
  fftWindow?: string;
  powerScale?: "dB" | "dBm";
  /** Whether the RTL-SDR device is connected */
  isDeviceConnected?: boolean;
  /** Callback for frequency range changes */
  onFrequencyRangeChange?: (range: FrequencyRange) => void;
  /** Fires when the user double-clicks the center-frequency/VFO label region. */
  onCenterFrequencyDoubleClick?: () => void;
  /** Currently active demodulation selection range */
  selectionRange?: FrequencyRange;
  selectionMode?: "zoom" | "range";
  /** Whether the selection overlay is disabled */
  selectionDisabled?: boolean;
  /** Callback for selection range changes (dragging the box) */
  onSelectionChange?: (range: FrequencyRange) => void;
  bandwidthAlignment?: Alignment;
  displayTemporalResolution?: "low" | "medium" | "high";
  /** Callback to trigger a snapshot render for the sidebar */
  onSnapshot?: (data: {
    waveform: Float32Array;
    frequencyRange: FrequencyRange;
    dbMin: number;
    dbMax: number;
    centerFrequencyHz: number;
    isDeviceConnected: boolean;
    vizZoom: number;
    vizPanOffset: number;
    grid: boolean;
  }) => void;
  /** Grid preference for snapshot rendering (affects 2D shadow canvases) */
  snapshotGridPreference: boolean;
  /** Whether to hide title and use compact layout (for node integration) */
  compact?: boolean;
  /** Tighten FFT margins for small node previews */
  nodePreview?: boolean;
  /** Optional overlay rendered inside the FFT canvas wrapper */
  overlayContent?: ReactNode;
  /** Optional TX slider drawn into the bottom FFT status band. */
  txSlider?: CanvasTxSliderState & {
    signalLabel?: string;
    powerDbm?: number;
  };
  /** Optional explicit labels for the bottom FFT status band. */
  canvasStatusRow?: LiveCanvasStatusRow | null;
  /** Optional action content rendered beside the FFT section title */
  headerActionContent?: ReactNode;
  /** Optional label used to personalize loading / error placeholders. */
  placeholderSourceLabel?: string;
  /** Optional pane label used by the placeholder copy. */
  placeholderPaneLabel?: string;
  /** Optional explicit playback error message for the placeholder overlay. */
  placeholderErrorReason?: string | null;
  /** Optional explicit placeholder state for non-loading display modes. */
  placeholderState?: CanvasPlaceholderState | null;
  /** Disable canvas interactions while a placeholder is shown. */
  interactionDisabled?: boolean;
  /** Emits when the rAF loop sees a real live frame from a mutable data ref. */
  onRenderableFrameChange?: (hasRenderableFrame: boolean) => void;
  /** Emits the actual placeholder/loading state owned by the FFT canvas. */
  onCanvasLoadingChange?: (isLoading: boolean) => void;
  showSpikeOverlay?: boolean;
  vizZoom?: number;
  vizZoomFloor?: number;
  vizZoomFloorPan?: number;
  vizPanOffset?: number;
  autoZoomStability?: boolean;
  onVizZoomChange?: (zoom: number) => void;
  onVizZoomFloorChange?: (zoomFloor: number) => void;
  onVizZoomFloorPanChange?: (pan: number) => void;
  onVizPanChange?: (pan: number) => void;
  /** Maximum allowed bandwidth for the selection range */
  maxBandwidthHz?: number;
  fftMin?: number;
  fftMax?: number;
  onFftDbLimitsChange?: (min: number, max: number) => void;
  hardwareSampleRateHz?: number;
  deviceProfile?: DeviceProfile | null;
  deviceBackend?: string | null;
  deviceName?: string | null;
  tunerGainDb?: number;
  /** Whether I/Q recording is active */
  isIqRecordingActive?: boolean;
  limitMarkers?: SdrLimitMarker[];
  isWaterfallCleared?: boolean;
  onResetWaterfallCleared?: () => void;
  heterodyningVerifyRequestId?: number;
  heterodyningHighlightedBins?: Array<{ start: number; end: number }>;
  onHeterodyningAnalyzed?: (result: {
    detected: boolean;
    confidence: number | null;
    statusText: string;
    highlightedBins: Array<{ start: number; end: number }>;
  }) => void;
  awaitingDeviceData?: boolean | string;
  visualizerMachine?: FFTVisualizerMachine;
  visualizerSessionKey?: string;
  waterfallCanvasBindings?: FFTCanvasWaterfallBindings;
  demodulationCenterFreqHz?: number | null;
  demodulationRangeHz?: number | null;
}

export interface FFTCanvasWaterfallBindings {
  waterfallGpuCanvasNode: HTMLCanvasElement | null;
  waterfallOverlayCanvasNode: HTMLCanvasElement | null;
  setWaterfallGpuCanvasNode: (node: HTMLCanvasElement | null) => void;
  setWaterfallOverlayCanvasNode: (node: HTMLCanvasElement | null) => void;
}

export const getLatestLiveFrame = <T,>(
  liveData: T | T[] | null | undefined,
): T | null => {
  if (!liveData) return null;
  return Array.isArray(liveData)
    ? (liveData[liveData.length - 1] ?? null)
    : liveData;
};

export const getLiveFrameSignature = (
  liveFrame: LiveFrameData | null | undefined,
): number | LiveFrameData | null => {
  if (!liveFrame) return null;
  return typeof liveFrame.timestamp === "number"
    ? liveFrame.timestamp
    : liveFrame;
};

export const shouldRenderWaterfallWithFrameOrRestore = (
  hasDimensions: boolean,
  hasCurrentFrame: boolean,
  hasPendingRestore: boolean,
): boolean => hasDimensions && (hasCurrentFrame || hasPendingRestore);

/**
 * FFT canvas component with FFT spectrum and waterfall displays
 * Uses SDR++ style rendering for professional spectrum analysis
 */
export type SnapshotData = {
  waveform: Float32Array | null;
  fullChannelWaveform: Float32Array | null;
  frequencyRange: FrequencyRange;
  dbMin: number;
  dbMax: number;
  fftSize?: number;
  fftWindow?: string;
  centerFrequencyHz: number;
  isDeviceConnected: boolean;
  vizZoom: number;
  vizPanOffset: number;
  waterfallTextureSnapshot: Uint8Array | null;
  waterfallTextureMeta: {
    width: number;
    height: number;
    writeRow: number;
  } | null;
  waterfallBuffer: Uint8ClampedArray | null;
  waterfallDims: { width: number; height: number } | null;
  webgpuEnabled: boolean;
  hardwareSampleRateHz?: number;
  isIqRecordingActive?: boolean;
  demodFocusOverlay?: DemodFocusOverlay | null;
  activeSignalArea?: string;

  colormap: number[][];
};

export type FFTCanvasHandle = {
  getSpectrumCanvas: () => HTMLCanvasElement | null;
  getWaterfallCanvas: () => HTMLCanvasElement | null;
  getSpectrumOverlayCanvas: () => HTMLCanvasElement | null;
  getWaterfallOverlayCanvas: () => HTMLCanvasElement | null;
  triggerSnapshotRender: () => void;
  getSnapshotData: () => SnapshotData | null;
  getCompositeSnapshot: () => {
    dataUrl: string;
    width: number;
    height: number;
  } | null;
};

const FFTCanvas = memo(
  forwardRef<FFTCanvasHandle, FFTCanvasProps>((props, ref) => {
    const {
      dataRef,
      frequencyRange,
      centerFrequencyHz,
      activeSignalArea: _activeSignalArea,
      signalAreaBounds,
      isPaused,
      fftFrameRate,
      fftSize,
      fftWindow,
      powerScale,
      isDeviceConnected = true,
      onFrequencyRangeChange,
      onCenterFrequencyDoubleClick,
      displayTemporalResolution = "medium",
      onSnapshot: _onSnapshot,
      snapshotGridPreference,
      showSpikeOverlay = false,
      headerActionContent,
      txSlider,
      canvasStatusRow,
      placeholderSourceLabel,
      placeholderPaneLabel = "FFT",
      placeholderErrorReason = null,
      placeholderState: explicitPlaceholderState = null,
      interactionDisabled = false,
      onRenderableFrameChange,
      onCanvasLoadingChange,
      vizZoom = 1,
      vizZoomFloor = 1,
      vizPanOffset = 0,
      onVizZoomChange,
      onVizZoomFloorChange,
      onVizZoomFloorPanChange,
      onVizPanChange,
      maxBandwidthHz,
      fftMin = FFT_MIN_DB,
      fftMax,
      onFftDbLimitsChange,
      hardwareSampleRateHz,
      deviceProfile,
      deviceBackend,
      deviceName,
      tunerGainDb,
      isIqRecordingActive = false,
      limitMarkers = [],
      isWaterfallCleared = false,
      onResetWaterfallCleared,
      heterodyningVerifyRequestId = 0,
      heterodyningHighlightedBins = [],
      onHeterodyningAnalyzed,
      awaitingDeviceData = false,
      visualizerMachine,
      visualizerSessionKey = "default",
      waterfallCanvasBindings,
      compact = false,
      nodePreview = false,
      demodulationCenterFreqHz = null,
      demodulationRangeHz = null,
      selectionRange,
      selectionMode = "zoom",
      selectionDisabled = false,
      bandwidthAlignment = "centered",
      onSelectionChange,
      autoZoomStability = false,
    } = props;
    const dispatch = useAppDispatch();
    const {
      drawMarkersOnContext,
      drawDemodFocusOnContext,
      drawSelectionOverlayOnContext,
      drawZoomMarkersOnContext,
      drawPowerLineOnContext,
    } = useOverlayRenderer();
    const fftColor = useAppSelector((reduxState) => reduxState.theme.fftColor);
    const themeAppMode = useAppSelector(
      (reduxState) => reduxState.theme.appMode,
    );
    const resolvedThemeMode = useResolvedThemeMode(themeAppMode);
    const reduxShowTxSlider = useAppSelector(
      (reduxState) => reduxState.spectrum.showTxSlider ?? true,
    );
    const reduxTxSignal = useAppSelector(
      (reduxState) => reduxState.spectrum.txSignal || "apt",
    );
    const reduxTxCenterFrequencyHz = useAppSelector(
      (reduxState) => reduxState.spectrum.txCenterFrequencyHz,
    );
    const reduxTxSampleRateHz = useAppSelector(
      (reduxState) => reduxState.spectrum.txSampleRateHz,
    );
    const reduxTxPowerDbm = useAppSelector(
      (reduxState) => reduxState.spectrum.txPowerDbm,
    );
    const reduxDeviceKind = useAppSelector(
      (reduxState) => reduxState.spectrum.deviceKind,
    );
    const reduxWebsocketSources = useAppSelector(
      (reduxState) => reduxState.websocket.sources,
    );
    const isTransmittingGlobal = useMemo(() => {
      return reduxWebsocketSources.some(
        (source) => source.status === "transmitting",
      );
    }, [reduxWebsocketSources]);
    const pendingTxSliderDispatchRef = useRef<{
      centerHz?: number;
      sampleRateHz?: number;
    }>({});
    const txSliderDispatchTimerRef = useRef<ReturnType<
      typeof setTimeout
    > | null>(null);
    const flushTxSliderDispatch = useCallback(() => {
      txSliderDispatchTimerRef.current = null;
      const pending = pendingTxSliderDispatchRef.current;
      pendingTxSliderDispatchRef.current = {};
      if (typeof pending.sampleRateHz === "number") {
        dispatch(setTxSampleRateHz(pending.sampleRateHz));
      }
      if (typeof pending.centerHz === "number") {
        dispatch(setTxCenterFrequencyHz(pending.centerHz));
      }
    }, [dispatch]);
    const scheduleTxSliderDispatch = useCallback(
      (patch: { centerHz?: number; sampleRateHz?: number }) => {
        pendingTxSliderDispatchRef.current = {
          ...pendingTxSliderDispatchRef.current,
          ...patch,
        };
        if (txSliderDispatchTimerRef.current) return;
        txSliderDispatchTimerRef.current = setTimeout(
          flushTxSliderDispatch,
          16,
        );
      },
      [flushTxSliderDispatch],
    );
    useEffect(() => {
      return () => {
        if (txSliderDispatchTimerRef.current) {
          clearTimeout(txSliderDispatchTimerRef.current);
          txSliderDispatchTimerRef.current = null;
        }
      };
    }, []);
    const effectiveTxSlider = useMemo(() => {
      if (txSlider?.visible) return txSlider;
      const canTransmit =
        reduxDeviceKind === "hackrf_one" ||
        reduxDeviceKind === "mock_tx" ||
        reduxDeviceKind === "tx_rx" ||
        reduxDeviceKind === "tx" ||
        reduxDeviceKind === "mock";
      if (!reduxShowTxSlider || !canTransmit) return null;
      if (
        !frequencyRange ||
        !Number.isFinite(frequencyRange.min) ||
        !Number.isFinite(frequencyRange.max)
      ) {
        return null;
      }
      const visibleMinHz = frequencyRange.min;
      const visibleMaxHz =
        frequencyRange.max > visibleMinHz
          ? frequencyRange.max
          : visibleMinHz + 1;
      const visibleSpanHz = visibleMaxHz - visibleMinHz;
      const centerHz = Number.isFinite(reduxTxCenterFrequencyHz)
        ? reduxTxCenterFrequencyHz
        : visibleMinHz + visibleSpanHz / 2;
      const sampleRateHz = Number.isFinite(reduxTxSampleRateHz)
        ? Math.max(1, reduxTxSampleRateHz)
        : Math.max(1, Math.min(120_000, visibleSpanHz));
      return {
        visible: true,
        isTransmitting: isTransmittingGlobal,
        signalLabel: String(reduxTxSignal).toUpperCase(),
        powerDbm: reduxTxPowerDbm,
        visibleMinHz,
        visibleMaxHz,
        txCenterHz: centerHz,
        txSampleRateHz: sampleRateHz,
        onCenterFrequencyChange: (value: number) =>
          scheduleTxSliderDispatch({ centerHz: value }),
        onSampleRateChange: (value: number) =>
          scheduleTxSliderDispatch({ sampleRateHz: value }),
      };
    }, [
      frequencyRange,
      reduxDeviceKind,
      reduxShowTxSlider,
      reduxTxCenterFrequencyHz,
      reduxTxPowerDbm,
      reduxTxSampleRateHz,
      reduxTxSignal,
      isTransmittingGlobal,
      scheduleTxSliderDispatch,
      txSlider,
    ]);

    const autoZoomStabilityRef = useRef(autoZoomStability);
    useEffect(() => {
      autoZoomStabilityRef.current = autoZoomStability;
    }, [autoZoomStability]);
    const waterfallTheme = useAppSelector(
      (reduxState) => reduxState.theme.waterfallTheme,
    );
    // dataFrameCounter subscription removed — live rendering is driven by
    // useFFTAnimation's rAF loop, and paused-frame tracking uses a polling interval.
    const fillColor = useMemo(() => {
      if (fftColor.startsWith("#")) {
        return `${fftColor}33`; // 20% opacity
      }
      return fftColor;
    }, [fftColor]);

    const colormap = useMemo(
      () => WATERFALL_COLORMAPS[waterfallTheme],
      [waterfallTheme],
    );

    // Use new hooks for state management
    const canvasState = useCanvasState(waterfallCanvasBindings);
    const {
      spectrumGpuCanvasNode,
      setSpectrumGpuCanvasNode,
      spectrumOverlayCanvasNode,
      setSpectrumOverlayCanvasNode: _setSpectrumOverlayCanvasNode,
      waterfallGpuCanvasNode,
      waterfallOverlayCanvasNode,
      setWaterfallGpuCanvasNode: _setWaterfallGpuCanvasNode,
      setWaterfallOverlayCanvasNode: _setWaterfallOverlayCanvasNode,
      spectrumGpuCanvasRef,
      spectrumOverlayCanvasRef,
      waterfallGpuCanvasRef,
      waterfallOverlayCanvasRef,
      spectrumContainerRef,
    } = canvasState;

    // Sync state to refs (this is now handled inside useCanvasState hook)

    const lastRenderedPowerScaleRef = useRef<"dB" | "dBm" | null>(null);
    const lastIncomingFrameRef = useRef<LiveFrameData | null>(null);
    const liveGpuProcessInFlightRef = useRef(false);
    const [hasRenderedSpectrumFrame, setHasRenderedSpectrumFrame] =
      useState(false);

    const [powerLineDb, setPowerLineDb] = useState<number | null>(null);
    const [isPowerLineHeld, setIsPowerLineHeld] = useState(false);
    const [isTxSliderLocked, setIsTxSliderLocked] = useState(false);
    const powerLineDbRef = useRef<number | null>(null);
    const txSliderRef = useRef<CanvasTxSliderState | null>(null);
    txSliderRef.current = effectiveTxSlider?.visible ? effectiveTxSlider : null;
    useEffect(() => {
      powerLineDbRef.current = powerLineDb;
      if (powerLineDb === null) {
        setIsPowerLineHeld(false);
      }
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      forceRender();
    }, [powerLineDb]);

    const {
      waterfallBufferRef,
      waterfallDataWidthRef,
      getBufferFromPool,
      returnBufferToPool,
    } = useWaterfallBufferPool();

    const waterfallCappedBufferRef = useRef<Float32Array | null>(null);

    // Track canvas dimensions for cache management
    const spectrumWidthRef = useRef<number>(0);
    const spectrumHeightRef = useRef<number>(0);

    const clearOverlayCanvas = useCallback(
      (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      [],
    );

    const drawTxSliderOnContext = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        visualRange: FrequencyRange,
        slider: CanvasTxSliderState | null,
      ) => {
        if (
          !slider?.visible ||
          !Number.isFinite(slider.visibleMinHz) ||
          !Number.isFinite(slider.visibleMaxHz) ||
          slider.visibleMaxHz <= slider.visibleMinHz ||
          !Number.isFinite(slider.txCenterHz) ||
          !Number.isFinite(slider.txSampleRateHz)
        ) {
          return;
        }

        const plotLeft = Math.min(50, width);
        const plotRight = Math.max(plotLeft, width - 40);
        const left = 4;
        const right = Math.max(left, width - 4);
        const top = Math.max(0, height - TX_SLIDER_ROW_HEIGHT);
        const bottom = Math.max(top + 1, height - 4);
        const trackLeft = plotLeft;
        const trackRight = Math.max(trackLeft + 80, plotRight);
        const trackWidth = Math.max(1, trackRight - trackLeft);
        const visibleSpan = visualRange.max - visualRange.min;
        const { min: bandMin, max: bandMax } =
          clampCenteredFrequencyRangeToZeroHz(
            slider.txCenterHz,
            slider.txSampleRateHz,
          );
        const bandwidth = Math.max(1, bandMax - bandMin);
        const toX = (hz: number) =>
          trackLeft + ((hz - visualRange.min) / visibleSpan) * trackWidth;
        const rawBandLeft = toX(bandMin);
        const rawBandRight = toX(bandMax);
        const bandLeft = Math.max(trackLeft, Math.min(trackRight, rawBandLeft));
        const bandRight = Math.max(
          trackLeft,
          Math.min(trackRight, rawBandRight),
        );
        const boundaryDashColor = slider.isTransmitting
          ? "rgba(0, 212, 255, 0.98)"
          : "rgba(148, 163, 184, 0.96)";
        const plotBottom = Math.max(0, top - 40);
        const plotTop = Math.min(20, height);

        ctx.save();
        ctx.clearRect(left - 2, top - 2, right - left + 4, bottom - top + 4);
        if (bandRight > bandLeft) {
          ctx.save();
          ctx.strokeStyle = boundaryDashColor;
          ctx.lineWidth = 1.75;
          ctx.lineCap = "round";
          ctx.setLineDash([4, 4]);
          for (const x of [rawBandLeft, rawBandRight]) {
            if (x < trackLeft - 0.5 || x > trackRight + 0.5) continue;
            ctx.beginPath();
            ctx.moveTo(x, plotTop);
            ctx.lineTo(x, plotBottom);
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
      },
      [resolvedThemeMode],
    );

    const drawLoadingPlaceholder = useCallback(
      (canvas: HTMLCanvasElement | null, fontOverride?: string) => {
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const dpr = window.devicePixelRatio || 1;
        const logicalWidth = canvas.width / dpr;
        const logicalHeight = canvas.height / dpr;
        ctx.save();
        ctx.font = fontOverride ?? LOADING_PLACEHOLDER_FONT;
        ctx.fillStyle = LOADING_PLACEHOLDER_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          LOADING_PLACEHOLDER_TEXT,
          logicalWidth / 2,
          logicalHeight / 2,
        );
        ctx.restore();
      },
      [],
    );

    const lastWaterfallRowRef = useRef<Float32Array | null>(null);
    const pausedWaterfallRowRef = useRef<Float32Array | null>(null);
    const retuneTransitionRowRef = useRef<Float32Array | null>(null);
    const waterfallTextureSnapshotRef = useRef<Uint8Array | null>(null);
    const waterfallTextureMetaRef = useRef<{
      width: number;
      height: number;
      writeRow: number;
    } | null>(null);
    const heterodyningHistoryRef = useRef<Float32Array[]>([]);
    const heterodyningWriteIndexRef = useRef(0);
    const heterodyningHistoryCountRef = useRef(0);
    const activeHistoryRef = useRef<Float32Array[]>([]);
    const lastHeterodyningRequestIdRef = useRef(0);
    const pendingWaterfallRestoreRef = useRef<PendingWaterfallRestore | null>(
      null,
    );
    const restoredWaterfallRef = useRef(false);
    const activeVisualizerSessionKeyRef = useRef(visualizerSessionKey);
    const latestVisualizerMachineRef = useRef(visualizerMachine);
    const latestVisualizerSessionKeyRef = useRef(visualizerSessionKey);
    const lastVisualizerAutoPersistAtRef = useRef(0);

    useEffect(() => {
      latestVisualizerMachineRef.current = visualizerMachine;
      latestVisualizerSessionKeyRef.current = visualizerSessionKey;
    }, [visualizerMachine, visualizerSessionKey]);

    // Simplified frame management
    const frameBufferRef = useRef<Float32Array[]>([]);
    const maxFrameBufferSize = 1;
    const lastProcessedDataRef = useRef<any>(null);
    const lastProcessedFrameSignatureRef = useRef<
      number | LiveFrameData | null
    >(null);
    const frequencyRangeRef = useRef<FrequencyRange>(frequencyRange);
    const centerFreqRef = useRef(centerFrequencyHz);
    centerFreqRef.current = centerFrequencyHz;
    const renderableFrequencyRange = useMemo(
      () =>
        resolveRenderableFrequencyRange({
          requestedRange: frequencyRange,
          centerFrequencyHz,
          hardwareSampleRateHz,
          deviceKind: deviceProfile?.kind,
          backend: deviceBackend,
          deviceName,
          isRtlSdr: deviceProfile?.is_rtl_sdr,
        }),
      [
        frequencyRange,
        centerFrequencyHz,
        hardwareSampleRateHz,
        deviceProfile?.kind,
        deviceProfile?.is_rtl_sdr,
        deviceBackend,
        deviceName,
      ],
    );

    const retuneSmearRef = useRef(0);
    const retuneDriftPxRef = useRef(0);
    const lastWaterfallVisualRangeRef = useRef<FrequencyRange | null>(null);

    const effectivePowerScale = powerScale ?? "dB";
    const isHackrfDevice = deviceProfile?.kind === "hackrf_one";
    const isRtlSdr = isRtlSdrDevice({
      deviceKind: deviceProfile?.kind,
      backend: deviceBackend,
      deviceName,
      isRtlSdr: deviceProfile?.is_rtl_sdr,
    });
    const effectiveDbmOffsetDb = resolveEffectiveDbmOffsetDb({
      powerScale: effectivePowerScale,
      deviceKind: deviceProfile?.kind,
      backend: deviceBackend,
      deviceName,
      isTransmitting: isTransmittingGlobal,
      tunerGainDb,
    });
    const baseDbMin = Number.isFinite(fftMin) ? (fftMin as number) : FFT_MIN_DB;
    const baseDbMax = Number.isFinite(fftMax) ? (fftMax as number) : FFT_MAX_DB;
    const effectiveFftSize = fftSize ?? 32768;
    const validatedDbRange = useMemo(
      () => ensureValidDbRange(baseDbMin, baseDbMax, effectivePowerScale),
      [baseDbMin, baseDbMax, effectivePowerScale],
    );
    const vizDbMin = validatedDbRange.min;
    const vizDbMax = validatedDbRange.max;

    const applyDbLimits = useCallback(
      (minValue: number, maxValue: number) => {
        if (!onFftDbLimitsChange) return;
        const next = ensureValidDbRange(
          minValue,
          maxValue,
          effectivePowerScale,
        );
        onFftDbLimitsChange(next.min, next.max);
      },
      [onFftDbLimitsChange, effectivePowerScale],
    );

    // Effect: Synchronizes validated dB range back to parent when it changes.
    // Prevents infinite loops by only emitting when values actually differ from last emitted.
    useEffect(() => {
      if (!onFftDbLimitsChange) return;
      const normalized = { min: vizDbMin, max: vizDbMax };
      const lastEmitted = lastEmittedDbLimitsRef.current;
      const shouldEmit =
        baseDbMin !== normalized.min || baseDbMax !== normalized.max;

      if (
        shouldEmit &&
        (!lastEmitted ||
          lastEmitted.min !== normalized.min ||
          lastEmitted.max !== normalized.max)
      ) {
        lastEmittedDbLimitsRef.current = normalized;
        onFftDbLimitsChange(vizDbMin, vizDbMax);
      }
    }, [baseDbMin, baseDbMax, vizDbMin, vizDbMax, onFftDbLimitsChange]);

    const currentVizZoom = vizZoom ?? 1;

    const currentVisualRange = useMemo(() => {
      const minFreq = frequencyRange?.min ?? 0;
      const maxFreq = frequencyRange?.max ?? 0;
      const fullSpan = maxFreq - minFreq;
      if (fullSpan <= 0) return { min: minFreq, max: maxFreq };

      const halfSpan = fullSpan / (2 * currentVizZoom);
      const centerFreq = (minFreq + maxFreq) / 2;
      const visualCenter = centerFreq + vizPanOffset;
      return {
        min: visualCenter - halfSpan,
        max: visualCenter + halfSpan,
      };
    }, [frequencyRange, currentVizZoom, vizPanOffset]);

    const clampedVizRangeRef = useRef<FrequencyRange>(currentVisualRange);
    clampedVizRangeRef.current = currentVisualRange;

    const fftAvgEnabled = useAppSelector(
      (reduxState) => reduxState.spectrum.fftAvgEnabled,
    );
    const fftSmoothEnabled = useAppSelector(
      (reduxState) => reduxState.spectrum.fftSmoothEnabled,
    );
    const wfSmoothEnabled = useAppSelector(
      (reduxState) => reduxState.spectrum.wfSmoothEnabled,
    );
    const hardwareSpectrumBounds = useAppSelector(
      (reduxState) => reduxState.demod.hardwareRange,
    );

    const fftProcessedBufferRef = useRef<Float32Array | null>(null);
    const spectrumOutputBufferRef = useRef<Float32Array | null>(null);
    const pendingFftSizeChangeRef = useRef(false);

    const setVizZoom = useCallback(
      (val: number | ((prev: number) => number)) => {
        const newZoom = typeof val === "function" ? val(currentVizZoom) : val;
        if (onVizZoomChange) {
          onVizZoomChange(newZoom);
        }
      },
      [onVizZoomChange, currentVizZoom],
    );

    const setVizPanOffset = useCallback(
      (val: number | ((prev: number) => number)) => {
        if (onVizPanChange) {
          onVizPanChange(typeof val === "function" ? val(vizPanOffset) : val);
        }
      },
      [onVizPanChange, vizPanOffset],
    );

    const vizZoomRef = useRef(currentVizZoom);
    const vizZoomFloorRef = useRef(vizZoomFloor);
    const vizDbMaxRef = useRef(vizDbMax);
    const vizDbMinRef = useRef(vizDbMin);
    const vizPanOffsetRef = useRef(vizPanOffset);
    const previousPowerScaleRef = useRef(effectivePowerScale);
    const previousFftSizeRef = useRef(effectiveFftSize);
    const previousFftWindowRef = useRef(fftWindow);
    const previousTemporalResolutionRef = useRef(displayTemporalResolution);
    const lastEmittedDbLimitsRef = useRef<{ min: number; max: number } | null>(
      null,
    );
    vizZoomRef.current = currentVizZoom;
    vizZoomFloorRef.current = vizZoomFloor;
    vizDbMaxRef.current = vizDbMax;
    vizDbMinRef.current = vizDbMin;
    vizPanOffsetRef.current = vizPanOffset;

    const isLoadingPlaceholder =
      !placeholderErrorReason && !hasRenderedSpectrumFrame;

    const canvasPlaceholderState =
      useMemo<CanvasPlaceholderState | null>(() => {
        if (explicitPlaceholderState) {
          return explicitPlaceholderState;
        }

        if (!isDeviceConnected) {
          return {
            kind: "error",
            sourceLabel: placeholderSourceLabel,
            reason: "Server down",
          };
        }

        if (placeholderErrorReason) {
          return {
            kind: "error",
            sourceLabel: placeholderSourceLabel,
            reason: placeholderErrorReason,
          };
        }

        if (isLoadingPlaceholder) {
          return {
            kind: "loading",
            sourceLabel: placeholderSourceLabel,
            paneLabel: placeholderPaneLabel,
            message:
              typeof awaitingDeviceData === "string"
                ? awaitingDeviceData
                : undefined,
          };
        }

        return null;
      }, [
        isLoadingPlaceholder,
        placeholderErrorReason,
        placeholderSourceLabel,
        placeholderPaneLabel,
        awaitingDeviceData,
        explicitPlaceholderState,
        isDeviceConnected,
      ]);

    const demodFocusOverlay = useMemo(() => {
      // Prioritize active selection range
      if (
        selectionRange &&
        Number.isFinite(selectionRange.min) &&
        Number.isFinite(selectionRange.max) &&
        selectionRange.max > selectionRange.min
      ) {
        return {
          centerFrequencyHz: (selectionRange.min + selectionRange.max) / 2,
          halfBandwidthHz: (selectionRange.max - selectionRange.min) / 2,
          alignment: bandwidthAlignment,
        };
      }

      if (
        demodulationCenterFreqHz === null ||
        demodulationCenterFreqHz === undefined ||
        !Number.isFinite(demodulationCenterFreqHz)
      ) {
        return null;
      }

      const range = demodulationRangeHz ?? 100_000;
      if (!Number.isFinite(range) || range <= 0) return null;

      return {
        centerFrequencyHz: demodulationCenterFreqHz,
        halfBandwidthHz: range / 2,
        alignment: bandwidthAlignment,
      };
    }, [
      selectionRange,
      demodulationCenterFreqHz,
      demodulationRangeHz,
      bandwidthAlignment,
    ]);

    const selectionOverlay = useMemo(() => {
      if (
        !selectionRange ||
        !Number.isFinite(selectionRange.min) ||
        !Number.isFinite(selectionRange.max) ||
        selectionRange.max <= selectionRange.min
      ) {
        return null;
      }

      return {
        minFrequencyHz: selectionRange.min,
        maxFrequencyHz: selectionRange.max,
      };
    }, [selectionRange]);

    const selectionTooltipText = useMemo(() => {
      if (!selectionRange) return null;
      if (
        !Number.isFinite(selectionRange.min) ||
        !Number.isFinite(selectionRange.max) ||
        selectionRange.max <= selectionRange.min
      ) {
        return null;
      }

      const startHz = selectionRange.min.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
      const endHz = selectionRange.max.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
      const spanHz = (selectionRange.max - selectionRange.min).toLocaleString(
        undefined,
        { maximumFractionDigits: 0 },
      );

      return {
        startHz,
        endHz,
        spanHz,
      };
    }, [selectionRange]);

    const txSliderTooltipContent = useMemo(() => {
      if (!effectiveTxSlider?.visible || canvasPlaceholderState) return null;
      const formatHz = (hz: number) => {
        if (!Number.isFinite(hz)) return "Unknown";
        const abs = Math.abs(hz);
        if (abs >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`;
        if (abs >= 1_000) return `${(hz / 1_000).toFixed(0)} kHz`;
        return `${Math.round(hz)} Hz`;
      };
      const power =
        typeof effectiveTxSlider.powerDbm === "number" &&
        Number.isFinite(effectiveTxSlider.powerDbm)
          ? `${effectiveTxSlider.powerDbm.toFixed(0)} dBm`
          : "Unknown";
      return [
        `Center: ${formatHz(effectiveTxSlider.txCenterHz)}`,
        `Bandwidth: ${formatHz(effectiveTxSlider.txSampleRateHz)}`,
        `Power: ${power}`,
      ].join("\n");
    }, [effectiveTxSlider]);

    const txSliderVisualMetrics = useMemo(() => {
      const slider = effectiveTxSlider;
      if (
        !slider?.visible ||
        !Number.isFinite(slider.visibleMinHz) ||
        !Number.isFinite(slider.visibleMaxHz) ||
        slider.visibleMaxHz <= slider.visibleMinHz ||
        !Number.isFinite(slider.txCenterHz) ||
        !Number.isFinite(slider.txSampleRateHz)
      ) {
        return null;
      }

      const visualMin = currentVisualRange.min;
      const visualMax = currentVisualRange.max;
      const span = visualMax - visualMin;
      if (span <= 0) return null;

      const { min: rawBandStart, max: rawBandEnd } =
        clampCenteredFrequencyRangeToZeroHz(
          slider.txCenterHz,
          slider.txSampleRateHz,
        );
      const bandwidth = Math.max(1, rawBandEnd - rawBandStart);
      const center = (rawBandStart + rawBandEnd) / 2;
      const bandStart = Math.max(visualMin, rawBandStart);
      const bandEnd = Math.min(visualMax, rawBandEnd);
      const left = ((bandStart - visualMin) / span) * 100;
      const width =
        bandEnd > bandStart ? ((bandEnd - bandStart) / span) * 100 : 0;
      const centerLeft = ((center - visualMin) / span) * 100;
      const powerLabel =
        typeof slider.powerDbm === "number" && Number.isFinite(slider.powerDbm)
          ? `${slider.powerDbm.toFixed(0)} dBm`
          : null;

      let offScreenDirection: "left" | "right" | null = null;
      if (center < visualMin) offScreenDirection = "left";
      else if (center > visualMax) offScreenDirection = "right";

      const formatHz = (hz: number) => {
        if (!Number.isFinite(hz)) return "Unknown";
        const abs = Math.abs(hz);
        if (abs >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`;
        if (abs >= 1_000) return `${(hz / 1_000).toFixed(0)} kHz`;
        return `${Math.round(hz)} Hz`;
      };

      return {
        left: Math.max(0, Math.min(100, left)),
        width: Math.max(0, Math.min(100, width)),
        centerLeft: Math.max(0, Math.min(100, centerLeft)),
        signalLabel: slider.signalLabel ?? "TX",
        powerLabel,
        isOffScreen: offScreenDirection !== null,
        offScreenDirection,
        centerHzFormatted: `○ ${formatHz(center)}`,
        bandwidthFormatted: `| ${formatHz(bandwidth)} |`,
      };
    }, [effectiveTxSlider, currentVisualRange]);

    const handleOffscreenIndicatorClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const slider = effectiveTxSlider;
        if (!slider || !frequencyRange) return;

        const span = frequencyRange.max - frequencyRange.min;
        const visualCenter =
          (currentVisualRange.min + currentVisualRange.max) / 2;
        onVizPanChange?.(slider.txCenterHz - visualCenter);
        if (onFrequencyRangeChange && Number.isFinite(span) && span > 0) {
          const center = Math.max(0, slider.txCenterHz);
          let nextMin = center - span / 2;
          let nextMax = center + span / 2;
          if (nextMin < 0) {
            nextMax -= nextMin;
            nextMin = 0;
          }
          onFrequencyRangeChange({ min: nextMin, max: nextMax });
          onVizPanChange?.(0);
          return;
        }
      },
      [
        effectiveTxSlider,
        frequencyRange,
        currentVisualRange,
        onFrequencyRangeChange,
        onVizPanChange,
      ],
    );

    // Compute zoomed visual frequency range and waveform slice
    // When zoom > 1: shows a subset of bins (magnified view)
    // When zoom < 1: pads the waveform with minimum dB values (zoomed out view)
    const getZoomedData = useCallback(
      (
        fullWaveform: Float32Array,
        fullRange: FrequencyRange,
        zoom: number,
        panOffset: number,
      ): {
        slicedWaveform: Float32Array;
        visualRange: FrequencyRange;
        clampedPan: number;
      } => {
        // Fast path: no zoom and no pan means show the full waveform unmodified
        if (zoom === 1 && panOffset === 0) {
          return {
            slicedWaveform: fullWaveform,
            visualRange: fullRange,
            clampedPan: 0,
          };
        }

        const totalBins = fullWaveform.length;
        const visibleBins = Math.max(1, Math.floor(totalBins / zoom));

        const fullSpan = fullRange.max - fullRange.min;
        const halfSpan = fullSpan / (2 * zoom);

        // The event handlers (useFrequencyDrag, useFFTHandlers) already properly clamp the pan
        // based on the component's state (e.g. allowing full plot panning if edge-panning is active).
        // Re-clamping here causes snap-back bugs when live frames arrive.
        let clampedPan = panOffset;

        const centerFreq = (fullRange.min + fullRange.max) / 2;
        const visualCenter = centerFreq + clampedPan;

        // Convert visual center frequency to bin index in the full waveform
        const visualCenterBin = Math.round(
          ((visualCenter - fullRange.min) / fullSpan) * totalBins,
        );

        let startBin = Math.round(visualCenterBin - visibleBins / 2);

        const visualRange = {
          min: visualCenter - halfSpan,
          max: visualCenter + halfSpan,
        };

        let slicedWaveform: Float32Array;

        // Pad with minimum dB values to fill the display if out of bounds or zoomed out
        if (startBin < 0 || startBin + visibleBins > totalBins || zoom < 1) {
          slicedWaveform = new Float32Array(visibleBins).fill(FFT_MIN_DB);
          const destOffset = Math.max(0, -startBin);
          const dataToCopy = Math.min(totalBins, visibleBins - destOffset);
          const srcOffset = Math.max(0, startBin);

          if (dataToCopy > 0 && srcOffset < totalBins) {
            const validDataToCopy = Math.min(dataToCopy, totalBins - srcOffset);
            if (validDataToCopy > 0) {
              slicedWaveform.set(
                fullWaveform.subarray(srcOffset, srcOffset + validDataToCopy),
                destOffset,
              );
            }
          }
        } else {
          // Extract the visible slice from the waveform
          const validStart = Math.max(0, startBin);
          const validEnd = Math.min(totalBins, startBin + visibleBins);
          slicedWaveform = fullWaveform.slice(validStart, validEnd);
        }

        return { slicedWaveform, visualRange, clampedPan };
      },
      [],
    );

    // Ref to track snapshot grid preference (for 2D shadow renders)
    const snapshotGridPreferenceRef = useRef(true);

    // Effect: Sync snapshotGridPreference prop to ref for access in callbacks without dependency churn
    useEffect(() => {
      snapshotGridPreferenceRef.current = snapshotGridPreference;
    }, [snapshotGridPreference]);
    const waveformFloatRef = useRef<Float32Array | null>(null);
    const renderWaveformRef = useRef<Float32Array | null>(null);
    const FULL_CHANNEL_BINS = 4096;
    const fullChannelWaveformRef = useRef<Float32Array | null>(null);
    const fullChannelRangeRef = useRef<FrequencyRange | null>(null);
    const waterfallDimsRef = useRef<{ width: number; height: number } | null>(
      null,
    );
    const waterfallGpuDimsRef = useRef<{
      width: number;
      height: number;
    } | null>(null);

    // Simplified WebGPU references
    const resampleComputePipelineRef = useRef<GPUComputePipeline | null>(null);
    const resampleParamsBufferRef = useRef<GPUBuffer | null>(null);
    const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);

    const {
      webgpuEnabled,
      isInitializingWebGPU,
      webgpuDeviceRef,
      webgpuFormatRef,
      gridOverlayRendererRef,
      markersOverlayRendererRef,
      spikesOverlayRendererRef,
      overlayDirtyRef,
    } = useWebGPUInit({
      spectrumGpuCanvasRef,
      waterfallGpuCanvasRef,
      resampleWgsl: RESAMPLE_WGSL,
      resampleComputePipelineRef,
      resampleParamsBufferRef,
      gpuBufferPoolRef,
    });
    const spectrumWebgpuEnabled = webgpuEnabled;
    const activeScaleDbMin = vizDbMin;
    const activeScaleDbMax = vizDbMax;
    const gpuProcessingDevice = webgpuDeviceRef.current;

    // Temporal frames ring buffer refs
    const temporalFramePoolRef = useRef<Float32Array[]>([]);
    const temporalWriteIndexRef = useRef(0);
    const temporalActiveCountRef = useRef(0);
    const activeTemporalFramesRef = useRef<Float32Array[]>([]);

    const resetTemporalAveragingState = useCallback(() => {
      temporalFramePoolRef.current.length = 0;
      temporalWriteIndexRef.current = 0;
      temporalActiveCountRef.current = 0;
      activeTemporalFramesRef.current.length = 0;
    }, []);

    const invalidateSpectrumProcessingCaches = useCallback(() => {
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      lastRenderedPowerScaleRef.current = null;
      pendingFftSizeChangeRef.current = true;
      fftProcessedBufferRef.current = null;
      spectrumOutputBufferRef.current = null;
      resetTemporalAveragingState();
    }, [resetTemporalAveragingState]);

    // Refs for volatile rendering parameters to stabilize callbacks
    const fftColorRef = useRef(fftColor);
    const fillColorRef = useRef(fillColor);
    const colormapRef = useRef(colormap);
    const waterfallThemeRef = useRef(waterfallTheme);
    const fftAvgEnabledRef = useRef(fftAvgEnabled);
    const fftSmoothEnabledRef = useRef(fftSmoothEnabled);
    const wfSmoothEnabledRef = useRef(wfSmoothEnabled);
    const effectivePowerScaleRef = useRef(effectivePowerScale);
    const activeScaleDbMinRef = useRef(activeScaleDbMin);
    const activeScaleDbMaxRef = useRef(activeScaleDbMax);
    const showSpikeOverlayRef = useRef(showSpikeOverlay);
    const awaitingDeviceDataRef = useRef(awaitingDeviceData);
    const demodFocusOverlayRef = useRef(demodFocusOverlay);
    const selectionOverlayRef = useRef(selectionOverlay);
    const nodePreviewRef = useRef(nodePreview);

    const liveDragSelectionRef = useRef<FrequencyRange | null>(null);
    const tooltipSpanRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
      fftColorRef.current = fftColor;
      fillColorRef.current = fillColor;
      colormapRef.current = colormap;
      waterfallThemeRef.current = waterfallTheme;
      fftAvgEnabledRef.current = fftAvgEnabled;
      fftSmoothEnabledRef.current = fftSmoothEnabled;
      wfSmoothEnabledRef.current = wfSmoothEnabled;
      effectivePowerScaleRef.current = effectivePowerScale;
      activeScaleDbMinRef.current = activeScaleDbMin;
      activeScaleDbMaxRef.current = activeScaleDbMax;
      showSpikeOverlayRef.current = showSpikeOverlay;
      awaitingDeviceDataRef.current = awaitingDeviceData;
      demodFocusOverlayRef.current = demodFocusOverlay;
      selectionOverlayRef.current = selectionOverlay;
      nodePreviewRef.current = nodePreview;
    }, [
      fftColor,
      fillColor,
      colormap,
      waterfallTheme,
      fftAvgEnabled,
      fftSmoothEnabled,
      wfSmoothEnabled,
      effectivePowerScale,
      activeScaleDbMin,
      activeScaleDbMax,
      showSpikeOverlay,
      awaitingDeviceData,
      demodFocusOverlay,
      selectionOverlay,
      nodePreview,
    ]);

    useEffect(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      forceRenderRef.current?.();
    }, [resolvedThemeMode, fftColor, waterfallTheme]);

    const forceRenderRef = useRef<(() => void) | null>(null);

    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      forceRenderRef.current?.();
    }, [
      effectiveTxSlider,
      spectrumOverlayCanvasNode,
      overlayDirtyRef,
      isInitializingWebGPU,
      webgpuEnabled,
    ]);

    const handleSpikeCount = useCallback(
      (count: number) => {
        dispatch(setGpuSpikeCount(count));
      },
      [dispatch],
    );

    const handleVizPanChange = useCallback(
      (pan: number) => {
        setVizPanOffset(pan);
        overlayDirtyRef.current.grid = true;
        overlayDirtyRef.current.markers = true;
        if (isPaused) forceRenderRef.current?.();
      },
      [isPaused, setVizPanOffset],
    );

    const { processUnified } = useUnifiedFFTWaterfall({
      device: webgpuDeviceRef.current ?? null,
      fftSize: effectiveFftSize,
      waterfallHeight: 1,
      windowType: toUnifiedWindowType(fftWindow),
      enableAveraging: fftAvgEnabled,
      enableSmoothing: fftSmoothEnabled,
    });

    // Effect: When hardware frequency range changes, mark overlays for redraw
    // and sync the ref used by drag/render logic. Note: this does NOT retune the device.
    useEffect(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      frequencyRangeRef.current = renderableFrequencyRange;
    }, [renderableFrequencyRange, overlayDirtyRef]);

    // Effect: When center frequency changes, only mark markers overlay for redraw
    // (grid lines stay at same positions, but frequency labels shift)
    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      centerFreqRef.current = centerFrequencyHz;
    }, [centerFrequencyHz, overlayDirtyRef]);

    // Effect: When device connection state changes, redraw markers overlay
    // to show/hide red limit lines indicating hardware boundaries
    useEffect(() => {
      overlayDirtyRef.current.markers = true;
    }, [isDeviceConnected]);

    useEffect(() => {
      overlayDirtyRef.current.markers = true;
    }, [demodFocusOverlay, overlayDirtyRef]);

    // Effect: When Tx center frequency or sample rate changes, mark markers overlay as dirty
    // and redraw the canvas (especially useful if the visualization is paused)
    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      forceRenderRef.current?.();
    }, [reduxTxCenterFrequencyHz, reduxTxSampleRateHz, overlayDirtyRef]);

    // Effect: Recording state or sample rate changes trigger grid redraw
    // to update the recording indicator visual elements
    useEffect(() => {
      overlayDirtyRef.current.grid = true;
    }, [isIqRecordingActive, hardwareSampleRateHz]);

    const hasRealWaveform = !!(
      waveformFloatRef.current && waveformFloatRef.current.length > 0
    );
    useEffect(() => {
      if (awaitingDeviceData || placeholderErrorReason) {
        setHasRenderedSpectrumFrame(false);
        onRenderableFrameChange?.(false);
      }
    }, [awaitingDeviceData, onRenderableFrameChange, placeholderErrorReason]);

    useEffect(() => {
      onCanvasLoadingChange?.(isLoadingPlaceholder);
    }, [isLoadingPlaceholder, onCanvasLoadingChange]);

    useFrequencyDrag({
      disabled:
        selectionDisabled || interactionDisabled || isLoadingPlaceholder,
      selectionMode,
      spectrumGpuCanvasRef,
      spectrumGpuCanvasNode,
      spectrumContainerRef,
      frequencyRangeRef,
      spectrumWebgpuEnabled,
      activeSignalArea: _activeSignalArea,
      signalAreaBounds,
      hardwareSpectrumBounds,
      onFrequencyRangeChange,
      selectionRange,
      onSelectionChange,
      fullPlotSelection: nodePreview,
      vizZoomRef,
      vizZoomFloorRef,
      vizPanOffsetRef,
      clampedVizRangeRef,
      onVizPanChange: handleVizPanChange,
      vizDbMinRef,
      vizDbMaxRef,
      onFftDbLimitsChange: applyDbLimits,
      onVizZoomChange: setVizZoom,
      onVizZoomFloorChange,
      onVizZoomFloorPanChange,
      autoZoomStabilityRef,
      renderWaveformRef,
      maxBandwidthHz,
      liveDragSelectionRef,
      onDragRepaint: useCallback(() => {
        overlayDirtyRef.current.markers = true;
        forceRenderRef.current?.();
      }, [overlayDirtyRef]),
      tooltipSpanRef,
      powerLineDbRef,
      onPowerLineDbChange: setPowerLineDb,
      onPowerLineHoldChange: setIsPowerLineHeld,
      txSliderRef,
      txSliderEnabled: !!effectiveTxSlider?.visible,
      txSliderLocked: isTxSliderLocked,
    });

    // Initialize WASM SIMD for optimized data processing
    const { processIqToDbmSpectrum } = useWasmSimdMath({
      fftSize: 4096,
      enableSimd: true,
      fallbackToScalar: true,
    });

    // Use the unified spectrum renderer (WebGPU + Canvas2D fallback)
    const { drawSpectrum, cleanup: cleanupSpectrum } = useSpectrumRenderer();
    const { drawWebGPUFIFOWaterfall, cleanup: cleanupWebGPUFIFOWaterfall } =
      useDrawWebGPUFIFOWaterfall();
    const {
      computeWaterfallRetuneRow,
      cleanup: cleanupWaterfallRetuneCompute,
    } = useWaterfallRetuneCompute();

    // Effect: Clears all waterfall state when isWaterfallCleared becomes true.
    // This resets the persisted snapshot, CPU history, and WebGPU circular texture.
    useEffect(() => {
      if (isWaterfallCleared) {
        visualizerMachine?.clear(visualizerSessionKey);
        cleanupWebGPUFIFOWaterfall();
        waterfallBufferRef.current = null;
        waterfallCappedBufferRef.current = null;
        waterfallTextureSnapshotRef.current = null;
        waterfallTextureMetaRef.current = null;
        lastWaterfallRowRef.current = null;
        pausedWaterfallRowRef.current = null;
        retuneTransitionRowRef.current = null;
        pendingWaterfallRestoreRef.current = null;
        restoredWaterfallRef.current = false;
        heterodyningHistoryRef.current = [];
        heterodyningWriteIndexRef.current = 0;
        heterodyningHistoryCountRef.current = 0;
        activeHistoryRef.current = [];
        retuneSmearRef.current = 0;
        retuneDriftPxRef.current = 0;
        lastWaterfallVisualRangeRef.current = null;
        clearOverlayCanvas(waterfallOverlayCanvasNode);
        onResetWaterfallCleared?.();
      }
    }, [
      cleanupWebGPUFIFOWaterfall,
      clearOverlayCanvas,
      isWaterfallCleared,
      onResetWaterfallCleared,
      visualizerMachine,
      visualizerSessionKey,
      waterfallOverlayCanvasNode,
    ]);

    // Redundant overlay logic removed (now handled by useSpectrumRenderer)

    const restoreWaveformFromStorageRef = useRef<() => void>(() => {
      // When paused and no current IQ data, try to reprocess from last valid frame
      // using the CPU path (authoritative spectrum source).
      const lastData = lastProcessedDataRef.current;
      if (lastData?.iq_data && lastData.iq_data.length >= 2) {
        const restored = processIqToDbmSpectrum(
          lastData.iq_data,
          effectiveDbmOffsetDb,
          effectiveFftSize,
          fftWindow,
          spectrumOutputBufferRef.current ?? undefined,
        );
        if (restored.length > 0) {
          spectrumOutputBufferRef.current = restored;
          const prev = renderWaveformRef.current;
          if (!prev || prev.length !== restored.length) {
            renderWaveformRef.current = new Float32Array(restored);
          } else {
            prev.set(restored);
          }
          return;
        }
      }

      // If no previous data, create a fallback waveform
      const fallbackWaveform = new Float32Array(1024).fill(FFT_MIN_DB);
      renderWaveformRef.current = fallbackWaveform;
    });

    /**
     * Animation loop for continuous spectrum and waterfall updates
     * While paused: keep rendering the last cached waveform without ingesting new data.
     *
     * NOTE: React's dev profiling creates PerformanceMeasure objects that leak memory.
     * WebGPU state changes also trigger performance measurements. Clear them each frame
     * to prevent memory ballooning (was reaching 40GB+ without this).
     */
    const onRenderFrame = useCallback(
      (_runId: number) => {
        performance.clearMeasures();
        const spectrumGpuCanvas = spectrumGpuCanvasRef.current;
        const waterfallGpuCanvas = waterfallGpuCanvasRef.current;
        const spectrumOverlayCanvas = spectrumOverlayCanvasRef.current;
        const waterfallOverlayCanvas = waterfallOverlayCanvasRef.current;

        const currentData = dataRef.current;
        const currentFrame = getLatestLiveFrame(currentData);
        const hasRenderableFrame = !!(
          currentFrame &&
          ((currentFrame.iq_data && currentFrame.iq_data.length > 0) ||
            ((currentFrame as any).waveform &&
              (currentFrame as any).waveform.length > 0) ||
            ((currentFrame as any).data &&
              (currentFrame as any).data.length > 0))
        );

        const hasDrawableCachedWaveform = !!(
          (renderWaveformRef.current && renderWaveformRef.current.length > 0) ||
          (waveformFloatRef.current && waveformFloatRef.current.length > 0) ||
          (waveformFloatRef.current && lastProcessedDataRef.current)
        );
        const showLoadingPlaceholder =
          isLoadingPlaceholder &&
          !hasRenderableFrame &&
          !hasDrawableCachedWaveform;
        const showErrorPlaceholder =
          !!placeholderErrorReason ||
          (!isDeviceConnected && !hasRenderableFrame);

        if (showLoadingPlaceholder || showErrorPlaceholder) {
          clearOverlayCanvas(spectrumOverlayCanvas);
          clearOverlayCanvas(waterfallOverlayCanvas);

          if (spectrumOverlayCanvas) {
            const ctx = spectrumOverlayCanvas.getContext("2d");
            if (ctx) {
              const dpr = window.devicePixelRatio || 1;
              const logicalW = spectrumOverlayCanvas.width / dpr;
              const logicalH = spectrumOverlayCanvas.height / dpr;
              ctx.clearRect(0, 0, logicalW, logicalH);
            }
          }
          return;
        }

        clearOverlayCanvas(spectrumOverlayCanvas);
        clearOverlayCanvas(waterfallOverlayCanvas);

        const powerScale = effectivePowerScaleRef.current;
        const isDbmMode = powerScale === "dBm";
        const powerScaleChanged =
          lastRenderedPowerScaleRef.current !== powerScale;
        const fftWindowChanged =
          previousFftWindowRef.current !== (fftWindow ?? "Rectangular");
        const hasNewData =
          !isPaused &&
          currentFrame &&
          getLiveFrameSignature(currentFrame) !==
            lastProcessedFrameSignatureRef.current &&
          (!!currentFrame.iq_data ||
            !!(currentFrame as any).waveform ||
            !!(currentFrame as any).data);
        const shouldReprocessCurrentFrame = !!(
          currentFrame &&
          (getLiveFrameSignature(currentFrame) ===
            lastProcessedFrameSignatureRef.current ||
            isPaused) &&
          (powerScaleChanged || fftWindowChanged) &&
          (!!currentFrame.iq_data ||
            !!(currentFrame as any).waveform ||
            !!(currentFrame as any).data)
        );

        if (
          (hasNewData || shouldReprocessCurrentFrame) &&
          currentFrame?.iq_data
        ) {
          // Unified IQ→spectrum path: all live data is iq_data (Uint8Array).
          // The only variable is the dB offset for the power scale.
          const iqBytes = currentFrame?.iq_data;
          if (!iqBytes || iqBytes.length < 2) return;

          frequencyRangeRef.current = resolveLiveFrameRenderableFrequencyRange({
            currentFrame,
            requestedRange: frequencyRange,
            propsCenterFrequencyHz: centerFreqRef.current,
            propsHardwareSampleRateHz: hardwareSampleRateHz,
            preferRequestedRange: isIqRecordingActive,
            deviceKind: deviceProfile?.kind,
            backend: deviceBackend,
            deviceName,
            isRtlSdr: deviceProfile?.is_rtl_sdr,
          });

          if (gpuProcessingDevice && webgpuEnabled && !isInitializingWebGPU) {
            if (!liveGpuProcessInFlightRef.current) {
              liveGpuProcessInFlightRef.current = true;
              const liveChunkSize = effectiveFftSize * 2;
              const liveIqChunk =
                iqBytes.length > liveChunkSize
                  ? iqBytes.subarray(0, liveChunkSize)
                  : iqBytes;
              // GPU unified path: drives the waterfall texture only.
              // Do NOT write spectrumData back to waveformFloatRef — the CPU
              // processIqToDbmSpectrum path below is the authoritative spectrum
              // source and uses a different normalization / FFT implementation.
              // Letting the async GPU result overwrite the CPU result causes
              // dB mode to draw with dBm-shaped values (race condition).
              void processUnified(liveIqChunk, {
                inputMode: "complex_iq",
                powerMode: isDbmMode ? "dbm" : "db",
                minDb: activeScaleDbMinRef.current,
                maxDb: activeScaleDbMaxRef.current,
                hardwareSampleRateHz: currentFrame.sample_rate,
                centerFrequencyHz: currentFrame.center_frequency_hz,
                tunerGainDb: tunerGainDb ?? 0,
                calibrationMode: isHackrfDevice ? "hackrf_one" : "generic",
                ...(isHackrfDevice
                  ? { baseCalibrationDb: 30, chainLossDb: 0 }
                  : {}),
              })
                .finally(() => {
                  liveGpuProcessInFlightRef.current = false;
                })
                .catch(() => {
                  liveGpuProcessInFlightRef.current = false;
                });
            }
          }

          let waveform: Float32Array;

          const rawSpectrum = processIqToDbmSpectrum(
            iqBytes,
            effectiveDbmOffsetDb,
            effectiveFftSize,
            fftWindow,
            spectrumOutputBufferRef.current ?? undefined,
          );
          spectrumOutputBufferRef.current = rawSpectrum;
          const prev = renderWaveformRef.current;
          if (!prev || prev.length !== rawSpectrum.length) {
            renderWaveformRef.current = new Float32Array(rawSpectrum);
          } else {
            prev.set(rawSpectrum);
          }
          waveform = renderWaveformRef.current!;
          pendingFftSizeChangeRef.current = false;

          // Validate waveform before processing
          if (waveform && waveform.length > 0) {
            waveformFloatRef.current = waveform;
            lastProcessedDataRef.current = currentFrame;
            lastProcessedFrameSignatureRef.current =
              getLiveFrameSignature(currentFrame);
            lastRenderedPowerScaleRef.current = effectivePowerScale;
            previousFftWindowRef.current = fftWindow ?? "Rectangular";

            // Accumulate frequency-hop data into full-channel composite buffer.
            // This builds a 4096-bin representation of the entire channel span
            // from individual hop-sized I/Q chunks for intentional wide snapshots.
            // RTL-SDR must never synthesize a whole-channel buffer because its
            // hardware window is limited to the current 3.2MHz sample rate.
            if (isRtlSdr) {
              fullChannelWaveformRef.current = null;
              fullChannelRangeRef.current = null;
            } else {
              const channelRange = frequencyRangeRef.current;
              if (!channelRange) return;
              const channelSpan = channelRange.max - channelRange.min;
              const hopCenterHz = currentFrame.center_frequency_hz;
              const hopSampleRate = currentFrame.sample_rate;
              if (
                channelSpan > 0 &&
                typeof hopCenterHz === "number" &&
                hopCenterHz > 0 &&
                typeof hopSampleRate === "number" &&
                hopSampleRate > 0
              ) {
                const hopMin = hopCenterHz - hopSampleRate / 2;
                const hopMax = hopCenterHz + hopSampleRate / 2;

                // Reset the full-channel buffer when the channel range changes
                if (
                  !fullChannelRangeRef.current ||
                  fullChannelRangeRef.current.min !== channelRange.min ||
                  fullChannelRangeRef.current.max !== channelRange.max
                ) {
                  fullChannelWaveformRef.current = new Float32Array(
                    FULL_CHANNEL_BINS,
                  ).fill(-200);
                  fullChannelRangeRef.current = { ...channelRange };
                }

                // Map this hop's frequency range into the full-channel bin indices
                const buf = fullChannelWaveformRef.current!;
                const startRatio = Math.max(
                  0,
                  (hopMin - channelRange.min) / channelSpan,
                );
                const endRatio = Math.min(
                  1,
                  (hopMax - channelRange.min) / channelSpan,
                );
                const destStart = Math.round(startRatio * FULL_CHANNEL_BINS);
                const destEnd = Math.round(endRatio * FULL_CHANNEL_BINS);
                const destCount = Math.max(1, destEnd - destStart);
                const srcLen = waveform.length;

                // Resample the hop's waveform into the destination bin range
                for (let i = 0; i < destCount; i++) {
                  const srcIdx = Math.min(
                    srcLen - 1,
                    Math.round((i / destCount) * srcLen),
                  );
                  buf[destStart + i] = waveform[srcIdx];
                }
              }
            }

            // Architecture note: Only one active spectrum pipeline here.
            // The direct drawSpectrum path is the authoritative visible renderer.
            // Launching unifiedFFT.processUnified in parallel causes a second
            // GPU processing path that races the visible renderer, causing
            // flashing and color shifts during dBm/dB-range transitions.

            const temporalWindow = getTemporalResolutionWindow(
              displayTemporalResolution,
              fftFrameRate,
            );
            if (temporalWindow <= 1) {
              // Fast path: single frame, no averaging needed. Reuse the render buffer.
              const prev = renderWaveformRef.current;
              if (!prev || prev.length !== waveform.length) {
                renderWaveformRef.current = new Float32Array(waveform);
              } else {
                prev.set(waveform);
              }
              temporalActiveCountRef.current = 0;
            } else {
              const pool = temporalFramePoolRef.current;
              if (
                pool.length !== temporalWindow ||
                (pool.length > 0 && pool[0].length !== waveform.length)
              ) {
                pool.length = 0;
                for (let i = 0; i < temporalWindow; i++) {
                  pool.push(new Float32Array(waveform.length));
                }
                temporalWriteIndexRef.current = 0;
                temporalActiveCountRef.current = 0;
              }

              const writeIdx = temporalWriteIndexRef.current;
              pool[writeIdx].set(waveform);
              temporalWriteIndexRef.current = (writeIdx + 1) % temporalWindow;
              temporalActiveCountRef.current = Math.min(
                temporalWindow,
                temporalActiveCountRef.current + 1,
              );

              const activeFrames = activeTemporalFramesRef.current;
              const activeCount = temporalActiveCountRef.current;
              activeFrames.length = activeCount;
              for (let i = 0; i < activeCount; i++) {
                const idx =
                  (temporalWriteIndexRef.current - 1 - i + temporalWindow) %
                  temporalWindow;
                activeFrames[i] = pool[idx];
              }

              if (
                !renderWaveformRef.current ||
                renderWaveformRef.current.length !== waveform.length
              ) {
                renderWaveformRef.current = new Float32Array(waveform.length);
              }
              renderWaveformRef.current = averageTemporalWaveforms(
                activeFrames,
                renderWaveformRef.current,
                renderWaveformRef.current,
              );
            }
          }
        } else if (
          currentFrame &&
          (currentFrame.iq_data ? isPaused : true) &&
          (currentFrame.iq_data ||
            (currentFrame as any).waveform ||
            (currentFrame as any).data) &&
          (currentFrame !== lastProcessedDataRef.current ||
            powerScaleChanged ||
            fftWindowChanged)
        ) {
          let processedWaveform: Float32Array | undefined;

          if (currentFrame.iq_data) {
            // Paused: ingest once to avoid blank frames (file mode or first paused frame)
            processedWaveform = processIqToDbmSpectrum(
              currentFrame.iq_data,
              effectiveDbmOffsetDb,
              effectiveFftSize,
              fftWindow,
              spectrumOutputBufferRef.current ?? undefined,
            );
            spectrumOutputBufferRef.current = processedWaveform;
            previousFftWindowRef.current = fftWindow ?? "Rectangular";
          } else {
            // Handle pre-processed FFT data (playback mode)
            processedWaveform = ((currentFrame as any).waveform ||
              (currentFrame as any).data) as Float32Array;
          }

          // Validate waveform before processing
          if (!processedWaveform || processedWaveform.length === 0) {
            return;
          }

          waveformFloatRef.current = processedWaveform;
          lastProcessedDataRef.current = currentFrame;
          lastProcessedFrameSignatureRef.current =
            getLiveFrameSignature(currentFrame);
          lastRenderedPowerScaleRef.current = powerScale;

          const temporalWindow = getTemporalResolutionWindow(
            displayTemporalResolution,
            fftFrameRate,
          );
          if (temporalWindow <= 1) {
            const prev = renderWaveformRef.current;
            if (!prev || prev.length !== processedWaveform.length) {
              renderWaveformRef.current = new Float32Array(processedWaveform);
            } else {
              prev.fill(0);
              prev.set(processedWaveform);
            }
            temporalActiveCountRef.current = 0;
          } else {
            const pool = temporalFramePoolRef.current;
            if (
              pool.length !== temporalWindow ||
              (pool.length > 0 && pool[0].length !== processedWaveform.length)
            ) {
              pool.length = 0;
              for (let i = 0; i < temporalWindow; i++) {
                pool.push(new Float32Array(processedWaveform.length));
              }
              temporalWriteIndexRef.current = 0;
              temporalActiveCountRef.current = 0;
            }

            const writeIdx = temporalWriteIndexRef.current;
            pool[writeIdx].set(processedWaveform);
            temporalWriteIndexRef.current = (writeIdx + 1) % temporalWindow;
            temporalActiveCountRef.current = Math.min(
              temporalWindow,
              temporalActiveCountRef.current + 1,
            );

            const activeFrames = activeTemporalFramesRef.current;
            const activeCount = temporalActiveCountRef.current;
            activeFrames.length = activeCount;
            for (let i = 0; i < activeCount; i++) {
              const idx =
                (temporalWriteIndexRef.current - 1 - i + temporalWindow) %
                temporalWindow;
              activeFrames[i] = pool[idx];
            }

            if (
              !renderWaveformRef.current ||
              renderWaveformRef.current.length !== processedWaveform.length
            ) {
              renderWaveformRef.current = new Float32Array(
                processedWaveform.length,
              );
            }
            renderWaveformRef.current = averageTemporalWaveforms(
              activeFrames,
              renderWaveformRef.current,
              renderWaveformRef.current,
            );
          }

          pendingFftSizeChangeRef.current = false;
        }

        const waveform = renderWaveformRef.current;
        if (!waveform || waveform.length === 0) {
          if (isPaused && !waveform) {
            restoreWaveformFromStorageRef.current();
            if (
              !renderWaveformRef.current ||
              renderWaveformRef.current.length === 0
            ) {
              return;
            }
          } else {
            return;
          }
        }

        // Update waveform reference after potential restoration
        const currentWaveform = renderWaveformRef.current;

        if (
          currentWaveform &&
          currentWaveform.length > 0 &&
          frequencyRangeRef.current
        ) {
          const {
            slicedWaveform: rawSlicedWaveform,
            visualRange,
            clampedPan,
          } = getZoomedData(
            currentWaveform,
            frequencyRangeRef.current,
            vizZoomRef.current,
            vizPanOffsetRef.current,
          );

          // Sync clamped pan back to state if it drifted
          if (clampedPan !== vizPanOffsetRef.current) {
            setVizPanOffset(clampedPan);
          }

          const unifiedSourceWaveform = null;

          // Use unified GPU output (averaging/smoothing handled on GPU when enabled)
          const baseSpectrumWaveform =
            unifiedSourceWaveform ?? rawSlicedWaveform;
          let slicedWaveform = baseSpectrumWaveform;

          // CPU-side fallback for averaging/smoothing when unified GPU path isn't active
          if (!unifiedSourceWaveform) {
            if (fftAvgEnabledRef.current) {
              if (
                !fftProcessedBufferRef.current ||
                fftProcessedBufferRef.current.length !==
                  baseSpectrumWaveform.length
              ) {
                fftProcessedBufferRef.current = new Float32Array(
                  baseSpectrumWaveform.length,
                );
              }
              const processed = fftProcessedBufferRef.current;
              processed.set(baseSpectrumWaveform);

              // Disable FFT averaging to prevent noise floor animation when moving dB sliders
              // let prev = fftAvgBufferRef.current;
              // if (!prev || prev.length !== processed.length) {
              //   prev = new Float32Array(processed);
              //   fftAvgBufferRef.current = prev;
              // } else {
              //   const alpha = 0.2;
              //   for (let i = 0; i < processed.length; i++) {
              //     processed[i] = prev[i] * (1 - alpha) + processed[i] * alpha;
              //   }
              //   prev.set(processed);
              // }
              slicedWaveform = processed;
            }

            // Disable FFT smoothing to prevent noise floor animation when moving dB sliders
            // if (fftSmoothEnabledRef.current && slicedWaveform.length > 4) {
            //   if (
            //     !fftSmoothedBufferRef.current ||
            //     fftSmoothedBufferRef.current.length !== slicedWaveform.length
            //   ) {
            //     fftSmoothedBufferRef.current = new Float32Array(slicedWaveform.length);
            //   }
            //   const smoothed = fftSmoothedBufferRef.current;
            //   for (let i = 0; i < slicedWaveform.length; i++) {
            //     let sum = 0;
            //     let count = 0;
            //     for (
            //       let j = Math.max(0, i - 2);
            //       j <= Math.min(slicedWaveform.length - 1, i + 2);
            //       j++
            //     ) {
            //       sum += slicedWaveform[j];
            //       count++;
            //     }
            //     smoothed[i] = sum / count;
            //   }
            //   slicedWaveform = smoothed;
            // }
          }
          const currentTxSlider = txSliderRef.current as
            | (CanvasTxSliderState & {
                signalLabel?: string;
                powerDbm?: number;
              })
            | null;
          const bottomReservedPx = TX_SLIDER_ROW_HEIGHT;
          const markerOverlayOpacity =
            powerLineDbRef.current !== null ? 0.1 : 1;
          // Spectrum render (using unified hook)
          if (spectrumGpuCanvas) {
            drawSpectrum({
              canvas: spectrumGpuCanvas,
              webgpuEnabled: spectrumWebgpuEnabled,
              isInitializingWebGPU,
              device: webgpuDeviceRef.current,
              format: webgpuFormatRef.current,
              waveform: slicedWaveform,
              frequencyRange: visualRange,
              fftMin: activeScaleDbMinRef.current,
              fftMax: activeScaleDbMaxRef.current,
              powerScale: effectivePowerScaleRef.current,
              nodePreview: nodePreviewRef.current,
              gridOverlayRenderer: compact
                ? undefined
                : gridOverlayRendererRef.current,
              markersOverlayRenderer: compact
                ? undefined
                : markersOverlayRendererRef.current,
              spikesOverlayRenderer: spikesOverlayRendererRef.current,
              overlayDirty: overlayDirtyRef.current,
              centerFrequencyHz: centerFreqRef.current,
              isDeviceConnected,
              hardwareSampleRateHz,
              fftSize: effectiveFftSize,
              fftWindow,
              temporalResolution: displayTemporalResolution,
              reservedBottomPx: bottomReservedPx,
              fullCaptureRange: frequencyRangeRef.current,
              isIqRecordingActive: compact ? false : isIqRecordingActive,
              limitMarkers: compact ? [] : limitMarkers,
              showSpikeOverlay: showSpikeOverlayRef.current,
              demodFocusOverlay: liveDragSelectionRef.current
                ? {
                    centerFrequencyHz:
                      (liveDragSelectionRef.current.min +
                        liveDragSelectionRef.current.max) /
                      2,
                    halfBandwidthHz:
                      (liveDragSelectionRef.current.max -
                        liveDragSelectionRef.current.min) /
                      2,
                    alignment: bandwidthAlignment,
                  }
                : demodFocusOverlayRef.current,
              selectionOverlay: liveDragSelectionRef.current
                ? {
                    minFrequencyHz: liveDragSelectionRef.current.min,
                    maxFrequencyHz: liveDragSelectionRef.current.max,
                  }
                : selectionOverlayRef.current,
              txSlider: compact ? null : currentTxSlider,
              overlayOpacity: markerOverlayOpacity,
              canvasStatusRow: compact ? null : canvasStatusRow,
              onSpikeCount: (count) => {
                dispatch(setGpuSpikeCount(count));
              },
              lineColor: fftColorRef.current,
              fillColor: fillColorRef.current,
            });

            if (!hasRenderedSpectrumFrame) {
              setHasRenderedSpectrumFrame(true);
              onRenderableFrameChange?.(true);
            }
          }

          // Render overlays to 2D HTML canvas instead of WebGPU texture
          if (spectrumOverlayCanvas) {
            const ctx = spectrumOverlayCanvas.getContext("2d");
            if (ctx) {
              const dpr = window.devicePixelRatio || 1;
              const logicalW = spectrumOverlayCanvas.width / dpr;
              const logicalH = spectrumOverlayCanvas.height / dpr;

              const activeDemodFocus = liveDragSelectionRef.current
                ? {
                    centerFrequencyHz:
                      (liveDragSelectionRef.current.min +
                        liveDragSelectionRef.current.max) /
                      2,
                    halfBandwidthHz:
                      (liveDragSelectionRef.current.max -
                        liveDragSelectionRef.current.min) /
                      2,
                    alignment: bandwidthAlignment,
                  }
                : demodFocusOverlayRef.current;

              const activeSelection = liveDragSelectionRef.current
                ? {
                    minFrequencyHz: liveDragSelectionRef.current.min,
                    maxFrequencyHz: liveDragSelectionRef.current.max,
                  }
                : selectionOverlayRef.current;
              const rendersMarkersInWebGpuOverlay =
                !compact && !!markersOverlayRendererRef.current;

              if (
                !rendersMarkersInWebGpuOverlay &&
                !nodePreview &&
                centerFreqRef.current !== undefined
              ) {
                drawMarkersOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  visualRange,
                  centerFreqRef.current,
                  isDeviceConnected,
                  hardwareSampleRateHz,
                  frequencyRangeRef.current,
                  isIqRecordingActive,
                  compact ? [] : limitMarkers,
                  effectiveFftSize,
                  fftWindow,
                  displayTemporalResolution,
                  !currentTxSlider?.visible,
                  bottomReservedPx,
                  compact ? undefined : (canvasStatusRow ?? undefined),
                  markerOverlayOpacity,
                );
              }

              if (!rendersMarkersInWebGpuOverlay && activeDemodFocus) {
                drawDemodFocusOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  visualRange,
                  activeDemodFocus,
                  nodePreview,
                  bottomReservedPx,
                  markerOverlayOpacity,
                );
              }

              if (!rendersMarkersInWebGpuOverlay && activeSelection) {
                drawSelectionOverlayOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  visualRange,
                  activeSelection,
                  nodePreview,
                  bottomReservedPx,
                );
              }

              // Draw zoom markers at top (e.g. 500kHz)
              drawZoomMarkersOnContext(
                ctx,
                logicalW,
                logicalH,
                visualRange,
                frequencyRangeRef.current,
                bottomReservedPx,
                markerOverlayOpacity,
              );

              // Draw draggable horizontal power line
              if (powerLineDbRef.current !== null) {
                drawPowerLineOnContext(
                  ctx,
                  logicalW,
                  logicalH,
                  powerLineDbRef.current,
                  activeScaleDbMinRef.current,
                  activeScaleDbMaxRef.current,
                  effectivePowerScaleRef.current,
                  bottomReservedPx,
                  isPowerLineHeld ? " HOLD" : "",
                );
              }
            }
          }

          // Waterfall render (only push new lines when not paused AND new data is available)
          // Note: Unified FFT system provides its own waterfall texture for instant synchronization
          // This fallback waterfall rendering is kept for compatibility when unified FFT is not available
          if (
            webgpuEnabled &&
            webgpuDeviceRef.current &&
            webgpuFormatRef.current &&
            waterfallGpuCanvas
          ) {
            const dims = waterfallGpuDimsRef.current;
            if (
              shouldRenderWaterfallWithFrameOrRestore(
                !!dims,
                !!currentFrame,
                !!pendingWaterfallRestoreRef.current,
              )
            ) {
              const waterfallDims = dims!;
              const waterfallMotion = getWaterfallMotion({
                previousVisualRange: lastWaterfallVisualRangeRef.current,
                currentVisualRange: visualRange,
                textureWidth: 4096,
              });
              const shouldUpdateWaterfallRow =
                !isPaused &&
                (hasNewData || waterfallMotion.shouldPaintMotionRow);
              retuneDriftPxRef.current = waterfallMotion.driftBins;
              retuneSmearRef.current = 0;

              // Waterfall texture strategy: Always resample to constant 4096 bins.
              // This 'bakes' the zoom into each row permanently, avoiding WebGPU
              // texture resets when zoom changes. The shader handles the final
              // mapping from 4096 bins to display pixels.
              const FIXED_WATERFALL_BINS = 4096;
              // Ensure we have a persistent buffer for the fixed-width data
              if (
                !waterfallCappedBufferRef.current ||
                waterfallCappedBufferRef.current.length !== FIXED_WATERFALL_BINS
              ) {
                waterfallCappedBufferRef.current = new Float32Array(
                  FIXED_WATERFALL_BINS,
                );
              }
              const processed = waterfallCappedBufferRef.current;
              let waterfallBins: Float32Array = processed;

              // The visible waterfall must advance only with a complete row.
              // Async GPU readback can lag under load and caused ring-buffer
              // holes that showed up as black horizontal bars when paused.
              waterfallBins = peakResampleWaterfallRow(
                slicedWaveform,
                processed,
              );

              const rowsToDraw: Float32Array[] = [];
              let waterfallGpuRowBuffer: GPUBuffer | null = null;

              if (shouldUpdateWaterfallRow) {
                const previousWaterfallRow = lastWaterfallRowRef.current;
                if (
                  waterfallMotion.shouldPaintMotionRow &&
                  previousWaterfallRow?.length === waterfallBins.length
                ) {
                  waterfallGpuRowBuffer = computeWaterfallRetuneRow({
                    device: webgpuDeviceRef.current,
                    previous: previousWaterfallRow,
                    current: waterfallBins,
                    driftBins: waterfallMotion.driftBins,
                    progress: RETUNE_ROW_BLEND_PROGRESS,
                  });

                  if (
                    !retuneTransitionRowRef.current ||
                    retuneTransitionRowRef.current.length !==
                      waterfallBins.length
                  ) {
                    retuneTransitionRowRef.current = new Float32Array(
                      waterfallBins.length,
                    );
                  }
                  synthesizeWaterfallTransitionRow({
                    previous: previousWaterfallRow,
                    current: waterfallBins,
                    target: retuneTransitionRowRef.current,
                    driftBins: waterfallMotion.driftBins,
                    progress: RETUNE_ROW_BLEND_PROGRESS,
                  });
                  waterfallBins = retuneTransitionRowRef.current;
                }

                rowsToDraw.push(waterfallBins);

                // Cache the last row for pause state and snapshots
                if (
                  !lastWaterfallRowRef.current ||
                  lastWaterfallRowRef.current.length !== waterfallBins.length
                ) {
                  lastWaterfallRowRef.current = new Float32Array(
                    waterfallBins.length,
                  );
                  copyValidWaterfallRow(
                    waterfallBins,
                    lastWaterfallRowRef.current,
                    null,
                  );
                } else {
                  copyValidWaterfallRow(
                    waterfallBins,
                    lastWaterfallRowRef.current,
                    lastWaterfallRowRef.current,
                  );
                }

                // Accumulate history for heterodyning detection (ring buffer, 96 frames max)
                if (hasNewData) {
                  const maxHistory = 96;
                  const history = heterodyningHistoryRef.current;
                  if (history.length === 0) {
                    for (let i = 0; i < maxHistory; i++) {
                      history.push(new Float32Array(FIXED_WATERFALL_BINS));
                    }
                    heterodyningWriteIndexRef.current = 0;
                    heterodyningHistoryCountRef.current = 0;
                  }
                  const writeIdx = heterodyningWriteIndexRef.current;
                  history[writeIdx].set(waterfallBins);
                  heterodyningWriteIndexRef.current =
                    (writeIdx + 1) % maxHistory;
                  heterodyningHistoryCountRef.current = Math.min(
                    maxHistory,
                    heterodyningHistoryCountRef.current + 1,
                  );
                }
                lastWaterfallVisualRangeRef.current = { ...visualRange };
              } else {
                // Paused or no new data: reset drift and use cached row
                retuneDriftPxRef.current = 0;
                retuneSmearRef.current = 0;
                waterfallBins = lastWaterfallRowRef.current ?? processed;
                rowsToDraw.push(waterfallBins);
              }

              // Snapshot tracking: maintain a CPU-side copy of the waterfall texture
              // for session persistence. Always 4096 bins wide × RGBA.
              const textureBytesPerRow = FIXED_WATERFALL_BINS * 4;
              const textureByteSize = textureBytesPerRow * waterfallDims.height;
              if (
                !waterfallTextureSnapshotRef.current ||
                waterfallTextureSnapshotRef.current.length !== textureByteSize
              ) {
                const oldSnapshot = waterfallTextureSnapshotRef.current;
                const oldMeta = waterfallTextureMetaRef.current;

                const newSnapshot = new Uint8Array(textureByteSize);
                let newWriteRow = 0;

                if (oldSnapshot && oldMeta) {
                  // Repack the circular buffer by display age so the visible history
                  // stays in the same order after a height change. Matches WebGPU logic.
                  const prevH = oldMeta.height;
                  const needH = waterfallDims.height;
                  const prevRenderRow =
                    prevH > 0 ? (oldMeta.writeRow - 1 + prevH) % prevH : 0;
                  const nextRenderRow =
                    needH > 0 ? (oldMeta.writeRow - 1 + needH) % needH : 0;

                  for (let age = 0; age < needH; age++) {
                    const srcAge = Math.max(
                      0,
                      Math.min(prevH - 1, Math.floor((age * prevH) / needH)),
                    );
                    const srcY =
                      prevH > 0 ? (prevRenderRow - srcAge + prevH) % prevH : 0;
                    const dstY = (nextRenderRow - age + needH) % needH;

                    const srcOff = srcY * textureBytesPerRow;
                    const dstOff = dstY * textureBytesPerRow;
                    newSnapshot.set(
                      oldSnapshot.subarray(srcOff, srcOff + textureBytesPerRow),
                      dstOff,
                    );
                  }
                  newWriteRow = Math.min(oldMeta.writeRow, needH - 1);
                }

                waterfallTextureSnapshotRef.current = newSnapshot;
                waterfallTextureMetaRef.current = {
                  width: FIXED_WATERFALL_BINS,
                  height: waterfallDims.height,
                  writeRow: newWriteRow,
                };
              }
              const meta = waterfallTextureMetaRef.current;
              const snapshot = waterfallTextureSnapshotRef.current;
              const restoreTexture = resolvePendingWaterfallRestore({
                pendingRestore: pendingWaterfallRestoreRef.current,
                shouldUpdateWaterfallRow,
                hasRenderedRestore: restoredWaterfallRef.current,
              });

              // Sync restore data into CPU snapshot so auto-persist
              // doesn't overwrite restored history with an empty buffer.
              if (restoreTexture && meta && snapshot) {
                const restoreBytes = restoreTexture.data;
                const restoreW = restoreTexture.width;
                const restoreH = restoreTexture.height;
                if (
                  restoreW === FIXED_WATERFALL_BINS &&
                  restoreH === waterfallDims.height &&
                  restoreBytes.length === textureByteSize
                ) {
                  // Exact match — bulk copy
                  snapshot.set(restoreBytes);
                } else if (
                  restoreW === FIXED_WATERFALL_BINS &&
                  restoreBytes.length >= restoreW * restoreH * 4
                ) {
                  // Height may differ; repack chronologically to match WebGPU logic.
                  const prevH = restoreH;
                  const needH = waterfallDims.height;
                  const prevRenderRow =
                    prevH > 0
                      ? (restoreTexture.writeRow - 1 + prevH) % prevH
                      : 0;
                  const nextRenderRow =
                    needH > 0
                      ? (restoreTexture.writeRow - 1 + needH) % needH
                      : 0;

                  for (let age = 0; age < needH; age++) {
                    const srcAge = Math.max(
                      0,
                      Math.min(prevH - 1, Math.floor((age * prevH) / needH)),
                    );
                    const srcY =
                      prevH > 0 ? (prevRenderRow - srcAge + prevH) % prevH : 0;
                    const dstY = (nextRenderRow - age + needH) % needH;

                    const srcOff = srcY * textureBytesPerRow;
                    const dstOff = dstY * textureBytesPerRow;
                    snapshot.set(
                      restoreBytes.subarray(
                        srcOff,
                        srcOff + textureBytesPerRow,
                      ),
                      dstOff,
                    );
                  }
                }
                meta.writeRow = Math.max(
                  0,
                  Math.min(restoreTexture.writeRow, waterfallDims.height - 1),
                );
              }

              if (
                shouldUpdateWaterfallRow &&
                meta &&
                snapshot &&
                meta.width === FIXED_WATERFALL_BINS
              ) {
                for (const rowData of rowsToDraw) {
                  const rowBytes = new Uint8Array(
                    rowData.buffer,
                    rowData.byteOffset,
                    rowData.byteLength,
                  );
                  const row = meta.writeRow % waterfallDims.height;
                  const offset = row * textureBytesPerRow;
                  snapshot.set(rowBytes, offset);
                  meta.writeRow = (meta.writeRow + 1) % waterfallDims.height;
                }
                if (pendingWaterfallRestoreRef.current) {
                  pendingWaterfallRestoreRef.current = null;
                  restoredWaterfallRef.current = false;
                }

                const now = performance.now();
                if (
                  visualizerMachine &&
                  now - lastVisualizerAutoPersistAtRef.current > 250
                ) {
                  lastVisualizerAutoPersistAtRef.current = now;
                  visualizerMachine.persist(visualizerSessionKey, {
                    waveform: renderWaveformRef.current
                      ? new Float32Array(renderWaveformRef.current)
                      : null,
                    waterfallTextureSnapshot: new Uint8Array(snapshot),
                    waterfallTextureMeta: { ...meta },
                    waterfallBuffer: waterfallBufferRef.current
                      ? new Uint8ClampedArray(waterfallBufferRef.current)
                      : null,
                    waterfallDims: waterfallDimsRef.current
                      ? { ...waterfallDimsRef.current }
                      : null,
                  });
                }
              }

              const waterfallDevice = webgpuDeviceRef.current;
              const waterfallFormat = webgpuFormatRef.current;
              if (!waterfallDevice || !waterfallFormat) return;

              rowsToDraw.forEach((rowData, index) => {
                // Pass 4096 bins to hook — shader handles pixel mapping.
                drawWebGPUFIFOWaterfall({
                  canvas: waterfallGpuCanvas,
                  device: waterfallDevice,
                  format: waterfallFormat,
                  fftData:
                    waterfallGpuRowBuffer && index === rowsToDraw.length - 1
                      ? new Float32Array(0)
                      : rowData,
                  fftDataBuffer:
                    index === rowsToDraw.length - 1
                      ? (waterfallGpuRowBuffer ?? undefined)
                      : undefined,
                  fftMin: activeScaleDbMinRef.current,
                  fftMax: activeScaleDbMaxRef.current,
                  driftAmount: 0,
                  freeze: !shouldUpdateWaterfallRow,
                  restoreTexture: index === 0 ? restoreTexture : undefined,
                  wfSmooth: wfSmoothEnabledRef.current,
                  colormap: colormapRef.current,
                  colormapName: waterfallThemeRef.current,
                });
              });
              if (restoreTexture) {
                restoredWaterfallRef.current = true;
              }
            } else if (isPaused) {
              const restore = pendingWaterfallRestoreRef.current ?? undefined;
              const FIXED_WATERFALL_BINS = 4096;
              const targetWidth = restore?.width ?? FIXED_WATERFALL_BINS;

              let rowBuffer: Float32Array | null = null;
              if (targetWidth > 0) {
                rowBuffer = lastWaterfallRowRef.current;
                if (!rowBuffer || rowBuffer.length !== targetWidth) {
                  if (
                    !pausedWaterfallRowRef.current ||
                    pausedWaterfallRowRef.current.length !== targetWidth
                  ) {
                    pausedWaterfallRowRef.current = new Float32Array(
                      targetWidth,
                    );
                    pausedWaterfallRowRef.current.fill(-120);
                  } else {
                    pausedWaterfallRowRef.current.fill(-120);
                  }
                  restoredWaterfallRef.current = true;
                }
                rowBuffer = pausedWaterfallRowRef.current;
              }

              if (rowBuffer) {
                drawWebGPUFIFOWaterfall({
                  canvas: waterfallGpuCanvas,
                  device: webgpuDeviceRef.current!,
                  format: webgpuFormatRef.current!,
                  fftData: rowBuffer,
                  fftMin: activeScaleDbMinRef.current,
                  fftMax: activeScaleDbMaxRef.current,
                  driftAmount: retuneSmearRef.current,
                  freeze: true,
                  restoreTexture: restore,
                  colormap: colormapRef.current,
                  colormapName: waterfallThemeRef.current,
                });
              }
            }
          }
        }
      },
      [
        drawSpectrum,
        drawWebGPUFIFOWaterfall,
        computeWaterfallRetuneRow,
        isPaused,
        displayTemporalResolution,
        spectrumWebgpuEnabled,
        webgpuEnabled,
        webgpuDeviceRef,
        webgpuFormatRef,
        gridOverlayRendererRef,
        markersOverlayRendererRef,
        isDeviceConnected,
        spectrumGpuCanvasNode,
        waterfallGpuCanvasNode,
        drawLoadingPlaceholder,
        clearOverlayCanvas,
        placeholderErrorReason,
        isLoadingPlaceholder,
        hasRenderedSpectrumFrame,
        onRenderableFrameChange,
        dispatch,
        WATERFALL_PLACEHOLDER_FONT,
        fftFrameRate,
        fftWindow,
        frequencyRange,
        deviceProfile?.kind,
        deviceProfile?.is_rtl_sdr,
        deviceBackend,
        deviceName,
        drawMarkersOnContext,
        drawDemodFocusOnContext,
        drawSelectionOverlayOnContext,
        drawZoomMarkersOnContext,
        hardwareSampleRateHz,
        isIqRecordingActive,
        limitMarkers,
        compact,
        nodePreview,
        bandwidthAlignment,
        visualizerMachine,
        visualizerSessionKey,
        canvasStatusRow,
      ],
    );

    const onBecomeVisible = useCallback(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
    }, []);

    const { forceRender } = useFFTAnimation({
      isPaused,
      onRenderFrame,
      onBecomeVisible,
      targetFPS: fftFrameRate,
    });
    forceRenderRef.current = forceRender;

    // Effect: Cleanup placeholder. Most cleanup is handled by useFFTAnimation and other hooks.
    // Intentionally minimal - actual resources are managed by child hooks and their own cleanup.
    useEffect(() => {
      return () => {};
    }, []);

    // Effect: Temporal resolution changes alter accumulation cadence and need the
    // temporal/waterfall restore path. FFT window changes are handled separately
    // below so they only invalidate spectrum processing, not waterfall state.
    useEffect(() => {
      if (displayTemporalResolution === previousTemporalResolutionRef.current) {
        return;
      }

      previousTemporalResolutionRef.current = displayTemporalResolution;

      const hasPendingWaterfallRestore = !!pendingWaterfallRestoreRef.current;
      invalidateSpectrumProcessingCaches();
      if (!isPaused || !hasPendingWaterfallRestore) {
        pausedWaterfallRowRef.current = null;
        restoredWaterfallRef.current = false;
      }

      const currentWaveform = waveformFloatRef.current;
      if (currentWaveform && currentWaveform.length > 0) {
        renderWaveformRef.current = new Float32Array(currentWaveform);
      } else if (
        isPaused &&
        (dataRef.current?.iq_data ||
          (dataRef.current as any)?.waveform ||
          (dataRef.current as any)?.data)
      ) {
        // Trigger a re-process of paused I/Q data
        lastProcessedDataRef.current = null;
        lastProcessedFrameSignatureRef.current = null;
      }

      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      forceRender();
    }, [
      displayTemporalResolution,
      forceRender,
      invalidateSpectrumProcessingCaches,
      isPaused,
      dataRef,
    ]);

    // Effect: FFT window changes must reprocess the current frame immediately.
    // Do not clear waterfall rows/textures here; a new processed row will flow
    // through the normal render path without visually resetting the history.
    useEffect(() => {
      const currentFftWindow = fftWindow ?? "Rectangular";
      if (previousFftWindowRef.current === currentFftWindow) {
        return;
      }

      invalidateSpectrumProcessingCaches();
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      forceRender();
    }, [fftWindow, forceRender, invalidateSpectrumProcessingCaches]);

    // Effect: Trigger render when awaitingDeviceData changes (shows/hides loading placeholder)
    useEffect(() => {
      forceRender();
    }, [awaitingDeviceData, forceRender]);

    // Effect: Runs heterodyning detection when a new verify request comes in.
    // Deduplicates identical request IDs to avoid redundant analysis.
    useEffect(() => {
      if (!onHeterodyningAnalyzed) return;
      if (heterodyningVerifyRequestId <= 0) return;
      if (
        heterodyningVerifyRequestId === lastHeterodyningRequestIdRef.current
      ) {
        return;
      }

      lastHeterodyningRequestIdRef.current = heterodyningVerifyRequestId;

      const count = heterodyningHistoryCountRef.current;
      const history = heterodyningHistoryRef.current;
      const writeIdx = heterodyningWriteIndexRef.current;
      const maxHistory = 96;

      const activeList = activeHistoryRef.current;
      activeList.length = count;
      for (let i = 0; i < count; i++) {
        const idx = (writeIdx - count + i + maxHistory) % maxHistory;
        activeList[i] = history[idx];
      }

      onHeterodyningAnalyzed(detectHeterodyningFromHistory(activeList));
    }, [heterodyningVerifyRequestId, onHeterodyningAnalyzed]);

    // Effect: Toggle spike detection overlay. The spike hook owns persistence.
    useEffect(() => {
      overlayDirtyRef.current.spikes = true;
      forceRender();
    }, [showSpikeOverlay, forceRender, overlayDirtyRef]);

    // Selection updates can happen without new FFT data, so force the overlay
    // to repaint immediately when the live span range changes.
    useEffect(() => {
      overlayDirtyRef.current.markers = true;
      forceRender();
    }, [selectionRange, forceRender, overlayDirtyRef]);

    const { restoreWaveformFromStorage, ensurePausedFrame } = usePauseLogic({
      isPaused,
      renderWaveformRef,
      waveformFloatRef,
      waterfallBufferRef,
      waterfallDimsRef,
      dataRef,
      forceRender,
      snapshotScope: visualizerSessionKey,
    });

    restoreWaveformFromStorageRef.current = restoreWaveformFromStorage;

    // Build a serializable snapshot of current visualizer state for session persistence.
    // Includes waveform data, waterfall texture, and dimensional metadata.
    const buildVisualizerSessionSnapshot =
      useCallback((): FFTVisualizerSnapshot | null => {
        const waveform = renderWaveformRef.current ?? waveformFloatRef.current;
        const waterfallTextureSnapshot = waterfallTextureSnapshotRef.current;
        const waterfallTextureMeta = waterfallTextureMetaRef.current;
        const waterfallBuffer = waterfallBufferRef.current;

        if (
          !waveform &&
          !waterfallTextureSnapshot &&
          !waterfallTextureMeta &&
          !waterfallBuffer &&
          !waterfallDimsRef.current
        ) {
          return null;
        }

        return {
          waveform: waveform ? new Float32Array(waveform) : null,
          waterfallTextureSnapshot: waterfallTextureSnapshot
            ? new Uint8Array(waterfallTextureSnapshot)
            : null,
          waterfallTextureMeta: waterfallTextureMeta
            ? { ...waterfallTextureMeta }
            : null,
          waterfallBuffer: waterfallBuffer
            ? new Uint8ClampedArray(waterfallBuffer)
            : null,
          waterfallDims: waterfallDimsRef.current
            ? { ...waterfallDimsRef.current }
            : null,
        };
      }, []);

    // Restore visualizer state from a previously saved snapshot.
    // Handles three data formats: waveform, legacy waterfall buffer, and WebGPU texture snapshot.
    const restoreVisualizerSessionSnapshot = useCallback(
      (snapshot: FFTVisualizerSnapshot | null) => {
        if (!snapshot) {
          return false;
        }

        let restored = false;

        if (snapshot.waveform && snapshot.waveform.length > 0) {
          const waveform = new Float32Array(snapshot.waveform);
          renderWaveformRef.current = waveform;
          waveformFloatRef.current = new Float32Array(snapshot.waveform);
          restored = true;
        }

        // Legacy waterfall buffer path (2D canvas mode)
        if (snapshot.waterfallBuffer && snapshot.waterfallDims) {
          waterfallBufferRef.current = new Uint8ClampedArray(
            snapshot.waterfallBuffer,
          );
          waterfallDimsRef.current = { ...snapshot.waterfallDims };
          restored = true;
        }

        // WebGPU texture snapshot path (modern mode)
        if (
          snapshot.waterfallTextureSnapshot &&
          snapshot.waterfallTextureMeta
        ) {
          waterfallTextureSnapshotRef.current = new Uint8Array(
            snapshot.waterfallTextureSnapshot,
          );
          waterfallTextureMetaRef.current = {
            ...snapshot.waterfallTextureMeta,
          };
          pendingWaterfallRestoreRef.current = {
            data: new Uint8Array(snapshot.waterfallTextureSnapshot),
            width: snapshot.waterfallTextureMeta.width,
            height: snapshot.waterfallTextureMeta.height,
            writeRow: snapshot.waterfallTextureMeta.writeRow,
          };
          restoredWaterfallRef.current = false;
          restored = true;
        }

        return restored;
      },
      [],
    );

    const persistVisualizerSession = useCallback(() => {
      if (!visualizerMachine) {
        return;
      }

      visualizerMachine.persist(
        visualizerSessionKey,
        buildVisualizerSessionSnapshot(),
      );
    }, [
      buildVisualizerSessionSnapshot,
      visualizerMachine,
      visualizerSessionKey,
    ]);

    const clearLocalVisualizerSession = useCallback(() => {
      cleanupWebGPUFIFOWaterfall();
      waterfallBufferRef.current = null;
      waterfallCappedBufferRef.current = null;
      waterfallTextureSnapshotRef.current = null;
      waterfallTextureMetaRef.current = null;
      lastWaterfallRowRef.current = null;
      pausedWaterfallRowRef.current = null;
      retuneTransitionRowRef.current = null;
      pendingWaterfallRestoreRef.current = null;
      restoredWaterfallRef.current = false;
      heterodyningHistoryRef.current = [];
      heterodyningWriteIndexRef.current = 0;
      heterodyningHistoryCountRef.current = 0;
      activeHistoryRef.current = [];
      retuneSmearRef.current = 0;
      retuneDriftPxRef.current = 0;
      lastWaterfallVisualRangeRef.current = null;
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      renderWaveformRef.current = null;
      waveformFloatRef.current = null;
      fullChannelWaveformRef.current = null;
      fullChannelRangeRef.current = null;
      frameBufferRef.current = [];
      clearOverlayCanvas(waterfallOverlayCanvasNode);
    }, [
      cleanupWebGPUFIFOWaterfall,
      clearOverlayCanvas,
      waterfallOverlayCanvasNode,
    ]);

    useEffect(() => {
      const previousSessionKey = activeVisualizerSessionKeyRef.current;
      if (previousSessionKey === visualizerSessionKey) {
        return;
      }

      visualizerMachine?.persist(
        previousSessionKey,
        buildVisualizerSessionSnapshot(),
      );
      clearLocalVisualizerSession();
      activeVisualizerSessionKeyRef.current = visualizerSessionKey;

      const restoredFromMachine = restoreVisualizerSessionSnapshot(
        visualizerMachine?.restore(visualizerSessionKey) ?? null,
      );
      if (restoredFromMachine) {
        forceRenderRef.current?.();
      }
    }, [
      buildVisualizerSessionSnapshot,
      clearLocalVisualizerSession,
      restoreVisualizerSessionSnapshot,
      visualizerMachine,
      visualizerSessionKey,
    ]);

    // Effect: On mount: restore visualizer state from machine if available.
    // On unmount: persist current state to machine and cleanup resources.
    useEffect(() => {
      const restoredFromMachine = restoreVisualizerSessionSnapshot(
        latestVisualizerMachineRef.current?.restore(
          latestVisualizerSessionKeyRef.current,
        ) ?? null,
      );
      if (restoredFromMachine) {
        forceRenderRef.current?.();
      }

      return () => {
        latestVisualizerMachineRef.current?.persist(
          latestVisualizerSessionKeyRef.current,
          buildVisualizerSessionSnapshot(),
        );
        cleanupSpectrum();
        cleanupWebGPUFIFOWaterfall();
        cleanupWaterfallRetuneCompute();
      };
    }, [
      buildVisualizerSessionSnapshot,
      cleanupWebGPUFIFOWaterfall,
      cleanupWaterfallRetuneCompute,
      cleanupSpectrum,
      restoreVisualizerSessionSnapshot,
    ]);

    // Effect: When hardware frequency range changes, invalidate live caches.
    // While paused, keep the cached waveform intact so a channel/zoom change
    // redraws the frozen frame instead of rebuilding from a transient frame.
    useEffect(() => {
      const prevRange = frequencyRangeRef.current;
      frequencyRangeRef.current = renderableFrequencyRange;

      if (
        renderableFrequencyRange &&
        prevRange &&
        (prevRange.min !== renderableFrequencyRange.min ||
          prevRange.max !== renderableFrequencyRange.max)
      ) {
        lastProcessedDataRef.current = null;
        lastProcessedFrameSignatureRef.current = null;
        frameBufferRef.current = [];

        if (!isPaused) {
          renderWaveformRef.current = null;
          waveformFloatRef.current = null;
          fullChannelWaveformRef.current = null;
          fullChannelRangeRef.current = null;
        }
      }

      if (isPaused) {
        forceRender();
      }
    }, [renderableFrequencyRange, isPaused, forceRender]);

    // Effect: Tracks when new data frames arrive while paused.
    // Uses a polling interval instead of dataFrameCounter to avoid triggering
    // React re-renders of the entire FFTCanvas component on every WebSocket frame.
    // The live (non-paused) case is already handled by useFFTAnimation's rAF loop.
    useEffect(() => {
      if (!isPaused) return;

      const id = setInterval(() => {
        const currentData = dataRef.current;
        const currentFrame = getLatestLiveFrame(currentData);
        const hasData = !!(
          currentFrame &&
          (currentFrame.iq_data ||
            (currentFrame as any).waveform ||
            (currentFrame as any).data)
        );

        if (hasData && currentFrame !== lastIncomingFrameRef.current) {
          lastIncomingFrameRef.current = currentFrame;
          forceRender();
        }

        if (!hasData) {
          lastIncomingFrameRef.current = null;
        }
      }, 100); // Check 10x/sec during pause — plenty fast for manual frame stepping

      return () => clearInterval(id);
    }, [dataRef, isPaused, forceRender]);

    // Effect: Manages canvas dimensions, DPR scaling, and overlay dirty flags on resize.
    // Uses both window resize event and ResizeObserver for container changes.
    useEffect(() => {
      // Use the state value directly as a fallback — the ref may not be
      // synced yet when this effect first runs after a canvas mount.
      const gpuCanvas = spectrumGpuCanvasRef.current ?? spectrumGpuCanvasNode;

      const handleResize = () => {
        const dpr = window.devicePixelRatio || 1;

        // Use offsetWidth/offsetHeight instead of getBoundingClientRect() —
        // getBoundingClientRect() returns post-CSS-transform visual dimensions,
        // but React Flow applies transform: scale(zoom) to the viewport. Using
        // offset* gives us the actual CSS layout dimensions the canvas needs.
        const getLayoutSize = (el: HTMLElement | null | undefined) => {
          if (!el) return null;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (w > 0 && h > 0) return { width: w, height: h };
          return null;
        };

        const spectrumRect =
          getLayoutSize(gpuCanvas?.parentElement) ??
          getLayoutSize(spectrumContainerRef.current);
        const waterfallRect = getLayoutSize(
          waterfallGpuCanvasRef.current?.parentElement,
        );

        if (spectrumRect && spectrumOverlayCanvasRef.current) {
          const canvas = spectrumOverlayCanvasRef.current;
          const targetW = spectrumRect.width * dpr;
          const targetH = spectrumRect.height * dpr;
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            canvas.style.width = `${spectrumRect.width}px`;
            canvas.style.height = `${spectrumRect.height}px`;
            canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }

        if (spectrumRect && spectrumWebgpuEnabled && gpuCanvas) {
          const targetW = Math.max(1, Math.round(spectrumRect.width * dpr));
          const targetH = Math.max(1, Math.round(spectrumRect.height * dpr));
          if (gpuCanvas.width !== targetW || gpuCanvas.height !== targetH) {
            gpuCanvas.width = targetW;
            gpuCanvas.height = targetH;
            gpuCanvas.style.width = `${spectrumRect.width}px`;
            gpuCanvas.style.height = `${spectrumRect.height}px`;
          }

          spectrumWidthRef.current = spectrumRect.width;
          spectrumHeightRef.current = spectrumRect.height;
          overlayDirtyRef.current.grid = true;
          overlayDirtyRef.current.markers = true;
        }

        if (waterfallRect && waterfallOverlayCanvasRef.current) {
          const canvas = waterfallOverlayCanvasRef.current;
          const targetW = waterfallRect.width * dpr;
          const targetH = waterfallRect.height * dpr;
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            canvas.style.width = `${waterfallRect.width}px`;
            canvas.style.height = `${waterfallRect.height}px`;
            canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }

        if (waterfallRect && waterfallGpuCanvasRef.current) {
          const canvas = waterfallGpuCanvasRef.current;
          const targetW = Math.max(1, Math.round(waterfallRect.width * dpr));
          const targetH = Math.max(1, Math.round(waterfallRect.height * dpr));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            canvas.style.width = `${waterfallRect.width}px`;
            canvas.style.height = `${waterfallRect.height}px`;
          }

          const marginX = Math.round(40 * dpr);
          const marginY = Math.round(8 * dpr);
          const displayWidth = Math.max(
            1,
            Math.round(waterfallRect.width * dpr - marginX * 2),
          );
          const displayHeight = Math.max(
            1,
            Math.round(waterfallRect.height * dpr - marginY * 2),
          );
          if (waterfallDataWidthRef.current !== displayWidth) {
            waterfallDataWidthRef.current = displayWidth;
          }
          const dataWidth = waterfallDataWidthRef.current;
          waterfallGpuDimsRef.current = {
            width: dataWidth,
            height: displayHeight,
          };
        }

        if (isPaused) {
          ensurePausedFrame();
        }

        forceRenderRef.current?.();
      };

      handleResize();
      window.addEventListener("resize", handleResize);

      const resizeObserver = new ResizeObserver(() => handleResize());
      const spectrumParent = gpuCanvas?.parentElement;
      const waterfallParent = waterfallGpuCanvasRef.current?.parentElement;
      if (spectrumParent) resizeObserver.observe(spectrumParent);
      if (waterfallParent) resizeObserver.observe(waterfallParent);
      // Also observe the spectrumContainerRef itself — in nodePreview mode
      // the canvas parent may not be available when the effect first runs
      // (React Flow defers node layout), so we watch the container directly.
      const containerEl = spectrumContainerRef.current;
      if (containerEl && containerEl !== spectrumParent) {
        resizeObserver.observe(containerEl);
      }

      return () => {
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
      };
    }, [
      spectrumWebgpuEnabled,
      isPaused,
      ensurePausedFrame,
      spectrumGpuCanvasNode,
      spectrumOverlayCanvasNode,
      waterfallGpuCanvasNode,
      waterfallOverlayCanvasNode,
    ]);

    // Effect: Periodic memory cleanup (every 30s). Returns oversized buffers to pool
    // and clears stale waveform data. Skips cleanup when paused to preserve snapshot state.
    useEffect(() => {
      const cleanupInterval = setInterval(() => {
        if (isPaused) return;

        if (waterfallBufferRef.current && waterfallDimsRef.current) {
          const { width, height } = waterfallDimsRef.current;
          const expectedSize = width * height * 4;
          if (waterfallBufferRef.current.length > expectedSize * 1.5) {
            returnBufferToPool(waterfallBufferRef.current);
            waterfallBufferRef.current = getBufferFromPool(expectedSize);
          }
        }

        const currentFrameForCleanup = getLatestLiveFrame(dataRef.current);
        if (
          waveformFloatRef.current &&
          !currentFrameForCleanup?.iq_data &&
          !(currentFrameForCleanup as any)?.waveform &&
          !(currentFrameForCleanup as any)?.data
        ) {
          waveformFloatRef.current = null;
        }
      }, 30000);

      return () => clearInterval(cleanupInterval);
    }, [
      dataRef,
      waterfallDimsRef,
      returnBufferToPool,
      getBufferFromPool,
      isPaused,
    ]);

    // Effect: When paused with WebGPU becoming ready, trigger a render to show
    // the restored/snapshot state on the newly initialized canvas.
    useEffect(() => {
      if (!isPaused) return;
      if (!webgpuEnabled) return;
      if (!webgpuDeviceRef.current || !webgpuFormatRef.current) return;
      forceRender();
    }, [isPaused, webgpuEnabled, forceRender]);

    // Effect: When visualization parameters change (dB limits, zoom, pan),
    // mark overlays dirty and trigger paused re-render to update immediately.
    useEffect(() => {
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      if (isPaused) {
        forceRender();
      }
    }, [
      vizDbMin,
      vizDbMax,
      currentVizZoom,
      vizPanOffset,
      isPaused,
      forceRender,
    ]);

    // Effect: Handles power scale (dB vs dBm) switches separately for immediate updates.
    // Preserves render buffers to redraw from existing IQ frame rather than showing blank.
    useEffect(() => {
      if (previousPowerScaleRef.current === effectivePowerScale) {
        return;
      }
      previousPowerScaleRef.current = effectivePowerScale;
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      lastRenderedPowerScaleRef.current = null;
      // Keep render buffers intact so the new power scale can redraw immediately
      // from the existing live IQ frame instead of flashing a blank placeholder.
      overlayDirtyRef.current.grid = true;
      overlayDirtyRef.current.markers = true;
      if (isPaused) {
        forceRender();
      }
    }, [effectivePowerScale, isPaused, forceRender]);

    // Effect: When FFT Window or Temporal Resolution changes, re-process the frame
    // to apply the new windowing function or averaging window.
    useEffect(() => {
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      if (isPaused) {
        forceRender();
      }
    }, [fftWindow, displayTemporalResolution, isPaused, forceRender]);

    // Effect: When FFT size changes, drop the cached processed frame so the
    // next render recomputes at the newly selected resolution.
    useEffect(() => {
      if (previousFftSizeRef.current === effectiveFftSize) {
        return;
      }

      previousFftSizeRef.current = effectiveFftSize;
      lastProcessedDataRef.current = null;
      lastProcessedFrameSignatureRef.current = null;
      pendingFftSizeChangeRef.current = true;
    }, [effectiveFftSize, isPaused, forceRender]);

    const buildSnapshotData = useCallback((): SnapshotData | null => {
      const waveform = renderWaveformRef.current;
      const frequencyRangeCurrent = frequencyRangeRef.current;
      if (!waveform || waveform.length === 0 || !frequencyRangeCurrent) {
        return null;
      }

      return {
        waveform: new Float32Array(waveform),
        fullChannelWaveform:
          !isRtlSdr && fullChannelWaveformRef.current
            ? new Float32Array(fullChannelWaveformRef.current)
            : null,
        frequencyRange: { ...frequencyRangeCurrent },
        dbMin: roundDbValue(vizDbMinRef.current),
        dbMax: roundDbValue(vizDbMaxRef.current),
        fftSize: effectiveFftSize,
        fftWindow: fftWindow ?? "Rectangular",
        centerFrequencyHz: centerFreqRef.current,
        isDeviceConnected,
        vizZoom: vizZoomRef.current,
        vizPanOffset: vizPanOffsetRef.current,
        waterfallTextureSnapshot: waterfallTextureSnapshotRef.current
          ? new Uint8Array(waterfallTextureSnapshotRef.current)
          : null,
        waterfallTextureMeta: waterfallTextureMetaRef.current
          ? { ...waterfallTextureMetaRef.current }
          : null,
        waterfallBuffer: waterfallBufferRef.current
          ? new Uint8ClampedArray(waterfallBufferRef.current)
          : null,
        waterfallDims: waterfallDimsRef.current
          ? { ...waterfallDimsRef.current }
          : null,
        webgpuEnabled,
        hardwareSampleRateHz,
        isIqRecordingActive,
        colormap: colormap || [],
        demodFocusOverlay: demodFocusOverlayRef.current,
        activeSignalArea: _activeSignalArea,
      };
    }, [
      colormap,
      effectiveFftSize,
      fftWindow,
      hardwareSampleRateHz,
      isDeviceConnected,
      isIqRecordingActive,
      isRtlSdr,
      webgpuEnabled,
      _activeSignalArea,
    ]);

    const getCompositeSnapshot = useCallback(() => {
      const spectrumCanvas = spectrumGpuCanvasRef.current;
      const waterfallCanvas = waterfallGpuCanvasRef.current;

      if (!spectrumCanvas) {
        return null;
      }

      const width = spectrumCanvas.width;
      const waterfallHeight = waterfallCanvas?.height ?? 0;
      const height = spectrumCanvas.height + waterfallHeight;
      const compositeCanvas = document.createElement("canvas");
      compositeCanvas.width = width;
      compositeCanvas.height = height;
      const ctx = compositeCanvas.getContext("2d");
      if (!ctx) {
        return null;
      }

      const srcSpectrum =
        (spectrumCanvas as any)._lastFrameCanvas || spectrumCanvas;
      ctx.drawImage(srcSpectrum, 0, 0);
      if (waterfallCanvas) {
        const srcWaterfall =
          (waterfallCanvas as any)._lastFrameCanvas || waterfallCanvas;
        ctx.drawImage(srcWaterfall, 0, spectrumCanvas.height);
      }

      return {
        dataUrl: compositeCanvas.toDataURL("image/png"),
        width,
        height,
      };
    }, [spectrumWebgpuEnabled, webgpuEnabled]);

    useImperativeHandle(
      ref,
      () => ({
        getSpectrumCanvas: () => spectrumGpuCanvasRef.current,
        getWaterfallCanvas: () => waterfallGpuCanvasRef.current,
        getSpectrumOverlayCanvas: () => spectrumOverlayCanvasRef.current,
        getWaterfallOverlayCanvas: () => waterfallOverlayCanvasRef.current,
        triggerSnapshotRender: () => {
          forceRender();
        },
        getSnapshotData: buildSnapshotData,
        getCompositeSnapshot,
      }),
      [
        spectrumWebgpuEnabled,
        webgpuEnabled,
        buildSnapshotData,
        getCompositeSnapshot,
      ],
    );

    return (
      <Suspense fallback={<div>Loading FFT visualization…</div>}>
        {nodePreview ? (
          <NodePreviewCanvasWrapper
            ref={spectrumContainerRef}
            style={NODE_PREVIEW_BACKGROUND_STYLE}
          >
            {canvasPlaceholderState && (
              <CanvasPlaceholder state={canvasPlaceholderState} />
            )}
            {!isInitializingWebGPU && (
              <CanvasLayer
                ref={setSpectrumGpuCanvasNode}
                id="fft-spectrum-canvas-webgpu"
              />
            )}
            <CanvasLayer
              ref={_setSpectrumOverlayCanvasNode}
              id="fft-spectrum-canvas-overlay"
            />
            {heterodyningHighlightedBins.length > 0 && (
              <HighlightOverlay>
                {heterodyningHighlightedBins.map((bin) => (
                  <HighlightBand
                    key={`spectrum-highlight-${bin.start}-${bin.end}`}
                    $left={Math.max(0, Math.min(100, bin.start * 100))}
                    $width={Math.max(
                      0.2,
                      Math.min(100, (bin.end - bin.start) * 100),
                    )}
                  />
                ))}
              </HighlightOverlay>
            )}
          </NodePreviewCanvasWrapper>
        ) : (
          <VisualizerContainer
            style={compact ? COMPACT_VISUALIZER_STYLE : EMPTY_STYLE}
          >
            <VisualizerContent
              style={compact ? COMPACT_VISUALIZER_CONTENT_STYLE : EMPTY_STYLE}
            >
              <SpectrumSection>
                {!compact && (
                  <SectionTitleRow>
                    <SectionTitle>
                      FFT Signal Display {isPaused && "(Paused)"}
                    </SectionTitle>
                    {headerActionContent && (
                      <SectionTitleActions
                        data-disabled={!!canvasPlaceholderState}
                      >
                        {headerActionContent}
                      </SectionTitleActions>
                    )}
                  </SectionTitleRow>
                )}
                <SpectrumRow>
                  <CanvasWrapper
                    ref={spectrumContainerRef}
                    onDoubleClick={onCenterFrequencyDoubleClick}
                  >
                    {canvasPlaceholderState && (
                      <CanvasPlaceholder state={canvasPlaceholderState} />
                    )}
                    {!isInitializingWebGPU && (
                      <CanvasLayer
                        ref={setSpectrumGpuCanvasNode}
                        id="fft-spectrum-canvas-webgpu"
                      />
                    )}
                    <CanvasLayer
                      ref={_setSpectrumOverlayCanvasNode}
                      id="fft-spectrum-canvas-overlay"
                    />
                    {heterodyningHighlightedBins.length > 0 && (
                      <HighlightOverlay>
                        {heterodyningHighlightedBins.map((bin) => (
                          <HighlightBand
                            key={`spectrum-highlight-${bin.start}-${bin.end}`}
                            $left={Math.max(0, Math.min(100, bin.start * 100))}
                            $width={Math.max(
                              0.2,
                              Math.min(100, (bin.end - bin.start) * 100),
                            )}
                          />
                        ))}
                      </HighlightOverlay>
                    )}
                    {selectionTooltipText && selectionMode === "range" && (
                      <SelectionTooltip>
                        <strong>Selection</strong>
                        <span ref={tooltipSpanRef}>
                          Span: {selectionTooltipText.spanHz} Hz
                        </span>
                      </SelectionTooltip>
                    )}
                    {txSliderVisualMetrics && !compact ? (
                      <TxSliderVisualRow data-testid="tx-slider-visual-row">
                        <TxSliderVisualLabel>
                          <TxSliderLockButton
                            type="button"
                            onClick={() =>
                              setIsTxSliderLocked((value) => !value)
                            }
                            aria-pressed={isTxSliderLocked}
                            aria-label={
                              isTxSliderLocked
                                ? "Unlock Tx slider"
                                : "Lock Tx slider"
                            }
                            title={
                              isTxSliderLocked
                                ? "Unlock Tx slider"
                                : "Lock Tx slider"
                            }
                          >
                            {isTxSliderLocked ? (
                              <Lock size={10} strokeWidth={2.5} />
                            ) : (
                              <Unlock size={10} strokeWidth={2.5} />
                            )}
                          </TxSliderLockButton>
                          <div
                            style={{
                              position: "relative",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            {isTransmittingGlobal && <TxBlinkingDot />}
                            Tx
                          </div>
                        </TxSliderVisualLabel>
                        <TxSliderVisualTrack>
                          <TxSliderVisualBase />
                          <TxSliderVisualBand
                            $width={txSliderVisualMetrics.width}
                            $centerLeft={txSliderVisualMetrics.centerLeft}
                            $isTransmitting={isTransmittingGlobal}
                          />
                          {!txSliderVisualMetrics.isOffScreen && (
                            <>
                              <TxSliderVisualCenterFrequencyText
                                $left={txSliderVisualMetrics.centerLeft}
                                $isTransmitting={isTransmittingGlobal}
                                $isLocked={isTxSliderLocked}
                              >
                                {isTxSliderLocked ? (
                                  <TxSliderCenterLockIcon aria-hidden="true">
                                    <Lock size={10} strokeWidth={2.5} />
                                  </TxSliderCenterLockIcon>
                                ) : null}
                                {txSliderVisualMetrics.centerHzFormatted}
                              </TxSliderVisualCenterFrequencyText>
                              <TxSliderVisualText
                                $left={txSliderVisualMetrics.centerLeft}
                                $isTransmitting={isTransmittingGlobal}
                              >
                                <span>
                                  {txSliderVisualMetrics.bandwidthFormatted}
                                </span>
                                {txSliderVisualMetrics.powerLabel ? (
                                  <TxSliderVisualPower
                                    $isTransmitting={isTransmittingGlobal}
                                  >
                                    {"·"}
                                    {txSliderVisualMetrics.powerLabel}
                                  </TxSliderVisualPower>
                                ) : null}
                              </TxSliderVisualText>
                            </>
                          )}
                          {txSliderVisualMetrics.isOffScreen &&
                            txSliderVisualMetrics.offScreenDirection && (
                              <TxSliderVisualOffScreenIndicator
                                type="button"
                                $direction={
                                  txSliderVisualMetrics.offScreenDirection
                                }
                                $isTransmitting={isTransmittingGlobal}
                                onClick={handleOffscreenIndicatorClick}
                              >
                                {txSliderVisualMetrics.offScreenDirection ===
                                "left"
                                  ? "←"
                                  : ""}{" "}
                                {txSliderVisualMetrics.centerHzFormatted} ·{" "}
                                {txSliderVisualMetrics.powerLabel ?? "Unknown"}{" "}
                                · {txSliderVisualMetrics.bandwidthFormatted}{" "}
                                {txSliderVisualMetrics.offScreenDirection ===
                                "right"
                                  ? "→"
                                  : ""}
                              </TxSliderVisualOffScreenIndicator>
                            )}
                        </TxSliderVisualTrack>
                        <span aria-hidden="true" />
                      </TxSliderVisualRow>
                    ) : null}
                    {txSliderTooltipContent ? (
                      <TxSliderInfoLayer>
                        <Tooltip
                          title="Tx Slider"
                          content={txSliderTooltipContent}
                          trigger={
                            <TxInfoTrigger type="button">i</TxInfoTrigger>
                          }
                        />
                      </TxSliderInfoLayer>
                    ) : null}
                  </CanvasWrapper>
                </SpectrumRow>
              </SpectrumSection>
            </VisualizerContent>
          </VisualizerContainer>
        )}
      </Suspense>
    );
  }),
);

FFTCanvas.displayName = "FFTCanvas";

export default FFTCanvas;
