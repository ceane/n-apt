import React, {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import styled from "styled-components";
import {
  fileFrameRuntime,
  liveSourceFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  FIFOWaterfall,
  VisualizerSliders,
  newestIqWindow,
} from "@n-apt/spectrum/public/FIFOWaterfall";
import {
  setAutoZoomStability,
  setVizZoomFloor,
  setVizZoomFloorPan,
  useAppDispatch,
  useAppSelector,
} from "@n-apt/redux";
import { setFrequencyRange } from "@n-apt/redux/slices/spectrumSlice";
import { setWaterfallTheme } from "@n-apt/redux/slices/themeSlice";
import { sendFrequencyRange } from "@n-apt/redux/thunks/websocketThunks";
import {
  Brush,
  ListFilter,
  Lock,
  SquareDashed,
  Trash2,
  Unlock,
  Zap,
} from "lucide-react";
import { EditableCenterFrequency } from "@n-apt/ui/EditableCenterFrequency";
import { Popover } from "@n-apt/ui/Popover";
import { useWasmSimdMath } from "@n-apt/spectrum/public/useWasmSimdMath";
import {
  clampCenteredFrequencyRange,
  formatFrequency,
  getFrequencyRangeCenterHz,
} from "@n-apt/math/frequency";
import { Slider } from "@n-apt/ui/Slider";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import { resampleNearestInto } from "@n-apt/math/resampleNearest";
import { getFilePlaceholderState } from "@n-apt/app/infrastructure/io/filePlaceholderState";
import { isFilePlaybackPaused } from "@n-apt/spectrum/public/liveSourceLifecycle";
import { getSourcePresentationSessionKey } from "@n-apt/spectrum/public/liveSourceLifecycle";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import { Vfo } from "@n-apt/layout/vfo/Vfo";
import { mapDisplayFrequencyToSource } from "@n-apt/math/basebandMirror";
import { selectArrayOrEmpty } from "@n-apt/redux/selectors/stableSelectorDefaults";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import type { FrequencyRange } from "@n-apt/consts/types";
import { sourceSpectrumRuntime } from "@n-apt/app/infrastructure/visualization/sourceVisualizationRuntime";
import { isTxStandbyPreviewSource } from "@n-apt/spectrum/public/liveSourceLifecycle";
import { sourceVisualizationRuntime as liveIqRuntime } from "@n-apt/redux/middleware/websocketMiddleware";
import {
  DEFAULT_WATERFALL_BIN_SUBSET,
  type WaterfallBinSubset,
} from "@n-apt/spectrum/public/waterfallBinSubset";
import {
  getVisualizerDefaultDbLimits,
  VISUALIZER_DEFAULT_ZOOM,
  VISUALIZER_MAX_ZOOM,
} from "@n-apt/consts/visualizerControls";

interface WaterfallNodeProps {
  data: {
    waterfallOptions: boolean;
    label: string;
    showMiniVfo?: boolean;
    miniVfoPosition?: "top" | "bottom";
    sourceRole?: "rx" | "tx";
    sourceBindingGroup?: string;
    analysisOptions?: boolean;
  };
}

const FLOW_WATERFALL_FFT_SIZE = 4096;
// Waterfalls are pixel-width displays. Running a 65k-point FFT for every
// scrolling row wastes work when the node is only a few hundred pixels wide.
// Keep the full configured FFT for FFTNode and use this visual-resolution cap
// for the waterfall path.
const MAX_WATERFALL_FFT_SIZE = FLOW_WATERFALL_FFT_SIZE;

export const getWaterfallNodeFrequencyRange = ({
  sourceRole,
  fallbackRange,
  expectedCenterFrequencyHz,
  expectedSampleRateHz,
  frame,
  allowNegativeFrequencies = false,
}: {
  sourceRole?: "rx" | "tx";
  fallbackRange?: FrequencyRange | null;
  expectedCenterFrequencyHz?: number | null;
  expectedSampleRateHz?: number | null;
  frame?: Pick<LiveFrameData, "center_frequency_hz" | "sample_rate"> | null;
  allowNegativeFrequencies?: boolean;
}): FrequencyRange => {
  const frameCenterFrequencyHz = frame?.center_frequency_hz;
  const frameSampleRateHz = frame?.sample_rate;
  const hasFrameWindow =
    typeof frameCenterFrequencyHz === "number" &&
    Number.isFinite(frameCenterFrequencyHz) &&
    typeof frameSampleRateHz === "number" &&
    Number.isFinite(frameSampleRateHz) &&
    frameSampleRateHz > 0;
  const frameMatchesRequestedWindow =
    typeof expectedCenterFrequencyHz !== "number" ||
    Math.abs((frame?.center_frequency_hz ?? 0) - expectedCenterFrequencyHz) < 1;
  const frameMatchesRequestedRate =
    typeof expectedSampleRateHz !== "number" ||
    Math.abs((frame?.sample_rate ?? 0) - expectedSampleRateHz) < 1;

  if (
    hasFrameWindow &&
    (sourceRole !== "tx" ||
      (frameMatchesRequestedWindow && frameMatchesRequestedRate))
  ) {
    return clampCenteredFrequencyRange(
      frameCenterFrequencyHz!,
      frameSampleRateHz!,
      0,
    );
  }
  const fallback = fallbackRange ?? { min: 0, max: 1 };
  if (fallback.min >= 0) return fallback;
  return clampCenteredFrequencyRange(
    getFrequencyRangeCenterHz(fallback),
    fallback.max - fallback.min,
    0,
  );
};

export const getWaterfallNodeDisplayRange = ({
  analysisOptions,
  requestedRange,
  sourceRange,
  allowNegativeFrequencies = false,
}: {
  analysisOptions?: boolean;
  requestedRange: FrequencyRange;
  sourceRange: FrequencyRange;
  allowNegativeFrequencies?: boolean;
}): FrequencyRange => {
  const sourceRangeIsUsable =
    Number.isFinite(sourceRange.min) &&
    Number.isFinite(sourceRange.max) &&
    sourceRange.max - sourceRange.min > 1;

  if (analysisOptions && sourceRangeIsUsable) {
    if (sourceRange.min >= 0) return sourceRange;
    return clampCenteredFrequencyRange(
      getFrequencyRangeCenterHz(sourceRange),
      sourceRange.max - sourceRange.min,
      0,
    );
  }

  if (
    Number.isFinite(requestedRange.min) &&
    Number.isFinite(requestedRange.max) &&
    requestedRange.max > requestedRange.min
  ) {
    const span = requestedRange.max - requestedRange.min;
    return clampCenteredFrequencyRange(
      getFrequencyRangeCenterHz(requestedRange),
      span,
      0,
    );
  }

  return sourceRange;
};

const NodeWrapper = styled.div<{ $analysis?: boolean }>`
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  padding: 0;
  width: 100%;
  min-width: 525px;
  height: ${({ $analysis }) => ($analysis ? "500px" : "400px")};
  max-height: ${({ $analysis }) => ($analysis ? "500px" : "400px")};
  min-height: ${({ $analysis }) => ($analysis ? "500px" : "400px")};
  align-self: stretch;
  cursor: grab;
  overflow: hidden;
  position: relative;
  border-bottom-left-radius: ${({ $analysis }) => ($analysis ? "0" : "12px")};
`;

const NodeTitle = styled.div<{ $analysis?: boolean }>`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors?.primary || "#00d4ff"};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 0;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  width: max-content;
  pointer-events: auto;
  ${({ $analysis }) =>
    $analysis
      ? `
    padding: 4px 8px 0;
  `
      : `padding: 10px 12px 0;`}

  &::before {
    content: "";
    display: block;
    width: 8px;
    height: 8px;
    background: currentColor;
    border-radius: 2px;
  }
`;

const CanvasContainer = styled.div<{ $analysis?: boolean }>`
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  align-self: stretch;
  padding: ${({ $analysis }) => ($analysis ? "0" : "8px 10px 10px")};
  overflow: hidden;
  position: relative;
`;

const DbControls = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 8px 0;
  flex: 0 0 auto;
  pointer-events: auto;
`;

const AnalysisLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px;
  gap: 16px;
  min-height: 0;
  flex: 1;
  height: 100%;
  overflow: hidden;

  > div {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
`;

const AnalysisTools = styled.aside<{ $analysis?: boolean }>`
  box-sizing: border-box;
  width: 100%;
  display: grid;
  grid-template-rows: ${({ $analysis }) =>
    $analysis ? "minmax(0, 1fr) auto auto" : "minmax(0, 1fr) auto"};
  align-items: center;
  gap: 0;
  padding: 0;
  height: 100%;
  align-self: stretch;
  min-height: 0;
  overflow: visible;
  justify-content: stretch;

  > div:first-child {
    width: 100%;
    display: grid;
    flex: none !important;
    height: auto !important;
    align-self: stretch;
    min-height: 0 !important;
    padding-bottom: 8px;
    overflow: visible;
  }

  > button {
    flex: 0 0 32px;
    margin-top: 14px;
  }

  > [data-testid="waterfall-analysis-icon-grid"] {
    margin-top: 14px;
  }
`;

const AnalysisThemeSelect = styled.select`
  width: 100%;
  min-width: 0;
  padding: 6px 4px;
  border: 1px solid ${({ theme }) => theme.colors?.border || "#475569"};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors?.surface || "#212121"};
  color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  font: 10px ${({ theme }) => theme.typography?.mono || "monospace"};
`;

const AnalysisThemeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  width: 100%;
  padding: 12px 8px 6px;
  border-top: 0;
  background: ${({ theme }) => theme.colors?.surface || "#212121"};
  pointer-events: auto;
`;

const AnalysisThemeLabel = styled.span`
  flex: 0 0 auto;
  color: ${({ theme }) => theme.colors?.textSecondary || "#94a3b8"};
  font: 10px ${({ theme }) => theme.typography?.mono || "monospace"};
  text-transform: uppercase;
`;

const AnalysisToolButton = styled.button<{ $active?: boolean }>`
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid
    ${({ theme, $active }) =>
      $active ? theme.colors?.primary || "#2563eb" : "transparent"};
  border-radius: 50%;
  background: ${({ theme, $active }) =>
    $active
      ? theme.activeBackground || theme.colors?.activeBackground || "#2563eb26"
      : "transparent"};
  color: ${({ theme, $active }) =>
    $active
      ? theme.colors?.primary || "#2563eb"
      : theme.colors?.textSecondary || "#94a3b8"};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors?.surfaceHover || "#475569"};
    color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  }

  &[aria-pressed="true"] {
    border-color: ${({ theme }) => theme.primary};
    background: ${({ theme }) => theme.activeBackground};
    color: ${({ theme }) => theme.primary};
  }
