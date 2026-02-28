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
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ControlsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.label`
  font-size: 12px;
  color: ${COLORS.textMuted};
  font-weight: 500;
`;

const Slider = styled.input`
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: ${COLORS.border};
  outline: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${COLORS.primary};
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${COLORS.primary};
    cursor: pointer;
    border: none;
  }
`;

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
        <ControlGroup>
          <Label>Spike Count: {drawParams.spikeCount}</Label>
          <Slider
            type="range"
            min="10"
            max="300"
            step="10"
            value={drawParams.spikeCount}
            onChange={(e) => handleParamChange("spikeCount", Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Spike Width: {drawParams.spikeWidth.toFixed(1)}</Label>
          <Slider
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={drawParams.spikeWidth}
            onChange={(e) => handleParamChange("spikeWidth", Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Center Spike Boost: {drawParams.centerSpikeBoost.toFixed(1)}</Label>
          <Slider
            type="range"
            min="1.0"
            max="5.0"
            step="0.1"
            value={drawParams.centerSpikeBoost}
            onChange={(e) => handleParamChange("centerSpikeBoost", Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Floor Amplitude: {drawParams.floorAmplitude.toFixed(1)}</Label>
          <Slider
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={drawParams.floorAmplitude}
            onChange={(e) => handleParamChange("floorAmplitude", Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Decay Rate: {drawParams.decayRate.toFixed(2)}</Label>
          <Slider
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={drawParams.decayRate}
            onChange={(e) => handleParamChange("decayRate", Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Envelope Width: {drawParams.envelopeWidth.toFixed(1)}</Label>
          <Slider
            type="range"
            min="1.0"
            max="20.0"
            step="0.5"
            value={drawParams.envelopeWidth}
            onChange={(e) => handleParamChange("envelopeWidth", Number(e.target.value))}
          />
        </ControlGroup>
      </ControlsContainer>

      <InfoContainer>
        <InfoTitle>Signal Parameters</InfoTitle>
        <InfoText>
          <InfoParagraph>
            <strong>Frequency Range:</strong> 0 - 3 MHz (N-APT APT frequency range)
          </InfoParagraph>
          <InfoParagraph>
            <strong>Signal Features:</strong> Frequency comb with Gaussian envelope
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
