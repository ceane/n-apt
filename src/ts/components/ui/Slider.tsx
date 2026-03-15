import React, { useCallback } from "react";
import styled from "styled-components";

const MIN_THUMB_RATIO = 0.2;

export const SliderContainer = styled.div<{ $orientation: "vertical" | "horizontal" }>`
  display: flex;
  flex-direction: column;
  align-items: ${({ $orientation }) => ($orientation === "vertical" ? "center" : "stretch")};
  gap: 10px;
  flex: 1;
  width: 100%;
`;

export const SliderLabel = styled.span<{ $orientation: "vertical" | "horizontal" }>`
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 600;
  color: #d8d8d8;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  text-align: ${({ $orientation }) => ($orientation === "vertical" ? "center" : "left")};
`;

export interface SnapRange {
  label: string;
  min: number;
  max: number;
  color?: string;
}

export const SliderTrack = styled.div<{ $orientation: "vertical" | "horizontal" }>`
  position: relative;
  border-radius: 16px;
  background: #212121;
  display: flex;
  cursor: pointer;
  transition: scale 0.2s ease-in-out;
  position: relative;

  ${({ $orientation }) =>
    $orientation === "vertical"
      ? `
    width: 40px;
    height: 100%;
    min-height: 100px;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
  `
      : `
    height: 40px;
    width: 100%;
    min-width: 100px;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
  `}
`;

const RangeMarker = styled.div<{ $start: number; $end: number; $color?: string }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $start }) => $start}%;
  width: ${({ $start, $end }) => $end - $start}%;
  background: ${({ $color }) => $color || "rgba(255, 255, 255, 0.05)"};
  pointer-events: none;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
`;

const RangeLabel = styled.div<{ $pos: number }>`
  position: absolute;
  bottom: 2px;
  left: ${({ $pos }) => $pos}%;
  transform: translateX(-50%);
  font-size: 7px;
  color: #444;
  text-transform: uppercase;
  font-weight: 800;
  pointer-events: none;
  white-space: nowrap;
`;

const RangeTick = styled.div<{ $pos: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $pos }) => $pos}%;
  width: 1px;
  background: rgba(255, 255, 255, 0.2);
  pointer-events: none;
  z-index: 1;
`;

const TrackClipper = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 16px;
  overflow: hidden;
  pointer-events: none;
`;

export const SliderThumb = styled.div<{
  $percent: number;
  $orientation: "vertical" | "horizontal";
  $isDragging: boolean;
}>`
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  background-color: #3b3b3b;
  border-radius: 16px;
  cursor: grab;
  /* Only animate when NOT dragging, for a 'snappy' feel when clicking/snapping */
  transition: ${({ $isDragging }) =>
    $isDragging
      ? "background-color 0.2s ease"
      : "width 0.15s cubic-bezier(0.2, 0, 0, 1), height 0.15s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s ease, scale 0.1s ease"};
  
  /* Performance hint */
  will-change: ${({ $orientation }) => ($orientation === "vertical" ? "height" : "width")};
  z-index: 2;

  &:hover {
    background-color: #444;
    &:after {
      content: "";
      position: absolute;
      background: #888;
      display: block;
      z-index: 10;
      ${({ $orientation }) =>
    $orientation === "vertical"
      ? `width: 60%; height: 3px; top: 0; left: 50%; transform: translateX(-50%) translateY(-50%);`
      : `height: 60%; width: 3px; right: 0; top: 50%; transform: translateX(50%) translateY(-50%);`}
    }
  }

  &:active {
    cursor: grabbing;
    scale: 0.98;
    background-color: #4a4a4a;
  }

  ${({ $orientation, $percent }) =>
    $orientation === "vertical"
      ? `
    left: 0;
    bottom: 0;
    width: 100%;
    flex-flow: column;
    height: ${$percent}%;
    min-height: ${MIN_THUMB_RATIO * 100}%;
  `
      : `
    top: 0;
    left: 0;
    height: 100%;
    flex-flow: row;
    width: ${$percent}%;
    min-width: ${MIN_THUMB_RATIO * 100}%;
  `}
`;

export const SliderValue = styled.span<{ $orientation: "vertical" | "horizontal" }>`
  position: absolute;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: #fff;
  text-shadow: 0 0 4px rgba(0, 0, 0, 1), 0 0 8px rgba(0, 0, 0, 0.5);
  font-weight: 600;
  letter-spacing: 0.5px;
  pointer-events: none;
  z-index: 20; /* Ensure it stays above thumb and markers */
  text-align: center;

  ${({ $orientation }) =>
    $orientation === "vertical"
      ? `top: 13px;`
      : `right: 13px;`}
