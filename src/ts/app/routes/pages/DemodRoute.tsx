import React, { Suspense } from "react";
import styled from "styled-components";
import { DemodRouteSection } from "@n-apt/demodulation/DemodRouteSection";
import { useDemodAnalysis } from "@n-apt/demodulation/public/context/DemodAnalysisContext";
import { useAppSelector } from "@n-apt/redux";
import { useDemod } from "@n-apt/demodulation/context/DemodContext";
import { RetryableMlFeature } from "@n-apt/shared/ui/RetryableMlFeature";
import { loadEncryptedMlModule } from "@n-apt/shared/ui/loadEncryptedMlModule";

const loadVisionScene = () =>
  loadEncryptedMlModule().then((module) => ({
    default: module.VisionScene,
  }));

const DemodFilePlaybackBridge = React.lazy(() =>
  import("@n-apt/capture/DemodFilePlaybackBridge").then((m) => ({
    default: m.DemodFilePlaybackBridge,
  })),
);

const DemodContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
`;

export const DemodRoute: React.FC = () => {
  const { analysisSession } = useDemodAnalysis();
  const { visionPreset } = useDemod();
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const selectedFiles = useAppSelector(
    (state) => state.waterfall.selectedFiles,
  );
  const stitchTrigger = useAppSelector(
    (state) => state.waterfall.stitchTrigger,
  );
  const stitchSourceSettings = useAppSelector(
    (state) => state.waterfall.stitchSourceSettings,
  );
  const isStitchPaused = useAppSelector(
    (state) => state.waterfall.isStitchPaused,
  );
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);

  return (
    <DemodContainer data-testid="demod-route">
      {sourceMode === "file" && (
        <Suspense fallback={null}>
          <DemodFilePlaybackBridge
            selectedFiles={selectedFiles}
            stitchTrigger={stitchTrigger}
            stitchSourceSettings={stitchSourceSettings}
            isPaused={isStitchPaused}
            fftSize={fftSize}
          />
        </Suspense>
      )}

      <DemodRouteSection />

      {(analysisSession.state === "starting" ||
        analysisSession.state === "capturing") &&
        analysisSession.type === "vision" && (
          <RetryableMlFeature
            label="Vision stimulus"
            loader={loadVisionScene}
            componentProps={{ session: analysisSession, preset: visionPreset }}
          />
        )}
    </DemodContainer>
  );
};

export default DemodRoute;
