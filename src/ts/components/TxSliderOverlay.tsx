import React from "react";
import styled from "styled-components";
import { Signal } from "lucide-react";

const OverlayRoot = styled.div`
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 18px;
  z-index: 40;
  pointer-events: none;
`;

const OverlayCard = styled.div`
  pointer-events: auto;
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(8, 10, 14, 0.82), rgba(4, 6, 10, 0.92));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
`;

const Title = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${(props) => props.theme.textPrimary};
`;

const Badge = styled.span`
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${(props) => props.theme.primary};
  background: ${(props) => `${props.theme.primary}14`};
  border: 1px solid ${(props) => `${props.theme.primary}33`};
  border-radius: 999px;
  padding: 4px 8px;
`;

const Body = styled.div`
  display: grid;
  gap: 8px;
`;

const SliderRow = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
`;

const Value = styled.div`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  white-space: nowrap;
`;

const Slider = styled.input`
  width: 100%;
  accent-color: ${(props) => props.theme.primary};
`;

const Marks = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  opacity: 0.7;
  padding-inline: 2px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const Hint = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  opacity: 0.8;
`;

export interface TxSliderOverlayProps {
  signalLabel: string;
  txPosition: number;
  onTxPositionChange: (value: number) => void;
  powerDbm: number;
  sampleRateHz: number;
  centerFrequencyHz: number;
}

const formatHz = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(3)}MHz`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}kHz`;
  return `${Math.round(value)}Hz`;
};

export const TxSliderOverlay: React.FC<TxSliderOverlayProps> = ({
  signalLabel,
  txPosition,
  onTxPositionChange,
  powerDbm,
  sampleRateHz,
  centerFrequencyHz,
}) => {
  return (
    <OverlayRoot>
      <OverlayCard>
        <Header>
          <Title>
            <Signal size={13} strokeWidth={2} />
            Tx Slider
          </Title>
          <Badge>{signalLabel}</Badge>
        </Header>
        <Body>
          <SliderRow>
            <Value>-40dBm</Value>
            <Slider
              type="range"
              min={0}
              max={100}
              step={1}
              value={txPosition}
              onChange={(event) => onTxPositionChange(Number(event.target.value))}
              aria-label="Transmit position"
            />
            <Value>+10dBm</Value>
          </SliderRow>
          <Marks>
            <span>{formatHz(centerFrequencyHz - sampleRateHz / 2)}</span>
            <span>{formatHz(centerFrequencyHz)}</span>
            <span>{formatHz(centerFrequencyHz + sampleRateHz / 2)}</span>
          </Marks>
          <Hint>{formatHz(sampleRateHz)} span · {powerDbm.toFixed(1)} dBm target</Hint>
        </Body>
      </OverlayCard>
    </OverlayRoot>
  );
};

export default TxSliderOverlay;
