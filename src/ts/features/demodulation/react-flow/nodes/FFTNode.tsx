import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { styled } from "styled-components";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
  setFrequencyRange,
  setPreviewRange,
} from "@n-apt/redux/slices/spectrumSlice";
import { sendFrequencyRange } from "@n-apt/redux/thunks/websocketThunks";
import { useNodeConnections, useStore } from "@xyflow/react";
import { FFTCanvas, type FFTCanvasHandle } from "@n-apt/spectrum/public/FFTCanvas";
import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";
import { FrequencyRange } from "@n-apt/consts/types";
import {
  fileFrameRuntime,
  liveSourceFrameRuntime,
  subscribeFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { getFilePlaceholderState } from "@n-apt/app/infrastructure/io/filePlaceholderState";
import {
  isFilePlaybackPaused,
  shouldRestorePausedFrameSnapshot,
} from "@n-apt/spectrum/public/liveSourceLifecycle";
import {
  getSourcePresentationSessionKey,
  hasRenderableFramePayload,
} from "@n-apt/app/infrastructure/visualization/liveSourcePresentation";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import { sourceSpectrumRuntime } from "@n-apt/app/infrastructure/visualization/sourceVisualizationRuntime";
import { isTxStandbyPreviewSource } from "@n-apt/app/infrastructure/visualization/liveSourcePresentation";

interface FFTNodeProps {
  id: string;
  data: {
    fftOptions: boolean;
    label: string;
    showDemodOverlay?: boolean;
    sourceRole?: "rx" | "tx";
    sourceBindingGroup?: string;
  };
}

export const getFftNodeDisplayCenterHz = ({
  displayRange,
  bandwidthCenterFreqHz,
  fallbackCenterHz,
}: {
  displayRange?: FrequencyRange;
  bandwidthCenterFreqHz?: number | null;
  fallbackCenterHz: number;
}): number => {
  if (
    displayRange &&
    Number.isFinite(displayRange.min) &&
    Number.isFinite(displayRange.max) &&
    displayRange.max > displayRange.min
  ) {
    return (displayRange.min + displayRange.max) / 2;
  }
  return bandwidthCenterFreqHz ?? fallbackCenterHz;
};

export const getFftNodeResolvedRange = ({
  requestedRange,
  frameRange,
}: {
  requestedRange?: FrequencyRange | null;
  frameRange?: FrequencyRange | null;
}): FrequencyRange | undefined => {
  const isValidRange = (
    range?: FrequencyRange | null,
  ): range is FrequencyRange =>
    !!range &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.max > range.min;

  return isValidRange(requestedRange)
    ? requestedRange
    : isValidRange(frameRange)
      ? frameRange
      : undefined;
};

export const getFftNodeSourceRange = ({
  sourceMode,
  liveRange,
  activePlaybackRange,
  loadedFileRange,
}: {
  sourceMode: "live" | "file";
  liveRange?: FrequencyRange | null;
  activePlaybackRange?: FrequencyRange | null;
  loadedFileRange?: FrequencyRange | null;
}): FrequencyRange | null => {
  if (sourceMode === "file") {
    return activePlaybackRange ?? loadedFileRange ?? liveRange ?? null;
  }
  return liveRange ?? null;
};

/** Resolve a role-owned display window from the frame being rendered. */
export const getFftNodeRoleRange = ({
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
}): FrequencyRange | null => {
  if (
    sourceRole === "tx" &&
    typeof frame?.center_frequency_hz === "number" &&
    Number.isFinite(frame.center_frequency_hz) &&
    typeof frame.sample_rate === "number" &&
    Number.isFinite(frame.sample_rate) &&
    frame.sample_rate > 0
  ) {
    const frameMatchesRequestedWindow =
      (typeof expectedCenterFrequencyHz !== "number" ||
        Math.abs(frame.center_frequency_hz - expectedCenterFrequencyHz) < 1) &&
      (typeof expectedSampleRateHz !== "number" ||
        Math.abs(frame.sample_rate - expectedSampleRateHz) < 1);
    if (!frameMatchesRequestedWindow) return fallbackRange ?? null;
    return {
      min: frame.center_frequency_hz - frame.sample_rate / 2,
      max: frame.center_frequency_hz + frame.sample_rate / 2,
    };
  }
  return fallbackRange ?? null;
};

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

const FFTNodeComponent: React.FC<FFTNodeProps> = ({ id, data }) => {
  const dispatch = useAppDispatch();
  const fftRef = useRef<FFTCanvasHandle | null>(null);
  const activeSourceId = useAppSelector(
    (state) => state.websocket.activeSourceId,
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
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const selectedFiles = useAppSelector(
    (state) => state.waterfall.selectedFiles,
  );
  const stitchStatus = useAppSelector((state) => state.waterfall.stitchStatus);
  const stitchTrigger = useAppSelector(
    (state) => state.waterfall.stitchTrigger,
  );
  const isStitchPaused = useAppSelector(
    (state) => state.waterfall.isStitchPaused,
  );
  const [, setFrameVersion] = useState(0);
  const [hasRenderableFrame, setHasRenderableFrame] = useState(false);
  const selectedDeviceName = useAppSelector((state) => {
    const roleSource = (state.websocket.sources ?? []).find(
      (source) => source.id === roleSourceId,
    );
    return roleSource?.name ?? state.websocket.deviceName;
  });
  const roleSourceKind = useAppSelector((state) => {
    const roleSource = (state.websocket.sources ?? []).find(
      (source) => source.id === roleSourceId,
    );
    return roleSource?.kind ?? state.websocket.backend;
  });
  const initialSourceRef =
    sourceMode === "file"
      ? fileFrameRuntime.ref
      : liveSourceFrameRuntime.getRef(roleSourceId);
  const initialFrame = Array.isArray(initialSourceRef.current)
    ? (initialSourceRef.current[initialSourceRef.current.length - 1] ?? null)
    : initialSourceRef.current;
  const dataRef = useRef<LiveFrameData | null>(initialFrame);

  const connections = useNodeConnections({
    id: id,
    handleType: "target",
  });

  const isSpanConnected = useStore(
    useCallback(
      (flowState) =>
        connections.some(
          (connection) =>
            flowState.nodeLookup.get(connection.source)?.data?.spanOptions ===
            true,
        ),
      [connections],
    ),
  );

  const frequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const activePlaybackMetadata = useAppSelector(
    (state) => state.waterfall.activePlaybackMetadata,
  );
  const loadedFileMetadata = useAppSelector(
    (state) => state.waterfall.loadedFileMetadata,
  );
  const centerFrequencyHz = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? state.spectrum.txCenterFrequencyHz
      : state.websocket.sdrSettings?.center_frequency || 0,
  );
  const activeSignalArea = useAppSelector(
    (state) => state.spectrum.activeSignalArea || "A",
  );
  const fftSize = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? state.spectrum.txViewerFftSize
      : state.spectrum.fftSize,
  );
  const fftWindow = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? state.spectrum.txViewerFftWindow
      : state.spectrum.fftWindow,
  );
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const powerScale = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? state.spectrum.txViewerPowerScale
      : state.spectrum.powerScale,
  );
  const txViewerSampleRateHz = useAppSelector(
    (state) => state.spectrum.txViewerSampleRateHz,
  );
  const renderFftFrameRate = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? state.spectrum.txViewerFftFrameRate
      : state.spectrum.fftFrameRate,
  );
  const renderTemporalResolution = useAppSelector((state) =>
    data.sourceRole === "tx"
      ? state.spectrum.txViewerTemporalResolution
      : state.spectrum.displayTemporalResolution,
  );
  const showSpikeOverlay = useAppSelector(
    (state) => state.spectrum.showSpikeOverlay,
  );

  useEffect(() => {
    const sourceRef =
      sourceMode === "file"
        ? fileFrameRuntime.ref
        : liveSourceFrameRuntime.getRef(roleSourceId);
    const liveFrame = Array.isArray(sourceRef.current)
      ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
      : sourceRef.current;
    dataRef.current = liveFrame;
  }, [activeSourceId, roleSourceId, sourceMode]);
  const demodCenterFreqHz = useAppSelector(
    (state) => state.demod?.centerFreqHz ?? null,
  );
  const bandwidthCenterFreqHz = useAppSelector(
    (state) => state.demod?.bandwidthCenterFreqHz ?? null,
  );
  const hardwareSpanHz = useAppSelector(
    (state) => state.demod?.hardwareSpanHz ?? 3_200_000,
  );
  const demodBandwidthKhz = useAppSelector(
    (state) => state.demod?.bandwidthKhz ?? 500,
  );
  const demodBandwidthHz = useAppSelector(
    (state) => state.demod?.bandwidthHz ?? null,
  );
  const { previewRange, previewAlignment } = useAppSelector(
    (state) => state.spectrum,
  );
  const sourceFrequencyRange = getFftNodeSourceRange({
    sourceMode,
    liveRange: frequencyRange,
    activePlaybackRange: activePlaybackMetadata?.frequency_range
      ? {
          min: activePlaybackMetadata.frequency_range[0],
          max: activePlaybackMetadata.frequency_range[1],
        }
      : null,
    loadedFileRange: loadedFileMetadata?.frequency_range
      ? {
          min: loadedFileMetadata.frequency_range[0],
          max: loadedFileMetadata.frequency_range[1],
        }
      : null,
  });
  const configuredTxRange =
    data.sourceRole === "tx" &&
    Number.isFinite(centerFrequencyHz) &&
    centerFrequencyHz > 0 &&
    Number.isFinite(txViewerSampleRateHz) &&
    txViewerSampleRateHz > 0
      ? {
          min: centerFrequencyHz - txViewerSampleRateHz / 2,
          max: centerFrequencyHz + txViewerSampleRateHz / 2,
        }
      : null;
  const roleFallbackRange =
    data.sourceRole === "tx" ? configuredTxRange : sourceFrequencyRange;

  // Use a ref to track the latest range without stale closures
  const rangeRef = useRef<{ min: number; max: number } | null>(null);
  const [resolvedRange, setResolvedRange] = useState<
    FrequencyRange | undefined
  >(undefined);

  // Sync live frame data and derive frequency range from frame metadata
  useEffect(() => {
    return subscribeFrameRuntime(() => {
      const sourceRef =
        sourceMode === "file"
          ? fileFrameRuntime.ref
          : liveSourceFrameRuntime.getRef(roleSourceId);
      const liveFrame = Array.isArray(sourceRef.current)
        ? (sourceRef.current[sourceRef.current.length - 1] ?? null)
        : sourceRef.current;
      dataRef.current = liveFrame;
      // Live FFT rendering reads the source ref from its own rAF loop. A
      // React update here only adds node-tree work; file playback still needs
      // it to refresh its placeholder/status UI.
      if (sourceMode === "file") {
        setFrameVersion((version) => version + 1);
      }

      // Prefer the requested range while a retune is in flight. Frame
      // metadata can still describe the previous hardware window for several
      // frames and must not snap the display back to that stale range.
      let frameRange: FrequencyRange | undefined;
      if (liveFrame?.center_frequency_hz && liveFrame?.sample_rate) {
        frameRange = {
          min: liveFrame.center_frequency_hz - liveFrame.sample_rate / 2,
          max: liveFrame.center_frequency_hz + liveFrame.sample_rate / 2,
        };
      }

      const roleRange = getFftNodeRoleRange({
        sourceRole: data.sourceRole,
        fallbackRange: roleFallbackRange,
        expectedCenterFrequencyHz:
          data.sourceRole === "tx" ? centerFrequencyHz : null,
        expectedSampleRateHz:
          data.sourceRole === "tx" ? txViewerSampleRateHz : null,
        frame: liveFrame,
      });
      let newRange = getFftNodeResolvedRange({
        // Tx frames own the display range. The Rx global range must never
        // override it, otherwise the Tx canvas inherits the Rx axis.
        requestedRange: roleRange,
        frameRange: data.sourceRole === "tx" ? null : frameRange,
      });
      if (!newRange) {
        const fallbackCenter =
          bandwidthCenterFreqHz ??
          (demodCenterFreqHz && demodCenterFreqHz > 0
            ? demodCenterFreqHz
            : centerFrequencyHz);
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
  }, [
    centerFrequencyHz,
    data.sourceRole,
    demodCenterFreqHz,
    roleSourceId,
    roleFallbackRange,
    sourceFrequencyRange,
    sourceMode,
    txViewerSampleRateHz,
  ]); // Keep frame range aligned with the current source metadata

  const renderDataRef =
    sourceMode === "file"
      ? fileFrameRuntime.ref
      : liveSourceFrameRuntime.getRef(roleSourceId);
  const isPaused =
    isTxStandbyPreview || isFilePlaybackPaused({ sourceMode, isStitchPaused });
  const canvasSessionKey = getSourcePresentationSessionKey({
    sourceMode,
    selectedFiles,
    stitchTrigger,
    presentationRevision:
      data.sourceRole === "tx"
        ? `${roleSourceId ?? "none"}:${Math.round(centerFrequencyHz)}:${Math.round(txViewerSampleRateHz)}:${fftSize}`
        : roleSourceId,
  });
  useEffect(() => {
    // Keep an already-buffered frame visible during a source handoff. The
    // canvas receives the new session key imperatively and can reject stale
    // frames by source/epoch without destroying its renderer and flashing
    // blank between sessions.
    const currentFrame = Array.isArray(renderDataRef.current)
      ? (renderDataRef.current[renderDataRef.current.length - 1] ?? null)
      : renderDataRef.current;
    setHasRenderableFrame(hasRenderableFramePayload(currentFrame));
  }, [canvasSessionKey, roleSourceId]);
  const handleRenderableFrameChange = useCallback((ready: boolean) => {
    if (ready) setHasRenderableFrame(true);
  }, []);
  const frame = renderDataRef.current;
  const filePlaceholderState = getFilePlaceholderState({
    sourceMode,
    selectedFilesCount: selectedFiles.length,
    stitchStatus,
    hasRenderableFrame: Boolean(
      (frame as any)?.waveform?.length ||
      (frame as any)?.iq_data?.length ||
      (frame as any)?.data?.length,
    ),
  });

  const effectiveDisplayRange = resolvedRange;
  const selectionRange = previewRange || undefined;

  const currentCenterHz = getFftNodeDisplayCenterHz({
    displayRange: effectiveDisplayRange,
    bandwidthCenterFreqHz,
    fallbackCenterHz: centerFrequencyHz,
  });
  const handleSelectionChange = useCallback(
    (range: FrequencyRange) => {
      dispatch(setPreviewRange(range));
    },
    [dispatch],
  );

  const handleSelectionEdgePan = useCallback(
    (range: FrequencyRange) => {
      if (
        !Number.isFinite(range.min) ||
        !Number.isFinite(range.max) ||
        range.max <= range.min
      ) {
        return;
      }

      // This node has no VFO. Publish the new hardware window so the source
      // sends frames for the shifted range, then use that same range locally
      // while the retune is in flight. Keeping both paths in sync prevents the
      // status row from moving ahead of the plotted spectrum.
      dispatch(setFrequencyRange(range));
      dispatch(sendFrequencyRange(range));
      setResolvedRange((current) =>
        current?.min === range.min && current.max === range.max
          ? current
          : range,
      );
    },
    [dispatch],
  );

  /** Spectrum slice from Span / Apply — not the same as sample rate or radio demod BW. */
  const selectionDemodOverlay = useMemo(() => {
    const center =
      bandwidthCenterFreqHz ?? demodCenterFreqHz ?? currentCenterHz;
    if (!center || !Number.isFinite(center)) {
      return null;
    }
    const widthHz =
      demodBandwidthHz && Number.isFinite(demodBandwidthHz)
        ? demodBandwidthHz
        : demodBandwidthKhz * 1000;
    if (!Number.isFinite(widthHz) || widthHz < 1) return null;
    return {
      centerHz: center,
      rangeHz: widthHz,
    };
  }, [
    demodBandwidthHz,
    demodBandwidthKhz,
    demodCenterFreqHz,
    bandwidthCenterFreqHz,
    currentCenterHz,
  ]);

  const demodOverlayCenterHz =
    selectionDemodOverlay?.centerHz ?? demodCenterFreqHz ?? currentCenterHz;
  const demodOverlayRangeHz =
    selectionDemodOverlay?.rangeHz ?? demodBandwidthKhz * 1000;
  const publishSpectrumFrame = useCallback(
    (spectrum: Float32Array, sourceFrame: LiveFrameData) => {
      const sourceId = roleSourceId ?? sourceFrame.source_id;
      if (!sourceId) return;
      sourceSpectrumRuntime.publish({
        source_id: sourceId,
        stream_epoch: sourceFrame.stream_epoch,
        sequence: sourceFrame.sequence,
        spectrum,
        centerFrequencyHz: sourceFrame.center_frequency_hz ?? currentCenterHz,
        sampleRateHz:
          sourceFrame.sample_rate ??
          (data.sourceRole === "tx" ? txViewerSampleRateHz : hardwareSpanHz),
        fftSize: spectrum.length,
      });
    },
    [
      currentCenterHz,
      data.sourceRole,
      hardwareSpanHz,
      roleSourceId,
      txViewerSampleRateHz,
    ],
  );
  return (
    <NodeWrapper>
      <NodeTitle>{data.label}</NodeTitle>
      <CanvasContainer className="nodrag nopan" tabIndex={-1}>
        <FFTCanvas
          ref={fftRef}
          dataRef={renderDataRef}
          visualizerSessionKey={canvasSessionKey}
          pauseSnapshotEnabled={shouldRestorePausedFrameSnapshot({
            sourceMode,
          })}
          frequencyRange={effectiveDisplayRange || { min: 0, max: 0 }}
          centerFrequencyHz={currentCenterHz}
          activeSignalArea={activeSignalArea}
          isPaused={isPaused}
          isDeviceConnected={true}
          // Presentation remains bounded by the shared latest-frame runtime;
          // no queue is allowed to accumulate when a source outruns 60 Hz.
          fftFrameRate={Math.min(renderFftFrameRate, 60)}
          fftSize={fftSize}
          fftWindow={fftWindow}
          displayTemporalResolution={renderTemporalResolution}
          fftMin={fftMinDb}
          fftMax={fftMaxDb}
          powerScale={powerScale}
          expectedSourceId={roleSourceId}
          frameSourceIdFallback={roleSourceId}
          hardwareSampleRateHz={
            data.sourceRole === "tx" ? txViewerSampleRateHz : undefined
          }
          deviceBackend={data.sourceRole === "tx" ? roleSourceKind : undefined}
          showSpikeOverlay={showSpikeOverlay}
          snapshotGridPreference={true}
          compact={true}
          nodePreview={true}
          canvasResolutionScale={1}
          onSpectrumFrame={publishSpectrumFrame}
          onRenderableFrameChange={handleRenderableFrameChange}
          awaitingDeviceData={!hasRenderableFrame}
          isIqRecordingActive={true}
          demodulationCenterFreqHz={
            isSpanConnected
              ? undefined // Don't pass demod center if span is connected (uses selectionRange)
              : data.showDemodOverlay
                ? demodOverlayCenterHz
                : undefined
          }
          demodulationRangeHz={
            isSpanConnected
              ? undefined
              : data.showDemodOverlay
                ? demodOverlayRangeHz
                : undefined
          }
          maxBandwidthHz={hardwareSpanHz}
          selectionRange={isSpanConnected ? selectionRange : undefined}
          selectionMode="range"
          selectionEdgePanMode="frequency-range"
          rangeSelectionInteraction="edit-existing"
          selectionDisabled={!isSpanConnected}
          bandwidthAlignment={previewAlignment}
          onFrequencyRangeChange={handleSelectionEdgePan}
          onSelectionChange={handleSelectionChange}
          placeholderSourceLabel={data.label}
          placeholderState={filePlaceholderState}
          deviceName={selectedDeviceName ?? data.label}
        />
      </CanvasContainer>
    </NodeWrapper>
  );
};

export const FFTNode = React.memo(FFTNodeComponent);

export default FFTNode;
