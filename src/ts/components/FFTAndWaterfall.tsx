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
  type FFTCanvasWaterfallBindings,
} from "@n-apt/components/FFTCanvas";
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
    const vizZoomFloorPan = useAppSelector(
      (reduxState) => reduxState.spectrum.vizZoomFloorPan,
    );
    const showTxSlider = useAppSelector(
      (reduxState) => reduxState.spectrum.showTxSlider ?? true,
    );
    const txSignal = useAppSelector(
      (reduxState) => reduxState.spectrum.txSignal || "apt",
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
    const deviceKind = useAppSelector(
      (reduxState) => reduxState.spectrum.deviceKind,
    );
    const canShowTxSlider =
      deviceKind === "hackrf_one" ||
      deviceKind === "mock_tx" ||
      deviceKind === "tx_rx" ||
      deviceKind === "tx";
    const sourceMode = useAppSelector(
      (reduxState) => reduxState.waterfall.sourceMode,
    );
    const wsState = useAppSelector((reduxState) => reduxState.websocket);

    const [waterfallGpuCanvasNode, setWaterfallGpuCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallOverlayCanvasNode, setWaterfallOverlayCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [hasRenderableFrame, setHasRenderableFrame] = useState(false);
    const [isFftCanvasLoading, setIsFftCanvasLoading] = useState(true);
    const [shouldShowLoadingPlaceholder, setShouldShowLoadingPlaceholder] =
      useState(true);
    const loadingPlaceholderTimeoutRef = useRef<number | null>(null);
    const currentFrame = Array.isArray(props.dataRef.current)
      ? (props.dataRef.current[props.dataRef.current.length - 1] ?? null)
      : props.dataRef.current;
    const hasIncomingData = !!(
      currentFrame &&
      ((currentFrame.iq_data?.length ?? 0) > 0 ||
        (currentFrame.data?.length ?? 0) > 0 ||
        (currentFrame.waveform?.length ?? 0) > 0)
    );
    const hasLiveFrame = hasIncomingData || hasRenderableFrame;

    const placeholderErrorReason = useMemo(() => {
      if (props.placeholderErrorReason) {
        return props.placeholderErrorReason;
      }
      if (sourceMode === "live") {
        if (!wsState.isConnected) {
          return "Server Disconnected";
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
      isFftCanvasLoading
    );

    useEffect(() => {
      if (loadingPlaceholderTimeoutRef.current) {
        window.clearTimeout(loadingPlaceholderTimeoutRef.current);
        loadingPlaceholderTimeoutRef.current = null;
      }

      if (!isGlobalLoading) {
        setShouldShowLoadingPlaceholder(false);
        return;
      }

      loadingPlaceholderTimeoutRef.current = window.setTimeout(() => {
        setShouldShowLoadingPlaceholder(true);
        loadingPlaceholderTimeoutRef.current = null;
      }, 160);

      return () => {
        if (loadingPlaceholderTimeoutRef.current) {
          window.clearTimeout(loadingPlaceholderTimeoutRef.current);
          loadingPlaceholderTimeoutRef.current = null;
        }
      };
    }, [isGlobalLoading]);

    useEffect(() => {
      if (
        sourceMode === "live" &&
        (awaitingDeviceData || placeholderErrorReason)
      ) {
        setHasRenderableFrame(false);
        setIsFftCanvasLoading(true);
      }
    }, [awaitingDeviceData, placeholderErrorReason, sourceMode]);

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
        signalLabel: String(txSignal).toUpperCase(),
        powerDbm: txPowerDbm,
        visibleMinHz,
        visibleMaxHz,
        txCenterHz: centerHz,
        txSampleRateHz: sampleRateHz,
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
              txSlider={effectiveTxSlider}
              interactionDisabled={isGlobalLoading}
              awaitingDeviceData={
                sourceMode === "live"
                  ? awaitingDeviceData || !hasLiveFrame
                  : awaitingDeviceData
              }
              placeholderSourceLabel={props.placeholderSourceLabel}
              placeholderPaneLabel="FFT"
              placeholderErrorReason={placeholderErrorReason}
              onRenderableFrameChange={setHasRenderableFrame}
              onCanvasLoadingChange={setIsFftCanvasLoading}
              waterfallCanvasBindings={waterfallCanvasBindings}
            />
            {props.overlayContent ? props.overlayContent : null}
          </SpectrumStage>
          <FIFOWaterfallCanvas
            isPaused={props.isPaused}
            setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
            setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
            headerActionContent={props.waterfallHeaderActionContent}
            heterodyningHighlightedBins={props.heterodyningHighlightedBins}
            awaitingDeviceData={
              sourceMode === "live"
                ? awaitingDeviceData || !hasRenderableFrame
                : awaitingDeviceData
            }
            placeholderSourceLabel={props.placeholderSourceLabel}
            placeholderPaneLabel="Waterfall"
            placeholderErrorReason={placeholderErrorReason}
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
