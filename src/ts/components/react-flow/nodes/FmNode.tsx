import React, { useMemo, useRef } from 'react';
import styled from 'styled-components';
import { Handle, Position } from '@xyflow/react';
import { Radio as RadioIcon } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@n-apt/redux';
import { sendFrequencyRange } from '@n-apt/redux/thunks/websocketThunks';
import { setCenterFreq } from '@n-apt/redux/slices/demodSlice';
import { formatFrequency } from '@n-apt/utils/frequency';
import FFTCanvas from '@n-apt/components/FFTCanvas';
import { generateFMIQData } from '@n-apt/utils/generateSignalData';

const NodeContainer = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 12px;
  min-width: 420px;
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

const FrequencyDisplay = styled.div`
  font-size: 12px;
  font-family: ${({ theme }) => theme.typography.mono};
  color: ${({ theme }) => theme.colors.primary};
  background: ${({ theme }) => theme.colors.surface};
  padding: 8px;
  border-radius: 4px;
  text-align: center;
  border: 1px dashed ${({ theme }) => theme.colors.border};
  margin-bottom: 12px;
`;

const StationsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
`;

const StationsLabel = styled.div`
  font-size: 9px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textMuted};
  font-weight: 600;
`;

const StationsGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const StationPill = styled.button<{ $active: boolean }>`
  background: ${({ theme, $active }) => $active ? theme.colors.primary : theme.colors.surface};
  border: 1px solid ${({ theme, $active }) => $active ? theme.colors.primary : theme.colors.border};
  color: ${({ theme, $active }) => $active ? theme.colors.background : theme.colors.textPrimary};
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.typography.mono};
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:hover {
    background: ${({ theme }) => theme.colors.primary}33;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const VisualSection = styled.div`
  width: 100%;
  height: 180px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: #000;
`;

const FM_STATIONS = [
  88.1, 88.5, 88.9, 89.3, 89.5, 89.7, 90.3, 90.5, 90.7, 91.1, 91.7, 92.3, 92.7, 93.3, 94.1, 94.5, 95.3, 96.5, 97.3, 98.1, 98.5, 99.7, 100.3, 101.3, 102.1, 103.7, 104.5, 105.3, 106.1, 106.9, 107.7
];

interface FmNodeProps {
  data: {
    label: string;
  };
}

export const FmNode: React.FC<FmNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const centerFreq = useAppSelector((state) => state.demod.centerFreqMHz);

  const handleStationClick = (freqMHz: number) => {
    // Send frequency change command to server with ±100kHz range (200kHz total) for FM demodulation
    dispatch(sendFrequencyRange({
      min: freqMHz - 0.10,
      max: freqMHz + 0.10
    }));
    // Set PPM to 0 for precise FM tuning
    dispatch({
      type: 'websocket/sendMessage',
      payload: {
        type: 'ppm',
        ppm: 0
      }
    });
    // Set FFT Window to Rectangular for FM demodulation
    dispatch({
      type: 'websocket/sendMessage',
      payload: {
        type: 'settings',
        fftWindow: 'Rectangular'
      }
    });
    // Update local Redux state to keep the pill selected
    dispatch(setCenterFreq(freqMHz));
  };

  const fmIQ = useMemo(() => generateFMIQData(2048), []);
  const fmDataRef = useRef({
    iq_data: fmIQ,
    sample_rate: 250000,
    center_frequency_hz: 88200000
  });

  const fmRange = useMemo(() => ({ min: 88.0, max: 108.0 }), []);

  return (
    <NodeContainer>
      <Handle type="target" position={Position.Left} id="range" />

      <Header>
        <RadioIcon size={14} color="#00d4ff" />
        <Title>{data.label || 'FM Radio'}</Title>
      </Header>

      <FrequencyDisplay>
        {centerFreq ? formatFrequency(centerFreq) : 'Select a station'}
      </FrequencyDisplay>

      <StationsSection>
        <StationsLabel>FM Stations</StationsLabel>
        <StationsGrid>
          {FM_STATIONS.map((station) => (
            <StationPill
              key={station}
              $active={centerFreq !== null && Math.abs(centerFreq - station) < 0.1}
              onClick={() => handleStationClick(station)}
            >
              {station.toFixed(1)}
            </StationPill>
          ))}
        </StationsGrid>
      </StationsSection>

      <VisualSection>
        <FFTCanvas
          dataRef={fmDataRef}
          frequencyRange={fmRange}
          centerFrequencyMHz={centerFreq || 98.0}
          activeSignalArea="fm-preview"
          isPaused={true}
          isDeviceConnected={true}
          fftSize={2048}
          powerScale="dB"
          snapshotGridPreference={true}
          compact={true}
        />
      </VisualSection>

      <Handle type="source" position={Position.Right} id="audio" />
    </NodeContainer>
  );
};
