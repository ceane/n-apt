import React, { useCallback } from "react";
import styled from "styled-components";
import { useAppDispatch } from "@n-apt/redux";
import { spectrumActions, useAppSelector } from "@n-apt/redux";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useSpectrumTransport } from "@n-apt/hooks/useSpectrumTransport";
import FrequencyRangeSlider from "@n-apt/components/sidebar/FrequencyRangeSlider";
import {
  clampFrequencyRangeToBounds,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";
import { isRtlSdrDevice } from "@n-apt/utils/sdrSampleRateGuards";

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
  startingAnchorPosition?: "start" | "center" | "end";
  isWholeChannelMode?: boolean;
  forceFullWidth?: boolean;
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
  startingAnchorPosition = "start",
  isWholeChannelMode = false,
  forceFullWidth = false,
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
  const { state } = useSpectrumStore();
  const spectrumTransport = useSpectrumTransport();
  const hardwareSpectrumBounds = useAppSelector(
    (reduxState) => reduxState.demod.hardwareRange,
  );
  const websocketDeviceProfile = useAppSelector(
    (reduxState) => reduxState.websocket.deviceProfile,
  );
  const websocketBackend = useAppSelector(
    (reduxState) => reduxState.websocket.backend,
  );

  const areaKey = signalAreaKey ?? label;

  const frequencyRange = state.frequencyRange;
  const activeSignalArea = state.activeSignalArea;
  const lastKnownRanges = state.lastKnownRanges;
  const vizZoom = state.vizZoom;
  const vizPanOffset = state.vizPanOffset;
  const isCurrentActive =
    isActive ??
    (areaKey.length > 0 &&
      areaKey.toLowerCase() === activeSignalArea?.toLowerCase());
  const span = maxFreq - minFreq;
  const safeSpan = Number.isFinite(span) && span > 0 ? span : 0;
  const requestedHardwareSpan =
    typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
      ? sampleRateHz
      : span;
  const wholeChannelDisplayMode = isWholeChannelMode;
  const wideHardwareRangeActive =
    allowWideSampleRateOverscan &&
    safeSpan > 0 &&
    requestedHardwareSpan > safeSpan;
  const channelClampZoomThreshold = wideHardwareRangeActive
    ? requestedHardwareSpan / safeSpan
    : 1;
  const hardwareSpan = Math.min(requestedHardwareSpan, safeSpan);
  const rememberedRange = wholeChannelDisplayMode
    ? null
    : (lastKnownRanges[areaKey] ??
      lastKnownRanges[areaKey.toLowerCase()] ??
      null);

  const resolveHardwareWindow = useCallback(
    (range: FrequencyRange | null | undefined): FrequencyRange => {
      if (safeSpan <= hardwareSpan) {
        return { min: minFreq, max: maxFreq };
      }
      const rangeSpan =
        range && Number.isFinite(range.min) && Number.isFinite(range.max)
          ? range.max - range.min
          : null;
      const hasUsableRange =
        range &&
        Number.isFinite(range.min) &&
        Number.isFinite(range.max) &&
        rangeSpan !== null &&
        rangeSpan > 0 &&
        rangeSpan <= hardwareSpan + 1;
      const anchoredMin =
        startingAnchorPosition === "end"
          ? maxFreq - hardwareSpan
          : startingAnchorPosition === "center"
            ? minFreq + (safeSpan - hardwareSpan) / 2
            : minFreq;
      const requestedMin = hasUsableRange ? range.min : anchoredMin;
      const min = Math.max(
        minFreq,
        Math.min(maxFreq - hardwareSpan, requestedMin),
      );
      return {
        min,
        max: min + hardwareSpan,
      };
    },
    [hardwareSpan, maxFreq, minFreq, safeSpan, startingAnchorPosition],
  );

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
      return resolveHardwareWindow(rememberedRange);
    }

    if (!frequencyRange) {
      return resolveHardwareWindow(null);
    }

    if (safeZoom <= 1) {
      return frequencyRange.max - frequencyRange.min <= hardwareSpan + 1
        ? clampFrequencyRangeToBounds(frequencyRange, {
            min: minFreq,
            max: maxFreq,
          })
        : resolveHardwareWindow(frequencyRange);
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
    resolveHardwareWindow,
    vizZoom,
    vizPanOffset,
    minFreq,
    maxFreq,
    hardwareSpan,
    wholeChannelDisplayMode,
  ]);

  const visibleRange = calculateVisibleRange();
  const channelBounds = { min: minFreq, max: maxFreq };
  const isRtlSdr = isRtlSdrDevice({
    deviceKind: websocketDeviceProfile?.kind,
    backend: websocketBackend,
    isRtlSdr: websocketDeviceProfile?.is_rtl_sdr,
  });
  const hardwareBounds = isRtlSdr
    ? channelBounds
    : (hardwareSpectrumBounds ?? channelBounds);
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
  const clampToHardwareOnly = useCallback(
    (range: FrequencyRange): FrequencyRange =>
      normalizeFrequencyRangeToHz(
        clampFrequencyRangeToBounds(range, {
          min: Math.max(0, hardwareBounds.min),
          max: Math.max(0, hardwareBounds.max),
        }),
      ),
    [hardwareBounds.max, hardwareBounds.min],
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
          return;
        }

        const overflowPan =
          desiredPan - Math.max(-maxPan, Math.min(maxPan, desiredPan));
        let newHardwareCenter = currentHardwareCenter + overflowPan;
        let newHardwareMin = newHardwareCenter - halfHardware;
        let newHardwareMax = newHardwareCenter + halfHardware;
        const clampedHardwareRange = clampToHardwareOnly({
          min: newHardwareMin,
          max: newHardwareMax,
        });
        newHardwareCenter =
          (clampedHardwareRange.min + clampedHardwareRange.max) / 2;

        const newRange = clampedHardwareRange;
        dispatch(spectrumActions.setFrequencyRange(newRange));
        spectrumTransport.sendFrequencyRange(newRange);

        const remainingPan = Math.max(
          -maxPan,
          Math.min(
            maxPan,
            desiredPan - (newHardwareCenter - currentHardwareCenter),
          ),
        );
        dispatch(spectrumActions.setVizPan(remainingPan));
        return;
      }

      const clampedRange = allowFreeWideRange
        ? normalizeFrequencyRangeToHz({
            min: Math.max(0, range.min),
            max: Math.max(0, range.max),
          })
        : clampToChannelAndHardware(range);
      dispatch(spectrumActions.setFrequencyRange(clampedRange));
      spectrumTransport.sendFrequencyRange(clampedRange);
    },
    [
      spectrumTransport,
      vizZoom,
      isCurrentActive,
      frequencyRange,
      hardwareSpan,
      allowWideSampleRateOverscan,
      requestedHardwareSpan,
      span,
      clampToChannelAndHardware,
      clampToHardwareOnly,
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
        readOnly={readOnly}
        disabled={disabled}
        scanProgress={scanProgress}
        scanCurrentFreq={scanCurrentFreq}
        forceFullWidth={forceFullWidth}
      />
    </Container>
  );
};

export default ReduxFrequencyRangeSlider;
