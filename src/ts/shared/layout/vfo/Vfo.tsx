import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import styled from "styled-components";
import { findBestFrequencyRange } from "@n-apt/consts";
import { formatFrequency } from "@n-apt/math/frequency";
import {
  createCanvasVfoAxisContext,
  drawVfoAxis,
} from "@n-apt/layout/rendering/vfoAxis";
import {
  DEFAULT_VFO_OPTIONS,
  resolveVfoOptions,
  type VfoDrawingType,
  type VfoOptions,
  type VfoOrientation,
  type VfoTickPrecision,
  type VfoVisualState,
} from "@n-apt/layout/vfo/types";

export { DEFAULT_VFO_OPTIONS, resolveVfoOptions } from "@n-apt/layout/vfo/types";
export type {
  VfoDrawingType,
  VfoOptions,
  VfoOrientation,
  VfoTickPrecision,
  VfoVisualState,
} from "@n-apt/layout/vfo/types";

export interface VfoProps extends Partial<VfoOptions> {
  frequencyRange: { min: number; max: number };
  centerFrequencyHz?: number | null;
  accessory?: ReactNode;
  cursorOffsetPx?: number;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
  "data-position"?: string;
  "data-center"?: string;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  onWheel?: React.WheelEventHandler<HTMLDivElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
}

const DomVfo = styled.div<{ $orientation: VfoOrientation; $state: VfoVisualState }>`
  position: relative;
  width: 100%;
  height: 42px;
  min-height: 42px;
  flex: 0 0 42px;
  box-sizing: border-box;
  overflow: visible;
  color: ${({ theme }) => theme.colors?.textPrimary ?? "#e2e8f0"};
  font-family: ${({ theme }) => theme.typography?.mono ?? "monospace"};
  border-${({ $orientation }) => ($orientation === "top" ? "top" : "bottom")}: 1px solid ${({ theme }) => theme.colors?.border ?? "#334155"};
`;

const AxisLine = styled.div<{ $orientation: VfoOrientation }>`
  position: absolute;
  left: 4%;
  right: 4%;
  ${({ $orientation }) => ($orientation === "top" ? "top: 0;" : "bottom: 0;")}
  height: 1px;
  background: ${({ theme }) => theme.colors?.border ?? "#334155"};
`;

const Tick = styled.span<{ $left: number; $orientation: VfoOrientation }>`
  position: absolute;
  left: ${({ $left }) => `${$left}%`};
  ${({ $orientation }) => ($orientation === "top" ? "top: 0;" : "bottom: 0;")}
  width: 1px;
  height: 7px;
  background: ${({ theme }) => theme.colors?.textMuted ?? "#64748b"};
`;

const TickLabel = styled.span<{
  $left: number;
  $edge?: "left" | "right";
  $orientation: VfoOrientation;
}>`
  position: absolute;
  left: ${({ $left }) => `${$left}%`};
  top: ${({ $orientation }) => ($orientation === "top" ? "10px" : "auto")};
  bottom: ${({ $orientation }) => ($orientation === "top" ? "auto" : "10px")};
  transform: ${({ $edge }) =>
    $edge === "left"
      ? "none"
      : $edge === "right"
        ? "translateX(-100%)"
        : "translateX(-50%)"};
  color: ${({ theme }) => theme.colors?.textSecondary ?? "#94a3b8"};
  font-size: 11px;
  white-space: nowrap;
`;

const CenterLabel = styled.span<{
  $orientation: VfoOrientation;
}>`
  position: relative;
  top: auto;
  bottom: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${({ theme }) => theme.colors?.textPrimary ?? "#e2e8f0"};
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  z-index: 1;
`;

const CenterRow = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  pointer-events: none;
  z-index: 1;
`;

const CursorLine = styled.span<{ $offset: number }>`
  position: absolute;
  left: calc(50% + ${({ $offset }) => $offset}px);
  top: 50%;
  height: 24px;
  width: 1px;
  transform: translate(-50%, -50%);
  background: ${({ theme }) => theme.colors?.primary ?? "#00d4ff"};
  pointer-events: none;
  z-index: 3;
`;

const CenterStatus = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 6px;
  border: 1px solid ${({ theme }) => theme.colors?.primary ?? "#00d4ff"};
  border-radius: 999px;
  color: ${({ theme }) => theme.colors?.primary ?? "#00d4ff"};
  font-size: 11px;
  line-height: 1;
`;

const formatDomFrequency = (frequencyHz: number) =>
  formatFrequency(frequencyHz, {
    showUnits: true,
    precisionMHz: 6,
    precisionKHz: 3,
    precisionGHz: 6,
    trimTrailingZeros: true,
  }).replace(/(\d)(?=[A-Za-z])/g, "$1 ");

