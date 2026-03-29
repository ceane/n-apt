import React from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import { SourceSidebar } from "@n-apt/components/sidebar/SourceSidebar";
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { Channels } from "@n-apt/components/sidebar/Channels";
import { ScanningProgress } from "@n-apt/components/sidebar/ScanningProgress";
import { AudioDemodOptionsSidebar } from "@n-apt/components/sidebar/AudioDemodOptionsSidebar";
import { DemodulationMathSidebar } from "@n-apt/components/sidebar/DemodulationMathSidebar";
import { DemodDownloads } from "@n-apt/components/sidebar/DemodDownloads";
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
  font-family: ${(props) => props.theme.typography.mono};
`;

const InfoText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 11px;
  line-height: 1.5;
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
      <SourceSidebar
        sourceMode={sourceMode}
        onSourceModeChange={onSourceModeChange}
        backend={backend}
        deviceName={deviceName}
      />

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

      <AudioDemodOptionsSidebar
        windowSizeHz={windowSizeHz}
        stepSizeHz={stepSizeHz}
        audioThreshold={audioThreshold}
        onWindowSizeChange={onWindowSizeChange}
        onStepSizeChange={onStepSizeChange}
        onAudioThresholdChange={onAudioThresholdChange}
        isScanning={isScanning}
        onScanStart={onScanStart}
        onScanStop={onScanStop}
      />

      <DemodDownloads />

      <InfoBox>
        <InfoTitle>Demodulation</InfoTitle>
        <InfoText>
          N-APT uses APT-style modulation (shape, encoding): the RF signal is FM-demodulated to recover an AM-modulated subcarrier, and envelope detection is then used to recover the transmitted content.
        </InfoText>
      </InfoBox>

      <DemodulationMathSidebar />
    </SidebarContent>
  );
};

export default DemodulateSidebar;
