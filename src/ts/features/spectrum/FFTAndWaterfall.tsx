import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import styled from "styled-components";
import FFTCanvas, {
  type FFTCanvasHandle,
  type FFTCanvasProps,
} from "@n-apt/spectrum/FFTCanvas";
import type { FFTCanvasWaterfallBindings } from "@n-apt/types/canvas";
import FIFOWaterfallCanvas from "@n-apt/spectrum/FIFOWaterfallCanvas";
import { VisualizerSliders } from "@n-apt/spectrum/VisualizerSliders";
import { useAppDispatch, useAppSelector, spectrumActions } from "@n-apt/redux";
import { VISUALIZER_PADDING, VISUALIZER_GAP } from "@n-apt/consts";
import { getVisualizerDefaultDbLimits } from "@n-apt/consts/visualizerControls";
import {
  clampVizZoom,
  getRetunedVizPanForZoomChange,
  getStableVizPanForZoomChange,
} from "@n-apt/spectrum/public/visualizationZoom";
import {
  isSourceStreamAvailable,
  resolveSourceModeManagement,
} from "@n-apt/app/infrastructure/streams/sourceModeManagement";
import { isControlPlaneUnavailable } from "@n-apt/spectrum/hooks/liveSourceLifecycle";

type FFTAndWaterfallProps = FFTCanvasProps & {
  waterfallHeaderActionContent?: ReactNode;
  onLoadingStateChange?: (isLoading: boolean) => void;
  loadingPlaceholderDelayMs?: number;
};

export const shouldShowLiveServerDownPlaceholder = ({
  isConnected,
  connectionStatus = null,
  hasConnectedOnce = false,
  sourceStreamReady: _sourceStreamReady,
  sourceHandoffPending = false,
  sourceTransportPhase = null,
}: {
  isConnected: boolean;
  connectionStatus?: string | null;
  hasConnectedOnce?: boolean;
  sourceStreamReady?: boolean;
  sourceHandoffPending?: boolean;
  sourceTransportPhase?: string | null;
}): boolean =>
  // First-boot disconnected/connecting must stay on Loading FFT. After a live
  // session existed, a dropped control socket is Server Down even if a stale
  // source status or transport phase still looks ready.
  isControlPlaneUnavailable({
    isConnected,
    connectionStatus,
    hasConnectedOnce,
    sourceHandoffPending,
    transportPhase: sourceTransportPhase,
  });

const resolveTxSignalDisplayLabel = (signal: string) => {
  switch (signal) {
    case "d":
      return "D";
    case "wifi":
      return "Mock WiFi";
    case "d_sharp":
      return "D#";
    case "5g":
      return "Mock 5G";
    default:
      return signal.toUpperCase();
  }
};

type VisualizerConnectionState =
  | "file"
  | "ready"
  | "warming"
  | "down"
  | "unavailable";

const resolveVisualizerConnectionState = ({
  sourceMode,
  sourceStreamReady,
  placeholderErrorReason,
  sourceTransportPhase,
}: {
  sourceMode: string;
  sourceStreamReady: boolean;
  placeholderErrorReason: string | null;
  sourceTransportPhase?: string | null;
}): VisualizerConnectionState => {
  if (sourceMode === "file") return "file";
  if (placeholderErrorReason === "Server down") return "down";
  if (sourceStreamReady) return "ready";
  if (sourceTransportPhase === "warming") return "warming";
  return "unavailable";
};

const Container = styled.div`
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  padding: ${VISUALIZER_PADDING}px;
`;

const Left = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: ${VISUALIZER_GAP}px;
  padding-right: ${VISUALIZER_PADDING}px;
`;

const SpectrumStage = styled.div`
  display: flex;
  flex-direction: column;
  position: relative;
  flex: 1 1 40px;
  min-height: 0;
  width: 100%;