const DomVfoRenderer: React.FC<VfoProps & { options: VfoOptions }> = ({
  options,
  frequencyRange,
  centerFrequencyHz,
  accessory,
  cursorOffsetPx = 0,
  visualState: _visualState,
  drawingType: _drawingType,
  orientation: _orientation,
  cursorMotion: _cursorMotion,
  tickPrecision: _tickPrecision,
  ...handlers
}) => {
  const span = frequencyRange.max - frequencyRange.min;
  const center =
    typeof centerFrequencyHz === "number" && Number.isFinite(centerFrequencyHz)
      ? centerFrequencyHz
      : (frequencyRange.min + frequencyRange.max) / 2;
  const ticks = useMemo(() => {
    if (!(span > 0)) return [];
    const step = findBestFrequencyRange(
      span,
      options.tickPrecision === "reduced" ? 5 : 10,
    );
    const values = [frequencyRange.min];
    for (
      let frequencyHz = Math.ceil(frequencyRange.min / step) * step;
      frequencyHz < frequencyRange.max;
      frequencyHz += step
    ) {
      if (frequencyHz > frequencyRange.min) values.push(frequencyHz);
    }
    values.push(frequencyRange.max);
    return values;
  }, [frequencyRange.max, frequencyRange.min, options.tickPrecision, span]);
  const visibleTicks = useMemo(() => {
    if (ticks.length <= 2) return ticks.map((frequencyHz, index) => ({ frequencyHz, index }));

    const edgeReservePx = 70;
    const centerReservePx = 150;
    const estimatedWidthPx = (frequencyHz: number) =>
      Math.max(28, formatDomFrequency(frequencyHz).length * 7);
    const toPx = (frequencyHz: number) =>
      span > 0 ? ((frequencyHz - frequencyRange.min) / span) * 640 : 320;
    const occupied = [
      { start: 0, end: edgeReservePx },
      { start: 640 - edgeReservePx, end: 640 },
      {
        start: 320 - centerReservePx / 2,
        end: 320 + centerReservePx / 2,
      },
    ];
    const visible = ticks.map((frequencyHz, index) => {
      if (index === 0 || index === ticks.length - 1) {
        return { frequencyHz, index };
      }
      const centerPx = toPx(frequencyHz);
      const halfWidth = estimatedWidthPx(frequencyHz) / 2;
      const candidate = { start: centerPx - halfWidth, end: centerPx + halfWidth };
      const collides = occupied.some(
        (rect) => candidate.start < rect.end && candidate.end > rect.start,
      );
      if (collides) return null;
      occupied.push(candidate);
      return { frequencyHz, index };
    });
    return visible.filter(
      (tick): tick is { frequencyHz: number; index: number } => tick !== null,
    );
  }, [frequencyRange.min, span, ticks]);

  return (
    <DomVfo
      {...handlers}
      data-testid={handlers["data-testid"] ?? "unified-vfo"}
      data-orientation={options.orientation}
      data-tick-level={options.orientation}
      data-drawing-type={options.drawingType}
      data-visual-state={options.visualState}
      data-cursor-motion={options.cursorMotion}
      $orientation={options.orientation}
      $state={options.visualState}
    >
      <AxisLine $orientation={options.orientation} />
      {visibleTicks.map(({ frequencyHz, index }) => {
        const left = span > 0 ? ((frequencyHz - frequencyRange.min) / span) * 100 : 50;
        const edge = index === 0 ? "left" : index === ticks.length - 1 ? "right" : undefined;
        return (
          <React.Fragment key={`${frequencyHz}-${index}`}>
            <Tick $left={left} $orientation={options.orientation} />
            <TickLabel
              $left={left}
              $edge={edge}
              $orientation={options.orientation}
              data-testid={edge ? `unified-vfo-edge-${edge}` : undefined}
            >
              {formatDomFrequency(frequencyHz)}
            </TickLabel>
          </React.Fragment>
        );
      })}
      {options.cursorMotion ? (
        <CursorLine
          data-testid="unified-vfo-cursor-line"
          data-offset-px={cursorOffsetPx}
          data-vertical-alignment="center"
          $offset={cursorOffsetPx}
        />
      ) : null}
      <CenterRow
        data-testid="unified-vfo-center-row"
        data-vertical-alignment="center"
      >
        <CenterLabel
          $orientation={options.orientation}
          data-testid="unified-vfo-center-label"
        >
          <span>○ {formatDomFrequency(center)}</span>
          {accessory ? (
            <CenterStatus data-testid="unified-vfo-status">
              {accessory}
            </CenterStatus>
          ) : null}
        </CenterLabel>
      </CenterRow>
    </DomVfo>
  );
};

export const Vfo: React.FC<VfoProps> = (props) => {
  const options = resolveVfoOptions(props);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    if (options.drawingType !== "canvas") return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const width = canvas.clientWidth || 640;
    const height = options.visualState === "compact" ? 42 : 58;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    drawVfoAxis({
      ctx: createCanvasVfoAxisContext(context),
      frequencyRange: props.frequencyRange,
      centerFrequencyHz: props.centerFrequencyHz,
      bounds: { left: 8, right: width - 8, top: 0, bottom: height },
      y: options.orientation === "top" ? 8 : height - 8,
      labelY: options.orientation === "top" ? 28 : height - 8,
      orientation: options.orientation,
      tickDirection: options.orientation === "top" ? "up" : "down",
      targetTicks: options.tickPrecision === "reduced" ? 5 : 10,
      theme: {
        tick: "#64748b",
        label: "#94a3b8",
        center: "#e2e8f0",
        grid: "#334155",
      },
      icon: "circle",
      showAxisLine: true,
      showCenterLine: false,
    });
  }, [options, props.centerFrequencyHz, props.frequencyRange]);

  if (options.drawingType === "canvas") {
    return (
      <canvas
        ref={canvasRef}
        data-testid={props["data-testid"] ?? "unified-vfo"}
        data-orientation={options.orientation}
        data-tick-level={options.orientation}
        data-drawing-type={options.drawingType}
        data-visual-state={options.visualState}
        style={{ width: "100%", height: options.visualState === "compact" ? 42 : 58, ...props.style }}
        className={props.className}
      />
    );
  }

  return <DomVfoRenderer {...props} options={options} />;
};
