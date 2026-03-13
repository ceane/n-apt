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
  /** Power scale: "dB" or "dBm" */
  powerScale?: "dB" | "dBm";
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
  onResetZoomDb?: () => void;
}

export const VisualizerSliders: React.FC<VisualizerSlidersProps> = ({
  zoom,
  dbMax,
  dbMin,
  powerScale = "dB",
  onZoomChange,
  onDbMaxChange,
  onDbMinChange,
  fftAvgEnabled = false,
  fftSmoothEnabled = false,
  wfSmoothEnabled = false,
  onFftAvgChange,
  onFftSmoothChange,
  onWfSmoothChange,
  onResetZoomDb,
}) => {
  // Calculate appropriate ranges based on power scale
  const isDbm = powerScale === "dBm";
  const maxDbRange = isDbm ? { min: -80, max: 30 } : { min: -80, max: 0 };
  const minDbRange = isDbm ? { min: -120, max: -10 } : { min: -120, max: -10 };
  const dbUnit = isDbm ? "dBm" : "dB";
  return (
    <SlidersGrid>
      <TogglesContainer>
        <Toggle
          $active={false}
          onClick={onResetZoomDb}
          title="Reset Zoom and dB limits"
        >
          RESET
        </Toggle>
        <Toggle
          $active={fftAvgEnabled}
          onClick={() => onFftAvgChange?.(!fftAvgEnabled)}
          title="Toggle FFT averaging"
        >
          AVG
        </Toggle>
        <Toggle
          $active={fftSmoothEnabled}
          onClick={() => onFftSmoothChange?.(!fftSmoothEnabled)}
          title="Toggle FFT smoothing"
        >
          SMOOTH
        </Toggle>
        <Toggle
          $active={wfSmoothEnabled}
          onClick={() => onWfSmoothChange?.(!wfSmoothEnabled)}
          title="Toggle waterfall smoothing"
        >
          WF
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
        min={maxDbRange.min}
        max={maxDbRange.max}
        step={5}
        onChange={onDbMaxChange}
        formatValue={(v) => `${v}${dbUnit}`}
        invertFill
        orientation="vertical"
        labelPlacement="bottom"
      />
      <Slider
        label="Min"
        value={dbMin}
        min={minDbRange.min}
        max={minDbRange.max}
        step={5}
        onChange={onDbMinChange}
        formatValue={(v) => `${v}${dbUnit}`}
        orientation="vertical"
        labelPlacement="bottom"
      />
    </SlidersGrid>
  );
};

export default VisualizerSliders;
