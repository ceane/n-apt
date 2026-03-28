import React from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { Channels } from "@n-apt/components/sidebar/Channels";
import { ScanningProgress } from "@n-apt/components/sidebar/ScanningProgress";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { useAudioDemodFM } from "@n-apt/hooks/useAudioDemodFM";
import { Row } from "@n-apt/components/ui";
import { CollapsibleTitle, CollapsibleBody } from "@n-apt/components/ui/Collapsible";
import { DecryptionFallback } from "@n-apt/components/ui/DecryptionFallback";
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
  font-family: ${(props) => props.theme.typography.mono};
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
  font-family: ${(props) => props.theme.typography.mono};
`;

const InfoText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 11px;
  line-height: 1.5;
`;

const ControlInput = styled.input`
  background-color: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
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
  background-color: ${(props) => props.theme.danger};
  border: 1px solid ${(props) => props.theme.danger};
  border-radius: 6px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  grid-column: 1 / -1;
  justify-self: start;

  &:hover {
    background-color: ${(props) => `${props.theme.danger}cc`};
    border-color: ${(props) => props.theme.danger};
  }

  &:disabled {
    background-color: ${(props) => props.theme.borderHover};
    border-color: ${(props) => props.theme.borderHover};
    color: ${(props) => props.theme.textMuted};
    cursor: not-allowed;
  }
`;

const StartScanButton = styled(StopButton)`
  background-color: ${(props) => props.theme.primary};
  border-color: ${(props) => props.theme.primary};
  color: ${(props) => props.theme.background};

  &:hover {
    background-color: ${(props) => `${props.theme.primary}cc`};
    border-color: ${(props) => props.theme.primary};
  }
`;

const ResultCard = styled.div`
  padding: 8px;
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  margin-top: 4px;
`;

const ResultLabel = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  margin-bottom: 8px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const DownloadCaptureButton = styled(StopButton).attrs({ as: "a" })`
  background-color: ${(props) => props.theme.success};
  border-color: ${(props) => props.theme.success};
  color: ${(props) => props.theme.background};
  text-align: center;
  text-decoration: none;
  display: block;

  &:hover {
    background-color: ${(props) => `${props.theme.success}cc`};
    border-color: ${(props) => props.theme.success};
  }
`;

const MathFallback = styled.div`
  opacity: 0.5;
  font-size: 10px;
  text-align: center;
  color: ${(props) => props.theme.textSecondary};
`;

const AlgorithmSelect = styled.select`
  background-color: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  padding: 6px 8px;
  min-width: 130px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }

  option {
    background-color: ${(props) => props.theme.background};
    color: ${(props) => props.theme.textPrimary};
  }
`;

const AudioControlsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  grid-column: 1 / -1;
  margin-top: 8px;
`;

const AudioButtonContainer = styled.div`
  display: flex;
  gap: 8px;
  grid-column: 1 / -1;
`;

const AudioButton = styled.button<{ $variant?: "play" | "stop" }>`
  padding: 8px 16px;
  background-color: ${(props) =>
    props.$variant === "stop"
      ? props.theme.danger
      : props.$variant === "play"
        ? props.theme.success
        : props.theme.primary
  };
  border: 1px solid ${(props) =>
    props.$variant === "stop"
      ? props.theme.danger
      : props.$variant === "play"
        ? props.theme.success
        : props.theme.primary
  };
  border-radius: 6px;
  color: ${(props) => props.theme.background};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) =>
    props.$variant === "stop"
      ? `${props.theme.danger}cc`
      : props.$variant === "play"
        ? `${props.theme.success}cc`
        : `${props.theme.primary}cc`
  };
  }

  &:disabled {
    background-color: ${(props) => props.theme.borderHover};
    border-color: ${(props) => props.theme.borderHover};
    color: ${(props) => props.theme.textMuted};
    cursor: not-allowed;
  }
