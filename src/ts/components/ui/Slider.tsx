import React, { useCallback } from "react";
import styled from "styled-components";
import { COLORS } from "@n-apt/consts/components";

export const SliderContainer = styled.div<{
  $orientation: "vertical" | "horizontal";
  $disabled?: boolean;
  $hasSnapRanges?: boolean;
}>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: ${({ $orientation }) =>
    $orientation === "vertical" ? "center" : "stretch"};
  gap: 10px;
  flex: 1;
  width: 100%;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
  ${({ $hasSnapRanges, $orientation }) =>
    $hasSnapRanges && $orientation === "horizontal" ? "padding-top: 36px;" : ""}
`;

const InlineValueEditor = styled.input`
  position: absolute;
  z-index: 30;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 84px;
  border: 1px solid ${({ theme }) => theme.primary};
  border-radius: 12px;
  background: ${({ theme }) => theme.surface};
  color: ${({ theme }) => theme.textPrimary};
  padding: 6px 8px;
  text-align: center;
  font-family: "JetBrains Mono", monospace;
`;

export const SliderLabel = styled.span<{
  $orientation: "vertical" | "horizontal";
}>`
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  font-weight: 500;
  color: ${(props) => props.theme.textMuted};
  letter-spacing: 0.4px;
  text-transform: uppercase;
  text-align: ${({ $orientation }) =>
    $orientation === "vertical" ? "center" : "left"};
`;

export interface SnapRange {
  label: string;
  min: number;
  max: number;
  color?: string;
  longLabel?: string;
}

export const SliderTrack = styled.div<{
  $orientation: "vertical" | "horizontal";
  $disabled?: boolean;
}>`
  position: relative;
  border-radius: 16px;
  background: ${(props) =>
    props.theme.mode === "light" ? props.theme.surface : "#212121"};
  display: flex;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  transition: scale 0.2s ease-in-out;
  position: relative;
  border: 1px solid ${(props) => props.theme.border};
  pointer-events: ${({ $disabled }) => ($disabled ? "none" : "auto")};

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

const RangeMarker = styled.div<{
  $start: number;
  $end: number;
  $color?: string;
}>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $start }) => $start}%;
  width: ${({ $start, $end }) => $end - $start}%;
  background: ${({ $color, theme }) =>
    $color ||
    (theme.mode === "light"
      ? theme.activeBackground
      : "rgba(255, 255, 255, 0.05)")};
  pointer-events: none;
  border-left: 1px solid
    ${({ theme }) =>
      theme.mode === "light" ? COLORS.borderHover : "rgba(255, 255, 255, 0.1)"};
  border-right: 1px solid
    ${({ theme }) =>
      theme.mode === "light" ? COLORS.borderHover : "rgba(255, 255, 255, 0.1)"};
