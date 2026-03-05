import React from "react";
import styled from "styled-components";
import { COLORS } from "@n-apt/consts";

interface DrawMockNAPTSidebarProps {
  drawParams: {
    spikeCount: number;
    spikeWidth: number;
    centerSpikeBoost: number;
    floorAmplitude: number;
    decayRate: number;
    envelopeWidth: number;
  };
  onDrawParamsChange: (params: any) => void;
}

const DrawContainer = styled.div`
  display: grid;
  gap: 16px;
`;

const ControlsContainer = styled.div`
  display: grid;
  gap: 16px;
`;

import { Slider } from "@n-apt/components/ui";

const InfoContainer = styled.div`
  background-color: ${COLORS.surface};
  padding: 16px;
  border-radius: 8px;
  border: 1px solid ${COLORS.border};
`;

const InfoTitle = styled.h3`
  color: ${COLORS.primary};
  margin-bottom: 12px;
  font-size: 14px;
`;

const InfoText = styled.div`
  font-size: 12px;
  line-height: 1.5;
`;

const InfoParagraph = styled.p`
  margin-bottom: 8px;
  color: ${COLORS.textSecondary};
`;

const DrawMockNAPTSidebar: React.FC<DrawMockNAPTSidebarProps> = ({
  drawParams,
  onDrawParamsChange,
}) => {
  const handleParamChange = (key: keyof typeof drawParams, value: number) => {
    onDrawParamsChange({
      ...drawParams,
      [key]: value,
    });
  };

  return (
    <DrawContainer>
      <ControlsContainer>
        <Slider
          label="Spikes"
          value={drawParams.spikeCount}
          min={10}
          max={300}
          step={10}
          onChange={(v) => handleParamChange("spikeCount", v)}
          formatValue={(v) => v.toString()}
          orientation="horizontal"
        />

        <Slider
          label="S. Width"
          value={drawParams.spikeWidth}
          min={0.1}
          max={2.0}
          step={0.1}
          onChange={(v) => handleParamChange("spikeWidth", v)}
          formatValue={(v) => v.toFixed(1)}
          orientation="horizontal"
        />

        <Slider
          label="Boost"
          value={drawParams.centerSpikeBoost}
          min={1.0}
          max={5.0}
          step={0.1}
          onChange={(v) => handleParamChange("centerSpikeBoost", v)}
          formatValue={(v) => v.toFixed(1)}
          orientation="horizontal"
        />

        <Slider
          label="Floor"
          value={drawParams.floorAmplitude}
          min={0.1}
          max={2.0}
          step={0.1}
          onChange={(v) => handleParamChange("floorAmplitude", v)}
          formatValue={(v) => v.toFixed(1)}
          orientation="horizontal"
        />

        <Slider
          label="Decay"
          value={drawParams.decayRate}
          min={0.1}
          max={2.0}
          step={0.1}
          onChange={(v) => handleParamChange("decayRate", v)}
          formatValue={(v) => v.toFixed(2)}
          orientation="horizontal"
        />

        <Slider
          label="E. Width"
          value={drawParams.envelopeWidth}
          min={1.0}
          max={20.0}
          step={0.5}
          onChange={(v) => handleParamChange("envelopeWidth", v)}
          formatValue={(v) => v.toFixed(1)}
          orientation="horizontal"
        />
      </ControlsContainer>

      <InfoContainer>
        <InfoTitle>Signal Parameters</InfoTitle>
        <InfoText>
          <InfoParagraph>
            <strong>Frequency Range:</strong> 0 - 3 MHz (N-APT APT frequency
            range)
          </InfoParagraph>
          <InfoParagraph>
            <strong>Signal Features:</strong> Frequency comb with Gaussian
            envelope
          </InfoParagraph>
          <InfoParagraph>
            <strong>Modulation:</strong> Sine wave spikes with exponential decay
          </InfoParagraph>
          <InfoParagraph>
            <strong>Center Boost:</strong> Enhanced center frequency at 1.5 MHz
          </InfoParagraph>
        </InfoText>
      </InfoContainer>
    </DrawContainer>
  );
};

export default DrawMockNAPTSidebar;