`;

const VolumeSlider = styled.input`
  width: 100%;
  height: 4px;
  background: ${(props) => props.theme.borderHover};
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: ${(props) => props.theme.primary};
    border-radius: 50%;
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: ${(props) => props.theme.primary};
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
`;

const DemodMath = React.lazy(() => import("@n-apt/encrypted-modules/tmp/ts/components/math/DemodMath").catch(() => ({
  default: () => <DecryptionFallback moduleName="Demod Math" />
})));

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

  const { analysisSession, currentIQData, selectedAlgorithm, setSelectedAlgorithm } = useDemod();
  const [isOptionsOpen, setIsOptionsOpen] = React.useState(true);

  // FM audio demodulation hook
  const fmAudio = useAudioDemodFM({
    targetSampleRate: 48000,
    bufferSize: 4096,
  });

  // Process I/Q data when available and FM algorithm is selected
  React.useEffect(() => {
    if (currentIQData && selectedAlgorithm === "fm") {
      // Get sample rate from current data or default
      const sampleRate = 3200000; // Default sample rate
      fmAudio.processIQData(currentIQData, sampleRate);
    }
  }, [currentIQData, selectedAlgorithm, fmAudio]);

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
        <CollapsibleTitle
          label="Audio Demod Options"
          isOpen={isOptionsOpen}
          onToggle={() => setIsOptionsOpen(!isOptionsOpen)}
        />
        {isOptionsOpen && (
          <CollapsibleBody>
            <Row label="Algorithm" tooltip="Select demodulation algorithm.">
              <AlgorithmSelect
                value={selectedAlgorithm}
                onChange={(e) => setSelectedAlgorithm(e.target.value)}
              >
                <option value="fm">FM</option>
                <option value="n-apt_audio_hearing" disabled>N-APT (Audio, Hearing) (Coming Soon)</option>
                <option value="n-apt_audio_internal" disabled>N-APT (Audio, Internal) (Coming Soon)</option>
                <option value="n-apt_audio_voice" disabled>N-APT (Audio, Voice) (Coming Soon)</option>
                <option value="n-apt_vision" disabled>N-APT (Vision) (Coming Soon)</option>
              </AlgorithmSelect>
            </Row>

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

            {selectedAlgorithm === "fm" && (
              <AudioControlsContainer>
                <Row label="Volume" tooltip="Adjust audio playback volume.">
                  <VolumeSlider
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={fmAudio.volume}
                    onChange={(e) => fmAudio.setVolume(Number(e.target.value))}
                  />
                </Row>

                <AudioButtonContainer>
                  <AudioButton
                    $variant="play"
                    onClick={fmAudio.playAudio}
                    disabled={!currentIQData || fmAudio.isPlaying}
                  >
                    {fmAudio.isPlaying ? "Playing..." : "Play"}
                  </AudioButton>
                  <AudioButton
                    $variant="stop"
                    onClick={fmAudio.stopAudio}
                    disabled={!fmAudio.isPlaying}
                  >
                    Stop
                  </AudioButton>
                </AudioButtonContainer>
              </AudioControlsContainer>
            )}

            <div style={{ gridColumn: "1 / -1", marginTop: "8px" }}>
              {isScanning ? (
                <StopButton onClick={onScanStop}>
                  Stop Scanning
                </StopButton>
              ) : (
                <StartScanButton onClick={onScanStart}>
                  Scan for Audio
                </StartScanButton>
              )}
            </div>
          </CollapsibleBody>
        )}
      </Section>

      {analysisSession.state === 'result' && analysisSession.result?.naptFilePath && (
        <Section>
          <SectionTitle>Reference Captures</SectionTitle>
          <ResultCard>
            <ResultLabel>
              RESULT: {analysisSession.result.jobId}
            </ResultLabel>
            <DownloadCaptureButton
              href={analysisSession.result.naptFilePath}
              download
            >
              Download .napt Capture
            </DownloadCaptureButton>
          </ResultCard>
        </Section>
      )}

      <InfoBox>
        <InfoTitle>Demodulation</InfoTitle>
        <InfoText>
          N-APT uses APT-style modulation (shape, encoding): the RF signal is FM-demodulated to recover an AM-modulated subcarrier, and envelope detection is then used to recover the transmitted content.
        </InfoText>
      </InfoBox>

      <Section>
        <React.Suspense fallback={<MathFallback>Loading Math...</MathFallback>}>
          <DemodMath />
        </React.Suspense>
      </Section>
    </SidebarContent>
  );
};

export default DemodulateSidebar;
