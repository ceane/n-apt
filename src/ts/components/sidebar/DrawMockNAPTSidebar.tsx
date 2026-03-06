import React from "react";
import styled from "styled-components";
import { COLORS } from "@n-apt/consts";
import { Slider } from "@n-apt/components/ui";
import { BlockMath } from "react-katex";

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

const InfoContainer = styled.div`
  background-color: ${COLORS.surface};
  padding: 16px;
  border-radius: 8px;
  border: 1px solid ${COLORS.border};
`;

const InfoTitle = styled.h3`
  color: ${(props) => props.theme.primary};
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

const MathContainer = styled(InfoContainer)`
  background: rgba(0, 0, 0, 0.2);
  border: 1px dashed ${COLORS.border};
  padding: 12px;
  
  .katex-display {
    margin: 0.5em 0;
    font-size: 0.9em;
  }
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
      <MathContainer>
        <InfoTitle style={{ opacity: 0.7, fontSize: '12px' }}>Synthesis Equation</InfoTitle>
        <BlockMath
          math={`X(t) = e^{-\\left(\\frac{t}{w_e}\\right)^2} \\cdot \\sum_{k} h_k \\cdot S_k(t)`}
        />
        <BlockMath
          math={`S_k(t) = \\sin\\left[ \\frac{\\pi}{2} \\left( \\frac{t - k \\cdot s}{w} + 1 \\right) \\right]`}
        />
        <BlockMath
          math={`h_k = F + (B - F) \\cdot e^{-|k| \\lambda}`}
        />
        <div style={{ fontSize: '10px', color: COLORS.textSecondary, marginTop: '8px', textAlign: 'center' }}>
          where |t - k·s| ≤ w
        </div>
      </MathContainer>

      <div style={{ marginBottom: '8px', marginTop: '8px' }}>
        <h2 style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Simulation Controls
        </h2>
      </div>

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
          label="Spike Width"
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
          label="Envelope Width"
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
