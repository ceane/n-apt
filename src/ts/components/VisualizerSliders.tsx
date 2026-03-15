import React from "react";
import styled from "styled-components";
import { Slider } from "./ui";

const SlidersGrid = styled.div`
  display: grid;
  /* 3 rows for sliders, 1 auto row for toggles */
  grid-template-rows: auto 1fr 1fr 1fr;
  gap: 12px;
  height: 100%;
  width: 100%;
  user-select: none;
`;

// Action buttons wrapper
const ActionButtonsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ActionButton = styled.button<{ $active?: boolean }>`
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  white-space: nowrap;
  padding: 6px 10px;
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
      <ActionButtonsContainer>
        <ActionButton onClick={onResetZoomDb} title="Reset Zoom and dB limits">
          RESET
        </ActionButton>
        <ActionButton
          $active={fftAvgEnabled}
          onClick={() => onFftAvgChange?.(!fftAvgEnabled)}
          title="Toggle FFT averaging"
        >
          {fftAvgEnabled ? "▸ AVG" : "▹ AVG"}
        </ActionButton>
        <ActionButton
          $active={fftSmoothEnabled}
          onClick={() => onFftSmoothChange?.(!fftSmoothEnabled)}
          title="Toggle FFT smoothing"
        >
          {fftSmoothEnabled ? "▸ FFT" : "▹ FFT"}
        </ActionButton>
        <ActionButton
          $active={wfSmoothEnabled}
          onClick={() => onWfSmoothChange?.(!wfSmoothEnabled)}
          title="Toggle waterfall smoothing"
        >
          {wfSmoothEnabled ? "▸ WF" : "▹ WF"}
        </ActionButton>
      </ActionButtonsContainer>

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
