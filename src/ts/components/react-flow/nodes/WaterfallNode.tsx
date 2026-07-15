import React, {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import styled from "styled-components";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import { FIFOWaterfall } from "@n-apt/components/FIFOWaterfall";
import { useAppSelector } from "@n-apt/redux";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";
import { formatFrequency } from "@n-apt/utils/frequency";
import { Slider } from "@n-apt/components/ui/Slider";
import { resampleNearestInto } from "@n-apt/utils/resampleNearest";

interface WaterfallNodeProps {
  data: {
    waterfallOptions: boolean;
    label: string;
    showMiniVfo?: boolean;
    miniVfoPosition?: "top";
  };
}

const FLOW_WATERFALL_FFT_SIZE = 4096;

const NodeWrapper = styled.div`
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  padding: 0;
  width: 100%;
  min-width: 525px;
  min-height: 400px;
  align-self: stretch;
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
    border-radius: 2px;
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
`;

const DbControls = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 8px 0;
  flex: 0 0 auto;
  pointer-events: auto;
`;

const TopMiniVfo = styled.div`
  position: relative;
  width: 100%;
  height: 56px;
  flex: 0 0 56px;
  box-sizing: border-box;
  border-bottom: 1px solid ${({ theme }) => theme.colors?.border || "#334155"};
  color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  font-family: ${({ theme }) => theme.typography?.mono || "monospace"};
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
`;

const VfoEdgeLabel = styled.span<{ $side: "left" | "right" }>`
  position: absolute;
  top: 15px;
  ${({ $side }) => ($side === "left" ? "left: 8px;" : "right: 8px;")}
  color: ${({ theme }) => theme.colors?.textSecondary || "#94a3b8"};
  white-space: nowrap;
`;

const VfoCenterLabel = styled.span`
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  color: ${({ theme }) => theme.colors?.textPrimary || "#e2e8f0"};
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;

  &::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 27px;
    width: 3px;
    height: 16px;
    transform: translateX(-50%);
    background: ${({ theme }) => theme.colors?.primary || "#00d4ff"};
  }
