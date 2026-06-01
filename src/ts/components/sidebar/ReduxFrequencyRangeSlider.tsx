import React, { useCallback } from "react";
import styled from "styled-components";
import { useAppDispatch } from "@n-apt/redux";
import { spectrumActions, useAppSelector } from "@n-apt/redux";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import FrequencyRangeSlider from "@n-apt/components/sidebar/FrequencyRangeSlider";
import {
  clampFrequencyRangeToBounds,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";

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
  /** Match `activeSignalArea` / `lastKnownRanges` when `label` is empty (e.g. demod hides duplicate letter). */
  signalAreaKey?: string;
  minFreq: number;
  maxFreq: number;
  sampleRateHz?: number | null;
  isWholeChannelMode?: boolean;
  allowWideSampleRateOverscan?: boolean;
  wideSampleRateZoomThreshold?: number;
  limitMarkers?: Array<{ freq: number; label: string }>;
  isActive?: boolean;
  onActivate?: () => void;
  readOnly?: boolean;
  disabled?: boolean;
  scanProgress?: number;
  scanCurrentFreq?: number;
}

const ReduxFrequencyRangeSlider: React.FC<ReduxFrequencyRangeSliderProps> = ({
  label,
  signalAreaKey,
  minFreq,
  maxFreq,
  sampleRateHz,
  isWholeChannelMode = false,
  allowWideSampleRateOverscan = false,
  wideSampleRateZoomThreshold = 1.5,
  limitMarkers,
  isActive,
  onActivate,
  readOnly,
  disabled = false,
  scanProgress,
  scanCurrentFreq,
}) => {
  const dispatch = useAppDispatch();
  const { state, dispatch: storeDispatch, wsConnection } = useSpectrumStore();
  const hardwareSpectrumBounds = useAppSelector(
    (reduxState) => reduxState.demod.hardwareRange,
  );

  const areaKey = signalAreaKey ?? label;

  const frequencyRange = state.frequencyRange;
  const activeSignalArea = state.activeSignalArea;
  const lastKnownRanges = state.lastKnownRanges;
  const vizZoom = state.vizZoom;
  const vizPanOffset = state.vizPanOffset;
  const isCurrentActive =
    areaKey.length > 0 &&
    areaKey.toLowerCase() === activeSignalArea?.toLowerCase();
  const span = maxFreq - minFreq;
  const safeSpan = Number.isFinite(span) && span > 0 ? span : 0;
  const requestedHardwareSpan =
    typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
      ? sampleRateHz
      : span;
  const channelCardCoversWholeSpan =
    safeSpan > 0 && requestedHardwareSpan >= safeSpan;
  const wholeChannelDisplayMode =
    isWholeChannelMode || channelCardCoversWholeSpan;
  const wideHardwareRangeActive =
    allowWideSampleRateOverscan &&
    safeSpan > 0 &&
    requestedHardwareSpan > safeSpan;
  const channelClampZoomThreshold = wideHardwareRangeActive
    ? requestedHardwareSpan / safeSpan
    : 1;
  const hardwareSpan = wholeChannelDisplayMode
    ? safeSpan
    : Math.min(requestedHardwareSpan, safeSpan);
  const rememberedRange = wholeChannelDisplayMode
    ? null
    : (lastKnownRanges[areaKey] ??
      lastKnownRanges[areaKey.toLowerCase()] ??
      null);
  const externalFrequencyRange = wholeChannelDisplayMode
    ? null
    : isCurrentActive && (Number.isFinite(vizZoom) ? vizZoom : 1) > 1
      ? null
      : isCurrentActive
        ? frequencyRange
        : rememberedRange;

  // Calculate visible range based on zoom/pan settings
  const calculateVisibleRange = useCallback(() => {
    const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;
    if (wholeChannelDisplayMode) {
      return {
        min: minFreq,
        max: maxFreq,
      };
    }

    if (!isCurrentActive) {
      const baseRange = rememberedRange ?? {
        min: minFreq,
        max: minFreq + hardwareSpan,
      };
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
    wholeChannelDisplayMode,
  ]);

  const visibleRange = calculateVisibleRange();
  const channelBounds = { min: minFreq, max: maxFreq };
  const hardwareBounds = hardwareSpectrumBounds ?? channelBounds;
  const clampToChannelAndHardware = useCallback(
    (range: FrequencyRange): FrequencyRange => {
      const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;
      const shouldAllowWideRange =
        !wholeChannelDisplayMode &&
        wideHardwareRangeActive &&
        safeZoom < channelClampZoomThreshold;

      if (shouldAllowWideRange) {
        return normalizeFrequencyRangeToHz({
          min: Math.max(0, range.min),
          max: Math.max(0, range.max),
        });
      }

      return normalizeFrequencyRangeToHz(
        clampFrequencyRangeToBounds(
          clampFrequencyRangeToBounds(range, channelBounds),
          clampFrequencyRangeToBounds(hardwareBounds, channelBounds),
        ),
      );
    },
    [
      channelBounds.min,
      channelBounds.max,
      channelClampZoomThreshold,
      hardwareBounds,
      vizZoom,
      wholeChannelDisplayMode,
      wideHardwareRangeActive,
    ],
  );

  // Handle frequency range change
  const handleRangeChange = useCallback(
    (range: { min: number; max: number }) => {
      const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;
      const allowFreeWideRange =
        !wholeChannelDisplayMode &&
        wideHardwareRangeActive &&
        safeZoom < channelClampZoomThreshold;

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

        const overflowPan =
          desiredPan - Math.max(-maxPan, Math.min(maxPan, desiredPan));
        let newHardwareCenter = currentHardwareCenter + overflowPan;
        let newHardwareMin = newHardwareCenter - halfHardware;
        let newHardwareMax = newHardwareCenter + halfHardware;
        const clampedHardwareRange = clampToChannelAndHardware({
          min: newHardwareMin,
          max: newHardwareMax,
        });
        newHardwareCenter =
          (clampedHardwareRange.min + clampedHardwareRange.max) / 2;

        const newRange = clampedHardwareRange;
        dispatch(spectrumActions.setFrequencyRange(newRange));
        storeDispatch({ type: "SET_FREQUENCY_RANGE", range: newRange });
        wsConnection.sendFrequencyRange(newRange);

        const remainingPan = Math.max(
          -maxPan,
          Math.min(
            maxPan,
            desiredPan - (newHardwareCenter - currentHardwareCenter),
          ),
        );
        dispatch(spectrumActions.setVizPan(remainingPan));
        storeDispatch({ type: "SET_VIZ_PAN", pan: remainingPan });
        return;
      }

      const clampedRange = allowFreeWideRange
        ? normalizeFrequencyRangeToHz({
            min: Math.max(0, range.min),
            max: Math.max(0, range.max),
          })
        : clampToChannelAndHardware(range);
      dispatch(spectrumActions.setFrequencyRange(clampedRange));
      storeDispatch({ type: "SET_FREQUENCY_RANGE", range: clampedRange });
      wsConnection.sendFrequencyRange(clampedRange);
    },
    [
      storeDispatch,
      wsConnection,
      vizZoom,
      isCurrentActive,
      frequencyRange,
      hardwareSpan,
      allowWideSampleRateOverscan,
      requestedHardwareSpan,
      span,
      clampToChannelAndHardware,
      channelClampZoomThreshold,
      wideHardwareRangeActive,
    ],
  );

  return (
    <Container>
      <FrequencyRangeSlider
        label={label}
        minFreq={minFreq}
        maxFreq={maxFreq}
        visibleMin={visibleRange.min}
        visibleMax={visibleRange.max}
        sampleRateHz={hardwareSpan}
        allowWideSampleRateOverscan={false}
        wideSampleRateZoomThreshold={wideSampleRateZoomThreshold}
        limitMarkers={limitMarkers}
        isActive={isActive ?? isCurrentActive}
        onActivate={onActivate ?? (() => {})}
        onRangeChange={handleRangeChange}
        externalFrequencyRange={externalFrequencyRange ?? undefined}
        readOnly={readOnly}
        disabled={disabled}
        scanProgress={scanProgress}
        scanCurrentFreq={scanCurrentFreq}
        forceFullWidth={wholeChannelDisplayMode}
      />
    </Container>
  );
};

export default ReduxFrequencyRangeSlider;
