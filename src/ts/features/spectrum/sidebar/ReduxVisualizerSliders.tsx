import React from "react";
import styled from "styled-components";
import { useAppSelector, useAppDispatch } from "@n-apt/redux";
import { spectrumActions } from "@n-apt/redux";
import VisualizerSliders from "@n-apt/spectrum/VisualizerSliders";
import {
  clampVizZoom,
  getStableVizPanForZoomChange,
} from "@n-apt/spectrum/public/visualizationZoom";
import { resolveSourceModeManagement } from "@n-apt/app/infrastructure/streams/sourceModeManagement";

const Container = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

interface ReduxVisualizerSlidersProps {
  onResetZoomDb?: () => void;
}

const ReduxVisualizerSliders: React.FC<ReduxVisualizerSlidersProps> = ({
  onResetZoomDb,
}) => {
  const dispatch = useAppDispatch();

  // Get state from Redux
  const vizZoom = useAppSelector((state) => state.spectrum.vizZoom);
  const maxVizZoom = useAppSelector((state) => state.spectrum.maxVizZoom);
  const vizZoomFloor = useAppSelector((state) => state.spectrum.vizZoomFloor);
  const vizPanOffset = useAppSelector((state) => state.spectrum.vizPanOffset);
  const frequencyRange = useAppSelector(
    (state) => state.spectrum.frequencyRange,
  );
  const fftMinDb = useAppSelector((state) => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector((state) => state.spectrum.fftMaxDb);
  const powerScale = useAppSelector((state) => state.spectrum.powerScale);
  const fftAvgEnabled = useAppSelector((state) => state.spectrum.fftAvgEnabled);
  const fftSmoothEnabled = useAppSelector(
    (state) => state.spectrum.fftSmoothEnabled,
  );
  const wfSmoothEnabled = useAppSelector(
    (state) => state.spectrum.wfSmoothEnabled,
  );
  const autoZoomStability = useAppSelector(
    (state) => state.spectrum.autoZoomStability,
  );
  const vizZoomFloorPan = useAppSelector(
    (state) => state.spectrum.vizZoomFloorPan,
  );
  const showTxSlider = useAppSelector(
    (state) => state.spectrum.showTxSlider ?? true,
  );
  const activeSource = useAppSelector((state) =>
    state.websocket.sources?.find?.(
      (source) => source.id === state.websocket.activeSourceId,
    ),
  );
  const txSuiteSourceId = useAppSelector(
    (state) => state.sourceRouting?.bindings?.["tx-suite:tx"] ?? null,
  );
  const canShowTxSlider = resolveSourceModeManagement({
    source: activeSource,
    txBindingSourceId: txSuiteSourceId,
  }).shouldShowTxControls;

  // Handle zoom change
  const handleZoomChange = React.useCallback(
    (zoom: number) => {
      const clampedZoom = clampVizZoom(zoom, vizZoomFloor, maxVizZoom);
      const nextPan = frequencyRange
        ? getStableVizPanForZoomChange({
            currentZoom: vizZoom,
            currentPan: vizPanOffset,
            nextZoom: clampedZoom,
            rangeMin: frequencyRange.min,
            rangeMax: frequencyRange.max,
          })
        : vizPanOffset;
      dispatch(spectrumActions.setVizZoom(clampedZoom));
      dispatch(spectrumActions.setVizPan(nextPan));
    },
    [dispatch, frequencyRange, maxVizZoom, vizZoom, vizPanOffset, vizZoomFloor],
  );

  // Handle dB range changes
  const handleDbMaxChange = React.useCallback(
    (dbMax: number) => {
      dispatch(spectrumActions.setFftDbLimits({ min: fftMinDb, max: dbMax }));
    },
    [dispatch, fftMinDb],
  );

  const handleDbMinChange = React.useCallback(
    (dbMin: number) => {
      dispatch(spectrumActions.setFftDbLimits({ min: dbMin, max: fftMaxDb }));
    },
    [dispatch, fftMaxDb],
  );

  // Handle reset
  const handleResetZoomDb = React.useCallback(() => {
    dispatch(spectrumActions.setVizPan(0));
    dispatch(spectrumActions.resetZoomAndDb());
    dispatch(spectrumActions.setAutoZoomStability(true));
    dispatch(spectrumActions.setVizZoomFloorPan(0));
    onResetZoomDb?.();
  }, [dispatch, onResetZoomDb]);

  // Handle toggle changes (these would need Redux actions added)
  const handleFftAvgChange = React.useCallback(
    (enabled: boolean) => {
      dispatch(spectrumActions.setFftAvgEnabled(enabled));
    },
    [dispatch],
  );

  const handleFftSmoothChange = React.useCallback(
    (enabled: boolean) => {
      dispatch(spectrumActions.setFftSmoothEnabled(enabled));
    },
    [dispatch],
  );

  const handleWfSmoothChange = React.useCallback(
    (enabled: boolean) => {
      dispatch(spectrumActions.setWfSmoothEnabled(enabled));
    },
    [dispatch],
  );

  return (
    <Container>
      <VisualizerSliders
        zoom={vizZoom}
        maxZoom={maxVizZoom}
        dbMax={fftMaxDb}
        dbMin={fftMinDb}
        powerScale={powerScale}
        zoomFloor={vizZoomFloor}
        onZoomChange={handleZoomChange}
        onDbMaxChange={handleDbMaxChange}
        onDbMinChange={handleDbMinChange}
        fftAvgEnabled={fftAvgEnabled}
        fftSmoothEnabled={fftSmoothEnabled}
        wfSmoothEnabled={wfSmoothEnabled}
        onFftAvgChange={handleFftAvgChange}
        onFftSmoothChange={handleFftSmoothChange}
        onWfSmoothChange={handleWfSmoothChange}
        onResetZoomDb={handleResetZoomDb}
        autoZoomStability={autoZoomStability}
        onAutoZoomStabilityChange={(enabled) =>
          dispatch(spectrumActions.setAutoZoomStability(enabled))
        }
        showTxSlider={showTxSlider}
        canShowTxSlider={canShowTxSlider}
        onShowTxSliderChange={(show) =>
          dispatch(spectrumActions.setShowTxSlider(show))
        }
        onLockZoomFloor={() => {
          dispatch(spectrumActions.setVizZoomFloor(vizZoom));
          dispatch(spectrumActions.setVizZoomFloorPan(vizPanOffset));
        }}
        onRefocusZoomFloor={() => {
          dispatch(spectrumActions.setVizZoom(vizZoomFloor));
          dispatch(spectrumActions.setVizPan(vizZoomFloorPan));
        }}
      />
    </Container>
  );
};

export default ReduxVisualizerSliders;