`;

const SlidersRail = styled.div`
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const FFTAndWaterfall = forwardRef<FFTCanvasHandle, FFTAndWaterfallProps>(
  (props, ref) => {
    const dispatch = useAppDispatch();
    const fftAvgEnabled = useAppSelector(
      (reduxState) => reduxState.spectrum.fftAvgEnabled,
    );
    const fftSmoothEnabled = useAppSelector(
      (reduxState) => reduxState.spectrum.fftSmoothEnabled,
    );
    const wfSmoothEnabled = useAppSelector(
      (reduxState) => reduxState.spectrum.wfSmoothEnabled,
    );
    const autoZoomStability = useAppSelector(
      (reduxState) => reduxState.spectrum.autoZoomStability,
    );
    const allowNegativeFrequencies = useAppSelector(
      (reduxState) => reduxState.settings?.mirrorIqBasebandBelowZero ?? false,
    );
    const vizZoomFloorPan = useAppSelector(
      (reduxState) => reduxState.spectrum.vizZoomFloorPan,
    );
    const maxVizZoom = useAppSelector(
      (reduxState) => reduxState.spectrum.maxVizZoom,
    );
    const showTxSlider = useAppSelector(
      (reduxState) => reduxState.spectrum.showTxSlider ?? true,
    );
    const txSignal = useAppSelector(
      (reduxState) => reduxState.spectrum.txSignal || "wifi",
    );
    const txCenterFrequencyHz = useAppSelector(
      (reduxState) => reduxState.spectrum.txCenterFrequencyHz,
    );
    const txSampleRateHz = useAppSelector(
      (reduxState) => reduxState.spectrum.txSampleRateHz,
    );
    const txPowerDbm = useAppSelector(
      (reduxState) => reduxState.spectrum.txPowerDbm,
    );
    const activeSource = useAppSelector((reduxState) =>
      reduxState.websocket.sources?.find?.(
        (source) => source.id === reduxState.websocket.activeSourceId,
      ),
    );
    const wsState = useAppSelector((reduxState) => reduxState.websocket);
    const activeSourceStatus = activeSource
      ? (wsState.sourceStatuses?.[activeSource.id] ?? activeSource.status)
      : null;
    const txSuiteSourceId = useAppSelector(
      (reduxState) =>
        reduxState.sourceRouting?.bindings?.["tx-suite:tx"] ?? null,
    );
    const sourceModeManagement = resolveSourceModeManagement({
      source: activeSource
        ? { ...activeSource, status: activeSourceStatus }
        : activeSource,
      txBindingSourceId: txSuiteSourceId,
    });
    const sourceTransport =
      wsState.sourceTransportByMode?.[
        sourceModeManagement.isTxMode ? "tx" : "rx"
      ] ?? wsState.sourceTransport;
    const sourceMode = useAppSelector(
      (reduxState) => reduxState.waterfall.sourceMode,
    );
    const canShowTxSlider =
      sourceMode !== "file" &&
      (props.txSlider?.visible === true ||
        sourceModeManagement.shouldShowTxControls ||
        activeSourceStatus === "standby" ||
        activeSourceStatus === "transmitting");

    const [waterfallGpuCanvasNode, setWaterfallGpuCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallOverlayCanvasNode, setWaterfallOverlayCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [hasRenderableFrame, setHasRenderableFrame] = useState(false);
    const [hasPaintedFrame, setHasPaintedFrame] = useState(false);
    const [shouldShowLoadingPlaceholder, setShouldShowLoadingPlaceholder] =
      useState(true);
    const handleRenderableFrameChange = useCallback(
      (hasFrame: boolean) => {
        setHasRenderableFrame(hasFrame);
        if (!hasFrame) {
          setHasPaintedFrame(false);
        }
        props.onRenderableFrameChange?.(hasFrame);
      },
      [props.onRenderableFrameChange],
    );
    const handleCanvasLoadingChange = useCallback(
      (isLoading: boolean) => {
        setHasPaintedFrame(!isLoading);
        props.onCanvasLoadingChange?.(isLoading);
      },
      [props.onCanvasLoadingChange],
    );
    const awaitingFreshFrameRef = useRef(false);
    const loadingPlaceholderTimeoutRef = useRef<number | null>(null);
    const currentFrame = Array.isArray(props.dataRef.current)
      ? (props.dataRef.current[props.dataRef.current.length - 1] ?? null)
      : props.dataRef.current;
    const hasIncomingData = !!(
      currentFrame &&
      ((currentFrame.iq_data?.length ?? 0) > 0 ||
        ((currentFrame as any).data?.length ?? 0) > 0 ||
        ((currentFrame as any).waveform?.length ?? 0) > 0)
    );
    const sourceStreamReady =
      isSourceStreamAvailable(activeSourceStatus) ||
      sourceTransport?.phase === "ready" ||
      hasIncomingData;
    const hasFrameForLoading =
      hasPaintedFrame ||
      // TX standby intentionally preserves a cached preview beneath its
      // top-bar prompt; live RX must wait for a confirmed paint instead.
      (props.isStandby &&
        hasIncomingData &&
        props.presentationPolicy?.preserveMatchingPresentation === true);
    // When SpectrumRoute supplies a presentationPolicy, liveSourceLifecycle is
    // the placeholder authority. Canvas layers only render that decision.
    const lifecycleOwnsPlaceholders = props.presentationPolicy != null;
    const placeholderErrorReason = useMemo(() => {
      if (props.placeholderErrorReason) {
        return props.placeholderErrorReason;
      }
      if (
        props.placeholderState?.kind === "error" &&
        props.placeholderState.reason
      ) {
        return props.placeholderState.reason;
      }
      if (sourceMode === "live" && wsState.cryptoCorrupted) {
        return "Crypto Corrupted";
      }
      if (lifecycleOwnsPlaceholders) {
        return null;
      }
      // Unit-test / non-route fallback only — production live path uses lifecycle.
      if (
        sourceMode === "live" &&
        shouldShowLiveServerDownPlaceholder({
          isConnected: wsState.isConnected,
          connectionStatus: wsState.connectionStatus,
          hasConnectedOnce: wsState.hasConnectedOnce === true,
          sourceStreamReady,
          sourceHandoffPending:
            props.presentationPolicy?.suppressStaleFrames === true,
          sourceTransportPhase: sourceTransport?.phase,
        })
      ) {
        return "Server down";
      }
      return null;
    }, [
      props.placeholderErrorReason,
      props.placeholderState,
      lifecycleOwnsPlaceholders,
      sourceMode,
      wsState.isConnected,
      wsState.connectionStatus,
      wsState.hasConnectedOnce,
      wsState.cryptoCorrupted,
      sourceStreamReady,
      props.presentationPolicy?.suppressStaleFrames,
      sourceTransport?.phase,
    ]);

    const awaitingDeviceData = useMemo(() => {
      if (sourceMode === "live") {
        if (
          wsState.deviceState === "loading" ||
          wsState.deviceState === "initializing"
        ) {
          return wsState.deviceLoadingReason === "restart"
            ? "Restarting device..."
            : wsState.deviceState === "initializing"
              ? "Initializing device..."
              : "Loading device...";
        }
      }
      return props.awaitingDeviceData || false;
    }, [
      sourceMode,
      wsState.deviceState,
      wsState.deviceLoadingReason,
      props.awaitingDeviceData,
    ]);

    const isGlobalLoading = !!(
      awaitingDeviceData ||
      placeholderErrorReason ||
      (props.placeholderState && props.placeholderState.kind !== "top-bar") ||
      // Standby top-bar is not a full-canvas cover. Cached data is not enough
      // here: both panes must stay covered until one pane confirms a paint.
      (sourceMode === "live" && !props.isPaused && !hasFrameForLoading)
    );

    const sharedAwaitingDeviceData = shouldShowLoadingPlaceholder
      ? placeholderErrorReason
        ? false
        : awaitingDeviceData ||
          (sourceMode === "live" && !props.isPaused && !hasFrameForLoading)
      : false;

    const sharedPlaceholderState = useMemo(() => {
      // Lifecycle-attached placeholder is authoritative (including Server Down).
      if (props.placeholderState) return props.placeholderState;
      if (lifecycleOwnsPlaceholders) return null;
      if (placeholderErrorReason) return null;
      if (!sharedAwaitingDeviceData) return null;
      return {
        kind: "loading" as const,
        sourceLabel: props.placeholderSourceLabel,
        paneLabel: "FFT",
        message:
          typeof sharedAwaitingDeviceData === "string"
            ? sharedAwaitingDeviceData
            : undefined,
      };
    }, [
      lifecycleOwnsPlaceholders,
      placeholderErrorReason,
      props.placeholderSourceLabel,
      props.placeholderState,
      props.isStandby,
      sharedAwaitingDeviceData,
    ]);

    const visualizerConnectionState = resolveVisualizerConnectionState({
      sourceMode,
      sourceStreamReady,
      placeholderErrorReason,
      sourceTransportPhase: sourceTransport?.phase,
    });
    const visualizerFrameState = hasRenderableFrame
      ? "rendered"
      : hasIncomingData
        ? "received"
        : props.isStandby
          ? "standby"
          : "awaiting";
    const visualizerMode =
      sourceMode === "file"
        ? "file"
        : sourceModeManagement.isTxMode
          ? "tx"
          : "rx";

    useEffect(() => {
      if (loadingPlaceholderTimeoutRef.current) {
        window.clearTimeout(loadingPlaceholderTimeoutRef.current);
        loadingPlaceholderTimeoutRef.current = null;
      }

      if (!isGlobalLoading) {
        if (awaitingFreshFrameRef.current) {
          return;
        }
        setShouldShowLoadingPlaceholder(false);
        return;
      }

      awaitingFreshFrameRef.current = true;
      setHasRenderableFrame(false);
      setHasPaintedFrame(false);

      loadingPlaceholderTimeoutRef.current = window.setTimeout(() => {
        setShouldShowLoadingPlaceholder(true);
        loadingPlaceholderTimeoutRef.current = null;
      }, props.loadingPlaceholderDelayMs ?? 160);

      return () => {
        if (loadingPlaceholderTimeoutRef.current) {
          window.clearTimeout(loadingPlaceholderTimeoutRef.current);
          loadingPlaceholderTimeoutRef.current = null;
        }
      };
    }, [isGlobalLoading, props.loadingPlaceholderDelayMs]);

    useEffect(() => {
      if (!hasPaintedFrame || !awaitingFreshFrameRef.current) {
        return;
      }
      awaitingFreshFrameRef.current = false;
      setShouldShowLoadingPlaceholder(false);
    }, [hasPaintedFrame]);

    useEffect(() => {
      props.onLoadingStateChange?.(shouldShowLoadingPlaceholder);
    }, [shouldShowLoadingPlaceholder, props.onLoadingStateChange]);

    const waterfallCanvasBindings: FFTCanvasWaterfallBindings = {
      waterfallGpuCanvasNode,
      waterfallOverlayCanvasNode,
      setWaterfallGpuCanvasNode,
      setWaterfallOverlayCanvasNode,
    };

    const zoom = props.vizZoom ?? 1;
    const zoomFloor = props.vizZoomFloor ?? 1;
    const pan = props.vizPanOffset ?? 0;
    const resetFrequencyRangeRef = useRef({ ...props.frequencyRange });
    useEffect(() => {
      if (zoom <= 1.0001) {
        resetFrequencyRangeRef.current = { ...props.frequencyRange };
      }
    }, [zoom, props.frequencyRange.min, props.frequencyRange.max]);
    const powerScale = props.powerScale ?? "dB";
    const defaultDbLimits = getVisualizerDefaultDbLimits(powerScale);
    const dbMin = props.fftMin ?? defaultDbLimits.min;
    const dbMax = props.fftMax ?? defaultDbLimits.max;
    const effectiveTxSlider = useMemo(() => {
      if (!showTxSlider) return undefined;
      if (!canShowTxSlider) return undefined;
      if (props.txSlider) return props.txSlider;
      const range = props.frequencyRange;
      if (
        !range ||
        !Number.isFinite(range.min) ||
        !Number.isFinite(range.max)
      ) {
        return undefined;
      }
      const visibleMinHz = Number.isFinite(range.min) ? range.min : 0;
      const visibleMaxHz =
        Number.isFinite(range.max) && range.max > visibleMinHz
          ? range.max
          : visibleMinHz + 1;
      const span = visibleMaxHz - visibleMinHz;
      const centerHz = Number.isFinite(txCenterFrequencyHz)
        ? txCenterFrequencyHz
        : visibleMinHz + span / 2;
      const sampleRateHz = Number.isFinite(txSampleRateHz)
        ? Math.max(1, txSampleRateHz)
        : Math.max(1, Math.min(120_000, span));
      return {
        visible: true,
        signalLabel: resolveTxSignalDisplayLabel(txSignal),
        powerDbm: txPowerDbm,
        visibleMinHz,
        visibleMaxHz,
        txCenterHz: centerHz,
        txSampleRateHz: sampleRateHz,
        rxSampleRateHz: span,
        onCenterFrequencyChange: (value: number) =>
          dispatch(spectrumActions.setTxCenterFrequencyHz(value)),
        onSampleRateChange: (value: number) =>
          dispatch(spectrumActions.setTxSampleRateHz(value)),
      };
    }, [
      props.txSlider,
      props.frequencyRange,
      showTxSlider,
      canShowTxSlider,
      txCenterFrequencyHz,
      txSampleRateHz,
      txSignal,
      txPowerDbm,
      dispatch,
    ]);
    const handleZoomChange = useCallback(
      (nextZoom: number) => {
        const clampedZoom = clampVizZoom(nextZoom, zoomFloor, maxVizZoom);
        const activeBounds =
          props.signalAreaBounds?.[props.activeSignalArea] ??
          props.signalAreaBounds?.[props.activeSignalArea?.toLowerCase?.()] ??
          null;
        const zoomedBounds = clampedZoom > 1 ? null : activeBounds;
        const retune = allowNegativeFrequencies
          ? null
          : getRetunedVizPanForZoomChange({
              currentPan: pan,
              nextZoom: clampedZoom,
              rangeMin: props.frequencyRange.min,
              rangeMax: props.frequencyRange.max,
              bounds: zoomedBounds,
            });
        const nextPan = retune?.retuned
          ? retune.pan
          : getStableVizPanForZoomChange({
              currentZoom: zoom,
              currentPan: pan,
              nextZoom: clampedZoom,
              rangeMin: props.frequencyRange.min,
              rangeMax: props.frequencyRange.max,
              allowNegativeFrequencies,
            });
        if (retune?.retuned) {
          props.onFrequencyRangeChange?.(retune.frequencyRange);
        }
        if (props.onVizPanChange && nextPan !== pan) {
          props.onVizPanChange(nextPan);
        }
        props.onVizZoomChange?.(clampedZoom);
      },
      [
        zoom,
        zoomFloor,
        maxVizZoom,
        pan,
        props.activeSignalArea,
        props.frequencyRange.min,
        props.frequencyRange.max,
        props.signalAreaBounds,
        props.onFrequencyRangeChange,
        props.onVizPanChange,
        props.onVizZoomChange,
        allowNegativeFrequencies,
      ],
    );

    return (
      <Container
        data-testid="fft-waterfall"
        data-stream-source-id={
          sourceModeManagement.sourceId ?? props.expectedSourceId ?? ""
        }
        data-stream-mode={visualizerMode}
        data-stream-connection-state={visualizerConnectionState}
        data-stream-frame-state={visualizerFrameState}
        data-stream-frame-sequence={
          currentFrame && typeof currentFrame.sequence === "number"
            ? String(currentFrame.sequence)
            : ""
        }
      >
        <Left>
          <SpectrumStage>
            <FFTCanvas
              ref={ref}
              {...props}
              isStandby={props.isStandby}
              txSlider={effectiveTxSlider}
              maxVizZoom={maxVizZoom}
              txSliderAllowed={canShowTxSlider}
              interactionDisabled={isGlobalLoading}
              awaitingDeviceData={sharedAwaitingDeviceData}
              placeholderSourceLabel={props.placeholderSourceLabel}
              placeholderPaneLabel="FFT"
              placeholderErrorReason={placeholderErrorReason}
              placeholderState={
                sharedPlaceholderState?.kind === "loading" &&
                !shouldShowLoadingPlaceholder
                  ? undefined
                  : sharedPlaceholderState?.kind === "loading"
                    ? { ...sharedPlaceholderState, paneLabel: "FFT" }
                    : sharedPlaceholderState
              }
              onRenderableFrameChange={handleRenderableFrameChange}
              onCanvasLoadingChange={handleCanvasLoadingChange}
              waterfallCanvasBindings={waterfallCanvasBindings}
            />
            {props.overlayContent ? props.overlayContent : null}
          </SpectrumStage>
          <FIFOWaterfallCanvas
            isPaused={props.isPaused}
            isStandby={props.isStandby}
            setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
            setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
            headerActionContent={props.waterfallHeaderActionContent}
            awaitingDeviceData={sharedAwaitingDeviceData}
            placeholderSourceLabel={props.placeholderSourceLabel}
            placeholderPaneLabel="Waterfall"
            placeholderErrorReason={placeholderErrorReason}
            placeholderState={
              props.isPaused && !sharedPlaceholderState
                ? {
                    kind: "top-bar",
                    kicker: "Paused",
                    title: "",
                    sourceLabel: props.placeholderSourceLabel,
                  }
                : sharedPlaceholderState?.kind === "loading" &&
                    !shouldShowLoadingPlaceholder &&
                    !props.placeholderState
                  ? undefined
                  : sharedPlaceholderState?.kind === "loading"
                    ? { ...sharedPlaceholderState, paneLabel: "Waterfall" }
                    : sharedPlaceholderState
            }
          />
        </Left>
        <SlidersRail>
          <VisualizerSliders
            zoom={zoom}
            maxZoom={maxVizZoom}
            dbMax={dbMax}
            dbMin={dbMin}
            powerScale={props.powerScale ?? "dB"}
            disabled={isGlobalLoading}
            zoomFloor={zoomFloor}
            onZoomChange={handleZoomChange}
            onDbMaxChange={(nextDbMax) =>
              props.onFftDbLimitsChange?.(dbMin, nextDbMax)
            }
            onDbMinChange={(nextDbMin) =>
              props.onFftDbLimitsChange?.(nextDbMin, dbMax)
            }
            fftAvgEnabled={fftAvgEnabled}
            fftSmoothEnabled={fftSmoothEnabled}
            wfSmoothEnabled={wfSmoothEnabled}
            onFftAvgChange={(enabled) =>
              dispatch(spectrumActions.setFftAvgEnabled(enabled))
            }
            onFftSmoothChange={(enabled) =>
              dispatch(spectrumActions.setFftSmoothEnabled(enabled))
            }
            onWfSmoothChange={(enabled) =>
              dispatch(spectrumActions.setWfSmoothEnabled(enabled))
            }
            showTxSlider={showTxSlider}
            canShowTxSlider={canShowTxSlider}
            onShowTxSliderChange={(enabled) =>
              dispatch(spectrumActions.setShowTxSlider(enabled))
            }
            onResetZoomDb={() => {
              props.onFrequencyRangeChange?.(resetFrequencyRangeRef.current);
              props.onVizZoomFloorChange?.(1);
              props.onVizPanChange?.(0);
              props.onVizZoomChange?.(1);
              const defaultDbLimits = getVisualizerDefaultDbLimits(
                props.powerScale ?? "dB",
              );
              props.onFftDbLimitsChange?.(
                defaultDbLimits.min,
                defaultDbLimits.max,
              );
              dispatch(spectrumActions.setAutoZoomStability(true));
              dispatch(spectrumActions.setVizZoomFloorPan(0));
            }}
            autoZoomStability={autoZoomStability}
            onAutoZoomStabilityChange={(enabled) =>
              dispatch(spectrumActions.setAutoZoomStability(enabled))
            }
            onLockZoomFloor={() => {
              props.onVizZoomFloorChange?.(zoom);
              props.onVizZoomFloorPanChange?.(pan);
            }}
            onRefocusZoomFloor={() => {
              props.onVizZoomChange?.(zoomFloor);
              props.onVizPanChange?.(vizZoomFloorPan);
            }}
          />
        </SlidersRail>
      </Container>
    );
  },
);

FFTAndWaterfall.displayName = "FFTAndWaterfall";

export default FFTAndWaterfall;
