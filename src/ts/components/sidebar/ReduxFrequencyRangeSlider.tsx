import React, { useCallback } from "react";
import styled from "styled-components";
import { useAppDispatch } from "@n-apt/redux";
import { spectrumActions } from "@n-apt/redux";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import FrequencyRangeSlider from "./FrequencyRangeSlider";

// Styled Components
const Container = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

interface ReduxFrequencyRangeSliderProps {
  label: string;
  minFreq: number;
  maxFreq: number;
  sampleRateMHz?: number | null;
  limitMarkers?: Array<{ freq: number; label: string }>;
  isActive?: boolean;
  onActivate?: () => void;
}

const ReduxFrequencyRangeSlider: React.FC<ReduxFrequencyRangeSliderProps> = ({
  label,
  minFreq,
  maxFreq,
  sampleRateMHz,
  limitMarkers,
  isActive = false,
  onActivate,
}) => {
  const dispatch = useAppDispatch();
  const { state, dispatch: storeDispatch, wsConnection } = useSpectrumStore();

  const frequencyRange = state.frequencyRange;
  const activeSignalArea = state.activeSignalArea;
  const lastKnownRanges = state.lastKnownRanges;
  const vizZoom = state.vizZoom;
  const vizPanOffset = state.vizPanOffset;
  const isCurrentActive = label.toLowerCase() === activeSignalArea?.toLowerCase();
  const span = maxFreq - minFreq;
  const hardwareSpan =
    typeof sampleRateMHz === "number" && Number.isFinite(sampleRateMHz)
      ? Math.min(sampleRateMHz, span)
      : span;
  const rememberedRange =
    lastKnownRanges[label] ?? lastKnownRanges[label.toLowerCase()] ?? null;
  const externalFrequencyRange =
    isCurrentActive && (Number.isFinite(vizZoom) ? vizZoom : 1) > 1
      ? null
      : isCurrentActive
        ? frequencyRange
        : rememberedRange;

  // Calculate visible range based on zoom/pan settings
  const calculateVisibleRange = useCallback(() => {
    const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;
    if (!isCurrentActive) {
      const baseRange = rememberedRange ?? { min: minFreq, max: minFreq + hardwareSpan };
      return {
        min: baseRange.min,
        max: baseRange.max,
      };
    }

    if (!frequencyRange) {
      return {
        min: minFreq,
        max: minFreq + hardwareSpan,
      };
    }

    if (safeZoom <= 1) {
      const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
      const halfHardware = hardwareSpan / 2;
      return {
        min: Math.max(minFreq, hardwareCenter - halfHardware),
        max: Math.min(maxFreq, hardwareCenter + halfHardware),
      };
    }

    const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const visualSpan = hardwareSpan / safeZoom;
    const halfVisualSpan = visualSpan / 2;
    let visualCenter = hardwareCenter + vizPanOffset;

    visualCenter = Math.max(
      minFreq + halfVisualSpan,
      Math.min(maxFreq - halfVisualSpan, visualCenter),
    );

    return {
      min: visualCenter - halfVisualSpan,
      max: visualCenter + halfVisualSpan,
    };
  }, [
    isCurrentActive,
    frequencyRange,
    rememberedRange,
    vizZoom,
    vizPanOffset,
    minFreq,
    maxFreq,
    hardwareSpan,
  ]);

  const visibleRange = calculateVisibleRange();

  // Handle frequency range change
  const handleRangeChange = useCallback((range: { min: number; max: number }) => {
    const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;

    if (isCurrentActive && safeZoom > 1 && frequencyRange) {
      const visualCenter = (range.min + range.max) / 2;
      const halfHardware = hardwareSpan / 2;
      const currentHardwareCenter =
        (frequencyRange.min + frequencyRange.max) / 2;
      const halfVisualSpan = hardwareSpan / (2 * safeZoom);
      const maxPan = halfHardware - halfVisualSpan;
      const desiredPan = visualCenter - currentHardwareCenter;

      if (Math.abs(desiredPan) <= maxPan + 0.001) {
        dispatch(spectrumActions.setVizPan(desiredPan));
        storeDispatch({ type: "SET_VIZ_PAN", pan: desiredPan });
        return;
      }

      let newHardwareCenter = visualCenter;
      let newHardwareMin = newHardwareCenter - halfHardware;
      let newHardwareMax = newHardwareCenter + halfHardware;

      if (newHardwareMin < minFreq) {
        newHardwareMin = minFreq;
        newHardwareMax = minFreq + hardwareSpan;
      }
      if (newHardwareMax > maxFreq) {
        newHardwareMax = maxFreq;
        newHardwareMin = maxFreq - hardwareSpan;
      }
      newHardwareCenter = (newHardwareMin + newHardwareMax) / 2;

      const newRange = { min: newHardwareMin, max: newHardwareMax };
      dispatch(spectrumActions.setFrequencyRange(newRange));
      storeDispatch({ type: "SET_FREQUENCY_RANGE", range: newRange });
      wsConnection.sendFrequencyRange(newRange);

      const remainingPan = visualCenter - newHardwareCenter;
      dispatch(spectrumActions.setVizPan(remainingPan));
      storeDispatch({ type: "SET_VIZ_PAN", pan: remainingPan });
      return;
    }

    dispatch(spectrumActions.setFrequencyRange(range));
    storeDispatch({ type: "SET_FREQUENCY_RANGE", range });
    wsConnection.sendFrequencyRange(range);
  }, [
    dispatch,
    storeDispatch,
    wsConnection,
    vizZoom,
    isCurrentActive,
    frequencyRange,
    hardwareSpan,
    minFreq,
    maxFreq,
  ]);

  return (
    <Container>
      <FrequencyRangeSlider
        label={label}
        minFreq={minFreq}
        maxFreq={maxFreq}
        visibleMin={visibleRange.min}
        visibleMax={visibleRange.max}
        sampleRateMHz={
          typeof hardwareSpan === "number"
            ? hardwareSpan / (isCurrentActive ? Math.max(1, vizZoom) : 1)
            : null
        }
        limitMarkers={limitMarkers}
        isActive={isActive}
        onActivate={onActivate ?? (() => { })}
        onRangeChange={handleRangeChange}
        externalFrequencyRange={externalFrequencyRange ?? undefined}
      />
    </Container>
  );
};

export default ReduxFrequencyRangeSlider;
