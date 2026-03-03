import React, { useCallback } from "react";
import styled from "styled-components";

const SlidersContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-self: stretch;
  gap: 12px;
  height: 100%;
  user-select: none;
`;

const SliderGroup = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  flex: 1;
`;

const SliderLabel = styled.span`
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 600;
  color: #d8d8d8;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  white-space: nowrap;
`;

const MIN_THUMB_RATIO = 0.2; // 20% of track height

const SliderTrack = styled.div`
  position: relative;
  width: 40px;
  flex: 1;
  padding: 6px 10px;
  border-radius: 16px;
  background: #212121;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: scale 1s ease-in-out;
`;

const SliderThumb = styled.div<{ $heightPercent: number }>`
  display: flex;
  flex-flow: column;
  align-items: center;
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: ${({ $heightPercent }) => `${$heightPercent}%`};
  min-height: ${MIN_THUMB_RATIO * 100}%;
  background-color: #3B3B3B;
  border-radius: 16px;
  cursor: grab;
  transition: background-color 0.15s;

  &:hover {
    background-color: grey;

    &:after {
        content: "";
        display: block;
        width: 60%;
        height: 3px;
        background: #5e5e5e;
    }
  }

  &:active {
    cursor: grabbing;
  }
`;

const SliderValue = styled.span`
  position: absolute;
  bottom: 13px;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: #686868;
  letter-spacing: 0.3px;
  pointer-events: none;
  opacity: 0.9;
  text-align: center;
`;

// Toggle button styles
const TogglesContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
`;

const ToggleButton = styled.button<{ $active: boolean }>`
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  white-space: nowrap;
  padding: 6px 4px;
  border-radius: 8px;
  border: 1px solid ${({ $active }) => ($active ? "rgba(0,0,0,0.2)" : "#333")};
  background: ${({ $active }) =>
    $active ? "linear-gradient(135deg, #00c853, #009688)" : "#212121"};
  color: ${({ $active }) => ($active ? "#fff" : "#888")};
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  text-align: center;

  &:hover {
    background: ${({ $active }) =>
      $active ? "linear-gradient(135deg, #00e676, #26a69a)" : "#2a2a2a"};
    color: ${({ $active }) => ($active ? "#fff" : "#aaa")};
  }

  &:active {
    transform: scale(0.96);
  }
`;

interface VerticalSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  invertFill?: boolean;
  logarithmic?: boolean;
}

const VerticalSlider: React.FC<VerticalSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  invertFill = false,
  logarithmic = false,
}) => {
  const rangeNorm = logarithmic
    ? Math.max(0, Math.min(1, Math.log(value / min) / Math.log(max / min)))
    : Math.max(0, Math.min(1, (value - min) / (max - min || 1)));

  const fillRatio = invertFill ? 1 - rangeNorm : rangeNorm;
  const heightPercent =
    (MIN_THUMB_RATIO + fillRatio * (1 - MIN_THUMB_RATIO)) * 100;

  const handleTrackInteraction = useCallback(
    (clientY: number, rect: DOMRect) => {
      let pct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

      // thumb's top edge ranges from 0 to 1 - MIN_THUMB_RATIO down the track
      const maxScrollPct = 1 - MIN_THUMB_RATIO;
      let adjustedPct = Math.max(0, Math.min(maxScrollPct, pct));

      let rawFillRatio = 1 - adjustedPct / maxScrollPct;
      let normalized = invertFill ? 1 - rawFillRatio : rawFillRatio;

      let raw: number;
      if (logarithmic) {
        raw = min * Math.pow(max / min, normalized);
      } else {
        raw = min + normalized * (max - min);
      }

      // Handle floating point steps gracefully
      if (step < 1) {
        const inv = 1.0 / step;
        raw = Math.round(raw * inv) / inv;
      } else {
        raw = Math.round(raw / step) * step;
      }

      // Snap to 1.0 for convenience if close
      if (logarithmic && Math.abs(raw - 1.0) < 0.15) {
        raw = 1.0;
      }

      raw = Math.max(min, Math.min(max, raw));
      onChange(raw);
    },
    [min, max, step, onChange, invertFill, logarithmic],
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
        <SliderThumb $heightPercent={heightPercent} />
        <SliderValue>{formatValue ? formatValue(value) : value}</SliderValue>
      </SliderTrack>
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
  /** FFT averaging toggle */
  fftAvgEnabled?: boolean;
  /** FFT smoothing toggle */
  fftSmoothEnabled?: boolean;
  /** Waterfall smoothing toggle */
  wfSmoothEnabled?: boolean;
  onFftAvgChange?: (enabled: boolean) => void;
  onFftSmoothChange?: (enabled: boolean) => void;
  onWfSmoothChange?: (enabled: boolean) => void;
}

export const VisualizerSliders: React.FC<VisualizerSlidersProps> = ({
  zoom,
  dbMax,
  dbMin,
  onZoomChange,
  onDbMaxChange,
  onDbMinChange,
  fftAvgEnabled = false,
  fftSmoothEnabled = false,
  wfSmoothEnabled = false,
  onFftAvgChange,
  onFftSmoothChange,
  onWfSmoothChange,
}) => {
  return (
    <SlidersContainer>
      <VerticalSlider
        label="Zoom"
        value={zoom}
        min={1}
        max={1000}
        step={0.1}
        onChange={onZoomChange}
        formatValue={(v) => `${v.toFixed(1)}x`}
        logarithmic
      />
      <VerticalSlider
        label="Max"
        value={dbMax}
        min={-80}
        max={0}
        step={5}
        onChange={onDbMaxChange}
        formatValue={(v) => `${v}dB`}
        invertFill
      />
      <VerticalSlider
        label="Min"
        value={dbMin}
        min={-120}
        max={-10}
        step={5}
        onChange={onDbMinChange}
        formatValue={(v) => `${v}dB`}
      />
      <TogglesContainer>
        <ToggleButton
          $active={fftAvgEnabled}
          onClick={() => onFftAvgChange?.(!fftAvgEnabled)}
          title="FFT Averaging — temporal smoothing of spectrum"
        >
          {fftAvgEnabled ? "▸ AVG" : "▹ AVG"}
        </ToggleButton>
        <ToggleButton
          $active={fftSmoothEnabled}
          onClick={() => onFftSmoothChange?.(!fftSmoothEnabled)}
          title="FFT Smoothing — adjacent bin averaging"
        >
          {fftSmoothEnabled ? "▸ FFT" : "▹ FFT"}
        </ToggleButton>
        <ToggleButton
          $active={wfSmoothEnabled}
          onClick={() => onWfSmoothChange?.(!wfSmoothEnabled)}
          title="Waterfall Smoothing — interpolation between bins"
        >
          {wfSmoothEnabled ? "▸ WF" : "▹ WF"}
        </ToggleButton>
      </TogglesContainer>
    </SlidersContainer>
  );
};

export default VisualizerSliders;