`;

const AnalysisIconGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 34px);
  grid-template-rows: repeat(2, 34px);
  gap: 6px;
  justify-content: center;
  align-items: center;
`;

const AnalysisResetButton = styled.button`
  width: 100%;
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors?.border || "#475569"};
  border-radius: 6px;
  background: transparent;
  color: ${({ theme }) => theme.colors?.textSecondary || "#94a3b8"};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors?.surfaceHover || "#475569"};
    color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  }
`;

const AnalysisBinSubsetControl = styled.div`
  position: relative;
  display: flex;
`;

const AnalysisBinSubsetField = styled.label`
  display: grid;
  gap: 4px;
  color: ${({ theme }) => theme.colors?.textSecondary || "#94a3b8"};
  font: 10px ${({ theme }) => theme.typography?.mono || "monospace"};
  text-transform: uppercase;
`;

const AnalysisBinSubsetSelect = styled.select`
  width: 100%;
  min-width: 0;
  padding: 5px 3px;
  border: 1px solid ${({ theme }) => theme.colors?.border || "#475569"};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors?.surface || "#212121"};
  color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  font: 10px ${({ theme }) => theme.typography?.mono || "monospace"};
`;

const AnalysisViewport = styled.div<{ $analysis?: boolean }>`
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  padding-top: ${({ $analysis }) => ($analysis ? "32px" : "24px")};
`;

type BrushLine = {
  left: { x: number; y: number };
  center: { x: number; y: number };
  right: { x: number; y: number };
};

const EMPTY_FREQUENCY_RANGE: FrequencyRange = {
  min: Number.NaN,
  max: Number.NaN,
};

export const remapBrushLineToZoomBox = (
  line: BrushLine,
  startX: number,
  endX: number,
): BrushLine => {
  const minX = Math.min(startX, endX);
  const span = Math.max(0.0001, Math.abs(endX - startX));
  const remap = (point: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(1, (point.x - minX) / span)),
    y: point.y,
  });
  return {
    left: remap(line.left),
    center: remap(line.center),
    right: remap(line.right),
  };
};

export const getBrushCurveControlPoint = (line: BrushLine) => ({
  x: 2 * line.center.x - (line.left.x + line.right.x) / 2,
  y: 2 * line.center.y - (line.left.y + line.right.y) / 2,
});

export const getBrushBaselineY = (line: BrushLine, x: number): number => {
  if (x <= line.center.x) {
    const span = line.center.x - line.left.x || 1;
    const t = Math.max(0, Math.min(1, (x - line.left.x) / span));
    const control = line.left.y + (line.center.y - line.left.y) * 0.5;
    return (
      (1 - t) ** 2 * line.left.y +
      2 * (1 - t) * t * control +
      t ** 2 * line.center.y
    );
  }
  const span = line.right.x - line.center.x || 1;
  const t = Math.max(0, Math.min(1, (x - line.center.x) / span));
  const control = line.right.y + (line.center.y - line.right.y) * 0.5;
  return (
    (1 - t) ** 2 * line.center.y +
    2 * (1 - t) * t * control +
    t ** 2 * line.right.y
  );
};

export const normalizeSpectrumToBrushLine = (
  spectrum: Float32Array,
  line: BrushLine,
  fftMin: number,
  fftMax: number,
): Float32Array => {
  const output = new Float32Array(spectrum.length);
  const referenceDb =
    fftMax -
    ((line.left.y + line.center.y + line.right.y) / 3) * (fftMax - fftMin);
  for (let index = 0; index < spectrum.length; index += 1) {
    const x = spectrum.length <= 1 ? 0.5 : index / (spectrum.length - 1);
    const baselineDb = fftMax - getBrushBaselineY(line, x) * (fftMax - fftMin);
    output[index] = spectrum[index] - baselineDb + referenceDb;
  }
  return output;
};

const BrushOverlay = styled.svg<{ $active: boolean }>`
  position: absolute;
    /* The analysis title consumes 32px and the VFO is a fixed 56px row. Anchor
   * the brush to the remaining
   * waterfall viewport with both top and bottom edges instead of combining a
   * top inset with a calculated height; the latter can be distorted by the
   * React Flow node's flex/grid sizing and makes the zoombox look squashed. */
  inset: 88px 0 0;
  width: 100%;
  height: auto;
  z-index: 3;
  cursor: crosshair;
  touch-action: none;
  opacity: ${({ $active }) => ($active ? 1 : 0)};
  visibility: ${({ $active }) => ($active ? "visible" : "hidden")};
  pointer-events: ${({ $active }) => ($active ? "auto" : "none")};
`;

const formatBinSubsetLabel = (parity: WaterfallBinSubset["parity"]) =>
  `${parity === "even" ? "Even" : "Odd"} Bins`;

export const formatMiniVfoFrequency = (frequencyHz: number) =>
  formatFrequency(frequencyHz, {
    showUnits: true,
    // Preserve Hz-level VFO changes while keeping the compact unit display.
    precisionMHz: 6,
    precisionGHz: 6,
    precisionKHz: 3,
    trimTrailingZeros: true,
  }).replace(/(\d)(?=[A-Za-z])/g, "$1 ");

const formatDb = (value: number, unit = "dB") =>
  `${value.toFixed(0)} ${unit}`;

const getIqMutationMarker = (iq: Uint8Array | null | undefined): string => {
  if (!iq || iq.length === 0) return "";
  const middle = iq[Math.floor(iq.length / 2)] ?? 0;
  return `${iq.length}:${iq[0] ?? 0}:${middle}:${iq[iq.length - 1] ?? 0}`;
};

export const getCenteredWaterfallZoomView = (
  waveform: Float32Array,
  zoom: number,
): Float32Array => {
  if (zoom <= 1 || waveform.length <= 1) return waveform;
  const visibleLength = Math.max(1, Math.floor(waveform.length / zoom));
  const start = Math.max(0, Math.floor((waveform.length - visibleLength) / 2));
  return waveform.subarray(start, start + visibleLength);
};

export const getWaterfallZoomBoxView = ({
  hardwareRange,
  currentZoom,
  currentPanHz,
  selectionStartX,
  selectionEndX,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  currentZoom: number;
  currentPanHz: number;
  selectionStartX: number;
  selectionEndX: number;
  allowNegativeFrequencies?: boolean;
}): {
  zoom: number;
  panHz: number;
  visibleRange: FrequencyRange;
} => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const safeCurrentZoom = Math.max(1, currentZoom);
  const selectionSpan = Math.max(
    0.001,
    Math.abs(selectionEndX - selectionStartX),
  );
  const zoom = Math.min(
    VISUALIZER_MAX_ZOOM,
    Math.round((safeCurrentZoom / selectionSpan) * 1_000_000) / 1_000_000,
  );
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const currentVisibleSpan = fullSpan / safeCurrentZoom;
  const currentVisibleMin =
    hardwareCenter + currentPanHz - currentVisibleSpan / 2;
  const selectionCenterX = (selectionStartX + selectionEndX) / 2;
  const targetCenter =
    currentVisibleMin + selectionCenterX * currentVisibleSpan;
  const visibleSpan = fullSpan / zoom;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const panHz = Math.max(
    minPanHz,
    Math.min(maxPanHz, targetCenter - hardwareCenter),
  );
  const visibleCenter = hardwareCenter + panHz;

  return {
    zoom,
    panHz,
    visibleRange: {
      min: visibleCenter - visibleSpan / 2,
      max: visibleCenter + visibleSpan / 2,
    },
  };
};

