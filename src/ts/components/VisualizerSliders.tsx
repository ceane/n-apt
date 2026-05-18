import React from "react";
import styled from "styled-components";
import { Slider } from "@n-apt/components/ui";
import { COLORS, STITCHER_BUTTON_STYLE } from "@n-apt/consts/components";
import { FFT_MIN_DB, FFT_MAX_DB } from "@n-apt/consts";
import { roundDbValue } from "@n-apt/utils/frequency";
import {
  PaintbrushVertical,
  RotateCcw,
  Sigma,
  Wand2,
  WandSparkles,
} from "lucide-react";

const SlidersGrid = styled.div`
  display: grid;
  grid-template-rows: auto 1fr 1fr 1fr;
  justify-content: center;
  justify-items: center;
  align-content: start;
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
  width: 84px;
`;

const ActionButton = styled.button<{ $active?: boolean; $outlined?: boolean }>`
  font-family: ${STITCHER_BUTTON_STYLE.fontFamily};
  font-size: 9px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.1px;
  text-transform: none;
  white-space: normal;
  overflow-wrap: anywhere;
  padding: 5px 6px;
  border-radius: 6px;
  border: 1px solid
    ${(props) =>
      props.$outlined
        ? props.theme.primary
        : props.$active
          ? props.theme.primary
          : props.theme.border};
  background: ${(props) =>
    props.$outlined
      ? "transparent"
      : props.$active
        ? props.theme.activeBackground
        : "transparent"};
  color: ${(props) =>
    props.$outlined
      ? props.theme.textPrimary
      : props.$active
        ? props.theme.primary
        : props.theme.textMuted};
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  max-width: none;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;

  &:hover {
    background: ${(props) =>
      props.$outlined
        ? props.theme.surfaceHover
        : props.$active
          ? props.theme.activeBackground
          : props.theme.surfaceHover};
    color: ${(props) =>
      props.$outlined
        ? props.theme.textPrimary
        : props.$active
          ? props.theme.primary
          : props.theme.textPrimary};
  }

  &:active {
    transform: scale(0.96);
  }
`;

const ResetButton = styled(ActionButton)<{ $hasZoomFloor?: boolean }>`
  position: relative;
  padding-right: 14px;

  ${({ $hasZoomFloor, theme }) =>
    $hasZoomFloor
      ? `
    border-color: ${theme.primary};
    color: ${theme.textPrimary};
  `
      : ""}
`;

const ResetBadge = styled.span`
  position: absolute;
  top: 3px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #ff5b5b;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
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
  zoomFloor?: number;
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
  zoomFloor = 1,
}) => {
  // Calculate appropriate ranges based on power scale
  const isDbm = powerScale === "dBm";
  const maxDbRange = isDbm
    ? { min: -100, max: 30 }
    : { min: FFT_MIN_DB, max: FFT_MAX_DB };
  const minDbRange = isDbm
    ? { min: -120, max: -10 }
    : { min: FFT_MIN_DB, max: -10 };
  const dbUnit = isDbm ? "dBm" : "dB";
  const hasZoomFloor = zoomFloor > 1.0001;
  return (
    <SlidersGrid>
      <ActionButtonsContainer>
        <ResetButton
          $outlined={hasZoomFloor}
          $hasZoomFloor={hasZoomFloor}
          onClick={onResetZoomDb}
          title="Reset Zoom and dB limits"
        >
          <RotateCcw size={13} strokeWidth={1.5} />
          Reset
          {hasZoomFloor ? <ResetBadge data-testid="zoom-floor-indicator" /> : null}
        </ResetButton>
        <ActionButton
          $active={fftAvgEnabled}
          onClick={() => onFftAvgChange?.(!fftAvgEnabled)}
          title="Toggle FFT averaging"
        >
          <Sigma size={13} strokeWidth={1.5} />
          FFT Averaging
        </ActionButton>
        <ActionButton
          $active={fftSmoothEnabled}
          onClick={() => onFftSmoothChange?.(!fftSmoothEnabled)}
          title="Toggle FFT smoothing"
        >
          <Wand2 size={13} strokeWidth={1.5} />
          FFT Smoothing
        </ActionButton>
        <ActionButton
          $active={wfSmoothEnabled}
          onClick={() => onWfSmoothChange?.(!wfSmoothEnabled)}
          title="Toggle waterfall smoothing"
        >
          <PaintbrushVertical size={19} strokeWidth={1.5} />
          Waterfall Smoothing
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
        formatValue={(v) => `${roundDbValue(v)}${dbUnit}`}
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
        formatValue={(v) => `${roundDbValue(v)}${dbUnit}`}
        orientation="vertical"
        labelPlacement="bottom"
      />
    </SlidersGrid>
  );
};

export default VisualizerSliders;
