import { forwardRef, useCallback, useState } from "react";
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
  getStableVizPanForZoomChange,
} from "@n-apt/utils/visualizationZoom";

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

const SlidersRail = styled.div`
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const FFTAndWaterfall = forwardRef<FFTCanvasHandle, FFTCanvasProps>(
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
    const [waterfallGpuCanvasNode, setWaterfallGpuCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallOverlayCanvasNode, setWaterfallOverlayCanvasNode] =
      useState<HTMLCanvasElement | null>(null);

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
    const handleZoomChange = useCallback(
      (nextZoom: number) => {
        const clampedZoom = clampVizZoom(nextZoom, zoomFloor);
        const nextPan = getStableVizPanForZoomChange({
          currentZoom: zoom,
          currentPan: pan,
          nextZoom: clampedZoom,
          rangeMin: props.frequencyRange.min,
          rangeMax: props.frequencyRange.max,
        });
        if (props.onVizPanChange && nextPan !== pan) {
          props.onVizPanChange(nextPan);
        }
        props.onVizZoomChange?.(clampedZoom);
      },
      [
        zoom,
        zoomFloor,
        pan,
        props.frequencyRange.min,
        props.frequencyRange.max,
        props.onVizPanChange,
        props.onVizZoomChange,
      ],
    );

    return (
      <Container>
        <Left>
        <FFTCanvas
            key={props.fftSize}
            ref={ref}
            {...props}
            waterfallCanvasBindings={waterfallCanvasBindings}
          />
          <FIFOWaterfallCanvas
            isPaused={props.isPaused}
            setWaterfallGpuCanvasNode={setWaterfallGpuCanvasNode}
            setWaterfallOverlayCanvasNode={setWaterfallOverlayCanvasNode}
            heterodyningHighlightedBins={props.heterodyningHighlightedBins}
          />
        </Left>
        <SlidersRail>
          <VisualizerSliders
            zoom={zoom}
            dbMax={dbMax}
            dbMin={dbMin}
            powerScale={props.powerScale ?? "dB"}
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
            onRefocusZoomFloor={() => {
              props.onVizZoomFloorChange?.(zoom);
              props.onVizZoomFloorPanChange?.(pan);
            }}
          />
        </SlidersRail>
      </Container>
    );
  },
);

FFTAndWaterfall.displayName = "FFTAndWaterfall";

export default FFTAndWaterfall;
