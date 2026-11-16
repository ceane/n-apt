import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { Lock, Unlock } from "lucide-react";
import { useAppSelector } from "@n-apt/redux";
import { selectActiveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import { shouldApplyNonHardwareSourcePattern } from "@n-apt/layout/rendering/nonHardwarePattern";
import { fileFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { useActivePresentationFrameRef } from "@n-apt/app/infrastructure/visualization/useActivePresentationFrame";
import {
  FIFOWaterfall,
  VisualizerSliders,
} from "@n-apt/spectrum/public/FIFOWaterfall";
import { resampleNearestInto } from "@n-apt/math/resampleNearest";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";
import { getVisualizerDefaultDbLimits } from "@n-apt/consts/visualizerControls";
import { Vfo } from "@n-apt/layout/vfo/Vfo";
import { EditableCenterFrequency } from "@n-apt/ui/EditableCenterFrequency";
import { useVfoTuner } from "@n-apt/demodulation/react-flow/nodes/useVfoTuner";
import type { VfoTunerPersistedView } from "@n-apt/demodulation/react-flow/nodes/useVfoTuner";
import { useNodeFastSnapshot } from "@n-apt/demodulation/react-flow/nodes/useNodeFastSnapshot";
import { usePersistDemodNodeData } from "@n-apt/demodulation/react-flow/nodes/usePersistDemodNodeData";
import { createWaterfallSourceFeed } from "@n-apt/demodulation/react-flow/nodes/waterfallSourceBuffer";
import {
  formatWaterfallSpan,
  WATERFALL_CONTROL_RAIL_WIDTH,
  WATERFALL_NODE_HEIGHT,
  WATERFALL_NODE_WIDTH,
  WATERFALL_SOURCE_FFT_SIZE,
} from "@n-apt/demodulation/react-flow/nodes/waterfallLayout";

interface FrequencyRange {
  min: number;
  max: number;
}

type AmplitudeDisplayMode = "level" | "variance";

interface AmplitudeWaterfallNodeProps {
  id?: string;
  data?: {
    label?: React.ReactNode;
    amplitudeDisplayMode?: AmplitudeDisplayMode;
    amplitudeLevelDbMin?: number;
    amplitudeLevelDbMax?: number;
    amplitudeVarianceDbMin?: number;
    amplitudeVarianceDbMax?: number;
    fastSnapshotShowStats?: boolean;
    vfoZoom?: number;
    vfoPanHz?: number;
    vfoFrequencyHz?: number;
    vfoIsLocked?: boolean;
  };
  frequencyRange?: FrequencyRange | null;
}

/** FIFOWaterfall measures its canvas from this fixed node box. */
const NODE_WIDTH = WATERFALL_NODE_WIDTH;
const NODE_HEIGHT = WATERFALL_NODE_HEIGHT;
const CONTROL_RAIL_WIDTH = WATERFALL_CONTROL_RAIL_WIDTH;
const VARIANCE_DB_LIMITS = { min: 0, max: 5 };
const VARIANCE_DB_MIN_RANGE = { min: 0, max: 25 };
const VARIANCE_DB_MAX_RANGE = { min: 5, max: 30 };

const persistedNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const OuterContainer = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: ${NODE_WIDTH}px;
  min-width: ${NODE_WIDTH}px;
  height: ${NODE_HEIGHT}px;
  min-height: ${NODE_HEIGHT}px;
  max-height: ${NODE_HEIGHT}px;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  overflow: hidden;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const Header = styled.div`
  box-sizing: border-box;
  flex: 0 0 72px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  background: ${({ theme }) => theme.colors.surface};
  padding: 6px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const HeaderTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const HeaderMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const SnapshotActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px 0;
`;

const DeviceTitle = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Title = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 800;
`;

const MetaText = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
  white-space: nowrap;
`;

const ZoomReadout = styled.div`
  padding: 3px 6px;
  border: 1px solid ${({ theme }) => theme.colors.primary}55;
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.activeBackground};
  color: ${({ theme }) => theme.colors.primary};
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
`;

const Legend = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 8px;
  color: ${({ theme }) => theme.colors.textMuted};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
`;

const LegendGradient = styled.div<{ $gradient: string }>`
  width: 80px;
  height: 8px;
  border-radius: 2px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ $gradient }) => $gradient};
