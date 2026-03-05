import React from "react";
import styled from "styled-components";
import { Slider, Toggle } from "./ui";

const SlidersGrid = styled.div`
  display: grid;
  /* 3 rows for sliders, 1 auto row for toggles */
  grid-template-rows: auto 1fr 1fr 1fr;
  gap: 12px;
  height: 100%;
  width: 100%;
  user-select: none;
`;

// Toggles wrapper
const TogglesContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

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
    <SlidersGrid>
      <TogglesContainer>
        <Toggle
          $active={fftAvgEnabled}
          onClick={() => onFftAvgChange?.(!fftAvgEnabled)}
          title="FFT Averaging — temporal smoothing of spectrum"
        >
          {fftAvgEnabled ? "▸ AVG" : "▹ AVG"}
        </Toggle>
        <Toggle
          $active={fftSmoothEnabled}
          onClick={() => onFftSmoothChange?.(!fftSmoothEnabled)}
          title="FFT Smoothing — adjacent bin averaging"
        >
          {fftSmoothEnabled ? "▸ FFT" : "▹ FFT"}
        </Toggle>
        <Toggle
          $active={wfSmoothEnabled}
          onClick={() => onWfSmoothChange?.(!wfSmoothEnabled)}
          title="Waterfall Smoothing — interpolation between bins"
        >
          {wfSmoothEnabled ? "▸ WF" : "▹ WF"}
        </Toggle>
      </TogglesContainer>

      <Slider
        label="Zoom"
        value={zoom}
        min={1}
        max={1000}
        step={0.1}
        onChange={onZoomChange}
        formatValue={(v) => `${v.toFixed(1)}x`}
        logarithmic
        orientation="vertical"
        labelPlacement="bottom"
      />
      <Slider
        label="Max"
        value={dbMax}
        min={-80}
        max={0}
        step={5}
        onChange={onDbMaxChange}
        formatValue={(v) => `${v}dB`}
        invertFill
        orientation="vertical"
        labelPlacement="bottom"
      />
      <Slider
        label="Min"
        value={dbMin}
        min={-120}
        max={-10}
        step={5}
        onChange={onDbMinChange}
        formatValue={(v) => `${v}dB`}
        orientation="vertical"
        labelPlacement="bottom"
      />
    </SlidersGrid>
  );
};

export default VisualizerSliders;
