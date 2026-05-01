import React, { useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Radio as RadioIcon, Volume2, VolumeX } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@n-apt/redux';
import { setAlgorithm, setBandwidth, setListening } from '@n-apt/redux/slices/demodSlice';
import { formatFrequency } from '@n-apt/utils/frequency';
import { useDemod } from '@n-apt/contexts/DemodContext';

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

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ControlItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 9px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textMuted};
`;

const StyledSelect = styled.select`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 4px 8px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.sans};
  width: 100%;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
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
`;

const ListenButton = styled.button<{ $active: boolean }>`
  width: 100%;
  margin-top: 12px;
  background: ${({ theme, $active }) => $active ? theme.colors.primary : theme.colors.primary + '22'};
  border: 1px solid ${({ theme }) => theme.colors.primary}44;
  color: ${({ theme, $active }) => $active ? theme.colors.background : theme.colors.primary};
  padding: 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover {
    background: ${({ theme, $active }) => $active ? theme.colors.primary : theme.colors.primary + '44'};
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

interface RadioNodeProps {
  data: {
    label: string;
  };
}

export const RadioNode: React.FC<RadioNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const algorithm = useAppSelector((state) => state.demod.algorithm);
  const bandwidth = useAppSelector((state) => state.demod.bandwidthKhz);
  const isListening = useAppSelector((state) => state.demod.isListening);
  const centerFreq = useAppSelector((state) => state.demod.centerFreqHz);

  const { audioPlayback } = useDemod();
  const { getNodes, getEdges } = useReactFlow();

  // Check if FM node is connected upstream
  const hasFmNodeUpstream = useMemo(() => {
    const nodes = getNodes();
    const edges = getEdges();
    // Find this radio node by matching the label
    const radioNode = nodes.find(n => n.data?.label === data.label && n.type === 'custom');

    if (!radioNode) return false;

    // Find all nodes that have an edge to this radio node
    const upstreamNodeIds = edges
      .filter(e => e.target === radioNode.id)
      .map(e => e.source);

    // Check if any upstream node has fmOptions
    return upstreamNodeIds.some(id => {
      const node = nodes.find(n => n.id === id);
      return node?.data?.fmOptions;
    });
  }, [getNodes, getEdges, data]);

  // Auto-select APT algorithm if an APT node is present in the flow
  useEffect(() => {
    const nodes = getNodes();
    const hasAptNode = nodes.some(n => n.data && n.data.aptOptions);

    if (hasAptNode && algorithm !== 'apt') {
      dispatch(setAlgorithm('apt'));
    }
  }, [getNodes, algorithm, dispatch]);

  const handleListenToggle = () => {
    const nextState = !isListening;
    dispatch(setListening(nextState));

    if (!nextState) {
      audioPlayback.stopAudio();
    }
  };

  return (
    <NodeContainer>
      <Handle type="target" position={Position.Left} id="range" />

      <Header>
        <RadioIcon size={14} color="#00d4ff" />
        <Title>{data.label || 'Radio'}</Title>
      </Header>

      <ControlGroup>
        <ControlItem>
          <Label>Demod Algorithm</Label>
          <StyledSelect
            value={hasFmNodeUpstream ? 'fm' : algorithm}
            onChange={(e) => dispatch(setAlgorithm(e.target.value as 'fm' | 'apt'))}
            disabled={hasFmNodeUpstream}
          >
            <option value="fm">FM (Wideband/Narrow)</option>
            <option value="apt">APT (NOAA Satellite)</option>
          </StyledSelect>
        </ControlItem>

        {!hasFmNodeUpstream && (
          <>
            <ControlItem>
              <Label>Bandwidth</Label>
              <StyledSelect
                value={bandwidth}
                onChange={(e) => dispatch(setBandwidth(parseInt(e.target.value)))}
              >
                <option value="12">12.5 kHz</option>
                <option value="25">25 kHz</option>
                <option value="50">50 kHz</option>
                <option value="100">100 kHz</option>
                <option value="200">200 kHz</option>
              </StyledSelect>
            </ControlItem>
          </>
        )}

        <ControlItem>
          <Label>Center Frequency</Label>
          <FrequencyDisplay>
            {hasFmNodeUpstream && centerFreq
              ? `${(centerFreq / 1e6).toFixed(1)}FM (±100kHz)`
              : centerFreq
                ? formatFrequency(centerFreq / 1e6)
                : 'From Span'}
          </FrequencyDisplay>
        </ControlItem>
      </ControlGroup>

      <ListenButton $active={isListening} onClick={handleListenToggle}>
        {isListening ? <Volume2 size={12} /> : <VolumeX size={12} />}
        {isListening ? 'Stop Listening' : 'Listen Real-time'}
      </ListenButton>

      <Handle type="source" position={Position.Right} id="audio" />
    </NodeContainer>
  );
};
