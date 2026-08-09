import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { Search, Zap } from "lucide-react";
import { formatFrequency, formatPowerDbm } from "@n-apt/math/frequency";

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

const MetricRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const StripedRows = styled.div`
  display: grid;
  gap: 2px;
`;

const StripedMetricRow = styled(MetricRow)`
  padding: 5px 6px;
  border-radius: 4px;

  &:nth-child(even) {
    background: rgba(0, 0, 0, 0.15);
  }
`;

const NaptMetricRow = styled(StripedMetricRow)`
  font-size: 14.3px;
`;

const NaptRowLabel = styled(ResultLabel)`
  font-size: inherit;
`;

const MetricValue = styled.span<{ $positive?: boolean }>`
  color: ${({ theme, $positive }) =>
    $positive ? theme.colors.primary : theme.colors.textPrimary};
  font-weight: 700;
`;

const SpikeList = styled.div`
  display: grid;
  gap: 2px;
  max-height: 150px;
  overflow-y: auto;
`;

const SpikeRow = styled.div<{ $hovered: boolean }>`
  position: relative;
  padding: 5px 6px;
  border-radius: 6px;
  background: ${({ theme, $hovered }) =>
    $hovered ? `${theme.colors.primary}22` : "transparent"};
  border: 1px solid
    ${({ theme, $hovered }) =>
      $hovered ? theme.colors.primary : "transparent"};
  cursor: default;

  &:nth-child(even) {
    background: ${({ theme, $hovered }) =>
      $hovered ? `${theme.colors.primary}22` : "rgba(0, 0, 0, 0.15)"};
  }
`;

const HoverBand = styled.div`
  height: 3px;
  margin-top: 4px;
  border-radius: 3px;
  background: ${({ theme }) => theme.colors.primary};
  opacity: 0.8;
`;

import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setShowSpikeOverlay } from "@n-apt/redux/slices/spectrumSlice";
import {
  setHoveredSpikeIndex,
  setPowerScale,
} from "@n-apt/redux/slices/spectrumSlice";

export const SpikeDetectionNode: React.FC<SpikeDetectionNodeProps> = ({
  data,
}) => {
  const dispatch = useAppDispatch();
  const isEnabled = useAppSelector((state) => state.spectrum.showSpikeOverlay);
  const fftSize = useAppSelector((state) => state.spectrum.fftSize);
  const sampleRateHz = useAppSelector((state) => state.spectrum.sampleRateHz);
  const gpuSpikeCount = useAppSelector((state) => state.spectrum.gpuSpikeCount);
  const gpuSpikeAnalysis = useAppSelector(
    (state) => state.spectrum.gpuSpikeAnalysis,
  );
  const [hoveredSpike, setHoveredSpike] = useState<number | null>(null);
  const diagnosticPercent = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value)
      ? `${Math.max(0, Math.min(1, value)) * 100 | 0}%`
      : "—";
  const naptLabel = gpuSpikeAnalysis
    ? gpuSpikeAnalysis.isNapt
      ? "Yes"
      : gpuSpikeAnalysis.confidence >= 0.5 && gpuSpikeAnalysis.confidence < 0.75
        ? "Likely"
        : "No"
    : "—";

  useEffect(() => {
    dispatch(setPowerScale("dBm"));
  }, [dispatch]);

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
              {isEnabled ? `${gpuSpikeCount ?? 0} spikes` : "off"}
            </CountBadge>
          </ResultHeader>
          <HelperText>{scanStatus}</HelperText>
        </ResultCard>

        <ResultCard>
          <ResultLabel>Classifier diagnostics</ResultLabel>
          <StripedRows>
            <StripedMetricRow>
              <span>Suspension bridge</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.suspensionBridgeScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Unimodal bridge</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.unimodalBridgeScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Partial bridge branch</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.partialBridgeScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Apex prominence</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.apexProminenceScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Shoulder symmetry</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.shoulderSymmetryScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>U-dip</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.uDipScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Floor-relative power</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.floorRelativePowerScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Sinc artifact penalty</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.sincPenaltyScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Capture quality</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.captureQualityScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Temporal stability</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.temporalStability)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>One-frame baseline</span>
              <MetricValue>
                {gpuSpikeAnalysis
                  ? gpuSpikeAnalysis.baselineIsNapt
                    ? "Yes"
                    : "No"
                : "—"}
              </MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Multi-frame persistence</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.multiFramePersistence)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Envelope fit</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.envelopeFitScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Envelope residual</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.envelopeResidualScore)}</MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <span>Confidence</span>
              <MetricValue>{diagnosticPercent(gpuSpikeAnalysis?.confidence)}</MetricValue>
            </StripedMetricRow>
          </StripedRows>
        </ResultCard>

        <ResultCard>
          <StripedRows>
                <NaptMetricRow>
                  <NaptRowLabel>Is N-APT?</NaptRowLabel>
                  <MetricValue $positive={gpuSpikeAnalysis?.isNapt || naptLabel === "Likely"}>
                    {naptLabel}
                  </MetricValue>
                </NaptMetricRow>
            <StripedMetricRow>
              <ResultLabel>Floor at</ResultLabel>
              <MetricValue>
                {gpuSpikeAnalysis
                  ? formatPowerDbm(gpuSpikeAnalysis.floorDbm)
                  : "—"}
              </MetricValue>
            </StripedMetricRow>
            <StripedMetricRow>
              <ResultLabel>Power scale</ResultLabel>
              <label>
                <input type="checkbox" checked readOnly disabled /> dBm
              </label>
            </StripedMetricRow>
          </StripedRows>
        </ResultCard>

        <ResultCard>
          <ResultHeader>
            <ResultLabel>Spikes at</ResultLabel>
            <CountBadge>{gpuSpikeAnalysis?.spikes.length ?? 0}</CountBadge>
          </ResultHeader>
          <SpikeList>
            {(gpuSpikeAnalysis?.spikes ?? []).map((spike) => {
              const hovered = hoveredSpike === spike.index;
              return (
                <SpikeRow
                  key={spike.index}
                  $hovered={hovered}
                  onMouseEnter={() => {
                    setHoveredSpike(spike.index);
                    dispatch(setHoveredSpikeIndex(spike.index));
                  }}
                  onMouseLeave={() => {
                    setHoveredSpike(null);
                    dispatch(setHoveredSpikeIndex(null));
                  }}
                  title={`Band around ${spike.frequencyHz.toFixed(0)} Hz`}
                >
                  <MetricRow>
                    <span>
                      {formatFrequency(spike.frequencyHz, {
                        trimTrailingZeros: true,
                      })}
                    </span>
                    <MetricValue>{formatPowerDbm(spike.powerDbm)}</MetricValue>
                  </MetricRow>
                  {hovered && <HoverBand />}
                </SpikeRow>
              );
            })}
          </SpikeList>
          {!gpuSpikeAnalysis?.spikes.length && <HelperText>No spike readback yet.</HelperText>}
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
