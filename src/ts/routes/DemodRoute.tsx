import React from "react";
import styled from "styled-components";
import { DemodRouteSection } from "@n-apt/components/DemodRouteSection";
import { VisionScene } from "@n-apt/components/3D/VisionScene";
import { useDemod } from "@n-apt/contexts/DemodContext";

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

  return (
    <DemodContainer>
      <DemodRouteSection />

      {analysisSession.state === 'capturing' && analysisSession.type === 'vision' && (
        <VisionScene session={analysisSession} />
      )}
    </DemodContainer>
  );
};

export default DemodRoute;
