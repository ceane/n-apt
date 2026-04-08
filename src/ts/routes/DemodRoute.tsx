import React from "react";
import styled from "styled-components";
import { DemodRouteSection } from "@n-apt/components/DemodRouteSection";
import { VisionScene } from "@n-apt/components/3D/VisionScene";
import { DemodFilePlaybackBridge } from "@n-apt/components/DemodFilePlaybackBridge";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { useAppSelector } from "@n-apt/redux";

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
  const waterfall = useAppSelector((state) => state.waterfall);
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);

  return (
    <DemodContainer data-testid="demod-route">
      {waterfall.sourceMode === "file" && (
        <DemodFilePlaybackBridge
          selectedFiles={waterfall.selectedFiles}
          stitchTrigger={waterfall.stitchTrigger}
          stitchSourceSettings={waterfall.stitchSourceSettings}
          isPaused={waterfall.isStitchPaused}
          fftSize={fftSize}
        />
      )}

      <DemodRouteSection />

      {analysisSession.state === 'capturing' && analysisSession.type === 'vision' && (
        <VisionScene session={analysisSession} />
      )}
    </DemodContainer>
  );
};

export default DemodRoute;