`;

const Badge = styled.div`
  background: ${({ theme }) => theme.colors.activeBackground};
  border: 1px solid ${({ theme }) => theme.colors.primary}33;
  color: ${({ theme }) => theme.colors.primary};
  font-size: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
`;

const HeaderIconButton = styled.button<{ $active?: boolean }>`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
  opacity: ${({ $active }) => ($active ? 1 : 0.6)};
  padding: 2px;
  display: flex;
  align-items: center;

  &:hover {
    opacity: 1;
  }
`;

const ModeSelect = styled.select`
  appearance: none;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 9px;
  padding: 4px 7px;

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary};
    outline-offset: 1px;
  }
`;

const Viewport = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
`;

const VfoRow = styled.div`
  flex: 0 0 56px;
  display: flex;
  min-width: 0;
  background: ${({ theme }) => theme.colors.surface};
`;

const VfoPlot = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;

  > [data-testid="amplitude-waterfall-vfo"] {
    height: 56px;
    flex: 1;
    min-width: 0;
  }
`;

const VfoControlSpacer = styled.div`
  flex: 0 0 ${CONTROL_RAIL_WIDTH}px;
  width: ${CONTROL_RAIL_WIDTH}px;
`;

const CanvasRow = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
`;

const WaterfallPlot = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
`;

const ControlRail = styled.aside`
  box-sizing: border-box;
  width: ${CONTROL_RAIL_WIDTH}px;
  flex: 0 0 ${CONTROL_RAIL_WIDTH}px;
  min-height: 0;
  display: flex;
  padding: 8px 4px;
  border-left: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
