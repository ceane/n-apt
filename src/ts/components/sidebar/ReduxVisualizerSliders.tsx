import React from "react";
import styled from "styled-components";
import { useAppSelector, useAppDispatch } from "@n-apt/redux";
import { spectrumActions } from "@n-apt/redux";
import VisualizerSliders from "../VisualizerSliders";

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
  const vizZoom = useAppSelector(state => state.spectrum.vizZoom);
  const fftMinDb = useAppSelector(state => state.spectrum.fftMinDb);
  const fftMaxDb = useAppSelector(state => state.spectrum.fftMaxDb);
  const powerScale = useAppSelector(state => state.spectrum.powerScale);
  const fftAvgEnabled = useAppSelector(state => state.spectrum.fftAvgEnabled);
  const fftSmoothEnabled = useAppSelector(state => state.spectrum.fftSmoothEnabled);
  const wfSmoothEnabled = useAppSelector(state => state.spectrum.wfSmoothEnabled);

  // Handle zoom change
  const handleZoomChange = React.useCallback((zoom: number) => {
    dispatch(spectrumActions.setVizZoom(zoom));
  }, [dispatch]);

  // Handle dB range changes
  const handleDbMaxChange = React.useCallback((dbMax: number) => {
    dispatch(spectrumActions.setFftDbLimits({ min: fftMinDb, max: dbMax }));
  }, [dispatch, fftMinDb]);

  const handleDbMinChange = React.useCallback((dbMin: number) => {
    dispatch(spectrumActions.setFftDbLimits({ min: dbMin, max: fftMaxDb }));
  }, [dispatch, fftMaxDb]);

  // Handle reset
  const handleResetZoomDb = React.useCallback(() => {
    dispatch(spectrumActions.resetZoomAndDb());
    onResetZoomDb?.();
  }, [dispatch, onResetZoomDb]);

  // Handle toggle changes (these would need Redux actions added)
  const handleFftAvgChange = React.useCallback((enabled: boolean) => {
    dispatch(spectrumActions.setFftAvgEnabled(enabled));
  }, [dispatch]);

  const handleFftSmoothChange = React.useCallback((enabled: boolean) => {
    dispatch(spectrumActions.setFftSmoothEnabled(enabled));
  }, [dispatch]);

  const handleWfSmoothChange = React.useCallback((enabled: boolean) => {
    dispatch(spectrumActions.setWfSmoothEnabled(enabled));
  }, [dispatch]);

  return (
    <Container>
      <VisualizerSliders
        zoom={vizZoom}
        dbMax={fftMaxDb}
        dbMin={fftMinDb}
        powerScale={powerScale}
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
      />
    </Container>
  );
};

export default ReduxVisualizerSliders;
