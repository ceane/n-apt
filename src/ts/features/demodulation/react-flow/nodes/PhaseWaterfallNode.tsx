import React, { useMemo } from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import { selectActiveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import {
  fileFrameRuntime,
  liveFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import {
  FIFOWaterfall,
  newestIqWindow,
} from "@n-apt/spectrum/public/FIFOWaterfall";
import {
  computeIqToPhaseSpectrum,
  MAX_PHASE_DEG,
  MIN_PHASE_DEG,
} from "@n-apt/spectrum/public/phaseSpectrum";
import { resampleNearestInto } from "@n-apt/math/resampleNearest";
import type { ColormapData, RgbTuple } from "@n-apt/consts/colormaps";
import { Vfo } from "@n-apt/layout/vfo/Vfo";
import { EditableCenterFrequency } from "@n-apt/ui/EditableCenterFrequency";
import { Lock, Unlock } from "lucide-react";
import { useVfoTuner } from "@n-apt/demodulation/react-flow/nodes/useVfoTuner";

interface FrequencyRange {
  min: number;
  max: number;
}

interface PhaseWaterfallNodeProps {
  data?: { label?: React.ReactNode };
  frequencyRange?: FrequencyRange | null;
}

/** Node box. FIFOWaterfall measures its own canvas from this box, so its size
 * props only matter before the first measurement — they mirror it. */
const NODE_WIDTH = 880;
const NODE_HEIGHT = 540;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: ${({ theme }) => theme.colors.surface};
  padding: 6px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const HeaderMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
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

/** Inset the axis so its edge tick labels clear the node border. */
const VfoRow = styled.div`
  flex: 0 0 56px;
  display: flex;
  padding: 0 16px;
`;

const CanvasRow = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
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
  data,
  frequencyRange,
}) => {
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
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
    vfoTestId: "phase-waterfall-vfo",
  });

  const rangeSpan = Math.max(
    1,
    vfo.vfoFrequencyRange.max - vfo.vfoFrequencyRange.min,
  );

  const phaseFeed = useMemo(() => {
    const sourceRef =
      sourceMode === "file" ? fileFrameRuntime.ref : liveFrameRuntime.ref;
    let lastFrame: unknown = null;
    let lastPhase: Float32Array | null = null;

    // Returns a row only when a new frame landed; the buffer is reused, which
    // the feed contract explicitly supports.
    const computeLatestPhase = (): Float32Array | null => {
      const current = Array.isArray(sourceRef.current)
        ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
        : sourceRef.current;
      if (!current || current === lastFrame) return null;

      const iq = (current as { iq_data?: Uint8Array })?.iq_data;
      if (!iq?.length) return null;

      lastFrame = current;
      lastPhase = computeIqToPhaseSpectrum(
        newestIqWindow(iq, fftSize),
        { fftSize },
        lastPhase ?? undefined,
      );
      return lastPhase;
    };

    return {
      getCurrent: () => lastPhase,
      subscribe: (listener: (waveform: Float32Array) => void) => {
        let frameHandle: number | null = null;
        let disposed = false;

        const tick = () => {
          if (disposed) return;
          const phase = computeLatestPhase();
          if (phase) listener(phase);
          frameHandle = window.requestAnimationFrame(tick);
        };

        frameHandle = window.requestAnimationFrame(tick);

        return () => {
          disposed = true;
          if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
        };
      },
    };
  }, [sourceMode, fftSize]);

  const performScalarResampling = useMemo(
    () =>
      (input: ArrayLike<number>, targetLength: number, output?: Float32Array) =>
        // Neutral phase, not a dB floor, for any bins the resampler cannot fill.
        resampleNearestInto(input, targetLength, 0, output),
    [],
  );

  return (
    <OuterContainer data-testid="phase-waterfall-node">
      <Header>
        <HeaderLeft>
          <Title>{data?.label ?? "Phase"}</Title>
          <DeviceTitle>{deviceName}</DeviceTitle>
        </HeaderLeft>
        <HeaderMeta>
          <MetaText>
            <MetaInfoLabel>FFT SIZE:</MetaInfoLabel> {fftSize}
          </MetaText>
          <Legend>
            <span>{MIN_PHASE_DEG}°</span>
            <LegendGradient />
            <span>{MAX_PHASE_DEG}°</span>
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
      </Header>
      <Viewport
        ref={vfo.viewportRef}
        className="nodrag nopan nowheel"
        data-testid="phase-waterfall-viewport"
        {...vfo.viewportHandlers}
      >
        {/* Inside the gesture area so a wheel over the axis zooms/pans/tunes. */}
        <VfoRow>
          <Vfo
            visualState="compact"
            drawingType="dom"
            orientation="top"
            cursorMotion
            cursorOffsetPx={vfo.cursorOffsetPx}
            frequencyRange={vfo.visibleRange}
            centerFrequencyHz={vfo.displayCenterFrequencyHz}
            style={{ height: 56, flex: 1, minWidth: 0 }}
            className="nodrag nopan"
            data-testid="phase-waterfall-vfo"
            {...vfo.vfoHandlers}
          />
        </VfoRow>
        <CanvasRow>
          <FIFOWaterfall
            width={NODE_WIDTH}
            height={NODE_HEIGHT}
            waveform={null}
            waveformFeed={phaseFeed}
            frequencyRange={vfo.visibleRange}
            fftMin={MIN_PHASE_DEG}
            fftMax={MAX_PHASE_DEG}
            retuneSmear={1}
            isPaused={false}
            isVisible
            waterfallHistoryFill="immutable"
            historyZoom={vfo.zoom}
            historyPan={vfo.panHz / rangeSpan}
            performScalarResampling={performScalarResampling}
            colormap={PHASE_COLORMAP}
            colormapName={PHASE_COLORMAP_NAME}
            placeholderSourceLabel={
              typeof data?.label === "string" ? data.label : "Phase"
            }
          />
        </CanvasRow>
      </Viewport>
      {vfo.isEditorOpen && !vfo.isLocked && (
        <EditableCenterFrequency
          centerFrequencyHz={vfo.vfoFrequency}
          onCenterFrequencyChange={vfo.tuneVfo}
          onClose={vfo.closeEditor}
          placement="top"
          allowNegativeFrequencies={allowNegativeFrequencies}
          windowSpanHz={vfo.vfoFrequencyRange.max - vfo.vfoFrequencyRange.min}
        />
      )}
    </OuterContainer>
  );
};

export default PhaseWaterfallNode;
