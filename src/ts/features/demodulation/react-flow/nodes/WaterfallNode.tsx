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
  getLiveFrameRefForSource,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { useActivePresentationFrameRef } from "@n-apt/app/infrastructure/visualization/useActivePresentationFrame";
import {
  FIFOWaterfall,
  VisualizerSliders,
} from "@n-apt/spectrum/public/FIFOWaterfall";
import {
  setAutoZoomStability,
  setVizZoomFloor,
  setVizZoomFloorPan,
  useAppDispatch,
  useAppSelector,
} from "@n-apt/redux";
import { selectSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import { setWaterfallTheme } from "@n-apt/redux/slices/themeSlice";
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
import {
  clampCenteredFrequencyRange,
  getFrequencyRangeCenterHz,
} from "@n-apt/math/frequency";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import { resampleNearestInto } from "@n-apt/math/resampleNearest";
import { getFilePlaceholderState } from "@n-apt/app/infrastructure/io/filePlaceholderState";
import { isFilePlaybackPaused } from "@n-apt/spectrum/public/liveSourceLifecycle";
import { getSourcePresentationSessionKey } from "@n-apt/spectrum/public/liveSourceLifecycle";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import { Vfo } from "@n-apt/layout/vfo/Vfo";
import { selectArrayOrEmpty } from "@n-apt/redux/selectors/stableSelectorDefaults";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import type { FrequencyRange } from "@n-apt/consts/types";
import { isTxStandbyPreviewSource } from "@n-apt/spectrum/public/liveSourceLifecycle";
import {
  DEFAULT_WATERFALL_BIN_SUBSET,
  type WaterfallBinSubset,
} from "@n-apt/spectrum/public/waterfallBinSubset";
import {
  getVisualizerDefaultDbLimits,
  VISUALIZER_DEFAULT_ZOOM,
} from "@n-apt/consts/visualizerControls";
import {
  formatMiniVfoFrequency,
  getWaterfallVfoDisplayFrequency,
  getWaterfallZoomBoxView,
} from "@n-apt/demodulation/react-flow/nodes/waterfallView";
import { useVfoTuner } from "@n-apt/demodulation/react-flow/nodes/useVfoTuner";
import { shouldApplyNonHardwareSourcePattern } from "@n-apt/layout/rendering/nonHardwarePattern";
import {
  createAccretiveWaterfallFeed,
  createWaterfallSourceFeed,
  cropAccretiveWaterfallRow,
  type WaterfallSourceFrame,
} from "@n-apt/demodulation/react-flow/nodes/waterfallSourceBuffer";
import {
  formatWaterfallSpan,
  WATERFALL_ANALYSIS_COLUMN_GAP,
  WATERFALL_ANALYSIS_CONTROL_RAIL_WIDTH,
  WATERFALL_ANALYSIS_NODE_WIDTH,
  WATERFALL_CONTROL_RAIL_WIDTH,
  WATERFALL_NODE_HEIGHT,
  WATERFALL_NODE_WIDTH,
  WATERFALL_SOURCE_FFT_SIZE,
} from "@n-apt/demodulation/react-flow/nodes/waterfallLayout";
import { useNodeFastSnapshot } from "@n-apt/demodulation/react-flow/nodes/useNodeFastSnapshot";
import { usePersistDemodNodeData } from "@n-apt/demodulation/react-flow/nodes/usePersistDemodNodeData";

interface WaterfallNodeProps {
  id?: string;
  data: {
    waterfallOptions: boolean;
    label: string;
    showMiniVfo?: boolean;
    miniVfoPosition?: "top" | "bottom";
    sourceRole?: "rx" | "tx";
    sourceBindingGroup?: string;
    analysisOptions?: boolean;
    fastSnapshotShowStats?: boolean;
  };
}

const FLOW_WATERFALL_FFT_SIZE = WATERFALL_SOURCE_FFT_SIZE;

export const getWaterfallNodeFrequencyRange = ({
  sourceRole,
  fallbackRange,
  expectedCenterFrequencyHz,
  expectedSampleRateHz,
  frame,
  allowNegativeFrequencies: _allowNegativeFrequencies = false,
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
  allowNegativeFrequencies: _allowNegativeFrequencies = false,
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
  width: ${({ $analysis }) =>
    $analysis
      ? `${WATERFALL_ANALYSIS_NODE_WIDTH}px`
      : `${WATERFALL_NODE_WIDTH}px`};
  min-width: ${({ $analysis }) =>
    $analysis
      ? `${WATERFALL_ANALYSIS_NODE_WIDTH}px`
      : `${WATERFALL_NODE_WIDTH}px`};
  height: ${WATERFALL_NODE_HEIGHT}px;
  max-height: ${WATERFALL_NODE_HEIGHT}px;
  min-height: ${WATERFALL_NODE_HEIGHT}px;
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
  padding: 0;
  width: max-content;
  pointer-events: auto;

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
  padding: 0;
  overflow: hidden;
  position: relative;
`;

const _DbControls = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 8px 0;
  flex: 0 0 auto;
  pointer-events: auto;
`;

const AnalysisLayout = styled.div<{ $analysis?: boolean }>`
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    ${({ $analysis }) =>
      $analysis
        ? `${WATERFALL_ANALYSIS_CONTROL_RAIL_WIDTH}px`
        : `${WATERFALL_CONTROL_RAIL_WIDTH}px`};
  gap: ${({ $analysis }) =>
    $analysis ? `${WATERFALL_ANALYSIS_COLUMN_GAP}px` : "0"};
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

const StandaloneBottomVfoRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) ${WATERFALL_CONTROL_RAIL_WIDTH}px;
  gap: 0;
  flex: 0 0 56px;
  min-width: 0;
  background: ${({ theme }) => theme.colors?.surface || "#212121"};

  > [data-testid="waterfall-node-mini-vfo"] {
    width: 100%;
    min-width: 0;
  }
`;

const StandaloneHiddenVfoSpacer = styled.div`
  flex: 0 0 56px;
  width: 100%;
  background: ${({ theme }) => theme.colors?.surface || "#212121"};
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
  width: 132px;
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
  width: auto;
  padding: 0;
  background: transparent;
  pointer-events: auto;
`;

const WaterfallHud = styled.header`
  box-sizing: border-box;
  flex: 0 0 72px;
  min-height: 72px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 5px 12px;
  background: ${({ theme }) => theme.colors?.surface || "#212121"};
  border-bottom: 1px solid ${({ theme }) => theme.colors?.border || "#475569"};
`;

const WaterfallHudTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
`;

const WaterfallHudMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: ${({ theme }) => theme.colors?.textSecondary || "#94a3b8"};
  font: 9px ${({ theme }) => theme.typography?.mono || "monospace"};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const WaterfallHudType = styled.span`
  color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  white-space: nowrap;
`;

const WaterfallHudFft = styled.span`
  white-space: nowrap;
`;

const WaterfallHudSnapshot = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 1px 0;
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
  background: ${({ theme }) => theme.colors?.surface || "#212121"};
  padding-top: 0;
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
  /* The HUD is outside the viewport and the VFO is a fixed 56px row. Anchor
   * the brush to the remaining
   * waterfall viewport with both top and bottom edges instead of combining a
   * top inset with a calculated height; the latter can be distorted by the
   * React Flow node's flex/grid sizing and makes the zoombox look squashed. */
  inset: 56px 0 0;
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

const formatDb = (value: number, unit = "dB") => `${value.toFixed(0)} ${unit}`;

const getIqMutationMarker = (iq: Uint8Array | null | undefined): string => {
  if (!iq || iq.length === 0) return "";
  const middle = iq[Math.floor(iq.length / 2)] ?? 0;
  return `${iq.length}:${iq[0] ?? 0}:${middle}:${iq[iq.length - 1] ?? 0}`;
};

const WaterfallNodeComponent: React.FC<WaterfallNodeProps> = ({ id, data }) => {
  const dispatch = useAppDispatch();
  const { persistedNodeData, persistNodeData } = usePersistDemodNodeData(
    id,
    "waterfall",
    { fastSnapshotShowStats: data.fastSnapshotShowStats },
  );
  const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const setWaterfallCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    waterfallCanvasRef.current = canvas;
  }, []);
  const setWaterfallOverlayCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      waterfallOverlayCanvasRef.current = canvas;
    },
    [],
  );
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const sourceMode = useAppSelector(
    (state) => state.waterfall?.sourceMode ?? "live",
  );
  const activeLiveFrameRef = useActivePresentationFrameRef();
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
  const waterfallFftSize = FLOW_WATERFALL_FFT_SIZE;
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
  const roleLiveFrameRef = useMemo(
    () =>
      data.sourceRole
        ? getLiveFrameRefForSource(
            roleSourceId,
            data.sourceRole === "tx" ? "tx" : "rx",
          )
        : activeLiveFrameRef,
    [activeLiveFrameRef, data.sourceRole, roleSourceId],
  );
  const roleSourceDerived = useAppSelector((state) =>
    selectSourceDerivedState(state, roleSourceId),
  );
  const patternOverNonHardwareSources = useAppSelector(
    (state) => state.theme.patternOverNonHardwareSources,
  );
  const nonHardwareSourcePattern = shouldApplyNonHardwareSourcePattern({
    enabled: patternOverNonHardwareSources,
    deviceKind: roleSourceDerived.deviceProfile?.kind,
    backend: roleSourceDerived.backend,
    deviceName: roleSourceDerived.deviceName,
    isNonHardwareSource: sourceMode === "file",
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
  const stitchState = useAppSelector(
    (state) => state.waterfall?.stitchState ?? "idle",
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
  const waterfallDbUnit = powerScale === "dBm" ? "dBm" : "dB";
  const _formatWaterfallDb = useCallback(
    (value: number) => formatDb(value, waterfallDbUnit),
    [waterfallDbUnit],
  );
  const waterfallSourceRef = useMemo(
    () => (sourceMode === "file" ? fileFrameRuntime.ref : roleLiveFrameRef),
    [roleLiveFrameRef, sourceMode],
  );
  const sharedWaterfallFeed = useMemo(
    () =>
      createWaterfallSourceFeed(
        `${sourceMode}:${roleSourceId ?? "none"}:${data.sourceRole === "tx" ? "tx" : "active"}`,
        waterfallSourceRef,
        "level",
        powerScale === "dBm" ? 30 : 0,
      ),
    [data.sourceRole, powerScale, roleSourceId, sourceMode, waterfallSourceRef],
  );

  useEffect(() => {
    if (!data.analysisOptions) return;
    // The main visualizer's stability floor is a global presentation setting;
    // Analysis owns its zoom/pan locally and must not inherit that floor.
    dispatch(setAutoZoomStability(false));
    dispatch(setVizZoomFloor(1));
    dispatch(setVizZoomFloorPan(0));
  }, [data.analysisOptions, dispatch]);

  // Throttled data polling — frequency metadata and file-waveform playback use
  // React state; the shared source buffer handles I/Q spectrum rows separately.
  const getCurrentFrame = useCallback(() => {
    const sourceRef =
      sourceMode === "file" ? fileFrameRuntime.ref : roleLiveFrameRef;
    return sourceMode === "file" && Array.isArray(sourceRef.current)
      ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
      : sourceRef.current;
  }, [roleLiveFrameRef, sourceMode]);
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
        setFrameRevision((revision) => revision + 1);
      }
    }, 125);
    return () => clearInterval(id);
  }, [data.sourceRole, getCurrentFrame, roleSourceId, sourceMode]);

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
    const frame = liveFrame as
      | (LiveFrameData & { waveform?: Float32Array | null })
      | null;
    if (frame?.iq_data?.length) return null;
    const fileWaveform = sourceMode === "file" ? frame?.waveform : null;
    return fileWaveform?.length ? fileWaveform : null;
  }, [frameRevision, liveFrame, sourceMode]);
  const displayWaveform = waveform;
  const liveWaveformFeed =
    sourceMode === "file" &&
    !(liveFrame as LiveFrameData | null)?.iq_data?.length
      ? undefined
      : sharedWaterfallFeed;

  const filePlaceholderState = getFilePlaceholderState({
    sourceMode,
    selectedFilesCount: selectedFiles.length,
    stitchStatus,
    stitchState,
    hasRenderableFrame: Boolean(
      waveform?.length || liveWaveformFeed?.getCurrent()?.length,
    ),
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
  // Tuning surface (VFO center, view zoom/pan, gestures, center editor) is
  // shared with the phase waterfall node; see useVfoTuner.
  const {
    zoom: waterfallZoom,
    setZoom: setWaterfallZoom,
    panHz: waterfallPanHz,
    setPanHz: setWaterfallPanHz,
    vfoFrequency,
    setVfoFrequency,
    vfoFrequencyRange,
    displayCenterFrequencyHz: vfoDisplayCenterFrequencyHz,
    visibleRange: zoomedFrequencyRange,
    isLocked: isVfoLocked,
    setIsLocked: setIsVfoLocked,
    isEditorOpen: showVfoEditor,
    setIsEditorOpen: setShowVfoEditor,
    cursorOffsetPx: vfoDragOffsetPx,
    viewportRef: vfoViewportRef,
    viewportHandlers: vfoViewportHandlers,
    vfoHandlers,
    resetUserTuning: resetVfoUserTuning,
    tuneCenterFrequency,
  } = useVfoTuner({
    frequencyRange,
    allowNegativeFrequencies,
    zoomPanEnabled: true,
    retuneWhenUnzoomed: true,
    sessionKey: waterfallSessionKey,
    viewSyncKey: `${sourceMode}:${roleSourceId ?? "none"}${data.sourceRole === "tx" ? ":tx" : ""}`,
    vfoTestId: "waterfall-analysis-vfo",
    // A pinch over the viewport supersedes any in-flight brush stroke.
    onPinchStart: () => {
      brushDragRef.current = null;
    },
  });
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
    resetVfoUserTuning();
    setVfoFrequency((frequencyRange.min + frequencyRange.max) / 2);
    setIsVfoLocked(false);
    setShowVfoEditor(false);
  }, [frequencyRange.max, frequencyRange.min, powerScale]);
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
      // Mirror mode pans on an unbounded signed display axis (same contract
      // as the spectrum route's getStableVizPanForZoomChange and useVfoTuner):
      // clamping here would snap a below-DC view back across DC on every
      // slider tick.
      if (allowNegativeFrequencies) return;
      const fullSpan = vfoFrequencyRange.max - vfoFrequencyRange.min;
      const maxPanHz = Math.max(
        0,
        fullSpan / 2 - fullSpan / Math.max(1, zoom) / 2,
      );
      setWaterfallPanHz((panHz) =>
        Math.max(-maxPanHz, Math.min(maxPanHz, panHz)),
      );
    },
    [vfoFrequencyRange.max, vfoFrequencyRange.min, allowNegativeFrequencies],
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
  const { snapshotControl } = useNodeFastSnapshot({
    frequencyRange: data.analysisOptions
      ? zoomedFrequencyRange
      : frequencyRange,
    dbMin: waterfallDbMin,
    dbMax: waterfallDbMax,
    powerScale,
    waterfallScaleUnit: waterfallDbUnit,
    spectrogramType: `Power / ${powerScale}`,
    filenamePrefix: "waterfall",
    sourceName: roleSourceDerived.deviceName || "SDR Device",
    fftSize: waterfallFftSize,
    isDeviceConnected: roleSourceDerived.deviceState === "connected",
    fastSnapshotShowStats: persistedNodeData.fastSnapshotShowStats as
      | boolean
      | undefined,
    persistNodeData,
    waterfallCanvasRef,
    waterfallOverlayCanvasRef,
  });
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
  const transformWaveform = useCallback(
    (nextWaveform: Float32Array) => {
      // Spectrum FFT owns the |f| fold on the GPU. Never CPU-extend here —
      // the live waveform subscribe path was allocating a full mirrored row
      // every frame with the option on.
      if (!brushLine || !isNormalizationEnabled) {
        return nextWaveform;
      }
      return normalizeSpectrumToBrushLine(
        nextWaveform,
        brushLine,
        fftMinDb,
        fftMaxDb,
      );
    },
    [brushLine, fftMaxDb, fftMinDb, isNormalizationEnabled],
  );
  const accretiveTransformRef = useRef<
    (row: Float32Array, frame?: WaterfallSourceFrame) => Float32Array
  >((row) => row);
  accretiveTransformRef.current = (row, frame) => {
    const frameSpan =
      frame?.sampleRateHz ?? vfoFrequencyRange.max - vfoFrequencyRange.min;
    const frameCenter =
      frame?.centerFrequencyHz ??
      (vfoFrequencyRange.min + vfoFrequencyRange.max) / 2;
    const viewSpan = zoomedFrequencyRange.max - zoomedFrequencyRange.min;
    const viewCenter =
      (zoomedFrequencyRange.min + zoomedFrequencyRange.max) / 2;
    return cropAccretiveWaterfallRow(
      transformWaveform(row),
      frameSpan / Math.max(1, viewSpan),
      viewCenter - frameCenter,
      frameSpan,
    );
  };
  const transformedDisplayWaveform = displayWaveform
    ? data.analysisOptions
      ? transformWaveform(displayWaveform)
      : accretiveTransformRef.current(displayWaveform)
    : displayWaveform;
  const accretiveFeed = useMemo(
    () =>
      liveWaveformFeed
        ? createAccretiveWaterfallFeed(liveWaveformFeed, (row, frame) =>
            accretiveTransformRef.current(row, frame),
          )
        : undefined,
    [liveWaveformFeed],
  );
  const transformedWaveformFeed = useMemo(() => {
    if (!data.analysisOptions) return accretiveFeed;
    if (!liveWaveformFeed) return liveWaveformFeed;
    return {
      replayHistory: liveWaveformFeed.replayHistory,
      getCurrent: () => {
        const current = liveWaveformFeed.getCurrent();
        return current ? transformWaveform(current) : null;
      },
      subscribe: (listener: (nextWaveform: Float32Array) => void) =>
        liveWaveformFeed.subscribe((nextWaveform: Float32Array) =>
          listener(transformWaveform(nextWaveform)),
        ),
    };
  }, [
    accretiveFeed,
    data.analysisOptions,
    liveWaveformFeed,
    transformWaveform,
  ]);
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
      <CanvasContainer $analysis={data.analysisOptions}>
        <WaterfallHud data-testid="waterfall-node-hud">
          <WaterfallHudTop>
            <NodeTitle
              $analysis={data.analysisOptions}
              className={data.analysisOptions ? "drag-handle" : undefined}
            >
              {data.label}
            </NodeTitle>
            <WaterfallHudMeta>
              <WaterfallHudType>
                Spectrogram Type: Power / {powerScale}
              </WaterfallHudType>
              <WaterfallHudFft>FFT SIZE: {waterfallFftSize}</WaterfallHudFft>
              {!data.analysisOptions && (
                <WaterfallHudFft>
                  ZOOM: {waterfallZoom.toFixed(1)}x
                </WaterfallHudFft>
              )}
              <WaterfallHudFft>
                SPAN:{" "}
                {formatWaterfallSpan(
                  zoomedFrequencyRange.max - zoomedFrequencyRange.min,
                )}
              </WaterfallHudFft>
            </WaterfallHudMeta>
            {data.analysisOptions && (
              <AnalysisThemeRow
                className="nodrag nopan"
                data-testid="waterfall-analysis-theme-row"
                onMouseDown={stopNodeDrag}
                onPointerDown={stopNodeDrag}
              >
                <AnalysisThemeLabel>Theme</AnalysisThemeLabel>
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
          </WaterfallHudTop>
          <WaterfallHudSnapshot
            className="nodrag nopan"
            onMouseDown={stopNodeDrag}
            onPointerDown={stopNodeDrag}
          >
            {snapshotControl}
          </WaterfallHudSnapshot>
        </WaterfallHud>
        <AnalysisLayout $analysis={data.analysisOptions}>
          <AnalysisViewport
            ref={vfoViewportRef}
            $analysis={data.analysisOptions}
            className="nodrag nopan nowheel"
            data-testid="waterfall-analysis-viewport"
            {...vfoViewportHandlers}
          >
            {!data.analysisOptions &&
              data.miniVfoPosition !== "bottom" &&
              (data.showMiniVfo ?? true) && (
                <Vfo
                  visualState="compact"
                  drawingType="dom"
                  orientation="top"
                  frequencyRange={displayZoomedFrequencyRange}
                  centerFrequencyHz={getWaterfallVfoDisplayFrequency({
                    hardwareCenterHz: vfoFrequency,
                    visibleRange: zoomedFrequencyRange,
                  })}
                  style={{ height: 56, flex: "0 0 56px" }}
                  data-testid="waterfall-node-mini-vfo"
                  data-position="top"
                />
              )}
            {!data.analysisOptions && !(data.showMiniVfo ?? true) && (
              <StandaloneHiddenVfoSpacer aria-hidden="true" />
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
                {...vfoHandlers}
              />
            )}
            <FIFOWaterfall
              key={`${waterfallSessionKey}:${waterfallDbMin}:${waterfallDbMax}:${waterfallTheme}:${binSubset.mode}:${binSubset.parity}`}
              width={WATERFALL_NODE_WIDTH - WATERFALL_CONTROL_RAIL_WIDTH}
              height={WATERFALL_NODE_HEIGHT}
              waveform={
                transformedWaveformFeed?.getCurrent() ??
                transformedDisplayWaveform
              }
              waveformFeed={transformedWaveformFeed}
              onWaterfallCanvasReady={setWaterfallCanvas}
              onPatternOverlayCanvasReady={setWaterfallOverlayCanvas}
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
              nonHardwareSourcePattern={nonHardwareSourcePattern}
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
                centerFrequencyHz={vfoDisplayCenterFrequencyHz}
                onCenterFrequencyChange={tuneCenterFrequency}
                onClose={() => setShowVfoEditor(false)}
                placement="top"
                allowNegativeFrequencies={allowNegativeFrequencies}
              />
            )}
          </AnalysisViewport>
          <AnalysisTools
            $analysis={data.analysisOptions}
            className="nodrag nopan"
            data-testid={
              data.analysisOptions
                ? "waterfall-analysis-tools"
                : "waterfall-compact-controls"
            }
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
              <AnalysisResetButton
                type="button"
                onClick={resetAnalysisControls}
              >
                Reset
              </AnalysisResetButton>
            )}
          </AnalysisTools>
        </AnalysisLayout>
        {!data.analysisOptions &&
          data.showMiniVfo &&
          data.miniVfoPosition === "bottom" && (
            <StandaloneBottomVfoRow>
              <Vfo
                visualState="compact"
                drawingType="dom"
                orientation="bottom"
                frequencyRange={displayZoomedFrequencyRange}
                centerFrequencyHz={getWaterfallVfoDisplayFrequency({
                  hardwareCenterHz: vfoFrequency,
                  visibleRange: zoomedFrequencyRange,
                })}
                style={{ height: 56, flex: "0 0 56px" }}
                data-testid="waterfall-node-mini-vfo"
                data-position="bottom"
              />
              <div aria-hidden="true" />
            </StandaloneBottomVfoRow>
          )}
      </CanvasContainer>
    </NodeWrapper>
  );
};

export const WaterfallNode = React.memo(WaterfallNodeComponent);