`;

const formatMiniVfoFrequency = (frequencyHz: number) =>
  formatFrequency(frequencyHz, {
    showUnits: true,
    precisionMHz: 3,
    precisionGHz: 3,
    precisionKHz: 3,
  }).replace(/(\d)(?=[A-Za-z])/g, "$1 ");

const formatDb = (value: number) => `${value.toFixed(0)} dB`;

export const WaterfallNode: React.FC<WaterfallNodeProps> = ({ data }) => {
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const dataFrameCounter = useAppSelector(
    (state) => state.websocket.dataFrameCounter,
  );
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const [waterfallDbMin, setWaterfallDbMin] = useState(fftMinDb);
  const [waterfallDbMax, setWaterfallDbMax] = useState(fftMaxDb);
  const { processIqToDbmSpectrum } = useWasmSimdMath({
    fftSize: FLOW_WATERFALL_FFT_SIZE,
    enableSimd: true,
    fallbackToScalar: true,
  });

  // Throttled data polling — waterfall scrolls visually so 8fps is smooth enough.
  const initialFrame = Array.isArray(liveDataRef.current)
    ? (liveDataRef.current[liveDataRef.current.length - 1] ?? null)
    : liveDataRef.current;
  const [liveFrame, setLiveFrame] = useState(initialFrame);
  const [, setFrameRevision] = useState(0);
  const lastRefRef = useRef<unknown>(initialFrame);
  const lastIqRef = useRef(initialFrame?.iq_data);
  const lastTimestampRef = useRef(initialFrame?.timestamp);
  const resampledWaterfallRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const next = Array.isArray(liveDataRef.current)
        ? (liveDataRef.current[liveDataRef.current.length - 1] ?? null)
        : liveDataRef.current;
      if (
        next !== lastRefRef.current ||
        next?.iq_data !== lastIqRef.current ||
        next?.timestamp !== lastTimestampRef.current
      ) {
        lastRefRef.current = next;
        lastIqRef.current = next?.iq_data;
        lastTimestampRef.current = next?.timestamp;
        setLiveFrame(next);
        // The stream may reuse and mutate its frame object. A revision update
        // guarantees a render even when React sees the same object identity.
        setFrameRevision((revision) => revision + 1);
      }
    }, 125); // 8fps — smooth waterfall scrolling
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const next = Array.isArray(liveDataRef.current)
      ? (liveDataRef.current[liveDataRef.current.length - 1] ?? null)
      : liveDataRef.current;
    lastRefRef.current = next;
    lastIqRef.current = next?.iq_data;
    lastTimestampRef.current = next?.timestamp;
    setLiveFrame(next);
    setFrameRevision((revision) => revision + 1);
  }, [activeSourceId]);

  useEffect(() => {
    const next = Array.isArray(liveDataRef.current)
      ? (liveDataRef.current[liveDataRef.current.length - 1] ?? null)
      : liveDataRef.current;
    if (!next) return;
    lastRefRef.current = next;
    lastIqRef.current = next.iq_data;
    lastTimestampRef.current = next.timestamp;
    setLiveFrame(next);
  }, [dataFrameCounter]);

  const waveform = useMemo(() => {
    const iq = liveFrame?.iq_data;
    if (!iq || iq.length === 0) return null;
    const spectrum = processIqToDbmSpectrum(iq, 0, FLOW_WATERFALL_FFT_SIZE);
    return spectrum;
  }, [dataFrameCounter, liveFrame?.iq_data, processIqToDbmSpectrum]);

  const frequencyRange = useMemo(
    () => ({
      min:
        liveFrame?.center_frequency_hz != null && liveFrame?.sample_rate != null
          ? liveFrame.center_frequency_hz - liveFrame.sample_rate / 2
          : 0,
      max:
        liveFrame?.center_frequency_hz != null && liveFrame?.sample_rate != null
          ? liveFrame.center_frequency_hz + liveFrame.sample_rate / 2
          : 1,
    }),
    [liveFrame?.center_frequency_hz, liveFrame?.sample_rate],
  );

  const handleDbMinChange = useCallback(
    (value: number) => setWaterfallDbMin(Math.min(value, waterfallDbMax - 5)),
    [waterfallDbMax],
  );
  const handleDbMaxChange = useCallback(
    (value: number) => setWaterfallDbMax(Math.max(value, waterfallDbMin + 5)),
    [waterfallDbMin],
  );
  const performScalarResampling = useCallback(
    (
      input: ArrayLike<number>,
      targetLength: number,
      destination?: Float32Array,
    ) => {
      const currentOutput = destination ?? resampledWaterfallRef.current;
      const output = resampleNearestInto(
        input,
        targetLength,
        waterfallDbMin,
        currentOutput ?? undefined,
      );
      resampledWaterfallRef.current = output;
      return output;
    },
    [waterfallDbMin],
  );
  const stopNodeDrag = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <NodeWrapper
      data-testid="waterfall-node"
      data-frame-counter={dataFrameCounter}
      data-iq-length={liveFrame?.iq_data?.length ?? 0}
      data-waveform-length={waveform?.length ?? 0}
    >
      <NodeTitle>{data.label}</NodeTitle>
      <CanvasContainer>
        {data.showMiniVfo && data.miniVfoPosition === "top" && (
          <TopMiniVfo data-testid="waterfall-node-mini-vfo" data-position="top">
            <VfoEdgeLabel $side="left">
              {formatMiniVfoFrequency(frequencyRange.min)}
            </VfoEdgeLabel>
            <VfoCenterLabel>
              ◉{" "}
              {formatMiniVfoFrequency(
                (frequencyRange.min + frequencyRange.max) / 2,
              )}
            </VfoCenterLabel>
            <VfoEdgeLabel $side="right">
              {formatMiniVfoFrequency(frequencyRange.max)}
            </VfoEdgeLabel>
          </TopMiniVfo>
        )}
        <FIFOWaterfall
          width={640}
          height={220}
          waveform={waveform}
          frequencyRange={frequencyRange}
          fftMin={waterfallDbMin}
          fftMax={waterfallDbMax}
          retuneSmear={1}
          isPaused={false}
          isVisible={true}
          performScalarResampling={performScalarResampling}
          awaitingDeviceData={false}
          placeholderSourceLabel={data.label}
        />
        <DbControls
          className="nodrag nopan"
          data-testid="waterfall-db-controls"
          onMouseDown={stopNodeDrag}
          onPointerDown={stopNodeDrag}
        >
          <Slider
            label="Min dB"
            value={waterfallDbMin}
            min={-150}
            max={-10}
            step={5}
            minThumbRatio={0}
            onChange={handleDbMinChange}
            formatValue={formatDb}
            orientation="horizontal"
          />
          <Slider
            label="Max dB"
            value={waterfallDbMax}
            min={-100}
            max={30}
            step={5}
            minThumbRatio={0}
            onChange={handleDbMaxChange}
            formatValue={formatDb}
            invertFill
            orientation="horizontal"
          />
        </DbControls>
      </CanvasContainer>
    </NodeWrapper>
  );
};
