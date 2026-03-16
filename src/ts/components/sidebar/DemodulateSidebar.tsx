import React from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { Channels } from "@n-apt/components/sidebar/Channels";
import { ScanningProgress } from "@n-apt/components/sidebar/ScanningProgress";
import { Row } from "@n-apt/components/ui";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";

const SidebarContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: 0 24px 24px 24px;
  box-sizing: border-box;
  max-width: 100%;
`;

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: 0;
  box-sizing: border-box;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
`;

const InfoBox = styled.div`
  background: ${(props) => props.theme.primaryAnchor};
  border: 1px solid ${(props) => props.theme.primaryAlpha};
  border-radius: 8px;
  padding: 16px;
  margin-top: 24px;
`;

const InfoTitle = styled.div`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  font-family: "JetBrains Mono", monospace;
`;

const InfoText = styled.div`
  color: #888;
  font-size: 11px;
  line-height: 1.5;
`;

const ControlInput = styled.input`
  background-color: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 6px 8px;
  min-width: 130px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }
`;

const StopButton = styled.button`
  padding: 8px 16px;
  background-color: #ff4444;
  border: 1px solid #ff6666;
  border-radius: 6px;
  color: white;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  grid-column: 1 / -1;
  justify-self: start;

  &:hover {
    background-color: #ff6666;
    border-color: #ff8888;
  }

  &:disabled {
    background-color: #333;
    border-color: #444;
    color: #666;
    cursor: not-allowed;
  }
`;

interface DemodulateSidebarProps {
  sourceMode?: SourceMode;
  onSourceModeChange?: (mode: SourceMode) => void;
  windowSizeHz?: number;
  stepSizeHz?: number;
  audioThreshold?: number;
  onWindowSizeChange?: (size: number) => void;
  onStepSizeChange?: (size: number) => void;
  onAudioThresholdChange?: (threshold: number) => void;
  // Scanner props
  isScanning?: boolean;
  scanProgress?: number;
  scanCurrentFreq?: number;
  scanRange?: { min: number; max: number };
  detectedRegions?: number;
  onScanStart?: () => void;
  onScanStop?: () => void;
}

export const DemodulateSidebar: React.FC<DemodulateSidebarProps> = ({
  sourceMode = "live",
  onSourceModeChange,
  windowSizeHz = 25000,
  stepSizeHz = 10000,
  audioThreshold = 0.3,
  onWindowSizeChange,
  onStepSizeChange,
  onAudioThresholdChange,
  isScanning = false,
  scanProgress = 0,
  scanCurrentFreq,
  scanRange,
  detectedRegions = 0,
  onScanStart,
  onScanStop,
}) => {
  // Get real device data from Redux store
  const isConnected = useAppSelector((s) => s.websocket.isConnected);
  const deviceState = useAppSelector((s) => s.websocket.deviceState);
  const deviceLoadingReason = useAppSelector((s) => s.websocket.deviceLoadingReason);
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const deviceName = useAppSelector((s) => s.websocket.deviceName);
  const backend = useAppSelector((s) => s.websocket.backend);
  const cryptoCorrupted = useAppSelector((s) => s.websocket.cryptoCorrupted);

  return (
    <SidebarContent>
      <Section>
        <SectionTitle>Source</SectionTitle>
        <SourceInput
          sourceMode={sourceMode}
          backend={backend}
          deviceName={deviceName}
          onSourceModeChange={onSourceModeChange || (() => { })}
        />
      </Section>

      <Section>
        <ConnectionStatusSection
          isConnected={isConnected}
          deviceState={deviceState}
          deviceLoadingReason={deviceLoadingReason}
          isPaused={isPaused}
          cryptoCorrupted={cryptoCorrupted}
          onPauseToggle={() => { }}
          onRestartDevice={() => { }}
        />
      </Section>


      <Section>
        <SectionTitle>Channels</SectionTitle>
        <Channels
          isScanning={isScanning}
          scanProgress={scanProgress}
          scanCurrentFreq={scanCurrentFreq}
          scanRange={scanRange}
          onScanStart={onScanStart}
          onScanStop={onScanStop}
        />
      </Section>

      <ScanningProgress
        isScanning={isScanning}
        scanProgress={scanProgress}
        currentFrequency={scanCurrentFreq}
        scanRange={scanRange}
        detectedRegions={detectedRegions}
      />

      <Section>
        <SectionTitle>Audio Demod Options</SectionTitle>
        <Row label="Window Size (Hz)" tooltip="Size of the frequency window for analysis.">
          <ControlInput
            type="number"
            value={windowSizeHz}
            onChange={(e) => onWindowSizeChange?.(Number(e.target.value))}
            min="1000"
            max="100000"
            step="5000"
          />
        </Row>

        <Row label="Step Size (Hz)" tooltip="Step size between frequency windows.">
          <ControlInput
            type="number"
            value={stepSizeHz}
            onChange={(e) => onStepSizeChange?.(Number(e.target.value))}
            min="1000"
            max="50000"
            step="1000"
          />
        </Row>

        <Row label="Audio Threshold" tooltip="Threshold for detecting audio signals.">
          <ControlInput
            type="number"
            value={audioThreshold}
            onChange={(e) => onAudioThresholdChange?.(Number(e.target.value))}
            min="0.1"
            max="1.0"
            step="0.05"
          />
        </Row>

        <div style={{ gridColumn: "1 / -1", marginTop: "8px" }}>
          {isScanning ? (
            <StopButton onClick={onScanStop}>
              Stop Scanning
            </StopButton>
          ) : (
            <StopButton
              onClick={onScanStart}
              style={{ backgroundColor: "#00d4ff", border: "1px solid #00d4ff" }}
            >
              Scan for Audio
            </StopButton>
          )}
        </div>
      </Section>

      <InfoBox>
        <InfoTitle>Analysis Mode</InfoTitle>
        <InfoText>
          ML-powered signal analysis and feature extraction. Use this mode to
          identify specific modulation types and protocol structures in N-APT
          signals.
        </InfoText>
      </InfoBox>
    </SidebarContent>
  );
};

export default DemodulateSidebar;