export const getWaterfallVfoDisplayFrequency = ({
  hardwareCenterHz,
  visibleRange,
}: {
  hardwareCenterHz: number;
  visibleRange: FrequencyRange;
}): number =>
  Number.isFinite(visibleRange.min) &&
  Number.isFinite(visibleRange.max) &&
  visibleRange.max > visibleRange.min
    ? (visibleRange.min + visibleRange.max) / 2
    : hardwareCenterHz;

export const getWaterfallScrollPan = ({
  hardwareRange,
  zoom,
  currentPanHz,
  deltaY,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  zoom: number;
  currentPanHz: number;
  deltaY: number;
  allowNegativeFrequencies?: boolean;
}): number => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const safeZoom = Math.max(1, zoom);
  const visibleSpan = fullSpan / safeZoom;
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const nextPan = currentPanHz - (deltaY * visibleSpan) / 40;
  return Math.max(minPanHz, Math.min(maxPanHz, nextPan));
};

export const getWaterfallVfoDragPan = ({
  hardwareRange,
  zoom,
  startPanHz,
  dragDistancePx,
  viewportWidthPx,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  zoom: number;
  startPanHz: number;
  dragDistancePx: number;
  viewportWidthPx: number;
  allowNegativeFrequencies?: boolean;
}): number => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const visibleSpan = fullSpan / Math.max(1, zoom);
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const nextPan =
    startPanHz + (dragDistancePx / Math.max(1, viewportWidthPx)) * visibleSpan;
  return Math.max(minPanHz, Math.min(maxPanHz, nextPan));
};

export const getWaterfallPinchZoomView = ({
  hardwareRange,
  startZoom,
  centerFrequencyHz,
  startDistancePx,
  currentDistancePx,
  allowNegativeFrequencies = false,
}: {
  hardwareRange: FrequencyRange;
  startZoom: number;
  centerFrequencyHz: number;
  startDistancePx: number;
  currentDistancePx: number;
  allowNegativeFrequencies?: boolean;
}): { zoom: number; panHz: number } => {
  const fullSpan = hardwareRange.max - hardwareRange.min;
  const safeStartZoom = Math.max(1, startZoom);
  const zoom = Math.max(
    1,
    Math.min(
      VISUALIZER_MAX_ZOOM,
      safeStartZoom *
        (Math.max(1, currentDistancePx) / Math.max(1, startDistancePx)),
    ),
  );
  const visibleSpan = fullSpan / zoom;
  const hardwareCenter = (hardwareRange.min + hardwareRange.max) / 2;
  const minPanHz = allowNegativeFrequencies
    ? Number.NEGATIVE_INFINITY
    : hardwareRange.min + visibleSpan / 2 - hardwareCenter;
  const maxPanHz = allowNegativeFrequencies
    ? Number.POSITIVE_INFINITY
    : hardwareRange.max - visibleSpan / 2 - hardwareCenter;
  const panHz = Math.max(
    minPanHz,
    Math.min(maxPanHz, centerFrequencyHz - hardwareCenter),
  );
  return { zoom, panHz };
};

