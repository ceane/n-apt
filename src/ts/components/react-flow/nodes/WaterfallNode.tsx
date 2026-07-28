import React, {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import styled from "styled-components";
import {
  fileFrameRuntime,
  liveSourceFrameRuntime,
} from "@n-apt/visualization/frameRuntime";
import { FIFOWaterfall } from "@n-apt/components/FIFOWaterfall";
import { useAppSelector } from "@n-apt/redux";
import { useWasmSimdMath } from "@n-apt/hooks/useWasmSimdMath";
import { formatFrequency } from "@n-apt/utils/frequency";
import { Slider } from "@n-apt/components/ui/Slider";
import { resampleNearestInto } from "@n-apt/utils/resampleNearest";
import { getFilePlaceholderState } from "@n-apt/utils/filePlaceholderState";
import { isFilePlaybackPaused } from "@n-apt/hooks/liveSourceLifecycle";
import { getSourcePresentationSessionKey } from "@n-apt/utils/liveSourcePresentation";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import { selectArrayOrEmpty } from "@n-apt/redux/selectors/stableSelectorDefaults";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import type { FrequencyRange } from "@n-apt/consts/types";
import { sourceSpectrumRuntime } from "@n-apt/visualization/sourceVisualizationRuntime";
import { isTxStandbyPreviewSource } from "@n-apt/utils/liveSourcePresentation";

interface WaterfallNodeProps {
  data: {
    waterfallOptions: boolean;
    label: string;
    showMiniVfo?: boolean;
    miniVfoPosition?: "top";
    sourceRole?: "rx" | "tx";
    sourceBindingGroup?: string;
  };
}

const FLOW_WATERFALL_FFT_SIZE = 4096;
// Waterfalls are pixel-width displays. Running a 65k-point FFT for every
// scrolling row wastes work when the node is only a few hundred pixels wide.
// Keep the full configured FFT for FFTNode and use this visual-resolution cap
// for the waterfall path.
const MAX_WATERFALL_FFT_SIZE = FLOW_WATERFALL_FFT_SIZE;

export const getWaterfallNodeFrequencyRange = ({
  sourceRole,
  fallbackRange,
  expectedCenterFrequencyHz,
  expectedSampleRateHz,
  frame,
}: {
  sourceRole?: "rx" | "tx";
  fallbackRange?: FrequencyRange | null;
  expectedCenterFrequencyHz?: number | null;
  expectedSampleRateHz?: number | null;
  frame?: Pick<LiveFrameData, "center_frequency_hz" | "sample_rate"> | null;
}): FrequencyRange => {
  const frameCenterFrequencyHz = frame?.center_frequency_hz;
  const frameSampleRateHz = frame?.sample_rate;
  const hasFrameWindow =
    typeof frameCenterFrequencyHz === "number" &&
    Number.isFinite(frameCenterFrequencyHz) &&
    typeof frameSampleRateHz === "number" &&
    Number.isFinite(frameSampleRateHz) &&
    frameSampleRateHz > 0;
  const frameMatchesRequestedWindow =
    typeof expectedCenterFrequencyHz !== "number" ||
    Math.abs((frame?.center_frequency_hz ?? 0) - expectedCenterFrequencyHz) < 1;
  const frameMatchesRequestedRate =
    typeof expectedSampleRateHz !== "number" ||
    Math.abs((frame?.sample_rate ?? 0) - expectedSampleRateHz) < 1;

  if (
    hasFrameWindow &&
    (sourceRole !== "tx" ||
      (frameMatchesRequestedWindow && frameMatchesRequestedRate))
  ) {
    return {
      min: frameCenterFrequencyHz! - frameSampleRateHz! / 2,
      max: frameCenterFrequencyHz! + frameSampleRateHz! / 2,
    };
  }
  return fallbackRange ?? { min: 0, max: 1 };
};

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

const getIqMutationMarker = (iq: Uint8Array | null | undefined): string => {
  if (!iq || iq.length === 0) return "";
  const middle = iq[Math.floor(iq.length / 2)] ?? 0;
  return `${iq.length}:${iq[0] ?? 0}:${middle}:${iq[iq.length - 1] ?? 0}`;
};

const WaterfallNodeComponent: React.FC<WaterfallNodeProps> = ({ data }) => {
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
  );
  const sourceMode = useAppSelector(
    (state) => state.waterfall?.sourceMode ?? "live",
  );
  const dataFrameCounter = useAppSelector((state) =>
    sourceMode === "file" ? state.websocket.dataFrameCounter : 0,
  );
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const waterfallFftSize = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? Math.min(state.spectrum.txViewerFftSize, MAX_WATERFALL_FFT_SIZE)
      : FLOW_WATERFALL_FFT_SIZE,
  );
  const roleSourceId = useAppSelector((state) => {
    const assignedSourceId =
      data.sourceRole && data.sourceBindingGroup
        ? state.sourceRouting.bindings[
            sourceBindingKey(data.sourceBindingGroup, data.sourceRole)
          ]
        : null;
    if (assignedSourceId) return assignedSourceId;
    if (!data.sourceRole) return state.websocket.activeSourceId;
    const candidates = state.websocket.sources ?? [];
    if (data.sourceRole === "tx") {
      return (
        candidates.find(
          (source) =>
            source.capability === "tx" || source.capability === "tx_rx",
        )?.id ?? state.websocket.activeSourceId
      );
    }
    return (
      candidates.find(
        (source) => source.capability === "rx" || source.capability === "tx_rx",
      )?.id ?? state.websocket.activeSourceId
    );
  });
  const isTxStandbyPreview = useAppSelector((state) => {
    if (!roleSourceId) return false;
    const source = (state.websocket.sources ?? []).find(
      (candidate) => candidate.id === roleSourceId,
    );
    return Boolean(
      source &&
      isTxStandbyPreviewSource({
        sourceRole: data.sourceRole,
        capability: source.capability,
        status: source.status,
      }),
    );
  });
  const txCenterFrequencyHz = useAppSelector(
    (state) => state.spectrum.txCenterFrequencyHz,
  );
  const txViewerSampleRateHz = useAppSelector(
    (state) => state.spectrum.txViewerSampleRateHz,
  );
  const selectedFiles = useAppSelector(
    (state) => selectArrayOrEmpty(state.waterfall?.selectedFiles),
  );
  const stitchStatus = useAppSelector(
    (state) => state.waterfall?.stitchStatus ?? "",
  );
  const stitchTrigger = useAppSelector(
    (state) => state.waterfall?.stitchTrigger ?? 0,
  );
  const isStitchPaused = useAppSelector(
    (state) => state.waterfall?.isStitchPaused ?? false,
  );
  const [waterfallDbMin, setWaterfallDbMin] = useState(fftMinDb);
  const [waterfallDbMax, setWaterfallDbMax] = useState(fftMaxDb);
  const { processIqToDbmSpectrum } = useWasmSimdMath({
    fftSize: waterfallFftSize,
    enableSimd: true,
    fallbackToScalar: true,
  });

  // Throttled data polling — waterfall scrolls visually so 8fps is smooth enough.
  const getCurrentFrame = useCallback(() => {
    const sourceRef =
      sourceMode === "file"
        ? fileFrameRuntime.ref
        : liveSourceFrameRuntime.getRef(roleSourceId);
    return Array.isArray(sourceRef.current)
      ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
      : sourceRef.current;
  }, [roleSourceId, sourceMode]);
  const initialFrame = getCurrentFrame();
  const [liveFrame, setLiveFrame] = useState(initialFrame);
  const [frameRevision, setFrameRevision] = useState(0);
  const lastRefRef = useRef<unknown>(initialFrame);
  const lastIqRef = useRef((initialFrame as any)?.iq_data);
  const lastIqMutationMarkerRef = useRef(
    getIqMutationMarker((initialFrame as any)?.iq_data),
  );
  const lastTimestampRef = useRef((initialFrame as any)?.timestamp);
  const resampledWaterfallRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    if (sourceMode === "live" && data.sourceRole) return;
    const id = setInterval(() => {
      const next = getCurrentFrame();
      const nextIq = (next as any)?.iq_data;
      const nextIqMutationMarker = getIqMutationMarker(nextIq);
      if (
        next !== lastRefRef.current ||
        nextIq !== lastIqRef.current ||
        nextIqMutationMarker !== lastIqMutationMarkerRef.current ||
        (next as any)?.timestamp !== lastTimestampRef.current ||
        (next as any)?.waveform !== (lastRefRef.current as any)?.waveform
      ) {
        lastRefRef.current = next;
        lastIqRef.current = nextIq;
        lastIqMutationMarkerRef.current = nextIqMutationMarker;
        lastTimestampRef.current = (next as any)?.timestamp;
        setLiveFrame(next);
        // The stream may reuse and mutate its frame object. A revision update
        // guarantees a render even when React sees the same object identity.
        setFrameRevision((revision) => revision + 1);
      }
    }, 125); // 8fps — smooth waterfall scrolling
    return () => clearInterval(id);
  }, [data.sourceRole, getCurrentFrame, sourceMode]);

  useEffect(() => {
    const next = getCurrentFrame();
    const nextIq = (next as any)?.iq_data;
    const frameChanged =
      next !== lastRefRef.current ||
      nextIq !== lastIqRef.current ||
      getIqMutationMarker(nextIq) !== lastIqMutationMarkerRef.current ||
      (next as any)?.timestamp !== lastTimestampRef.current ||
      (next as any)?.waveform !== (lastRefRef.current as any)?.waveform;
    if (!frameChanged) return;
    lastRefRef.current = next;
    lastIqRef.current = nextIq;
    lastIqMutationMarkerRef.current = getIqMutationMarker(nextIq);
    lastTimestampRef.current = (next as any)?.timestamp;
    setLiveFrame(next);
    setFrameRevision((revision) => revision + 1);
  }, [activeSourceId, roleSourceId, txViewerSampleRateHz, getCurrentFrame]);

  useEffect(() => {
    if (sourceMode !== "file") return;
    const next = getCurrentFrame();
    if (!next) return;
    lastRefRef.current = next;
    lastIqRef.current = next.iq_data;
    lastIqMutationMarkerRef.current = getIqMutationMarker(next.iq_data);
    lastTimestampRef.current = next.timestamp;
    setLiveFrame(next);
    setFrameRevision((revision) => revision + 1);
  }, [dataFrameCounter, getCurrentFrame, sourceMode]);

  const waveform = useMemo(() => {
    const fileWaveform =
      sourceMode === "file" ? (liveFrame as any)?.waveform : null;
    if (fileWaveform && fileWaveform.length > 0) return fileWaveform;

    if (sourceMode === "live" && roleSourceId) {
      const shared = sourceSpectrumRuntime.getSourceRef(roleSourceId).current;
      if (shared?.spectrum?.length) return shared.spectrum;
      // Role-bound live FFT nodes own the transform. Waiting for their first
      // shared result is cheaper and safer than starting a second FFT here.
      if (data.sourceRole) return null;
    }

    const iq = (liveFrame as any)?.iq_data;
    if (!iq || iq.length === 0) return null;
    const spectrum = processIqToDbmSpectrum(iq, 0, waterfallFftSize);
    return spectrum;
  }, [
    frameRevision,
    (liveFrame as any)?.iq_data,
    (liveFrame as any)?.waveform,
    processIqToDbmSpectrum,
    sourceMode,
    roleSourceId,
    data.sourceRole,
    waterfallFftSize,
    txViewerSampleRateHz,
  ]);
  const liveWaveformFeed = useMemo(() => {
    if (sourceMode !== "live" || !roleSourceId) {
      return undefined;
    }
    return {
      getCurrent: () =>
        sourceSpectrumRuntime.getSourceRef(roleSourceId).current?.spectrum ??
        null,
      subscribe: (listener: (waveform: Float32Array) => void) =>
        sourceSpectrumRuntime.subscribe(roleSourceId, () => {
          const spectrum =
            sourceSpectrumRuntime.getSourceRef(roleSourceId).current?.spectrum;
          if (spectrum?.length) listener(spectrum);
        }),
    };
  }, [data.sourceRole, roleSourceId, sourceMode]);

  const filePlaceholderState = getFilePlaceholderState({
    sourceMode,
    selectedFilesCount: selectedFiles.length,
    stitchStatus,
    hasRenderableFrame: Boolean(waveform?.length),
  });
  const isPaused =
    isTxStandbyPreview ||
    isFilePlaybackPaused({
      sourceMode,
      isStitchPaused,
    });
  const waterfallSessionKey = getSourcePresentationSessionKey({
    sourceMode,
    selectedFiles,
    stitchTrigger,
    presentationRevision:
      data.sourceRole === "tx"
        ? `${roleSourceId ?? "none"}:${Math.round(txCenterFrequencyHz)}:${Math.round(txViewerSampleRateHz)}:${waterfallFftSize}`
        : roleSourceId,
  });

  const configuredTxRange =
    data.sourceRole === "tx" &&
    Number.isFinite(txCenterFrequencyHz) &&
    txCenterFrequencyHz > 0 &&
    Number.isFinite(txViewerSampleRateHz) &&
    txViewerSampleRateHz > 0
      ? {
          min: txCenterFrequencyHz - txViewerSampleRateHz / 2,
          max: txCenterFrequencyHz + txViewerSampleRateHz / 2,
        }
      : null;
  const frequencyRange = useMemo(
    () =>
      getWaterfallNodeFrequencyRange({
        sourceRole: data.sourceRole,
        fallbackRange: configuredTxRange,
        expectedCenterFrequencyHz:
          data.sourceRole === "tx" ? txCenterFrequencyHz : null,
        expectedSampleRateHz:
          data.sourceRole === "tx" ? txViewerSampleRateHz : null,
        frame: liveFrame,
      }),
    [
      configuredTxRange,
      data.sourceRole,
      liveFrame?.center_frequency_hz,
      liveFrame?.sample_rate,
      txCenterFrequencyHz,
      txViewerSampleRateHz,
    ],
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
          key={waterfallSessionKey}
          width={640}
          height={220}
          waveform={waveform}
          waveformFeed={liveWaveformFeed}
          frequencyRange={frequencyRange}
          fftMin={waterfallDbMin}
          fftMax={waterfallDbMax}
          retuneSmear={1}
          isPaused={isPaused}
          isVisible={true}
          performScalarResampling={performScalarResampling}
          awaitingDeviceData={false}
          placeholderSourceLabel={data.label}
          placeholderState={filePlaceholderState}
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

export const WaterfallNode = React.memo(WaterfallNodeComponent);