`;

export interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  invertFill?: boolean;
  logarithmic?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
  hideLabelInComponent?: boolean;
  labelPlacement?: "top" | "bottom" | "left" | "right";
  snapRanges?: SnapRange[];
}

export const Slider: React.FC<SliderProps> = React.memo(({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  invertFill = false,
  logarithmic = false,
  orientation = "horizontal",
  className,
  hideLabelInComponent = false,
  labelPlacement,
  snapRanges = [],
}) => {
  const [isDragging, setIsDragging] = React.useState(false);

  const getNormFromVal = useCallback((val: number) => {
    if (logarithmic) {
      return Math.max(0, Math.min(1, Math.log(val / min) / Math.log(max / min)));
    }
    return Math.max(0, Math.min(1, (val - min) / (max - min || 1)));
  }, [min, max, logarithmic]);

  const rangeNorm = getNormFromVal(value);
  const fillRatio = invertFill ? 1 - rangeNorm : rangeNorm;
  const percent = (MIN_THUMB_RATIO + fillRatio * (1 - MIN_THUMB_RATIO)) * 100;

  const currentRange = snapRanges.find(r => value >= r.min && value <= r.max);

  const handleTrackInteraction = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const pct =
        orientation === "vertical"
          ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
          : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

      const maxScrollPct = 1 - MIN_THUMB_RATIO;
      const adjustedPct = Math.max(0, Math.min(maxScrollPct, pct));

      const rawFillRatio =
        orientation === "vertical"
          ? 1 - adjustedPct / maxScrollPct
          : adjustedPct / maxScrollPct;

      const normalized = invertFill ? 1 - rawFillRatio : rawFillRatio;

      let raw: number;
      if (logarithmic) {
        raw = min * Math.pow(max / min, normalized);
      } else {
        raw = min + normalized * (max - min);
      }

      // Snapping to range boundaries based on track percentage (2% threshold)
      for (const r of snapRanges) {
        const snapThreshold = 0.02;
        const startNorm = getNormFromVal(r.min);
        const endNorm = getNormFromVal(r.max);

        if (Math.abs(normalized - startNorm) < snapThreshold) raw = r.min;
        if (Math.abs(normalized - endNorm) < snapThreshold) raw = r.max;
      }

      if (step < 1) {
        const inv = 1.0 / step;
        raw = Math.round(raw * inv) / inv;
      } else {
        raw = Math.round(raw / step) * step;
      }

      if (logarithmic && Math.abs(raw - 1.0) < 0.15 && min < 1.0 && max > 1.0) {
        raw = 1.0;
      }

      raw = Math.max(min, Math.min(max, raw));
      onChange(raw);
    },
    [min, max, step, onChange, invertFill, logarithmic, orientation, snapRanges, getNormFromVal],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const track = e.currentTarget;
      const rect = track.getBoundingClientRect();
      setIsDragging(true);
      handleTrackInteraction(e.clientX, e.clientY, rect);

      const onMouseMove = (ev: MouseEvent) => {
        handleTrackInteraction(ev.clientX, ev.clientY, rect);
      };
      const onMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [handleTrackInteraction],
  );

  const TrackComponent = (
    <SliderTrack
      $orientation={orientation}
      onMouseDown={handleMouseDown}
      className={className}
    >
      <TrackClipper>
        {snapRanges.map((r, i) => {
          const start = getNormFromVal(r.min) * 100;
          const end = getNormFromVal(r.max) * 100;
          return (
            <React.Fragment key={i}>
              <RangeMarker $start={start} $end={end} $color={r.color} />
              <RangeLabel $pos={(start + end) / 2}>{r.label}</RangeLabel>
              {start > 0.1 && start < 99.9 && <RangeTick $pos={start} />}
              {end > 0.1 && end < 99.9 && <RangeTick $pos={end} />}
            </React.Fragment>
          );
        })}
      </TrackClipper>

      <SliderThumb
        $percent={percent}
        $orientation={orientation}
        $isDragging={isDragging}
      />
      <SliderValue $orientation={orientation}>
        {currentRange ? `${currentRange.label} ` : ""}
        {formatValue ? formatValue(value) : value}
      </SliderValue>
    </SliderTrack>
  );

  if (hideLabelInComponent || !label) {
    return TrackComponent;
  }

  const isAfter = labelPlacement === "bottom" || labelPlacement === "right";

  return (
    <SliderContainer $orientation={orientation} className={className}>
      {!isAfter && <SliderLabel $orientation={orientation}>{label}</SliderLabel>}
      {TrackComponent}
      {isAfter && <SliderLabel $orientation={orientation}>{label}</SliderLabel>}
    </SliderContainer>
  );
});

export default Slider;
