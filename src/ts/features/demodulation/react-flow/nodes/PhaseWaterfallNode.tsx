import React, { useCallback, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import { selectActiveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import { shouldApplyNonHardwareSourcePattern } from "@n-apt/layout/rendering/nonHardwarePattern";
import { fileFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { useActivePresentationFrameRef } from "@n-apt/app/infrastructure/visualization/useActivePresentationFrame";
import {
  FIFOWaterfall,
  VisualizerSliders,
} from "@n-apt/spectrum/public/FIFOWaterfall";
import {
  MAX_PHASE_DEG,
  MIN_PHASE_DEG,
} from "@n-apt/spectrum/public/phaseSpectrum";
import { resampleNearestInto } from "@n-apt/math/resampleNearest";
import type { ColormapData, RgbTuple } from "@n-apt/consts/colormaps";
import { Vfo } from "@n-apt/layout/vfo/Vfo";
import { EditableCenterFrequency } from "@n-apt/ui/EditableCenterFrequency";
import { Lock, Unlock } from "lucide-react";
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

interface PhaseWaterfallNodeProps {
  id?: string;
  data?: {
    label?: React.ReactNode;
    fastSnapshotShowStats?: boolean;
    phaseDbMin?: number;
    phaseDbMax?: number;
    vfoZoom?: number;
    vfoPanHz?: number;
    vfoFrequencyHz?: number;
    vfoIsLocked?: boolean;
  };
  frequencyRange?: FrequencyRange | null;
}

/** Node box. FIFOWaterfall measures its own canvas from this box, so its size
 * props only matter before the first measurement — they mirror it. */
const NODE_WIDTH = WATERFALL_NODE_WIDTH;
const NODE_HEIGHT = WATERFALL_NODE_HEIGHT;
const PHASE_COLORMAP_NAME = "phase";
const LUT_SIZE = 256;

/**
 * Fully saturated hue wheel. Phase is cyclic, so -180° and +180° must render
 * as the same color; the first and last LUT entries are therefore both red.
 */
const hueToRgb = (hueDegrees: number): RgbTuple => {
  const hue = ((hueDegrees % 360) + 360) % 360;
  const sector = hue / 60;
  const x = Math.round(255 * (1 - Math.abs((sector % 2) - 1)));

  if (sector < 1) return [255, x, 0];
  if (sector < 2) return [x, 255, 0];
  if (sector < 3) return [0, 255, x];
  if (sector < 4) return [0, x, 255];
  if (sector < 5) return [x, 0, 255];
  return [255, 0, x];
};

const PHASE_COLORMAP: ColormapData = Array.from({ length: LUT_SIZE }, (_, i) =>
  hueToRgb((i / (LUT_SIZE - 1)) * 360),
);

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

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
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

const MetaInfoLabel = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  margin-right: 6px;
`;

const Title = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 800;
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

const Legend = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 8px;
  color: ${({ theme }) => theme.colors.textMuted};
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const LegendGradient = styled.div`
  width: 90px;
  height: 8px;
  border-radius: 2px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: linear-gradient(
    to right,
    rgb(255, 0, 0),
    rgb(255, 255, 0),
    rgb(0, 255, 0),
    rgb(0, 255, 255),
    rgb(0, 0, 255),
    rgb(255, 0, 255),
    rgb(255, 0, 0)
  );
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

  > [data-testid="phase-waterfall-vfo"] {
    height: 56px;
    flex: 1;
    min-width: 0;
  }
`;

const VfoControlSpacer = styled.div`
  flex: 0 0 ${WATERFALL_CONTROL_RAIL_WIDTH}px;
  width: ${WATERFALL_CONTROL_RAIL_WIDTH}px;
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
  width: ${WATERFALL_CONTROL_RAIL_WIDTH}px;
  flex: 0 0 ${WATERFALL_CONTROL_RAIL_WIDTH}px;
  min-height: 0;
  display: flex;
  padding: 8px 4px;
  border-left: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
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

/**
 * Phase waterfall: the phase of every FFT bin over time, colored by angle.
 *
 * Rows are produced through the imperative `waveformFeed` (not React state), so
 * a new frame appends a history row without re-rendering the node.
 */
export const PhaseWaterfallNode: React.FC<PhaseWaterfallNodeProps> = ({
  id,
  data,
  frequencyRange,
}) => {
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const activeLiveFrameRef = useActivePresentationFrameRef();
  const fftSize = WATERFALL_SOURCE_FFT_SIZE;
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const patternOverNonHardwareSources = useAppSelector(
    (state) => state.theme.patternOverNonHardwareSources,
  );
  const nonHardwareSourcePattern = shouldApplyNonHardwareSourcePattern({
    enabled: patternOverNonHardwareSources,
    deviceKind: activeSourceDerived.deviceProfile?.kind,
    backend: activeSourceDerived.backend,
    deviceName: activeSourceDerived.deviceName,
    isNonHardwareSource: sourceMode === "file",
  });
  const deviceName = activeSourceDerived.deviceName || "SDR Device";
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const allowNegativeFrequencies = useAppSelector(
    (state) => state.settings.mirrorIqBasebandBelowZero,
  );
  const spectrumFrequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const { persistedNodeData, persistNodeData, persistNodeDataDebounced } =
    usePersistDemodNodeData(id, "phase-waterfall", {
      fastSnapshotShowStats: data?.fastSnapshotShowStats,
      phaseDbMin: data?.phaseDbMin,
      phaseDbMax: data?.phaseDbMax,
      vfoZoom: data?.vfoZoom,
      vfoPanHz: data?.vfoPanHz,
      vfoFrequencyHz: data?.vfoFrequencyHz,
      vfoIsLocked: data?.vfoIsLocked,
    });
  const [phaseDbMin, setPhaseDbMin] = useState(() =>
    typeof persistedNodeData.phaseDbMin === "number"
      ? persistedNodeData.phaseDbMin
      : MIN_PHASE_DEG,
  );
  const [phaseDbMax, setPhaseDbMax] = useState(() =>
    typeof persistedNodeData.phaseDbMax === "number"
      ? persistedNodeData.phaseDbMax
      : MAX_PHASE_DEG,
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
  const handleDbMinChange = useCallback(
    (value: number) => {
      const nextValue = Math.min(value, phaseDbMax - 5);
      setPhaseDbMin(nextValue);
      persistNodeDataDebounced({ phaseDbMin: nextValue });
    },
    [persistNodeDataDebounced, phaseDbMax],
  );
  const handleDbMaxChange = useCallback(
    (value: number) => {
      const nextValue = Math.max(value, phaseDbMin + 5);
      setPhaseDbMax(nextValue);
      persistNodeDataDebounced({ phaseDbMax: nextValue });
    },
    [persistNodeDataDebounced, phaseDbMin],
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
    // The phase waterfall always retains history, so gestures zoom/pan it.
    zoomPanEnabled: true,
    // At 1x there is nothing to pan, so a gesture must retune the receiver for
    // the band to move at all.
    retuneWhenUnzoomed: true,
    sessionKey: `${sourceMode}:${activeSourceId ?? "none"}`,
    viewSyncKey: `${sourceMode}:${activeSourceId ?? "none"}`,
    vfoTestId: "phase-waterfall-vfo",
    initialView: {
      zoom: persistedNodeData.vfoZoom as number | undefined,
      panHz: persistedNodeData.vfoPanHz as number | undefined,
      vfoFrequencyHz: persistedNodeData.vfoFrequencyHz as number | undefined,
      isLocked: persistedNodeData.vfoIsLocked as boolean | undefined,
    },
    onViewChange: handleVfoViewChange,
  });
  const { snapshotControl } = useNodeFastSnapshot({
    frequencyRange: vfo.visibleRange,
    dbMin: phaseDbMin,
    dbMax: phaseDbMax,
    waterfallScaleUnit: "°",
    spectrogramType: "Phase",
    filenamePrefix: "phase-waterfall",
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
  const stopNodeDrag = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const rangeSpan = Math.max(
    1,
    vfo.vfoFrequencyRange.max - vfo.vfoFrequencyRange.min,
  );

  const phaseSourceRef = useMemo(
    () => (sourceMode === "file" ? fileFrameRuntime.ref : activeLiveFrameRef),
    [activeLiveFrameRef, sourceMode],
  );
  const phaseFeed = useMemo(
    () =>
      createWaterfallSourceFeed(
        `${sourceMode}:${activeSourceId ?? "none"}:active`,
        phaseSourceRef,
        "phase",
      ),
    [activeSourceId, phaseSourceRef, sourceMode],
  );

  const performScalarResampling = useMemo(
    () =>
      (input: ArrayLike<number>, targetLength: number, output?: Float32Array) =>
        resampleNearestInto(input, targetLength, phaseDbMin, output),
    [phaseDbMin],
  );
  return (
    <OuterContainer data-testid="phase-waterfall-node">
      <Header>
        <HeaderTop>
          <HeaderLeft>
            <Title>{data?.label ?? "Phase"}</Title>
            <DeviceTitle>{deviceName}</DeviceTitle>
          </HeaderLeft>
          <HeaderMeta>
            <ZoomReadout
              data-testid="phase-waterfall-zoom"
              aria-label={`Zoom ${vfo.zoom.toFixed(1)} times`}
            >
              ZOOM {vfo.zoom.toFixed(1)}x
            </ZoomReadout>
            <MetaText>
              SPAN:{" "}
              {formatWaterfallSpan(vfo.visibleRange.max - vfo.visibleRange.min)}
            </MetaText>
            <MetaText>
              <MetaInfoLabel>FFT SIZE:</MetaInfoLabel> {fftSize}
            </MetaText>
            <Legend>
              <span>{phaseDbMin}°</span>
              <LegendGradient />
              <span>{phaseDbMax}°</span>
            </Legend>
            <Badge>Phase</Badge>
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
        data-testid="phase-waterfall-viewport"
        {...vfo.viewportHandlers}
      >
        {/* Inside the gesture area so a wheel over the axis zooms/pans/tunes. */}
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
              data-testid="phase-waterfall-vfo"
              {...vfo.vfoHandlers}
            />
          </VfoPlot>
          <VfoControlSpacer aria-hidden="true" />
        </VfoRow>
        <CanvasRow>
          <WaterfallPlot>
            <FIFOWaterfall
              key={`${sourceMode}:${activeSourceId ?? "none"}:${fftSize}:${phaseDbMin}:${phaseDbMax}`}
              width={NODE_WIDTH - WATERFALL_CONTROL_RAIL_WIDTH}
              height={NODE_HEIGHT}
              waveform={phaseFeed.getCurrent()}
              waveformFeed={phaseFeed}
              onWaterfallCanvasReady={setWaterfallCanvas}
              onPatternOverlayCanvasReady={setWaterfallOverlayCanvas}
              frequencyRange={vfo.visibleRange}
              fftMin={phaseDbMin}
              fftMax={phaseDbMax}
              retuneSmear={1}
              isPaused={false}
              isVisible
              waterfallHistoryFill="immutable"
              historyZoom={vfo.zoom}
              historyPan={vfo.panHz / rangeSpan}
              performScalarResampling={performScalarResampling}
              colormap={PHASE_COLORMAP}
              colormapName={PHASE_COLORMAP_NAME}
              nonHardwareSourcePattern={nonHardwareSourcePattern}
              placeholderSourceLabel={
                typeof data?.label === "string" ? data.label : "Phase"
              }
            />
          </WaterfallPlot>
          <ControlRail
            className="nodrag nopan"
            data-testid="phase-waterfall-controls"
            onMouseDown={stopNodeDrag}
            onPointerDown={stopNodeDrag}
          >
            <VisualizerSliders
              compact
              showZoom={false}
              zoom={vfo.zoom}
              dbMin={phaseDbMin}
              dbMax={phaseDbMax}
              dbUnitLabel="°"
              dbMinRange={{ min: MIN_PHASE_DEG, max: MAX_PHASE_DEG - 5 }}
              dbMaxRange={{ min: MIN_PHASE_DEG + 5, max: MAX_PHASE_DEG }}
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

export default PhaseWaterfallNode;
