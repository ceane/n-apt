import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { styled } from "styled-components";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setPreviewRange } from "@n-apt/redux/slices/spectrumSlice";
import { useNodeConnections, useNodes } from "@xyflow/react";
import FFTCanvas, { type FFTCanvasHandle } from "@n-apt/components/FFTCanvas";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { FrequencyRange } from "@n-apt/consts/types";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";

interface FFTNodeProps {
  id: string;
  data: {
    fftOptions: boolean;
    label: string;
    showDemodOverlay?: boolean;
  };
}

export function getDisplayRangeForSelection(
  displayRange: FrequencyRange | undefined,
  selectionRange: FrequencyRange | null | undefined,
): FrequencyRange | undefined {
  if (!displayRange) return undefined;
  if (
    !selectionRange ||
    !Number.isFinite(selectionRange.min) ||
    !Number.isFinite(selectionRange.max) ||
    selectionRange.max <= selectionRange.min
  ) {
    return displayRange;
  }

  const span = displayRange.max - displayRange.min;
  if (!Number.isFinite(span) || span <= 0) return displayRange;

  let offset = 0;
  if (selectionRange.min < displayRange.min) {
    offset = selectionRange.min - displayRange.min;
  } else if (selectionRange.max > displayRange.max) {
    offset = selectionRange.max - displayRange.max;
  }

  if (offset === 0) return displayRange;
  return {
    min: displayRange.min + offset,
    max: displayRange.max + offset,
  };
}

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 400px;
  align-self: stretch;
  border-radius: 0;
  padding: 0;
  min-width: 525px;
  cursor: grab;
  overflow: hidden;
`;

const NodeTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors?.primary || "#00d4ff"};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 0;

  &::before {
    content: "";
    display: block;
    width: 8px;
    height: 8px;
    background: currentColor;
    border-radius: 0;
  }
`;

const CanvasContainer = styled.div`
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  align-self: stretch;
  padding: 8px 10px 10px;
  overflow: hidden;
  pointer-events: auto;
  cursor: grab;
`;

