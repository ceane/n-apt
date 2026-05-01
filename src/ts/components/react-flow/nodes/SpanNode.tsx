import React, { useState, useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { Handle, Position } from '@xyflow/react';
import { Settings2, Zap } from 'lucide-react';
import { useAppDispatch, useAppSelector, sendFrequencyRange, setFrequencyRange } from '@n-apt/redux';
import { fetchHardwareInfo } from '@n-apt/redux/thunks/demodThunks';
import { formatFrequency, parseFrequency } from '@n-apt/utils/frequency';

const NodeContainer = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 12px;
  min-width: 280px;
  color: ${({ theme }) => theme.colors.textPrimary};
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding-bottom: 8px;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${({ theme }) => theme.colors.primary};
`;

const InfoRow = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
`;

const InfoValue = styled.span`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
`;

const InputGroup = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: 12px;
`;

const InputField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 9px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const StyledInput = styled.input`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 4px 8px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.mono};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const ApplyButton = styled.button`
  width: 100%;
  margin-top: 12px;
  background: ${({ theme }) => theme.colors.primary}22;
  border: 1px solid ${({ theme }) => theme.colors.primary}44;
  color: ${({ theme }) => theme.colors.primary};
  padding: 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.primary}44;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

interface SpanNodeProps {
  data: {
    label: string;
  };
}

export const SpanNode: React.FC<SpanNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const isConnected = useAppSelector((state) => state.websocket.isConnected);
  const hardwareRange = useAppSelector((state) => state.demod.hardwareRange);
  const sampleRate = useAppSelector((state) => state.demod.sampleRateHz);
  const activeFrequencyRange = useAppSelector((state) => state.spectrum.frequencyRange);

  const [centerFreq, setCenterFreq] = useState<string>('137.500');
  const displaySampleRateHz = sampleRate && sampleRate > 0 ? sampleRate : 3_200_000;

  useEffect(() => {
    if (!isConnected) return;
    dispatch(fetchHardwareInfo());
  }, [dispatch, isConnected]);

  useEffect(() => {
    if (!activeFrequencyRange) return;
    const center = (activeFrequencyRange.min + activeFrequencyRange.max) / 2;
    setCenterFreq(Number.isFinite(center) ? center.toFixed(3) : '---');
  }, [activeFrequencyRange]);

  const derivedSpanHz = useMemo(() => {
    if (Number.isFinite(displaySampleRateHz) && displaySampleRateHz > 0) {
      return displaySampleRateHz;
    }
    if (activeFrequencyRange && Number.isFinite(activeFrequencyRange.min) && Number.isFinite(activeFrequencyRange.max)) {
      return Math.max(0, activeFrequencyRange.max - activeFrequencyRange.min);
    }
    return 3_200_000;
  }, [activeFrequencyRange, displaySampleRateHz]);

  const displayHardwareRange = hardwareRange ?? { min: 0, max: 2_000_000_000 };

  const derivedCenterHz = useMemo(() => {
    const parsed = parseFrequency(centerFreq, 'MHz');
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    if (activeFrequencyRange) {
      return (activeFrequencyRange.min + activeFrequencyRange.max) / 2;
    }
    return 137_500_000;
  }, [activeFrequencyRange, centerFreq]);

  const derivedStartHz = derivedCenterHz - derivedSpanHz / 2;
  const derivedEndHz = derivedCenterHz + derivedSpanHz / 2;

  const handleApply = () => {
    if (Number.isFinite(derivedCenterHz) && derivedEndHz > derivedStartHz) {
      const range = { min: derivedStartHz, max: derivedEndHz };
      dispatch(setFrequencyRange(range));
      dispatch(sendFrequencyRange(range));
    }
  };

  return (
    <NodeContainer>
      <Header>
        <Settings2 size={14} color="#00d4ff" />
        <Title>{data.label || 'Span'}</Title>
      </Header>

      <InfoRow>
        <span>Hardware Frequency Range:</span>
        <InfoValue>
          {`${formatFrequency(displayHardwareRange.min)} - ${formatFrequency(displayHardwareRange.max)}`}
        </InfoValue>
      </InfoRow>
      <InfoRow>
        <span>Sample Rate:</span>
        <InfoValue>{formatFrequency(displaySampleRateHz)}</InfoValue>
      </InfoRow>
      <InfoRow>
        <span>Start Frequency:</span>
        <InfoValue>{formatFrequency(derivedStartHz)}</InfoValue>
      </InfoRow>
      <InfoRow>
        <span>End Frequency:</span>
        <InfoValue>{formatFrequency(derivedEndHz)}</InfoValue>
      </InfoRow>

      <InputGroup>
        <InputField>
          <Label>Center Frequency (MHz)</Label>
          <StyledInput
            type="number"
            value={centerFreq}
            onChange={(e) => setCenterFreq(e.target.value)}
          />
        </InputField>
      </InputGroup>

      <ApplyButton onClick={handleApply}>
        <Zap size={10} style={{ marginRight: 4 }} />
        Apply Span
      </ApplyButton>

      <Handle type="source" position={Position.Right} id="range" />
    </NodeContainer>
  );
};