`;

const RangeLabel = styled.div<{ $pos: number; $isGreek?: boolean }>`
  position: absolute;
  bottom: ${({ $isGreek }) => ($isGreek ? "11px" : "2px")};
  left: ${({ $pos }) => $pos}%;
  transform: translateX(-50%);
  font-size: ${({ $isGreek }) => ($isGreek ? "14px" : "7px")};
  color: ${(props) => props.theme.textMuted};
  text-transform: ${({ $isGreek }) => ($isGreek ? "none" : "uppercase")};
  font-weight: 800;
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
`;

const RangeTick = styled.div<{ $pos: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${({ $pos }) => $pos}%;
  width: 1px;
  background: ${(props) =>
    props.theme.mode === "light"
      ? COLORS.borderHover
      : "rgba(255, 255, 255, 0.2)"};
  pointer-events: none;
  z-index: 10;
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
  $disabled?: boolean;
}>`
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  background-color: ${(props) =>
    props.theme.mode === "light" ? props.theme.primary : "#3b3b3b"};
  border-radius: 16px;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "grab")};
  /* Only animate when NOT dragging, for a 'snappy' feel when clicking/snapping */
  transition: ${({ $isDragging }) =>
    $isDragging
      ? "background-color 0.2s ease"
      : "width 0.15s cubic-bezier(0.2, 0, 0, 1), height 0.15s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s ease, scale 0.1s ease"};

  /* Performance hint */
  will-change: width, height;
  z-index: 5;

  &:hover {
    background-color: ${(props) =>
      props.theme.mode === "light" ? props.theme.primary : "#444"};
    &:after {
      content: "";
      position: absolute;
      background: ${(props) =>
        props.theme.mode === "light" ? props.theme.surface : "#888"};
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
    background-color: ${(props) =>
      props.theme.mode === "light" ? props.theme.primary : "#4a4a4a"};
  }

  ${({ $orientation, $percent }) =>
    $orientation === "vertical"
      ? `
    left: 0;
    bottom: 0;
    width: 100%;
    flex-flow: column;
    height: ${$percent}%;
    min-height: 10px;
  `
      : `
    top: 0;
    left: 0;
    height: 100%;
    flex-flow: row;
    width: ${$percent}%;
    min-width: 10px;
  `}
`;

export const SliderValue = styled.span<{
  $orientation: "vertical" | "horizontal";
}>`
  position: absolute;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: ${(props) =>
    props.theme.mode === "light" ? props.theme.textSecondary : "#fff"};
  text-shadow: ${(props) =>
    props.theme.mode === "light" ? "none" : "0 0 4px rgba(0, 0, 0, 0.8)"};
  font-weight: 500;
  letter-spacing: 0.3px;
  pointer-events: none;
  z-index: 20; /* Ensure it stays above thumb and markers */
  text-align: center;

  ${({ $orientation }) =>
    $orientation === "vertical" ? `top: 13px;` : `right: 13px;`}
`;

const SelectedMarker = styled.div<{ $pos: number }>`
  position: absolute;
  top: -34px;
  left: ${({ $pos }) => $pos}%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  pointer-events: none;
  z-index: 30;
  transition: left 0.15s cubic-bezier(0.2, 0, 0, 1);
`;

const MarkerBubble = styled.div`
  background: ${(props) => props.theme.primary};
  color: ${(props) => props.theme.background || "#000"};
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  border: 1px solid
    ${(props) => props.theme.borderHover || "rgba(255, 255, 255, 0.1)"};
  text-transform: uppercase;
`;

const MarkerArrow = styled.div`
  width: 6px;
  height: 6px;
  border-bottom: 2px solid ${(props) => props.theme.primary};
  border-right: 2px solid ${(props) => props.theme.primary};
  transform: rotate(45deg);
  margin-top: -2px;
`;

export interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  hideThumbValue?: boolean;
  minThumbRatio?: number;
  formatValue?: (value: number) => string;
  invertFill?: boolean;
  logarithmic?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
  hideLabelInComponent?: boolean;
  labelPlacement?: "top" | "bottom" | "left" | "right";
  snapRanges?: SnapRange[];
  disabled?: boolean;
  editable?: boolean;
}

export const Slider: React.FC<SliderProps> = React.memo(
  ({
    label,
    value,
    min,
    max,
    step = 1,
    onChange,
    formatValue,
    hideThumbValue = false,
    minThumbRatio = 0.2,
    invertFill = false,
    logarithmic = false,
    orientation = "horizontal",
    className,
    hideLabelInComponent = false,
    labelPlacement,
    snapRanges = [],
    disabled = false,
    editable = false,
  }) => {
    const [isDragging, setIsDragging] = React.useState(false);
    const [isEditing, setIsEditing] = React.useState(false);
    const [editValue, setEditValue] = React.useState(String(value));

    const getNormFromVal = useCallback(
      (val: number) => {
        if (logarithmic) {
          return Math.max(
            0,
            Math.min(1, Math.log(val / min) / Math.log(max / min)),
          );
        }
        return Math.max(0, Math.min(1, (val - min) / (max - min || 1)));
      },
      [min, max, logarithmic],
    );

    const minRatio = snapRanges.length > 0 ? 0 : minThumbRatio;
    const rangeNorm = getNormFromVal(value);
    const fillRatio = invertFill ? 1 - rangeNorm : rangeNorm;
    const percent = (minRatio + fillRatio * (1 - minRatio)) * 100;

    const currentRange = snapRanges.find(
      (r) => value >= r.min && value <= r.max,
    );

    const handleTrackInteraction = useCallback(
      (clientX: number, clientY: number, rect: DOMRect) => {
        const pct =
          orientation === "vertical"
            ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
            : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

        const minRatio = snapRanges.length > 0 ? 0 : minThumbRatio;
        const maxScrollPct = 1 - minRatio;
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

        if (
          logarithmic &&
          Math.abs(raw - 1.0) < 0.15 &&
          min < 1.0 &&
          max > 1.0
        ) {
          raw = 1.0;
        }

        raw = Math.max(min, Math.min(max, raw));
        onChange(raw);
      },
      [
        min,
        max,
        step,
        onChange,
        invertFill,
        logarithmic,
        orientation,
        snapRanges,
        getNormFromVal,
        minThumbRatio,
      ],
    );

    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (disabled) {
          return;
        }
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
      [disabled, handleTrackInteraction],
    );

    const TrackComponent = (
      <SliderTrack
        $orientation={orientation}
        $disabled={disabled}
        onMouseDown={disabled ? undefined : handleMouseDown}
        className={className}
        aria-disabled={disabled}
        data-testid={label ? `slider-${label}` : undefined}
        tabIndex={disabled ? -1 : 0}
        onDoubleClick={() => {
          if (!editable || disabled) return;
          setEditValue(String(value));
          setIsEditing(true);
        }}
        onMouseEnter={(event) => {
          if (!disabled) event.currentTarget.focus();
        }}
        onKeyDownCapture={(event) => {
          if (disabled || !editable) return;
          const direction =
            event.key === "ArrowUp" || event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowDown" || event.key === "ArrowLeft"
                ? -1
                : 0;
          if (!direction) return;
          onChange(Math.max(min, Math.min(max, value + direction * step)));
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <TrackClipper>
          {snapRanges.map((r, i) => {
            const start = getNormFromVal(r.min) * 100;
            const end = getNormFromVal(r.max) * 100;
            const isGreek = /[\u0370-\u03ff]/.test(r.label);
            return (
              <React.Fragment key={i}>
                <RangeMarker $start={start} $end={end} $color={r.color} />
                <RangeLabel $pos={(start + end) / 2} $isGreek={isGreek}>
                  {r.label}
                </RangeLabel>
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
          $disabled={disabled}
        />

        {snapRanges.length > 0 && orientation === "horizontal" && (
          <SelectedMarker $pos={percent}>
            <MarkerBubble>
              {currentRange
                ? `${currentRange.longLabel || currentRange.label} `
                : ""}
              {formatValue ? formatValue(value) : value}
            </MarkerBubble>
            <MarkerArrow />
          </SelectedMarker>
        )}

        {!isEditing && !hideThumbValue && snapRanges.length === 0 && (
          <SliderValue $orientation={orientation}>
            {formatValue ? formatValue(value) : value}
          </SliderValue>
        )}
      </SliderTrack>
    );

    if (hideLabelInComponent || !label) {
      return TrackComponent;
    }

    const isAfter = labelPlacement === "bottom" || labelPlacement === "right";

    const editor = isEditing ? (
      <InlineValueEditor
        type="number"
        aria-label={`${label ?? "Slider"} value`}
        value={editValue}
        min={min}
        max={max}
        step={step}
        autoFocus
        onChange={(event) => setEditValue(event.target.value)}
        onBlur={() => {
          const parsed = Number(editValue);
          if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, parsed)));
          setIsEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setIsEditing(false);
        }}
      />
    ) : null;

    return (
      <SliderContainer
        $orientation={orientation}
        $disabled={disabled}
        $hasSnapRanges={snapRanges.length > 0}
        className={className}
      >
        {!isAfter && (
          <SliderLabel $orientation={orientation}>{label}</SliderLabel>
        )}
        {TrackComponent}
        {editor}
        {isAfter && (
          <SliderLabel $orientation={orientation}>{label}</SliderLabel>
        )}
      </SliderContainer>
    );
  },
);

export default Slider;