export const FFTNode: React.FC<FFTNodeProps> = ({ id, data }) => {
  const dispatch = useAppDispatch();
  const fftRef = useRef<FFTCanvasHandle | null>(null);
  const dataRef = useRef<LiveFrameData | null>(liveDataRef.current);

  const nodes = useNodes();
  const connections = useNodeConnections({
    id: id,
    handleType: "target",
  });

  const isSpanConnected = useMemo(() => {
    return connections.some((conn) => {
      const sourceNode = nodes.find((n) => n.id === conn.source);
      return sourceNode?.data?.spanOptions === true;
    });
  }, [connections, nodes]);

  const frequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const centerFrequencyHz = useAppSelector(
    (state) => state.websocket.sdrSettings?.center_frequency || 0,
  );
  const activeSignalArea = useAppSelector(
    (state) => state.spectrum.activeSignalArea || "A",
  );
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);
  const fftWindow = useAppSelector((state) => state.spectrum.fftWindow);
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const powerScale = useAppSelector((state) => state.spectrum.powerScale);
  const showSpikeOverlay = useAppSelector(
    (state) => state.spectrum.showSpikeOverlay,
  );
  const demodCenterFreqHz = useAppSelector(
    (state) => state.demod?.centerFreqHz ?? null,
  );
  const demodBandwidthKhz = useAppSelector(
    (state) => state.demod?.bandwidthKhz ?? 500,
  );
  const { previewRange, previewAlignment } = useAppSelector((state) => state.spectrum);

  // Use a ref to track the latest range without stale closures
  const rangeRef = useRef<{ min: number; max: number } | null>(null);
  const [resolvedRange, setResolvedRange] = useState<FrequencyRange | undefined>(undefined);

  // Sync live frame data and derive frequency range from frame metadata
  useEffect(() => {
    const id = setInterval(() => {
      const liveFrame = liveDataRef.current;
      dataRef.current = liveFrame;

      // Derive range from the actual frame metadata (center_frequency_hz + sample_rate)
      let newRange: FrequencyRange | null = null;

      if (liveFrame?.center_frequency_hz && liveFrame?.sample_rate) {
        newRange = {
          min: liveFrame.center_frequency_hz - liveFrame.sample_rate / 2,
          max: liveFrame.center_frequency_hz + liveFrame.sample_rate / 2,
        };
      } else if (frequencyRange) {
        newRange = frequencyRange;
      } else {
        const fallbackCenter =
          demodCenterFreqHz && demodCenterFreqHz > 0
            ? demodCenterFreqHz
            : centerFrequencyHz;
        if (fallbackCenter > 0) {
          newRange = {
            min: fallbackCenter - 1_200_000,
            max: fallbackCenter + 1_200_000,
          };
        }
      }

      // Only update state if the range actually changed
      const prev = rangeRef.current;
      if (
        newRange &&
        (!prev || prev.min !== newRange.min || prev.max !== newRange.max)
      ) {
        rangeRef.current = newRange;
        setResolvedRange(newRange || undefined);
      }
    }, 50); // 20fps is plenty for range sync
    return () => clearInterval(id);
  }, [frequencyRange, centerFrequencyHz, demodCenterFreqHz]); // Include demodCenterFreqHz to react to station changes

  const frame = dataRef.current;

  const effectiveDisplayRange = useMemo(() => {
    return getDisplayRangeForSelection(resolvedRange, previewRange);
  }, [resolvedRange, previewRange]);

  const currentCenterHz = effectiveDisplayRange
    ? (effectiveDisplayRange.min + effectiveDisplayRange.max) / 2
    : centerFrequencyHz;

  const handleSelectionChange = useCallback((range: FrequencyRange) => {
    dispatch(setPreviewRange(range));
  }, [dispatch]);

  const handlePointerUp = useCallback(() => {
    // When dragging ends, we could commit the frequency range
    // but SpanNode usually has an "Apply" button or auto-applies.
    // However, the user wants "immediate, lag-free UI updates".
    // We'll let SpanNode handle the actual commitment to avoid double-dispatching.
  }, []);

  /** Spectrum slice from Span / Apply — not the same as sample rate or radio demod BW. */
  const selectionDemodOverlay = useMemo(() => {
    if (
      !frequencyRange ||
      !Number.isFinite(frequencyRange.min) ||
      !Number.isFinite(frequencyRange.max)
    ) {
      return null;
    }
    const widthHz = frequencyRange.max - frequencyRange.min;
    if (!Number.isFinite(widthHz) || widthHz < 1) return null;
    return {
      centerHz: (frequencyRange.min + frequencyRange.max) / 2,
      rangeHz: widthHz,
    };
  }, [frequencyRange]);

  const demodOverlayCenterHz = selectionDemodOverlay?.centerHz ??
    demodCenterFreqHz ??
    currentCenterHz;
  const demodOverlayRangeHz =
    selectionDemodOverlay?.rangeHz ?? demodBandwidthKhz * 1000;
  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <CanvasContainer className="nodrag nopan" tabIndex={-1}>
        <FFTCanvas
          ref={fftRef}
          dataRef={dataRef}
          frequencyRange={effectiveDisplayRange || { min: 0, max: 0 }}
          centerFrequencyHz={currentCenterHz}
          activeSignalArea={activeSignalArea}
          isPaused={false}
          isDeviceConnected={true}
          fftSize={fftSize}
          fftWindow={fftWindow}
          fftMin={fftMinDb}
          fftMax={fftMaxDb}
          powerScale={powerScale}
          showSpikeOverlay={showSpikeOverlay}
          snapshotGridPreference={true}
          compact={true}
          nodePreview={true}
          awaitingDeviceData={!frame}
          isIqRecordingActive={true}
          demodulationCenterFreqHz={
            isSpanConnected
              ? (previewRange
                  ? (previewRange.min + previewRange.max) / 2
                  : data.showDemodOverlay
                    ? demodOverlayCenterHz
                    : undefined)
              : undefined
          }
          demodulationRangeHz={
            isSpanConnected
              ? (previewRange
                  ? previewRange.max - previewRange.min
                  : data.showDemodOverlay
                    ? demodOverlayRangeHz
                    : undefined)
              : undefined
          }
          selectionRange={isSpanConnected ? (previewRange || undefined) : undefined}
          selectionMode="range"
          selectionDisabled={!isSpanConnected}
          bandwidthAlignment={previewAlignment}
          onSelectionChange={handleSelectionChange}
        />
      </CanvasContainer>
    </NodeWrapper>
  );
};

export default FFTNode;
