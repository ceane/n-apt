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
} from "@n-apt/components/FFTCanvas";
import type { FFTCanvasWaterfallBindings } from "@n-apt/types/canvas";
import FIFOWaterfallCanvas from "@n-apt/components/FIFOWaterfallCanvas";
import { VisualizerSliders } from "@n-apt/components/VisualizerSliders";
import { useAppDispatch, useAppSelector, spectrumActions } from "@n-apt/redux";
import { VISUALIZER_PADDING, VISUALIZER_GAP } from "@n-apt/consts";
import {
  clampVizZoom,
  getRetunedVizPanForZoomChange,
  getStableVizPanForZoomChange,
} from "@n-apt/utils/visualizationZoom";

type FFTAndWaterfallProps = FFTCanvasProps & {
  waterfallHeaderActionContent?: ReactNode;
  onLoadingStateChange?: (isLoading: boolean) => void;
  loadingPlaceholderDelayMs?: number;
};

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

const isTxCapableSource = (
  source?: { capability?: string | null } | null,
) => {
  if (!source) return false;
  const capability = source.capability?.toLowerCase?.() ?? "";
  return capability === "tx" || capability === "tx_rx";
};

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
    const vizZoomFloorPan = useAppSelector(
      (reduxState) => reduxState.spectrum.vizZoomFloorPan,
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
    const canShowTxSlider = isTxCapableSource(activeSource);
    const sourceMode = useAppSelector(
      (reduxState) => reduxState.waterfall.sourceMode,
    );
    const wsState = useAppSelector((reduxState) => reduxState.websocket);

    const [waterfallGpuCanvasNode, setWaterfallGpuCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallOverlayCanvasNode, setWaterfallOverlayCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [hasRenderableFrame, setHasRenderableFrame] = useState(false);
    const [shouldShowLoadingPlaceholder, setShouldShowLoadingPlaceholder] =
      useState(true);
    const handleRenderableFrameChange = useCallback(
      (hasFrame: boolean) => {
        setHasRenderableFrame(hasFrame);
        props.onRenderableFrameChange?.(hasFrame);
      },
      [props.onRenderableFrameChange],
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
    const hasLiveFrame =
      hasRenderableFrame || (props.isPaused && hasIncomingData);
    const placeholderErrorReason = useMemo(() => {
      if (props.placeholderErrorReason) {
        return props.placeholderErrorReason;
      }
      if (sourceMode === "live") {
        if (!wsState.isConnected) {
          return "Server down";
        }
        if (wsState.cryptoCorrupted) {
          return "Crypto Corrupted";
        }
      }
      return null;
    }, [
      props.placeholderErrorReason,
      sourceMode,
      wsState.isConnected,
      wsState.cryptoCorrupted,
    ]);

    const awaitingDeviceData = useMemo(() => {
      if (sourceMode === "live") {
        if (wsState.deviceState === "loading") {
          return wsState.deviceLoadingReason === "restart"
            ? "Restarting device..."
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
      props.placeholderState ||
      (sourceMode === "live" && !props.isPaused && !hasLiveFrame)
    );

    const sharedAwaitingDeviceData = shouldShowLoadingPlaceholder
      ? awaitingDeviceData ||
        (sourceMode === "live" && !props.isPaused && !hasLiveFrame)
      : false;

    const sharedPlaceholderState = useMemo(() => {
      // Connection and device errors are authoritative. Do not let a stale
      // standby/loading presentation mask the server-disconnected state.
      if (placeholderErrorReason) return null;
      if (props.placeholderState) return props.placeholderState;
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
      placeholderErrorReason,
      props.placeholderSourceLabel,
      props.placeholderState,
      sharedAwaitingDeviceData,
    ]);

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
      if (!hasRenderableFrame || !awaitingFreshFrameRef.current) {
        return;
      }
      awaitingFreshFrameRef.current = false;
      setShouldShowLoadingPlaceholder(false);
    }, [hasRenderableFrame]);

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
    const powerScale = props.powerScale ?? "dB";
    const dbMin = props.fftMin ?? (powerScale === "dBm" ? -100 : -120);
    const dbMax = props.fftMax ?? (powerScale === "dBm" ? 30 : 0);
    const effectiveTxSlider = useMemo(() => {
      if (props.txSlider) return props.txSlider;
      if (!showTxSlider) return undefined;
      if (!canShowTxSlider) return undefined;
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
        const clampedZoom = clampVizZoom(nextZoom, zoomFloor);
        const activeBounds =
          props.signalAreaBounds?.[props.activeSignalArea] ??
          props.signalAreaBounds?.[props.activeSignalArea?.toLowerCase?.()] ??
          null;
        const zoomedBounds = clampedZoom > 1 ? null : activeBounds;
        const retune = getRetunedVizPanForZoomChange({
          currentPan: pan,
          nextZoom: clampedZoom,
          rangeMin: props.frequencyRange.min,
          rangeMax: props.frequencyRange.max,
          bounds: zoomedBounds,
        });
        const nextPan = retune.retuned
          ? retune.pan
          : getStableVizPanForZoomChange({
              currentZoom: zoom,
              currentPan: pan,
              nextZoom: clampedZoom,
              rangeMin: props.frequencyRange.min,
              rangeMax: props.frequencyRange.max,
            });
        if (retune.retuned) {
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
        pan,
        props.activeSignalArea,
        props.frequencyRange.min,
        props.frequencyRange.max,
        props.signalAreaBounds,
        props.onFrequencyRangeChange,
        props.onVizPanChange,
        props.onVizZoomChange,
      ],
    );

    return (
      <Container>
        <Left>
          <SpectrumStage>
            <FFTCanvas
              ref={ref}
              {...props}
              isStandby={props.isStandby}
              txSlider={effectiveTxSlider}
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
              sharedPlaceholderState?.kind === "loading" &&
              !shouldShowLoadingPlaceholder
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
              props.onVizZoomFloorChange?.(1);
              props.onVizPanChange?.(0);
              props.onVizZoomChange?.(1);
              props.onFftDbLimitsChange?.(
                props.powerScale === "dBm" ? -100 : -120,
                props.powerScale === "dBm" ? 30 : 0,
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
