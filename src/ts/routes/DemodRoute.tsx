import React, { Suspense } from "react";
import styled from "styled-components";
import { DemodRouteSection } from "@n-apt/components/DemodRouteSection";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { useAppSelector } from "@n-apt/redux";

const VisionScene = React.lazy(() =>
  import("@n-apt/components/3D/VisionScene").then((m) => ({
    default: m.VisionScene,
  })),
);

const DemodFilePlaybackBridge = React.lazy(() =>
  import("@n-apt/components/DemodFilePlaybackBridge").then((m) => ({
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
  const { analysisSession } = useDemod();
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const selectedFiles = useAppSelector((state) => state.waterfall.selectedFiles);
  const stitchTrigger = useAppSelector((state) => state.waterfall.stitchTrigger);
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

      {analysisSession.state === "capturing" &&
        analysisSession.type === "vision" && (
          <Suspense fallback={null}>
            <VisionScene session={analysisSession} />
          </Suspense>
        )}
    </DemodContainer>
  );
};

export default DemodRoute;
