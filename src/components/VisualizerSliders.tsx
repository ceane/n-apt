import React, { useCallback } from "react";
import styled from "styled-components";

const SlidersContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 8px;
  background-color: #0a0a0a;
  border-left: 1px solid #222;
  align-self: stretch;
  height: 100%;
  user-select: none;
`;

const SliderGroup = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-height: 0;
`;

const SliderLabel = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  font-weight: 600;
  color: #ccc;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
`;

const SliderTrack = styled.div`
  position: relative;
  width: 6px;
  flex: 1;
  background-color: #1a1a1a;
  border-radius: 3px;
  cursor: pointer;
`;

const SliderThumb = styled.div<{ $position: number }>`
  position: absolute;
  left: 50%;
  top: ${({ $position }) => $position}%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 12px;
  background-color: #3b82f6;
  border-radius: 3px;
  cursor: grab;
  transition: background-color 0.15s;

  &:hover {
    background-color: #60a5fa;
  }

  &:active {
    cursor: grabbing;
    background-color: #2563eb;
  }
`;

const SliderValue = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  color: #666;
  white-space: nowrap;
`;

interface VerticalSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

const VerticalSlider: React.FC<VerticalSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
}) => {
  // Position: 0% = top (max value), 100% = bottom (min value)
  const position = ((max - value) / (max - min)) * 100;

  const handleTrackInteraction = useCallback(
    (clientY: number, rect: DOMRect) => {
      const pct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      // Top = max, bottom = min
      let raw = max - pct * (max - min);
      // Snap to step
      raw = Math.round(raw / step) * step;
      raw = Math.max(min, Math.min(max, raw));
      onChange(raw);
    },
    [min, max, step, onChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const track = e.currentTarget;
      const rect = track.getBoundingClientRect();
      handleTrackInteraction(e.clientY, rect);

      const onMouseMove = (ev: MouseEvent) => {
        handleTrackInteraction(ev.clientY, rect);
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

  return (
    <SliderGroup>
      <SliderLabel>{label}</SliderLabel>
      <SliderTrack onMouseDown={handleMouseDown}>
        <SliderThumb $position={position} />
      </SliderTrack>
      <SliderValue>{formatValue ? formatValue(value) : value}</SliderValue>
    </SliderGroup>
  );
};

export interface VisualizerSlidersProps {
  /** Frequency zoom level: 1 = no zoom, higher = more zoomed in */
  zoom: number;
  /** Max dB ceiling (top of Y axis), range: FFT_MAX_DB down to some minimum */
  dbMax: number;
  /** Min dB floor (bottom of Y axis), range: FFT_MIN_DB up to some maximum */
  dbMin: number;
  onZoomChange: (zoom: number) => void;
  onDbMaxChange: (dbMax: number) => void;
  onDbMinChange: (dbMin: number) => void;
}

export const VisualizerSliders: React.FC<VisualizerSlidersProps> = ({
  zoom,
  dbMax,
  dbMin,
  onZoomChange,
  onDbMaxChange,
  onDbMinChange,
}) => {
  return (
    <SlidersContainer>
      <VerticalSlider
        label="Zoom"
        value={zoom}
        min={1}
        max={1000}
        step={1}
        onChange={onZoomChange}
        formatValue={(v) => `${v}x`}
      />
      <VerticalSlider
        label="Max"
        value={dbMax}
        min={Math.max(-80, dbMin + 10)}
        max={0}
        step={5}
        onChange={onDbMaxChange}
        formatValue={(v) => `${v}`}
      />
      <VerticalSlider
        label="Min"
        value={dbMin}
        min={-120}
        max={Math.min(-10, dbMax - 10)}
        step={5}
        onChange={onDbMinChange}
        formatValue={(v) => `${v}`}
      />
    </SlidersContainer>
  );
};

export default VisualizerSliders;
