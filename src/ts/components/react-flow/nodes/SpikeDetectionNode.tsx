import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { Search, Zap } from "lucide-react";

interface SpikeDetectionNodeProps {
  data: {
    spikeOptions: boolean;
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

const PrimaryButton = styled(ActionButton)`
  justify-content: center;
  padding: 10px 12px;
  background: ${({ theme }) => theme.colors.primary}1a;
  border-color: ${({ theme }) => theme.colors.primary};
`;

const ResultCard = styled.div`
  padding: 10px;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: rgba(255, 255, 255, 0.03);
`;

const ResultHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
`;

const ResultLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ResultMeta = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const CountBadge = styled.div`
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primary};
  background: ${({ theme }) => theme.colors.primary}1a;
  font-size: 10px;
  font-weight: 700;
`;

const HelperText = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setShowSpikeOverlay } from "@n-apt/redux/slices/spectrumSlice";

export const SpikeDetectionNode: React.FC<SpikeDetectionNodeProps> = ({
  data,
}) => {
  const dispatch = useAppDispatch();
  const isEnabled = useAppSelector((state) => state.spectrum.showSpikeOverlay);
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);
  const sampleRateHz = useAppSelector((state) => state.spectrum.sampleRateHz);
  const gpuSpikeCount = useAppSelector((state) => state.spectrum.gpuSpikeCount);

  const [scanStatus, setScanStatus] = useState<string>(
    "Ready to scan FFT for spikes.",
  );
  const [isScanning, setIsScanning] = useState(false);

  const currentWindow = useMemo(() => {
    const base = fftSize || 0;
    const rate = sampleRateHz || 0;
    return base > 0
      ? `${base} bins @ ${Math.round(rate / 1000)} kHz`
      : "FFT not ready";
  }, [fftSize, sampleRateHz]);

  const handleScan = () => {
    setIsScanning(true);
    dispatch(setShowSpikeOverlay(!isEnabled));
    setScanStatus(
      !isEnabled
        ? "Spike overlay enabled. Review markers in the FFT view."
        : "Spike overlay disabled.",
    );

    window.setTimeout(() => {
      setScanStatus(
        !isEnabled
          ? "Spike overlay is active and markers should render in FFT."
          : "Spike overlay turned off.",
      );
      setIsScanning(false);
    }, 350);
  };

  return (
    <NodeContainer>
      <NodeTitle>
        <Zap size={16} />
        {data.label}
      </NodeTitle>
      <NodeSubtitle>
        {data.description ?? "Scan the FFT for prominent spikes."}
      </NodeSubtitle>

      <Section>
        <PrimaryButton type="button" onClick={handleScan} disabled={isScanning}>
          <Search size={12} />
          {isScanning
            ? "Updating…"
            : isEnabled
              ? "Disable spike overlay"
              : "Enable spike overlay"}
        </PrimaryButton>

        <ResultCard>
          <ResultHeader>
            <div>
              <ResultLabel>FFT Scan</ResultLabel>
              <ResultMeta>{currentWindow}</ResultMeta>
            </div>
            <CountBadge>
              {isEnabled ? `${gpuSpikeCount} spikes` : "off"}
            </CountBadge>
          </ResultHeader>
          <HelperText>{scanStatus}</HelperText>
        </ResultCard>

        <HelperText>
          This node toggles spike detection markers in the FFT view. Beat
          modulation stays in the Beat Detection node.
        </HelperText>
      </Section>
    </NodeContainer>
  );
};

export { SpikeDetectionNode as SpikeNode };
