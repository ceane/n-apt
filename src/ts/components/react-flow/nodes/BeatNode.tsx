import React, { useMemo } from 'react';
import styled from 'styled-components';
import { Minus, Plus, Waves } from 'lucide-react';
import { Slider } from '@n-apt/components/ui';
import { useSpectrumStore } from '@n-apt/hooks/useSpectrumStore';

interface BeatNodeProps {
  data: {
    beatOptions: boolean;
    label: string;
    description?: string;
  };
}

const NodeContainer = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: ${({ theme }) => theme.spacing.lg};
  min-width: 320px;
  max-width: 420px;
`;

const NodeTitle = styled.div`
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NodeSubtitle = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Section = styled.div`
  display: grid;
  gap: 12px;
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
`;

const ActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 6px 10px;
  background: ${({ theme }) => theme.colors.surfaceHover};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const BeatCard = styled.div`
  padding: 10px;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: rgba(255, 255, 255, 0.03);
`;

const BeatCardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
`;

const BeatLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const BeatMeta = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const HelperText = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SNAP_RANGES = [
  { label: 'Delta', min: 0.5, max: 4, color: 'rgba(255, 100, 100, 0.1)' },
  { label: 'Theta', min: 4, max: 8, color: 'rgba(100, 255, 100, 0.1)' },
  { label: 'Alpha', min: 8, max: 12, color: 'rgba(100, 100, 255, 0.1)' },
  { label: 'Beta', min: 12, max: 30, color: 'rgba(255, 255, 100, 0.1)' },
  { label: 'Gamma', min: 30, max: 100, color: 'rgba(255, 100, 255, 0.1)' },
  { label: 'Voice', min: 120, max: 180, color: 'rgba(100, 255, 255, 0.1)' },
];

export const BeatNode: React.FC<BeatNodeProps> = ({ data }) => {
  const { state, dispatch } = useSpectrumStore();
  const activeParams = state.drawParams[state.activeClumpIndex] || state.drawParams[0];

  const beats = useMemo(() => activeParams.beats ?? [], [activeParams.beats]);

  const updateParams = (nextBeats: typeof beats) => {
    dispatch({
      type: 'SET_CLUMP_PARAMS',
      index: state.activeClumpIndex,
      params: { ...activeParams, beats: nextBeats },
    });
  };

  const addBeat = () => {
    if (beats.length >= 2) return;
    updateParams([...beats, { offsetHz: 30 }]);
  };

  const removeBeat = (index: number) => {
    updateParams(beats.filter((_, i) => i !== index));
  };

  const changeBeat = (index: number, offsetHz: number) => {
    const next = [...beats];
    next[index] = { ...next[index], offsetHz: offsetHz < 0.75 ? 0.5 : Math.round(offsetHz) };
    updateParams(next);
  };

  return (
    <NodeContainer>
      <NodeTitle>
        <Waves size={16} />
        {data.label}
      </NodeTitle>
      <NodeSubtitle>{data.description ?? 'Beat detection and heterodyne offsets before FFT.'}</NodeSubtitle>

      <Section>
        <HeaderRow>
          <SectionTitle>Beat offsets</SectionTitle>
          <ActionButton type="button" onClick={addBeat} disabled={beats.length >= 2}>
            <Plus size={12} /> Add Beat
          </ActionButton>
        </HeaderRow>

        {beats.length === 0 && <HelperText>No beats configured yet.</HelperText>}

        {beats.map((beat, index) => (
          <BeatCard key={index}>
            <BeatCardHeader>
              <div>
                <BeatLabel>Beat {index + 1}</BeatLabel>
                <BeatMeta>Heterodyne offset</BeatMeta>
              </div>
              <ActionButton type="button" onClick={() => removeBeat(index)}>
                <Minus size={12} /> Remove
              </ActionButton>
            </BeatCardHeader>
            <Slider
              value={beat.offsetHz}
              min={0.5}
              max={500}
              step={0.1}
              logarithmic={true}
              snapRanges={SNAP_RANGES}
              onChange={(value) => changeBeat(index, value)}
              formatValue={(value) => `${value % 1 === 0 ? value : value.toFixed(1)} Hz`}
              orientation="horizontal"
            />
          </BeatCard>
        ))}

        <HelperText>
          Beat detection feeds the FFT node when the flow is composed left-to-right.
        </HelperText>
      </Section>
    </NodeContainer>
  );
};
