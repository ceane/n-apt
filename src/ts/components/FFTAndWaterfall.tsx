import { forwardRef, useMemo, useState } from "react";
import styled from "styled-components";
import FFTCanvas, {
  type FFTCanvasHandle,
  type FFTCanvasProps,
  type FFTCanvasWaterfallBindings,
} from "@n-apt/components/FFTCanvas";
import FIFOWaterfallCanvas from "@n-apt/components/FIFOWaterfallCanvas";
import { VisualizerSliders } from "@n-apt/components/VisualizerSliders";
import { useAppDispatch, useAppSelector, spectrumActions } from "@n-apt/redux";
import {
  VISUALIZER_PADDING,
  VISUALIZER_GAP
} from "@n-apt/consts";

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
    const [waterfallCanvasNode, setWaterfallCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallGpuCanvasNode, setWaterfallGpuCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const [waterfallOverlayCanvasNode, setWaterfallOverlayCanvasNode] =
      useState<HTMLCanvasElement | null>(null);
    const zoom = props.vizZoom ?? 1;
    const dbMin = props.fftMin ?? -120;
    const dbMax = props.fftMax ?? (props.powerScale === "dBm" ? 30 : 0);

    const waterfallCanvasBindings = useMemo<FFTCanvasWaterfallBindings>(
      () => ({
        waterfallCanvasNode,
        waterfallGpuCanvasNode,
        waterfallOverlayCanvasNode,
        setWaterfallCanvasNode,
        setWaterfallGpuCanvasNode,
        setWaterfallOverlayCanvasNode,
      }),
      [
        waterfallCanvasNode,
        waterfallGpuCanvasNode,
        waterfallOverlayCanvasNode,
      ],
    );

    return (
      <Container>
        <Left>
          <FFTCanvas
            ref={ref}
            {...props}
            hideWaterfall={true}
            hideSliders={true}
            waterfallCanvasBindings={waterfallCanvasBindings}
          />
          <FIFOWaterfallCanvas
            isPaused={props.isPaused}
            setWaterfallCanvasNode={setWaterfallCanvasNode}
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
            onZoomChange={(nextZoom) => props.onVizZoomChange?.(nextZoom)}
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
              props.onVizZoomChange?.(1);
              props.onVizPanChange?.(0);
              props.onFftDbLimitsChange?.(
                props.powerScale === "dBm" ? -100 : -120,
                props.powerScale === "dBm" ? 30 : 0,
              );
            }}
          />
        </SlidersRail>
      </Container>
    );
  },
);

FFTAndWaterfall.displayName = "FFTAndWaterfall";

export default FFTAndWaterfall;
