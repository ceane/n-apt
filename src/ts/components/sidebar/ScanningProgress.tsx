import React from "react";
import styled from "styled-components";
import { formatFrequency } from "@n-apt/utils/frequency";

interface ScanningProgressProps {
  isScanning: boolean;
  scanProgress: number;
  currentFrequency?: number;
  scanRange?: { min: number; max: number };
  detectedRegions?: number;
}

const ProgressContainer = styled.div`
  display: grid;
  gap: 8px;
  padding: 12px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  grid-column: 1 / -1;
`;

const ProgressHeader = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
`;

const ProgressTitle = styled.span`
  color: ${(props) => props.theme.primary};
  font-weight: 600;
`;

const ProgressStatus = styled.span<{ $active: boolean }>`
  color: ${props => props.$active ? "#00ff88" : "#666"};
  font-weight: 500;
`;

const ProgressBar = styled.div`
  height: 4px;
  background: #2a2a2a;
  border-radius: 2px;
  overflow: hidden;
  position: relative;
`;

const ProgressFill = styled.div<{ $progress: number }>`
  height: 100%;
  width: ${props => props.$progress}%;
  background: linear-gradient(90deg, ${(props) => props.theme.primary}, #00ff88);
  border-radius: 2px;
  transition: width 0.3s ease;
`;

const ProgressDetails = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-content: space-between;
  font-size: 10px;
  color: #888;
  font-family: "JetBrains Mono", monospace;
`;

const FrequencyDisplay = styled.span`
  color: ${(props) => props.theme.primary};
  font-weight: 500;
`;

export const ScanningProgress: React.FC<ScanningProgressProps> = ({
  isScanning,
  scanProgress,
  currentFrequency,
  scanRange,
  detectedRegions = 0,
}) => {
  if (!isScanning && scanProgress === 0) return null;

  const currentFreqDisplay = currentFrequency 
    ? formatFrequency(currentFrequency, { showUnits: true, precisionMHz: 3 })
    : "N/A";

  const rangeDisplay = scanRange 
    ? `${formatFrequency(scanRange.min, { showUnits: false, precisionMHz: 3 })} - ${formatFrequency(scanRange.max, { showUnits: false, precisionMHz: 3 })}`
    : "N/A";

  return (
    <ProgressContainer>
      <ProgressHeader>
        <ProgressTitle>Scanning Progress</ProgressTitle>
        <ProgressStatus $active={isScanning}>
          {isScanning ? "Active" : "Complete"}
        </ProgressStatus>
      </ProgressHeader>

      <ProgressBar>
        <ProgressFill $progress={scanProgress} />
      </ProgressBar>

      <ProgressDetails>
        <span>
          Current: <FrequencyDisplay>{currentFreqDisplay}</FrequencyDisplay>
        </span>
        <span>
          Range: {rangeDisplay}
        </span>
        <span>
          Found: {detectedRegions} regions
        </span>
      </ProgressDetails>
    </ProgressContainer>
  );
};

export default ScanningProgress;