`;

const formatRgb = (rgb: [number, number, number]) =>
  `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const getColormapGradient = (colormap: [number, number, number][]) => {
  if (colormap.length === 0) return "linear-gradient(to right, #000, #fff)";
  const positions = [0, 0.25, 0.5, 0.75, 1];
  const stops = positions.map((position) => {
    const color = colormap[Math.round(position * (colormap.length - 1))];
    return `${formatRgb(color)} ${position * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
};

/**
 * Shows per-frequency signal level or its recent standard deviation over time.
 * Variance mode retains recent changes in a fading trail so amplitude
 * modulation remains visible across the selected VFO band.
 */
export const AmplitudeWaterfallNode: React.FC<AmplitudeWaterfallNodeProps> = ({
  id,
  data,
  frequencyRange,
}) => {
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const activeLiveFrameRef = useActivePresentationFrameRef();
  const fftSize = WATERFALL_SOURCE_FFT_SIZE;
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const powerScale = useAppSelector(
    (state) => state.spectrum.powerScale ?? "dB",
  );
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const patternOverNonHardwareSources = useAppSelector(
    (state) => state.theme.patternOverNonHardwareSources,
  );
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const allowNegativeFrequencies = useAppSelector(
    (state) => state.settings.mirrorIqBasebandBelowZero,
  );
  const spectrumFrequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const waterfallTheme = useAppSelector((state) => state.theme.waterfallTheme);
  const { persistedNodeData, persistNodeData, persistNodeDataDebounced } =
    usePersistDemodNodeData(id, "amplitude-waterfall", {
      amplitudeDisplayMode: data?.amplitudeDisplayMode,
      amplitudeLevelDbMin: data?.amplitudeLevelDbMin,
      amplitudeLevelDbMax: data?.amplitudeLevelDbMax,
      amplitudeVarianceDbMin: data?.amplitudeVarianceDbMin,
      amplitudeVarianceDbMax: data?.amplitudeVarianceDbMax,
      fastSnapshotShowStats: data?.fastSnapshotShowStats,
      vfoZoom: data?.vfoZoom,
      vfoPanHz: data?.vfoPanHz,
      vfoFrequencyHz: data?.vfoFrequencyHz,
      vfoIsLocked: data?.vfoIsLocked,
    });
  const [displayMode, setDisplayMode] = useState<AmplitudeDisplayMode>(() =>
    persistedNodeData.amplitudeDisplayMode === "level" ? "level" : "variance",
  );
  const [levelDbMin, setLevelDbMin] = useState(() =>
    persistedNumber(persistedNodeData.amplitudeLevelDbMin, fftMinDb),
  );
  const [levelDbMax, setLevelDbMax] = useState(() =>
    persistedNumber(persistedNodeData.amplitudeLevelDbMax, fftMaxDb),
  );
  const [varianceDbMin, setVarianceDbMin] = useState(() =>
    persistedNumber(
      persistedNodeData.amplitudeVarianceDbMin,
      VARIANCE_DB_LIMITS.min,
    ),
  );
  const [varianceDbMax, setVarianceDbMax] = useState(() =>
    persistedNumber(
      persistedNodeData.amplitudeVarianceDbMax,
      VARIANCE_DB_LIMITS.max,
    ),
  );
  const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleVfoViewChange = useCallback(
    (view: VfoTunerPersistedView) => {
      persistNodeDataDebounced({
        vfoZoom: view.zoom,
        vfoPanHz: view.panHz,
        vfoFrequencyHz: view.vfoFrequencyHz,
        vfoIsLocked: view.isLocked,
      });
    },
    [persistNodeDataDebounced],
  );
  const isVarianceMode = displayMode === "variance";
  const waterfallDbMin = isVarianceMode ? varianceDbMin : levelDbMin;
  const waterfallDbMax = isVarianceMode ? varianceDbMax : levelDbMax;
  const amplitudeUnit = isVarianceMode
    ? "dB σ"
    : powerScale === "dBm"
      ? "dBm (approx.)"
      : "dBFS";
  const spectrogramType = `Amplitude / ${isVarianceMode ? "Variance" : "Level"}`;
  const previousPowerScale = useRef(powerScale);

  useEffect(() => {
    if (previousPowerScale.current === powerScale) return;
    previousPowerScale.current = powerScale;
    const defaultDbLimits = getVisualizerDefaultDbLimits(powerScale);
    setLevelDbMin(defaultDbLimits.min);
    setLevelDbMax(defaultDbLimits.max);
    persistNodeDataDebounced({
      amplitudeLevelDbMin: defaultDbLimits.min,
      amplitudeLevelDbMax: defaultDbLimits.max,
    });
  }, [persistNodeDataDebounced, powerScale]);

  const nonHardwareSourcePattern = shouldApplyNonHardwareSourcePattern({
    enabled: patternOverNonHardwareSources,
    deviceKind: activeSourceDerived.deviceProfile?.kind,
    backend: activeSourceDerived.backend,
    deviceName: activeSourceDerived.deviceName,
    isNonHardwareSource: sourceMode === "file",
  });
  const deviceName = activeSourceDerived.deviceName || "SDR Device";
  const colormap =
    WATERFALL_COLORMAPS[waterfallTheme] ?? WATERFALL_COLORMAPS.classic;
  const colormapGradient = useMemo(
    () => getColormapGradient(colormap),
    [colormap],
  );

  const resolvedRange = useMemo<FrequencyRange>(() => {
    const candidate = frequencyRange ?? spectrumFrequencyRange;
    if (
      candidate &&
      Number.isFinite(candidate.min) &&
      Number.isFinite(candidate.max) &&
      candidate.max > candidate.min
    ) {
      return { min: candidate.min, max: candidate.max };
    }
    return { min: 0, max: 1 };
  }, [frequencyRange, spectrumFrequencyRange]);

  const vfo = useVfoTuner({
    frequencyRange: resolvedRange,
    allowNegativeFrequencies,
    zoomPanEnabled: true,
    retuneWhenUnzoomed: true,
    sessionKey: `${sourceMode}:${activeSourceId ?? "none"}`,
    viewSyncKey: `${sourceMode}:${activeSourceId ?? "none"}`,
    vfoTestId: "amplitude-waterfall-vfo",
    initialView: {
      zoom: persistedNodeData.vfoZoom as number | undefined,
      panHz: persistedNodeData.vfoPanHz as number | undefined,
      vfoFrequencyHz: persistedNodeData.vfoFrequencyHz as number | undefined,
      isLocked: persistedNodeData.vfoIsLocked as boolean | undefined,
    },
    onViewChange: handleVfoViewChange,
  });
  const setWaterfallCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    waterfallCanvasRef.current = canvas;
  }, []);
  const setWaterfallOverlayCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      waterfallOverlayCanvasRef.current = canvas;
    },
    [],
  );

  const handleDbMinChange = useCallback(
    (value: number) => {
      if (isVarianceMode) {
        const nextValue = Math.min(value, varianceDbMax - 5);
        setVarianceDbMin(nextValue);
        persistNodeDataDebounced({ amplitudeVarianceDbMin: nextValue });
      } else {
        const nextValue = Math.min(value, levelDbMax - 5);
        setLevelDbMin(nextValue);
        persistNodeDataDebounced({ amplitudeLevelDbMin: nextValue });
      }
    },
    [isVarianceMode, levelDbMax, persistNodeDataDebounced, varianceDbMax],
  );
  const handleDbMaxChange = useCallback(
    (value: number) => {
      if (isVarianceMode) {
        const nextValue = Math.max(value, varianceDbMin + 5);
        setVarianceDbMax(nextValue);
        persistNodeDataDebounced({ amplitudeVarianceDbMax: nextValue });
      } else {
        const nextValue = Math.max(value, levelDbMin + 5);
        setLevelDbMax(nextValue);
        persistNodeDataDebounced({ amplitudeLevelDbMax: nextValue });
      }
    },
    [isVarianceMode, levelDbMin, persistNodeDataDebounced, varianceDbMin],
  );
  const stopNodeDrag = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);
  const handleDisplayModeChange = useCallback(
    (mode: AmplitudeDisplayMode) => {
      setDisplayMode(mode);
      persistNodeData({ amplitudeDisplayMode: mode });
    },
    [persistNodeData],
  );
  const { snapshotControl, isRecording } = useNodeFastSnapshot({
    frequencyRange: vfo.visibleRange,
    dbMin: waterfallDbMin,
    dbMax: waterfallDbMax,
    powerScale,
    waterfallScaleUnit: amplitudeUnit,
    spectrogramType,
    filenamePrefix: "amplitude-waterfall",
    sourceName: deviceName,
    fftSize,
    isDeviceConnected: activeSourceDerived.deviceState === "connected",
    fastSnapshotShowStats: persistedNodeData.fastSnapshotShowStats as
      | boolean
      | undefined,
    persistNodeData,
    waterfallCanvasRef,
    waterfallOverlayCanvasRef,
  });

  const rangeSpan = Math.max(
    1,
    vfo.vfoFrequencyRange.max - vfo.vfoFrequencyRange.min,
  );
  const amplitudeSourceRef = useMemo(
    () => (sourceMode === "file" ? fileFrameRuntime.ref : activeLiveFrameRef),
    [activeLiveFrameRef, sourceMode],
  );
  const amplitudeFeed = useMemo(
    () =>
      createWaterfallSourceFeed(
        `${sourceMode}:${activeSourceId ?? "none"}:active`,
        amplitudeSourceRef,
        isVarianceMode ? "variance" : "level",
        powerScale === "dBm" ? 30 : 0,
      ),
    [
      activeSourceId,
      amplitudeSourceRef,
      isVarianceMode,
      powerScale,
      sourceMode,
    ],
  );

  const performScalarResampling = useMemo(
    () =>
      (input: ArrayLike<number>, targetLength: number, output?: Float32Array) =>
        resampleNearestInto(input, targetLength, waterfallDbMin, output),
    [waterfallDbMin],
  );

  const label = typeof data?.label === "string" ? data.label : "Amplitude";

  return (
    <OuterContainer data-testid="amplitude-waterfall-node">
      <Header>
        <HeaderTop>
          <HeaderLeft>
            <Title>{data?.label ?? "Amplitude"}</Title>
            <DeviceTitle>{deviceName}</DeviceTitle>
          </HeaderLeft>
          <HeaderMeta>
            <ZoomReadout
              data-testid="amplitude-waterfall-zoom"
              aria-label={`Zoom ${vfo.zoom.toFixed(1)} times`}
            >
              ZOOM {vfo.zoom.toFixed(1)}x
            </ZoomReadout>
            <MetaText>
              SPAN:{" "}
              {formatWaterfallSpan(vfo.visibleRange.max - vfo.visibleRange.min)}
            </MetaText>
            <MetaText>FFT SIZE: {fftSize}</MetaText>
            <ModeSelect
              aria-label="Amplitude waterfall mode"
              data-testid="amplitude-waterfall-mode"
              title={
                isVarianceMode
                  ? "Per-frequency rolling standard deviation within the visible VFO band; recent changes fade out"
                  : "Instantaneous signal level in each frequency bin"
              }
              value={displayMode}
              disabled={isRecording}
              onChange={(event) =>
                handleDisplayModeChange(
                  event.target.value as AmplitudeDisplayMode,
                )
              }
            >
              <option value="variance">Variance</option>
              <option value="level">Level</option>
            </ModeSelect>
            <Legend
              aria-label={`${isVarianceMode ? "Level variation" : "Signal level"} ${waterfallDbMin} to ${waterfallDbMax} ${amplitudeUnit}`}
            >
              <span>
                {waterfallDbMin} {amplitudeUnit}
              </span>
              <LegendGradient $gradient={colormapGradient} />
              <span>
                {waterfallDbMax} {amplitudeUnit}
              </span>
            </Legend>
            <Badge>{isVarianceMode ? "AM VARIANCE" : "AM LEVEL"}</Badge>
            <HeaderIconButton
              type="button"
              aria-label={vfo.isLocked ? "Unlock VFO" : "Lock VFO"}
              aria-pressed={vfo.isLocked}
              $active={vfo.isLocked}
              onClick={() => vfo.setIsLocked((locked) => !locked)}
            >
              {vfo.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
            </HeaderIconButton>
          </HeaderMeta>
        </HeaderTop>
        <SnapshotActions
          className="nodrag nopan"
          onMouseDown={stopNodeDrag}
          onPointerDown={stopNodeDrag}
        >
          {snapshotControl}
        </SnapshotActions>
      </Header>
      <Viewport
        ref={vfo.viewportRef}
        className="nodrag nopan nowheel"
        data-testid="amplitude-waterfall-viewport"
        {...vfo.viewportHandlers}
      >
        <VfoRow>
          <VfoPlot>
            <Vfo
              visualState="compact"
              drawingType="dom"
              orientation="top"
              cursorMotion
              cursorOffsetPx={vfo.cursorOffsetPx}
              frequencyRange={vfo.visibleRange}
              centerFrequencyHz={vfo.displayCenterFrequencyHz}
              className="nodrag nopan"
              data-testid="amplitude-waterfall-vfo"
              {...vfo.vfoHandlers}
            />
          </VfoPlot>
          <VfoControlSpacer aria-hidden="true" />
        </VfoRow>
        <CanvasRow>
          <WaterfallPlot>
            <FIFOWaterfall
              key={`${sourceMode}:${activeSourceId ?? "none"}:${fftSize}:${waterfallTheme}:${displayMode}:${waterfallDbMin}:${waterfallDbMax}`}
              width={NODE_WIDTH - CONTROL_RAIL_WIDTH}
              height={NODE_HEIGHT}
              waveform={amplitudeFeed.getCurrent()}
              waveformFeed={amplitudeFeed}
              onWaterfallCanvasReady={setWaterfallCanvas}
              onPatternOverlayCanvasReady={setWaterfallOverlayCanvas}
              frequencyRange={vfo.visibleRange}
              fftMin={waterfallDbMin}
              fftMax={waterfallDbMax}
              retuneSmear={1}
              isPaused={false}
              isVisible
              waterfallHistoryFill="immutable"
              historyZoom={vfo.zoom}
              historyPan={vfo.panHz / rangeSpan}
              performScalarResampling={performScalarResampling}
              colormap={colormap}
              colormapName={waterfallTheme}
              nonHardwareSourcePattern={nonHardwareSourcePattern}
              placeholderSourceLabel={label}
            />
          </WaterfallPlot>
          <ControlRail
            className="nodrag nopan"
            data-testid="amplitude-waterfall-controls"
            onMouseDown={stopNodeDrag}
            onPointerDown={stopNodeDrag}
          >
            <VisualizerSliders
              compact
              showZoom={false}
              zoom={vfo.zoom}
              dbMin={waterfallDbMin}
              dbMax={waterfallDbMax}
              powerScale={powerScale}
              dbMinRange={isVarianceMode ? VARIANCE_DB_MIN_RANGE : undefined}
              dbMaxRange={isVarianceMode ? VARIANCE_DB_MAX_RANGE : undefined}
              dbUnitLabel={isVarianceMode ? "dB σ" : undefined}
              onZoomChange={vfo.setZoom}
              onDbMinChange={handleDbMinChange}
              onDbMaxChange={handleDbMaxChange}
            />
          </ControlRail>
        </CanvasRow>
      </Viewport>
      {vfo.isEditorOpen && !vfo.isLocked && (
        <EditableCenterFrequency
          centerFrequencyHz={vfo.displayCenterFrequencyHz}
          onCenterFrequencyChange={vfo.tuneCenterFrequency}
          onClose={vfo.closeEditor}
          placement="top"
          allowNegativeFrequencies={allowNegativeFrequencies}
        />
      )}
    </OuterContainer>
  );
};

export default AmplitudeWaterfallNode;