const WaterfallNodeComponent: React.FC<WaterfallNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const sourceMode = useAppSelector(
    (state) => state.waterfall?.sourceMode ?? "live",
  );
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const powerScale = useAppSelector(
    (state) => state.spectrum.powerScale ?? "dB",
  );
  const waterfallTheme = useAppSelector(
    (state) => state.theme?.waterfallTheme ?? "classic",
  );
  const waterfallColormap =
    WATERFALL_COLORMAPS[waterfallTheme] ?? WATERFALL_COLORMAPS.classic;
  const waterfallFftSize = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? Math.min(state.spectrum.txViewerFftSize, MAX_WATERFALL_FFT_SIZE)
      : FLOW_WATERFALL_FFT_SIZE,
  );
  const roleSourceId = useAppSelector((state) => {
    const assignedSourceId =
      data.sourceRole && data.sourceBindingGroup
        ? state.sourceRouting.bindings[
            sourceBindingKey(data.sourceBindingGroup, data.sourceRole)
          ]
        : null;
    if (assignedSourceId) return assignedSourceId;
    if (!data.sourceRole) return state.websocket.activeSourceId;
    const candidates = state.websocket.sources ?? [];
    if (data.sourceRole === "tx") {
      return (
        candidates.find(
          (source) =>
            source.capability === "tx" || source.capability === "tx_rx",
        )?.id ?? state.websocket.activeSourceId
      );
    }
    return (
      candidates.find(
        (source) => source.capability === "rx" || source.capability === "tx_rx",
      )?.id ?? state.websocket.activeSourceId
    );
  });
  const isTxStandbyPreview = useAppSelector((state) => {
    if (!roleSourceId) return false;
    const source = (state.websocket.sources ?? []).find(
      (candidate) => candidate.id === roleSourceId,
    );
    return Boolean(
      source &&
      isTxStandbyPreviewSource({
        sourceRole: data.sourceRole,
        capability: source.capability,
        status: source.status,
      }),
    );
  });
  const txCenterFrequencyHz = useAppSelector(
    (state) => state.spectrum.txCenterFrequencyHz,
  );
  const txViewerSampleRateHz = useAppSelector(
    (state) => state.spectrum.txViewerSampleRateHz,
  );
  const selectedFiles = useAppSelector((state) =>
    selectArrayOrEmpty(state.waterfall?.selectedFiles),
  );
  const stitchStatus = useAppSelector(
    (state) => state.waterfall?.stitchStatus ?? "",
  );
  const stitchTrigger = useAppSelector(
    (state) => state.waterfall?.stitchTrigger ?? 0,
  );
  const isStitchPaused = useAppSelector(
    (state) => state.waterfall?.isStitchPaused ?? false,
  );
  const requestedFrequencyRange = useAppSelector(
    (state) => state.spectrum?.frequencyRange ?? EMPTY_FREQUENCY_RANGE,
  );
  const allowNegativeFrequencies = useAppSelector(
    (state) => state.settings.mirrorIqBasebandBelowZero,
  );
  const [waterfallDbMin, setWaterfallDbMin] = useState(fftMinDb);
  const [waterfallDbMax, setWaterfallDbMax] = useState(fftMaxDb);
  const [waterfallZoom, setWaterfallZoom] = useState<number>(
    VISUALIZER_DEFAULT_ZOOM,
  );
  const [waterfallPanHz, setWaterfallPanHz] = useState(0);
  const waterfallDbUnit = powerScale === "dBm" ? "dBm" : "dB";
  const formatWaterfallDb = useCallback(
    (value: number) => formatDb(value, waterfallDbUnit),
    [waterfallDbUnit],
  );
  const { processIqToDbmSpectrum } = useWasmSimdMath({
    fftSize: waterfallFftSize,
    enableSimd: true,
    fallbackToScalar: true,
  });

  useEffect(() => {
    if (!data.analysisOptions) return;
    // The main visualizer's stability floor is a global presentation setting;
    // Analysis owns its zoom/pan locally and must not inherit that floor.
    dispatch(setAutoZoomStability(false));
    dispatch(setVizZoomFloor(1));
    dispatch(setVizZoomFloorPan(0));
  }, [data.analysisOptions, dispatch]);

  // Throttled data polling — waterfall scrolls visually so 8fps is smooth enough.
  const getCurrentFrame = useCallback(() => {
    const sourceRef =
      sourceMode === "file"
        ? fileFrameRuntime.ref
        : liveSourceFrameRuntime.getRef(roleSourceId);
    return Array.isArray(sourceRef.current)
      ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
      : sourceRef.current;
  }, [roleSourceId, sourceMode]);
  const initialFrame = getCurrentFrame();
  const [liveFrame, setLiveFrame] = useState(initialFrame);
  const [frameRevision, setFrameRevision] = useState(0);
  const lastRefRef = useRef<unknown>(initialFrame);
  const lastIqRef = useRef((initialFrame as any)?.iq_data);
  const lastIqMutationMarkerRef = useRef(
    getIqMutationMarker((initialFrame as any)?.iq_data),
  );
  const lastTimestampRef = useRef((initialFrame as any)?.timestamp);
  const resampledWaterfallRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    if (sourceMode === "live" && roleSourceId) return;
    const id = setInterval(() => {
      const next = getCurrentFrame();
      const nextIq = (next as any)?.iq_data;
      const nextIqMutationMarker = getIqMutationMarker(nextIq);
      if (
        next !== lastRefRef.current ||
        nextIq !== lastIqRef.current ||
        nextIqMutationMarker !== lastIqMutationMarkerRef.current ||
        (next as any)?.timestamp !== lastTimestampRef.current ||
        (next as any)?.waveform !== (lastRefRef.current as any)?.waveform
      ) {
        lastRefRef.current = next;
        lastIqRef.current = nextIq;
        lastIqMutationMarkerRef.current = nextIqMutationMarker;
        lastTimestampRef.current = (next as any)?.timestamp;
        setLiveFrame(next);
        // The stream may reuse and mutate its frame object. A revision update
        // guarantees a render even when React sees the same object identity.
        setFrameRevision((revision) => revision + 1);
      }
    }, 125); // 8fps — smooth waterfall scrolling
    return () => clearInterval(id);
  }, [data.sourceRole, getCurrentFrame, sourceMode]);

  useEffect(() => {
    const next = getCurrentFrame();
    const nextIq = (next as any)?.iq_data;
    const frameChanged =
      next !== lastRefRef.current ||
      nextIq !== lastIqRef.current ||
      getIqMutationMarker(nextIq) !== lastIqMutationMarkerRef.current ||
      (next as any)?.timestamp !== lastTimestampRef.current ||
      (next as any)?.waveform !== (lastRefRef.current as any)?.waveform;
    if (!frameChanged) return;
    lastRefRef.current = next;
    lastIqRef.current = nextIq;
    lastIqMutationMarkerRef.current = getIqMutationMarker(nextIq);
    lastTimestampRef.current = (next as any)?.timestamp;
    setLiveFrame(next);
    setFrameRevision((revision) => revision + 1);
  }, [activeSourceId, roleSourceId, txViewerSampleRateHz, getCurrentFrame]);

  const waveform = useMemo(() => {
    const fileWaveform =
      sourceMode === "file" ? (liveFrame as any)?.waveform : null;
    if (fileWaveform && fileWaveform.length > 0) return fileWaveform;

    if (sourceMode === "live" && roleSourceId && data.sourceRole) {
      const shared = sourceSpectrumRuntime.getSourceRef(roleSourceId).current;
      if (shared?.spectrum?.length) return shared.spectrum;
      // Role-bound live FFT nodes own the transform. Waiting for their first
      // shared result is cheaper and safer than starting a second FFT here.
      if (data.sourceRole) return null;
    }
    if (sourceMode === "live" && roleSourceId && !data.sourceRole) {
      // The direct live feed below owns this transform and pushes rows without
      // routing every frame through React.
      return null;
    }

    const iq = (liveFrame as any)?.iq_data;
    if (!iq || iq.length === 0) return null;
    const spectrum = processIqToDbmSpectrum(
      newestIqWindow(iq, waterfallFftSize),
      0,
      waterfallFftSize,
    );
    return spectrum;
  }, [
    frameRevision,
    (liveFrame as any)?.iq_data,
    (liveFrame as any)?.waveform,
    processIqToDbmSpectrum,
    sourceMode,
    roleSourceId,
    data.sourceRole,
    waterfallFftSize,
    txViewerSampleRateHz,
  ]);
  const displayWaveform = useMemo(() => {
    return waveform;
  }, [waveform]);
  const liveWaveformFeed = useMemo(() => {
    if (sourceMode !== "live" || !roleSourceId) {
      return undefined;
    }
    if (!data.sourceRole) {
      let cachedFrame: LiveFrameData | null = null;
      let cachedIq: Uint8Array | null = null;
      let cachedRevision = "";
      let cachedSpectrum: Float32Array | null = null;
      const readSpectrum = () => {
        const sourceRef = liveIqRuntime.getSourceRef(roleSourceId);
        const current = sourceRef.current;
        const frame = Array.isArray(current)
          ? (current[current.length - 1] ?? null)
          : current;
        const iq = (frame as any)?.iq_data;
        if (!iq?.length) return null;
        const revision = `${(frame as any)?.stream_epoch ?? ""}:${(frame as any)?.sequence ?? ""}:${(frame as any)?.timestamp ?? ""}:${getIqMutationMarker(iq)}`;
        if (
          frame === cachedFrame &&
          iq === cachedIq &&
          revision === cachedRevision
        ) {
          return cachedSpectrum;
        }
        const spectrum = processIqToDbmSpectrum(iq, 0, waterfallFftSize);
        cachedFrame = frame as LiveFrameData;
        cachedIq = iq;
        cachedRevision = revision;
        cachedSpectrum = spectrum;
        return cachedSpectrum;
      };
      return {
        getCurrent: readSpectrum,
        subscribe: (listener: (waveform: Float32Array) => void) => {
          let lastDeliveredSpectrum: Float32Array | null = null;
          const emitLatest = () => {
            const spectrum = readSpectrum();
            if (spectrum?.length && spectrum !== lastDeliveredSpectrum) {
              lastDeliveredSpectrum = spectrum;
              listener(spectrum);
            }
          };
          const unsubscribe = liveIqRuntime.subscribe(roleSourceId, emitLatest);
          // Source notifications are the fast path. The watchdog covers
          // in-place/fallback frame slots that cannot emit, without routing
          // rows through React or repeating FFT work for an unchanged frame.
          const watchdog = window.setInterval(emitLatest, 33);
          return () => {
            window.clearInterval(watchdog);
            unsubscribe();
          };
        },
      };
    }
    return {
      getCurrent: () =>
        sourceSpectrumRuntime.getSourceRef(roleSourceId).current?.spectrum ??
        null,
      subscribe: (listener: (waveform: Float32Array) => void) =>
        sourceSpectrumRuntime.subscribe(roleSourceId, () => {
          const spectrum =
            sourceSpectrumRuntime.getSourceRef(roleSourceId).current?.spectrum;
          if (spectrum?.length) listener(spectrum);
        }),
    };
  }, [
    data.sourceRole,
    getCurrentFrame,
    processIqToDbmSpectrum,
    roleSourceId,
    sourceMode,
    waterfallFftSize,
  ]);

  const filePlaceholderState = getFilePlaceholderState({
    sourceMode,
    selectedFilesCount: selectedFiles.length,
    stitchStatus,
    hasRenderableFrame: Boolean(waveform?.length),
  });
  const isPaused =
    isTxStandbyPreview ||
    isFilePlaybackPaused({
      sourceMode,
      isStitchPaused,
    });
  const waterfallSessionKey = getSourcePresentationSessionKey({
    sourceMode,
    selectedFiles,
    stitchTrigger,
    presentationRevision:
      data.sourceRole === "tx"
        ? `${roleSourceId ?? "none"}:${Math.round(txCenterFrequencyHz)}:${Math.round(txViewerSampleRateHz)}:${waterfallFftSize}`
        : roleSourceId,
  });

  const configuredTxRange =
    data.sourceRole === "tx" &&
    Number.isFinite(txCenterFrequencyHz) &&
    txCenterFrequencyHz > 0 &&
    Number.isFinite(txViewerSampleRateHz) &&
    txViewerSampleRateHz > 0
      ? {
          min: txCenterFrequencyHz - txViewerSampleRateHz / 2,
          max: txCenterFrequencyHz + txViewerSampleRateHz / 2,
        }
      : null;
  const sourceFrequencyRange = useMemo(
    () =>
      getWaterfallNodeFrequencyRange({
        sourceRole: data.sourceRole,
        fallbackRange: configuredTxRange,
        expectedCenterFrequencyHz:
          data.sourceRole === "tx" ? txCenterFrequencyHz : null,
        expectedSampleRateHz:
          data.sourceRole === "tx" ? txViewerSampleRateHz : null,
        frame: liveFrame,
        allowNegativeFrequencies,
      }),
    [
      configuredTxRange,
      data.sourceRole,
      liveFrame?.center_frequency_hz,
      liveFrame?.sample_rate,
      txCenterFrequencyHz,
      txViewerSampleRateHz,
      allowNegativeFrequencies,
    ],
  );
  const frequencyRange = useMemo(
    () =>
      getWaterfallNodeDisplayRange({
        analysisOptions: data.analysisOptions,
        requestedRange: requestedFrequencyRange,
        sourceRange: sourceFrequencyRange,
        allowNegativeFrequencies,
      }),
    [
      allowNegativeFrequencies,
      data.analysisOptions,
      requestedFrequencyRange,
      sourceFrequencyRange,
    ],
  );
  const [vfoFrequency, setVfoFrequency] = useState(0);
  const vfoUserTunedRef = useRef(false);
  const [vfoDragOffsetPx, setVfoDragOffsetPx] = useState(0);
  const vfoDragStartFrequencyRef = useRef<number | null>(null);
  const vfoDragStartXRef = useRef(0);
  const vfoDragStartPanRef = useRef(0);
  const vfoDragViewportWidthRef = useRef(1);
  const vfoDragDistancePxRef = useRef(0);
  const pinchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{
    distancePx: number;
    zoom: number;
    centerFrequencyHz: number;
  } | null>(null);
  const [showVfoEditor, setShowVfoEditor] = useState(false);
  const [isVfoLocked, setIsVfoLocked] = useState(false);
  const [isBrushEnabled, setIsBrushEnabled] = useState(false);
  const [isNormalizationEnabled, setIsNormalizationEnabled] = useState(false);
  const [isZoomBoxEnabled, setIsZoomBoxEnabled] = useState(false);
  const [isBinSubsetPopoverOpen, setIsBinSubsetPopoverOpen] = useState(false);
  const [binSubset, setBinSubset] = useState<WaterfallBinSubset>(
    DEFAULT_WATERFALL_BIN_SUBSET,
  );
  const binSubsetButtonRef = useRef<HTMLButtonElement | null>(null);
  const [zoomBox, setZoomBox] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  const [brushLine, setBrushLine] = useState<BrushLine | null>(null);
  const [brushFreehandPoints, setBrushFreehandPoints] = useState<
    Array<{ x: number; y: number }>
  >([]);
  const brushDragRef = useRef<"draw" | "left" | "center" | "right" | null>(
    null,
  );
  const brushLineRef = useRef<BrushLine | null>(null);
  const normalizationEnabledRef = useRef(false);
  const brushOverlayRef = useRef<SVGSVGElement | null>(null);
  const [brushAspectRatio, setBrushAspectRatio] = useState(1);
  useEffect(() => {
    if (!isZoomBoxEnabled) return;
    const handleZoomBoxEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomBox(null);
        setIsZoomBoxEnabled(false);
        brushDragRef.current = null;
        setBrushFreehandPoints([]);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!zoomBox) return;
      const step = 0.01;
      const dx =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      const dy =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (!dx && !dy) return;
      setZoomBox((box) => {
        if (!box) return box;
        const width = Math.abs(box.end.x - box.start.x);
        const height = Math.abs(box.end.y - box.start.y);
        const left = Math.min(box.start.x, box.end.x);
        const top = Math.min(box.start.y, box.end.y);
        const nextLeft = Math.max(0, Math.min(1 - width, left + dx));
        const nextTop = Math.max(0, Math.min(1 - height, top + dy));
        const offsetX = nextLeft - left;
        const offsetY = nextTop - top;
        return {
          start: { x: box.start.x + offsetX, y: box.start.y + offsetY },
          end: { x: box.end.x + offsetX, y: box.end.y + offsetY },
        };
      });
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleZoomBoxEscape, true);
    return () =>
      window.removeEventListener("keydown", handleZoomBoxEscape, true);
  }, [isZoomBoxEnabled, zoomBox]);
  const resetAnalysisControls = useCallback(() => {
    setBrushFreehandPoints([]);
    setBrushLine(null);
    setIsBrushEnabled(false);
    setIsNormalizationEnabled(false);
    setIsZoomBoxEnabled(false);
    setZoomBox(null);
    setIsBinSubsetPopoverOpen(false);
    setBinSubset(DEFAULT_WATERFALL_BIN_SUBSET);
    const defaultDbLimits = getVisualizerDefaultDbLimits(powerScale);
    setWaterfallDbMin(defaultDbLimits.min);
    setWaterfallDbMax(defaultDbLimits.max);
    setWaterfallZoom(VISUALIZER_DEFAULT_ZOOM);
    setWaterfallPanHz(0);
    vfoUserTunedRef.current = false;
    setVfoFrequency((frequencyRange.min + frequencyRange.max) / 2);
    setIsVfoLocked(false);
    setShowVfoEditor(false);
  }, [frequencyRange.max, frequencyRange.min, powerScale]);
  useEffect(() => {
    vfoUserTunedRef.current = false;
  }, [waterfallSessionKey]);
  useEffect(() => {
    if (!vfoUserTunedRef.current) {
      setVfoFrequency((frequencyRange.min + frequencyRange.max) / 2);
    }
  }, [frequencyRange.min, frequencyRange.max]);
  const tuneVfo = useCallback(
    (frequency: number, forceHardwareTune = false) => {
      if (isVfoLocked) return;
      if (!Number.isFinite(frequency)) return;
      const sourceFrequency = mapDisplayFrequencyToSource(frequency);
      if (data.analysisOptions && !forceHardwareTune) {
        const sourceCenter =
          (frequencyRange.min + frequencyRange.max) / 2;
        const visibleSpan =
          (frequencyRange.max - frequencyRange.min) /
          Math.max(1, waterfallZoom);
        const minPan = allowNegativeFrequencies
          ? Number.NEGATIVE_INFINITY
          : frequencyRange.min + visibleSpan / 2 - sourceCenter;
        const maxPan = allowNegativeFrequencies
          ? Number.POSITIVE_INFINITY
          : frequencyRange.max - visibleSpan / 2 - sourceCenter;
        setWaterfallPanHz(
          Math.max(minPan, Math.min(maxPan, frequency - sourceCenter)),
        );
        setVfoFrequency(frequency);
        return;
      }
      const span = frequencyRange.max - frequencyRange.min;
      const range = clampCenteredFrequencyRange(
        sourceFrequency,
        span,
        0,
      );
      const hardwareRangeUnchanged =
        range.min === frequencyRange.min && range.max === frequencyRange.max;
      if (data.analysisOptions && forceHardwareTune && hardwareRangeUnchanged) {
        const sourceCenter =
          (frequencyRange.min + frequencyRange.max) / 2;
        const visibleSpan =
          (frequencyRange.max - frequencyRange.min) /
          Math.max(1, waterfallZoom);
        const minPan = allowNegativeFrequencies
          ? Number.NEGATIVE_INFINITY
          : frequencyRange.min + visibleSpan / 2 - sourceCenter;
        const maxPan = allowNegativeFrequencies
          ? Number.POSITIVE_INFINITY
          : frequencyRange.max - visibleSpan / 2 - sourceCenter;
        setWaterfallPanHz(
          Math.max(minPan, Math.min(maxPan, frequency - sourceCenter)),
        );
        setVfoFrequency(frequency);
        return;
      }
      dispatch(setFrequencyRange(range));
      dispatch(sendFrequencyRange(range));
      vfoUserTunedRef.current = true;
      setVfoFrequency(frequency);
    },
    [
      data.analysisOptions,
      dispatch,
      frequencyRange,
      isVfoLocked,
      waterfallPanHz,
      waterfallZoom,
      allowNegativeFrequencies,
    ],
  );
  const vfoFrequencyRange = useMemo(() => {
    if (!Number.isFinite(vfoFrequency) || vfoFrequency === 0) {
      return frequencyRange;
    }
    const span = frequencyRange.max - frequencyRange.min;
    return clampCenteredFrequencyRange(
      mapDisplayFrequencyToSource(vfoFrequency),
      span,
      0,
    );
  }, [allowNegativeFrequencies, frequencyRange, vfoFrequency]);
  const zoomedFrequencyRange = useMemo(() => {
    if (!data.analysisOptions || waterfallZoom <= 1) return vfoFrequencyRange;
    const fullSpan = vfoFrequencyRange.max - vfoFrequencyRange.min;
    const halfSpan = fullSpan / waterfallZoom / 2;
    const sourceCenter =
      (vfoFrequencyRange.min + vfoFrequencyRange.max) / 2;
    const minPanHz = allowNegativeFrequencies
      ? Number.NEGATIVE_INFINITY
      : vfoFrequencyRange.min + halfSpan - sourceCenter;
    const maxPanHz = allowNegativeFrequencies
      ? Number.POSITIVE_INFINITY
      : vfoFrequencyRange.max - halfSpan - sourceCenter;
    const clampedPanHz = Math.max(
      minPanHz,
      Math.min(maxPanHz, waterfallPanHz),
    );
    const center = sourceCenter + clampedPanHz;
    return { min: center - halfSpan, max: center + halfSpan };
  }, [
    allowNegativeFrequencies,
    data.analysisOptions,
    vfoFrequencyRange,
    waterfallPanHz,
    waterfallZoom,
  ]);
  const handlePinchPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !data.analysisOptions ||
        isVfoLocked ||
        event.pointerType === "mouse"
      ) {
        return;
      }
      pinchPointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (pinchPointersRef.current.size !== 2) return;

      const [first, second] = Array.from(pinchPointersRef.current.values());
      pinchStartRef.current = {
        distancePx: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: waterfallZoom,
        centerFrequencyHz:
          (vfoFrequencyRange.min + vfoFrequencyRange.max) / 2 + waterfallPanHz,
      };
      vfoDragStartFrequencyRef.current = null;
      vfoDragDistancePxRef.current = 0;
      setVfoDragOffsetPx(0);
      brushDragRef.current = null;
      event.preventDefault();
      event.stopPropagation();
    },
    [
      data.analysisOptions,
      isVfoLocked,
      vfoFrequencyRange.max,
      vfoFrequencyRange.min,
      waterfallPanHz,
      waterfallZoom,
    ],
  );
  const handlePinchPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pinchPointersRef.current.has(event.pointerId)) return;
      pinchPointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const pinchStart = pinchStartRef.current;
      if (!pinchStart || pinchPointersRef.current.size < 2) return;

      const [first, second] = Array.from(pinchPointersRef.current.values());
      const nextView = getWaterfallPinchZoomView({
        hardwareRange: vfoFrequencyRange,
        startZoom: pinchStart.zoom,
        centerFrequencyHz: pinchStart.centerFrequencyHz,
        startDistancePx: pinchStart.distancePx,
        currentDistancePx: Math.hypot(second.x - first.x, second.y - first.y),
        allowNegativeFrequencies,
      });
      setWaterfallZoom(nextView.zoom);
      setWaterfallPanHz(nextView.panHz);
      event.preventDefault();
      event.stopPropagation();
    },
    [allowNegativeFrequencies, vfoFrequencyRange],
  );
  const handlePinchPointerEndCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const wasPinching = pinchStartRef.current !== null;
      pinchPointersRef.current.delete(event.pointerId);
      if (pinchPointersRef.current.size < 2) {
        pinchStartRef.current = null;
      }
      if (!wasPinching) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const handleDbMinChange = useCallback(
    (value: number) => setWaterfallDbMin(Math.min(value, waterfallDbMax - 5)),
    [waterfallDbMax],
  );
  const handleDbMaxChange = useCallback(
    (value: number) => setWaterfallDbMax(Math.max(value, waterfallDbMin + 5)),
    [waterfallDbMin],
  );
  const handleWaterfallZoomChange = useCallback(
    (zoom: number) => {
      setWaterfallZoom(zoom);
      const fullSpan = vfoFrequencyRange.max - vfoFrequencyRange.min;
      const maxPanHz = Math.max(
        0,
        fullSpan / 2 - fullSpan / Math.max(1, zoom) / 2,
      );
      setWaterfallPanHz((panHz) =>
        Math.max(-maxPanHz, Math.min(maxPanHz, panHz)),
      );
    },
    [vfoFrequencyRange.max, vfoFrequencyRange.min],
  );
  const performScalarResampling = useCallback(
    (
      input: ArrayLike<number>,
      targetLength: number,
      destination?: Float32Array,
    ) => {
      const currentOutput = destination ?? resampledWaterfallRef.current;
      const output = resampleNearestInto(
        input,
        targetLength,
        waterfallDbMin,
        currentOutput ?? undefined,
      );
      resampledWaterfallRef.current = output;
      return output;
    },
    [waterfallDbMin],
  );
  const stopNodeDrag = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);
  useEffect(() => {
    const overlay = brushOverlayRef.current;
    if (!overlay) return;
    const updateAspect = () => {
      const rect = overlay.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBrushAspectRatio(rect.width / rect.height);
      }
    };
    updateAspect();
    const observer = new ResizeObserver(updateAspect);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [isBrushEnabled]);
  const getBrushPoint = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    },
    [],
  );
  const handleBrushPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = getBrushPoint(event);
      if (isZoomBoxEnabled) {
        setZoomBox({ start: point, end: point });
        brushDragRef.current = "draw";
        return;
      }
      brushDragRef.current = "draw";
      setBrushFreehandPoints([point]);
      setBrushLine({ left: point, center: point, right: point });
    },
    [getBrushPoint, isZoomBoxEnabled],
  );
  const handleBrushPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!brushDragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const point = getBrushPoint(event);
      if (isZoomBoxEnabled) {
        setZoomBox((box) => (box ? { ...box, end: point } : box));
        return;
      }
      if (brushDragRef.current === "draw") {
        setBrushFreehandPoints((points) => [...points, point]);
      }
      setBrushLine((line) => {
        if (!line) return line;
        if (brushDragRef.current === "draw") {
          const left = line.left.x <= point.x ? line.left : point;
          const right = line.left.x <= point.x ? point : line.left;
          return {
            left,
            right,
            center: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
          };
        }
        const handle = brushDragRef.current;
        if (handle === "left" || handle === "center" || handle === "right") {
          return { ...line, [handle]: point };
        }
        return line;
      });
    },
    [getBrushPoint, isZoomBoxEnabled],
  );
  const stopBrushStroke = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isZoomBoxEnabled && zoomBox) {
        const span = Math.abs(zoomBox.end.x - zoomBox.start.x);
        if (span > 0.01) {
          const nextView = getWaterfallZoomBoxView({
            hardwareRange: vfoFrequencyRange,
            currentZoom: waterfallZoom,
            currentPanHz: waterfallPanHz,
            selectionStartX: zoomBox.start.x,
            selectionEndX: zoomBox.end.x,
            allowNegativeFrequencies,
          });
          setWaterfallZoom(nextView.zoom);
          setWaterfallPanHz(nextView.panHz);
          setBrushLine((line) =>
            line
              ? remapBrushLineToZoomBox(line, zoomBox.start.x, zoomBox.end.x)
              : line,
          );
        }
        setZoomBox(null);
        setIsZoomBoxEnabled(false);
      }
      setBrushFreehandPoints([]);
      brushDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [
      allowNegativeFrequencies,
      isZoomBoxEnabled,
      vfoFrequencyRange,
      waterfallPanHz,
      waterfallZoom,
      zoomBox,
    ],
  );
  const handleBrushHandleDown = useCallback(
    (handle: "left" | "center" | "right") =>
      (event: React.PointerEvent<SVGElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        brushDragRef.current = handle;
      },
    [],
  );
  const clearBrushStrokes = useCallback(() => {
    if (isVfoLocked) return;
    setBrushFreehandPoints([]);
    setBrushLine(null);
  }, [isVfoLocked]);
  useEffect(() => {
    brushLineRef.current = brushLine;
    normalizationEnabledRef.current = isNormalizationEnabled;
  }, [brushLine, isNormalizationEnabled]);
  const transformWaveform = useCallback(
    (nextWaveform: Float32Array) => {
      // Spectrum FFT owns the |f| fold on the GPU. Never CPU-extend here —
      // the live waveform subscribe path was allocating a full mirrored row
      // every frame with the option on.
      if (!brushLineRef.current || !normalizationEnabledRef.current) {
        return nextWaveform;
      }
      return normalizeSpectrumToBrushLine(
        nextWaveform,
        brushLineRef.current,
        fftMinDb,
        fftMaxDb,
      );
    },
    [fftMaxDb, fftMinDb],
  );
  const transformedDisplayWaveform = useMemo(
    () =>
      displayWaveform ? transformWaveform(displayWaveform) : displayWaveform,
    [displayWaveform, transformWaveform],
  );
  const transformedWaveformFeed = useMemo(() => {
    if (!liveWaveformFeed) return liveWaveformFeed;
    return {
      getCurrent: () => {
        const current = liveWaveformFeed.getCurrent();
        return current ? transformWaveform(current) : new Float32Array(0);
      },
      subscribe: (listener: (nextWaveform: Float32Array) => void) =>
        liveWaveformFeed.subscribe((nextWaveform: Float32Array) =>
          listener(transformWaveform(nextWaveform)),
        ),
    };
  }, [liveWaveformFeed, transformWaveform]);
  const displayFrequencyRange = useMemo(
    () => frequencyRange,
    [frequencyRange],
  );
  const displayZoomedFrequencyRange = useMemo(
    () => zoomedFrequencyRange,
    [zoomedFrequencyRange],
  );

  return (
    <NodeWrapper
      $analysis={data.analysisOptions}
      data-testid="waterfall-node"
      data-iq-length={liveFrame?.iq_data?.length ?? 0}
      data-waveform-length={waveform?.length ?? 0}
    >
      <NodeTitle
        $analysis={data.analysisOptions}
        className={data.analysisOptions ? "drag-handle" : undefined}
      >
        {data.label}
      </NodeTitle>
      <CanvasContainer $analysis={data.analysisOptions}>
        <AnalysisLayout>
          <AnalysisViewport
            $analysis={data.analysisOptions}
            className="nodrag nopan nowheel"
            data-testid="waterfall-analysis-viewport"
            onPointerDownCapture={handlePinchPointerDownCapture}
            onPointerMoveCapture={handlePinchPointerMoveCapture}
            onPointerUpCapture={handlePinchPointerEndCapture}
            onPointerCancelCapture={handlePinchPointerEndCapture}
            onWheel={(event) => {
              if (!data.analysisOptions) return;
              event.preventDefault();
              event.stopPropagation();
              if (isVfoLocked) return;
              if (event.ctrlKey) {
                const scale = Math.exp(-event.deltaY * 0.003);
                const nextView = getWaterfallPinchZoomView({
                  hardwareRange: vfoFrequencyRange,
                  startZoom: waterfallZoom,
                  centerFrequencyHz:
                    (zoomedFrequencyRange.min + zoomedFrequencyRange.max) / 2,
                  startDistancePx: 100,
                  currentDistancePx: 100 * scale,
                  allowNegativeFrequencies,
                });
                setWaterfallZoom(nextView.zoom);
                setWaterfallPanHz(nextView.panHz);
                return;
              }
              const target = event.target as HTMLElement;
              if (!target.closest?.('[data-testid="waterfall-analysis-vfo"]')) {
                return;
              }
              if (waterfallZoom > 1) {
                setWaterfallPanHz((panHz) =>
                  getWaterfallScrollPan({
                    hardwareRange: vfoFrequencyRange,
                    zoom: waterfallZoom,
                    currentPanHz: panHz,
                    deltaY: event.deltaY,
                    allowNegativeFrequencies,
                  }),
                );
                return;
              }
              tuneVfo(vfoFrequency - event.deltaY * 1000);
            }}
          >
            {!data.analysisOptions &&
              data.miniVfoPosition !== "bottom" &&
              (data.showMiniVfo ?? true) && (
                <Vfo
                  visualState="compact"
                  drawingType="dom"
                  orientation="top"
                  frequencyRange={displayFrequencyRange}
                  centerFrequencyHz={(frequencyRange.min + frequencyRange.max) / 2}
                  style={{ height: 56, flex: "0 0 56px" }}
                  data-testid="waterfall-node-mini-vfo"
                  data-position="top"
                />
              )}
            {data.analysisOptions && (
              <Vfo
                visualState="compact"
                drawingType="dom"
                orientation="top"
                cursorMotion
                cursorOffsetPx={vfoDragOffsetPx}
                frequencyRange={displayZoomedFrequencyRange}
                centerFrequencyHz={getWaterfallVfoDisplayFrequency({
                  hardwareCenterHz: vfoFrequency,
                  visibleRange: zoomedFrequencyRange,
                })}
                accessory={
                  binSubset.mode === "interleaved" ? (
                    <span
                      aria-label={formatBinSubsetLabel(binSubset.parity)}
                      data-testid="waterfall-analysis-vfo-bin-subset"
                    >
                      {formatBinSubsetLabel(binSubset.parity)}
                    </span>
                  ) : null
                }
                style={{ height: 56, flex: "0 0 56px" }}
                className="nodrag nopan"
                data-testid="waterfall-analysis-vfo"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setVfoDragOffsetPx(0);
                  vfoDragStartFrequencyRef.current = vfoFrequency;
                  vfoDragStartXRef.current = event.clientX;
                  vfoDragStartPanRef.current = waterfallPanHz;
                  vfoDragViewportWidthRef.current =
                    event.currentTarget.getBoundingClientRect().width || 1;
                  vfoDragDistancePxRef.current = 0;
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onWheel={(event) => {
                  if (isVfoLocked) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setShowVfoEditor(true);
                }}
                onPointerMove={(event) => {
                  if (vfoDragStartFrequencyRef.current !== null) {
                    vfoDragDistancePxRef.current =
                      vfoDragStartXRef.current - event.clientX;
                    setVfoDragOffsetPx(vfoDragDistancePxRef.current);
                    if (waterfallZoom > 1) {
                      setWaterfallPanHz(
                        getWaterfallVfoDragPan({
                          hardwareRange: vfoFrequencyRange,
                          zoom: waterfallZoom,
                          startPanHz: vfoDragStartPanRef.current,
                          dragDistancePx: vfoDragDistancePxRef.current,
                          viewportWidthPx: vfoDragViewportWidthRef.current,
                          allowNegativeFrequencies,
                        }),
                      );
                      return;
                    }
                    const startFrequency =
                      vfoDragStartFrequencyRef.current ?? vfoFrequency;
                    const fullSpan =
                      vfoFrequencyRange.max - vfoFrequencyRange.min;
                    tuneVfo(
                      startFrequency +
                        (vfoDragDistancePxRef.current /
                          vfoDragViewportWidthRef.current) *
                          fullSpan,
                      true,
                    );
                  }
                }}
                onPointerUp={() => {
                  setVfoDragOffsetPx(0);
                  vfoDragStartFrequencyRef.current = null;
                  vfoDragDistancePxRef.current = 0;
                }}
                onPointerCancel={() => {
                  setVfoDragOffsetPx(0);
                  vfoDragStartFrequencyRef.current = null;
                  vfoDragDistancePxRef.current = 0;
                }}
              />
            )}
            <FIFOWaterfall
              key={waterfallSessionKey}
              width={640}
              height={220}
              waveform={transformedDisplayWaveform}
              waveformFeed={transformedWaveformFeed}
              frequencyRange={zoomedFrequencyRange}
              fftMin={waterfallDbMin}
              fftMax={waterfallDbMax}
              retuneSmear={1}
              isPaused={isPaused}
              isVisible={true}
              performScalarResampling={performScalarResampling}
              awaitingDeviceData={false}
              placeholderSourceLabel={data.label}
              placeholderState={filePlaceholderState}
              waterfallHistoryFill={
                data.analysisOptions ? "immutable" : "accretive"
              }
              historyZoom={data.analysisOptions ? waterfallZoom : 1}
              historyPan={
                data.analysisOptions
                  ? waterfallPanHz /
                    Math.max(1, vfoFrequencyRange.max - vfoFrequencyRange.min)
                  : 0
              }
              colormap={waterfallColormap}
              colormapName={waterfallTheme}
              binSubset={binSubset}
            />
            {data.analysisOptions && (
              <BrushOverlay
                ref={brushOverlayRef}
                $active={isBrushEnabled || isZoomBoxEnabled}
                className="nodrag nopan"
                data-testid="waterfall-brush-overlay"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                onPointerDown={handleBrushPointerDown}
                onPointerMove={handleBrushPointerMove}
                onPointerUp={stopBrushStroke}
                onPointerCancel={stopBrushStroke}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseMove={(event) => {
                  if (brushDragRef.current) event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseUp={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                {zoomBox &&
                  isZoomBoxEnabled &&
                  (() => {
                    const left = Math.min(zoomBox.start.x, zoomBox.end.x);
                    const top = Math.min(zoomBox.start.y, zoomBox.end.y);
                    const width = Math.abs(zoomBox.end.x - zoomBox.start.x);
                    const height = Math.abs(zoomBox.end.y - zoomBox.start.y);
                    const preview = getWaterfallZoomBoxView({
                      hardwareRange: vfoFrequencyRange,
                      currentZoom: waterfallZoom,
                      currentPanHz: waterfallPanHz,
                      selectionStartX: zoomBox.start.x,
                      selectionEndX: zoomBox.end.x,
                      allowNegativeFrequencies,
                    });
                    const label = formatMiniVfoFrequency(
                      (preview.visibleRange.min + preview.visibleRange.max) / 2,
                    );
                    const labelWidth = Math.min(
                      0.42,
                      0.16 + label.length * 0.009,
                    );
                    const labelX = Math.max(
                      0.01,
                      Math.min(
                        0.99 - labelWidth,
                        left + width / 2 - labelWidth / 2,
                      ),
                    );
                    const labelY = Math.max(0.01, top - 0.08);
                    return (
                      <g pointerEvents="none">
                        <rect
                          x={left}
                          y={top}
                          width={width}
                          height={height}
                          fill="rgba(59, 130, 246, 0.18)"
                          stroke="#60a5fa"
                          strokeWidth="0.006"
                        />
                        <rect
                          x={labelX}
                          y={labelY}
                          width={labelWidth}
                          height="0.06"
                          rx="0.03"
                          fill="rgba(15, 23, 42, 0.96)"
                          stroke="#38bdf8"
                          strokeWidth="0.004"
                        />
                        <text
                          x={labelX + labelWidth / 2}
                          y={labelY + 0.04}
                          fill="#e2e8f0"
                          fontSize="0.028"
                          fontFamily="JetBrains Mono, monospace"
                          fontWeight="700"
                          textAnchor="middle"
                        >
                          {label}
                        </text>
                      </g>
                    );
                  })()}
                {brushLine && (
                  <>
                    {brushFreehandPoints.length > 1 &&
                      brushDragRef.current === "draw" && (
                        <polyline
                          points={brushFreehandPoints
                            .map(({ x, y }) => `${x},${y}`)
                            .join(" ")}
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth="0.012"
                        />
                      )}
                    <path
                      d={(() => {
                        const control = getBrushCurveControlPoint(brushLine);
                        return `M ${brushLine.left.x} ${brushLine.left.y} Q ${control.x} ${control.y} ${brushLine.right.x} ${brushLine.right.y}`;
                      })()}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="0.012"
                      pointerEvents="none"
                    />
                    {(["left", "center", "right"] as const).map((handle) => (
                      <ellipse
                        key={handle}
                        cx={brushLine[handle].x}
                        cy={brushLine[handle].y}
                        rx={0.025 / Math.max(1, brushAspectRatio)}
                        ry="0.025"
                        fill="#3b82f6"
                        stroke="#dbeafe"
                        strokeWidth="0.004"
                        data-brush-handle={handle}
                        onPointerDown={handleBrushHandleDown(handle)}
                      />
                    ))}
                  </>
                )}
              </BrushOverlay>
            )}
            {data.analysisOptions && showVfoEditor && !isVfoLocked && (
              <EditableCenterFrequency
                centerFrequencyHz={vfoFrequency}
                onCenterFrequencyChange={tuneVfo}
                onClose={() => setShowVfoEditor(false)}
                placement="top"
                allowNegativeFrequencies={allowNegativeFrequencies}
                windowSpanHz={
                  frequencyRange.max - frequencyRange.min
                }
              />
            )}
          </AnalysisViewport>
          <AnalysisTools
            $analysis={data.analysisOptions}
            className="nodrag nopan"
            data-testid={data.analysisOptions ? "waterfall-analysis-tools" : "waterfall-compact-controls"}
            onMouseDown={stopNodeDrag}
            onPointerDown={stopNodeDrag}
          >
            <VisualizerSliders
              compact
              zoom={waterfallZoom}
              dbMin={waterfallDbMin}
              dbMax={waterfallDbMax}
              powerScale={powerScale}
              onZoomChange={handleWaterfallZoomChange}
              onDbMinChange={handleDbMinChange}
              onDbMaxChange={handleDbMaxChange}
            />
          {data.analysisOptions && (
              <AnalysisIconGrid data-testid="waterfall-analysis-icon-grid">
                <AnalysisToolButton
                  type="button"
                  aria-label={isVfoLocked ? "Unlock VFO" : "Lock VFO"}
                  aria-pressed={isVfoLocked}
                  onClick={() => {
                    setIsVfoLocked((locked) => {
                      if (!locked) setShowVfoEditor(false);
                      return !locked;
                    });
                  }}
                >
                  {isVfoLocked ? <Lock size={16} /> : <Unlock size={16} />}
                </AnalysisToolButton>
                <AnalysisToolButton
                  type="button"
                  aria-label="Paint with selection"
                  aria-pressed={isBrushEnabled}
                  onClick={() => setIsBrushEnabled((enabled) => !enabled)}
                >
                  <Brush size={16} />
                </AnalysisToolButton>
                <AnalysisToolButton
                  type="button"
                  aria-label="Apply power normalization"
                  aria-pressed={isNormalizationEnabled}
                  disabled={!brushLine}
                  onClick={() =>
                    setIsNormalizationEnabled((enabled) => !enabled)
                  }
                >
                  <Zap size={16} />
                </AnalysisToolButton>
                <AnalysisToolButton
                  type="button"
                  aria-label="Zoom selection"
                  aria-pressed={isZoomBoxEnabled}
                  onClick={() => {
                    setIsZoomBoxEnabled((enabled) => !enabled);
                    setZoomBox(null);
                  }}
                >
                  <SquareDashed size={16} />
                </AnalysisToolButton>
                <AnalysisToolButton
                  type="button"
                  aria-label="Clear brush strokes"
                  disabled={isVfoLocked}
                  onClick={clearBrushStrokes}
                >
                  <Trash2 size={16} />
                </AnalysisToolButton>
                <AnalysisBinSubsetControl>
                  <AnalysisToolButton
                    ref={binSubsetButtonRef}
                    $active={
                      isBinSubsetPopoverOpen || binSubset.mode === "interleaved"
                    }
                    type="button"
                    aria-label="Bin Subset"
                    aria-expanded={isBinSubsetPopoverOpen}
                    aria-controls="waterfall-bin-subset-popover"
                    aria-pressed={
                      isBinSubsetPopoverOpen || binSubset.mode === "interleaved"
                    }
                    data-state={
                      isBinSubsetPopoverOpen || binSubset.mode === "interleaved"
                        ? "active"
                        : "inactive"
                    }
                    title="Bin Subset"
                    onClick={() =>
                      setIsBinSubsetPopoverOpen((isOpen) => !isOpen)
                    }
                  >
                    <ListFilter size={16} />
                  </AnalysisToolButton>
                  <Popover
                    open={isBinSubsetPopoverOpen}
                    anchorRef={binSubsetButtonRef}
                    onClose={() => setIsBinSubsetPopoverOpen(false)}
                    horizontalAnchor="right"
                    title="Bin Subset"
                    id="waterfall-bin-subset-popover"
                    role="dialog"
                    aria-label="Bin Subset"
                    style={{ width: 190, padding: 8 }}
                    onPointerDown={stopNodeDrag}
                  >
                    <AnalysisBinSubsetField>
                      Mode
                      <AnalysisBinSubsetSelect
                        aria-label="Bin Subset"
                        value={binSubset.mode}
                        onChange={(event) => {
                          const mode = event.target
                            .value as WaterfallBinSubset["mode"];
                          setBinSubset((current) => ({
                            ...current,
                            mode,
                          }));
                        }}
                      >
                        <option value="none">None</option>
                        <option value="interleaved">Interleaved</option>
                      </AnalysisBinSubsetSelect>
                    </AnalysisBinSubsetField>
                    {binSubset.mode === "interleaved" && (
                      <AnalysisBinSubsetField>
                        Bins
                        <AnalysisBinSubsetSelect
                          aria-label="Bins"
                          value={binSubset.parity}
                          onChange={(event) =>
                            setBinSubset((current) => ({
                              ...current,
                              parity: event.target
                                .value as WaterfallBinSubset["parity"],
                            }))
                          }
                        >
                          <option value="odd">Odd</option>
                          <option value="even">Even</option>
                        </AnalysisBinSubsetSelect>
                      </AnalysisBinSubsetField>
                    )}
                  </Popover>
                </AnalysisBinSubsetControl>
              </AnalysisIconGrid>
            )}
              {data.analysisOptions && (
                <AnalysisResetButton
                  type="button"
                  onClick={resetAnalysisControls}
                >
                  Reset
                </AnalysisResetButton>
              )}
              {!data.analysisOptions && (
                <AnalysisResetButton type="button" onClick={resetAnalysisControls}>
                  Reset
                </AnalysisResetButton>
              )}
            </AnalysisTools>
        </AnalysisLayout>
        {data.showMiniVfo && data.miniVfoPosition === "bottom" && (
          <Vfo
            visualState="compact"
            drawingType="dom"
            orientation="bottom"
            frequencyRange={displayFrequencyRange}
            centerFrequencyHz={(frequencyRange.min + frequencyRange.max) / 2}
            style={{ height: 56, flex: "0 0 56px" }}
            data-testid="waterfall-node-mini-vfo"
            data-position="bottom"
          />
        )}
        {data.analysisOptions && (
          <AnalysisThemeRow
            className="nodrag nopan"
            data-testid="waterfall-analysis-theme-row"
            onMouseDown={stopNodeDrag}
            onPointerDown={stopNodeDrag}
          >
            <AnalysisThemeLabel>Waterfall</AnalysisThemeLabel>
            <AnalysisThemeSelect
              aria-label="Waterfall theme"
              value={waterfallTheme}
              onChange={(event) =>
                dispatch(setWaterfallTheme(event.target.value))
              }
            >
              {Object.keys(WATERFALL_COLORMAPS).map((themeId) => (
                <option key={themeId} value={themeId}>
                  {themeId.charAt(0).toUpperCase() +
                    themeId.slice(1).replace("_", " ")}
                </option>
              ))}
            </AnalysisThemeSelect>
          </AnalysisThemeRow>
        )}
      </CanvasContainer>
    </NodeWrapper>
  );
};

export const WaterfallNode = React.memo(WaterfallNodeComponent);
