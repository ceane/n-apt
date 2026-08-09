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
  min-height: 56px;
  box-sizing: border-box;
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
  $cursorMotion: boolean;
  $offset: number;
  $orientation: VfoOrientation;
}>`
  position: absolute;
  left: 50%;
  top: ${({ $orientation }) => ($orientation === "top" ? "auto" : "8px")};
  bottom: ${({ $orientation }) => ($orientation === "top" ? "8px" : "auto")};
  transform: ${({ $cursorMotion, $offset }) =>
    `translateX(calc(-50% + ${$cursorMotion ? $offset : 0}px))`};
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${({ theme }) => theme.colors?.textPrimary ?? "#e2e8f0"};
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  z-index: 1;
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
      {ticks.map((frequencyHz, index) => {
        const left = span > 0 ? ((frequencyHz - frequencyRange.min) / span) * 100 : 50;
        const edge = index === 0 ? "left" : index === ticks.length - 1 ? "right" : undefined;
        return (
          <React.Fragment key={`${frequencyHz}-${index}`}>
            <Tick $left={left} $orientation={options.orientation} />
            <TickLabel
              $left={left}
              $edge={edge}
              $orientation={options.orientation}
            >
              {formatDomFrequency(frequencyHz)}
            </TickLabel>
          </React.Fragment>
        );
      })}
      <CenterLabel
        $cursorMotion={options.cursorMotion}
        $offset={cursorOffsetPx}
        $orientation={options.orientation}
      >
        <span>○ {formatDomFrequency(center)}</span>
        {accessory ? (
          <CenterStatus data-testid="unified-vfo-status">
            {accessory}
          </CenterStatus>
        ) : null}
      </CenterLabel>
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
