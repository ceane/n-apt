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

export const SliderTrack = styled.div<{ $orientation: "vertical" | "horizontal" }>`
  position: relative;
  border-radius: 16px;
  background: #212121;
  display: flex;
  cursor: pointer;
  transition: scale 1s ease-in-out;

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

export const SliderThumb = styled.div<{
  $percent: number;
  $orientation: "vertical" | "horizontal";
}>`
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  background-color: #3b3b3b;
  border-radius: 16px;
  cursor: grab;
  transition: background-color 0.15s;

  &:hover {
    background-color: grey;
    &:after {
      content: "";
      display: block;
      background: #5e5e5e;
      ${({ $orientation }) =>
    $orientation === "vertical"
      ? `width: 60%; height: 3px;`
      : `height: 60%; width: 3px;`}
    }
  }

  &:active {
    cursor: grabbing;
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
  color: #686868;
  letter-spacing: 0.3px;
  pointer-events: none;
  opacity: 0.9;
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
  hideLabelInComponent?: boolean; // Useful if parent grid renders label separately
  labelPlacement?: "top" | "bottom" | "left" | "right";
}

export const Slider: React.FC<SliderProps> = ({
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
}) => {
  const rangeNorm = logarithmic
    ? Math.max(0, Math.min(1, Math.log(value / min) / Math.log(max / min)))
    : Math.max(0, Math.min(1, (value - min) / (max - min || 1)));

  const fillRatio = invertFill ? 1 - rangeNorm : rangeNorm;
  const percent = (MIN_THUMB_RATIO + fillRatio * (1 - MIN_THUMB_RATIO)) * 100;

  const handleTrackInteraction = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      let pct =
        orientation === "vertical"
          ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
          : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

      const maxScrollPct = 1 - MIN_THUMB_RATIO;
      let adjustedPct = Math.max(0, Math.min(maxScrollPct, pct));

      let rawFillRatio =
        orientation === "vertical"
          ? 1 - adjustedPct / maxScrollPct
          : adjustedPct / maxScrollPct; // For horizontal, left-to-right is 0->1

      let normalized = invertFill ? 1 - rawFillRatio : rawFillRatio;

      let raw: number;
      if (logarithmic) {
        raw = min * Math.pow(max / min, normalized);
      } else {
        raw = min + normalized * (max - min);
      }

      if (step < 1) {
        const inv = 1.0 / step;
        raw = Math.round(raw * inv) / inv;
      } else {
        raw = Math.round(raw / step) * step;
      }

      if (logarithmic && Math.abs(raw - 1.0) < 0.15) {
        raw = 1.0;
      }

      raw = Math.max(min, Math.min(max, raw));
      onChange(raw);
    },
    [min, max, step, onChange, invertFill, logarithmic, orientation],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const track = e.currentTarget;
      const rect = track.getBoundingClientRect();
      handleTrackInteraction(e.clientX, e.clientY, rect);

      const onMouseMove = (ev: MouseEvent) => {
        handleTrackInteraction(ev.clientX, ev.clientY, rect);
      };
      const onMouseUp = () => {
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
      <SliderThumb $percent={percent} $orientation={orientation} />
      <SliderValue $orientation={orientation}>
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
};

export default Slider;
