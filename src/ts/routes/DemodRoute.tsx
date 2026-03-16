import React from "react";
import styled from "styled-components";
import { AnalysisTriggers } from "@n-apt/components/analysis/AnalysisTriggers";
import { VisionScene } from "@n-apt/components/analysis/VisionScene";
import { useDemod } from "@n-apt/contexts/DemodContext";

const DemodContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  gap: 24px;
  overflow-y: auto;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
`;

export const DemodRoute: React.FC = () => {
  const {
    currentIQData,
    setCurrentIQData,
    analysisSession,
  } = useDemod();

  // Initialize with mock data if none exists
  React.useEffect(() => {
    if (!currentIQData) {
      const samples = 32768; // 32K samples
      const iqData = new Uint8Array(samples * 2);
      for (let i = 0; i < samples; i++) {
        const t = i / samples;
        const phase = t * Math.PI * 2 * (1000 + Math.sin(t * 10) * 500) / 1000;
        iqData[i * 2] = Math.floor((Math.sin(phase) * 0.5 + 1) * 128);
        iqData[i * 2 + 1] = Math.floor((Math.cos(phase) * 0.5 + 1) * 128);
      }
      setCurrentIQData(iqData);
    }
  }, [currentIQData, setCurrentIQData]);

  return (
    <DemodContainer>
      <AnalysisTriggers />

      {analysisSession.state === 'capturing' && analysisSession.type === 'vision' && (
        <VisionScene session={analysisSession} />
      )}
    </DemodContainer>
  );
};

export default DemodRoute;
