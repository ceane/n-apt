import React from "react";
import styled from "styled-components";
import { AudioLines } from "lucide-react";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { useAudioDemodFM } from "@n-apt/hooks/useAudioDemodFM";
import { Row } from "@n-apt/components/ui";
import { Collapsible } from "@n-apt/components/ui/Collapsible";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: 0;
  box-sizing: border-box;
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

interface AudioDemodOptionsSidebarProps {
  windowSizeHz?: number;
  stepSizeHz?: number;
  audioThreshold?: number;
  onWindowSizeChange?: (size: number) => void;
  onStepSizeChange?: (size: number) => void;
  onAudioThresholdChange?: (threshold: number) => void;
  // Scanner props
  isScanning?: boolean;
  onScanStart?: () => void;
  onScanStop?: () => void;
}

export const AudioDemodOptionsSidebar: React.FC<AudioDemodOptionsSidebarProps> = ({
  windowSizeHz = 25000,
  stepSizeHz = 10000,
  audioThreshold = 0.3,
  onWindowSizeChange,
  onStepSizeChange,
  onAudioThresholdChange,
  isScanning = false,
  onScanStart,
  onScanStop,
}) => {
  const { currentIQData, selectedAlgorithm, setSelectedAlgorithm } = useDemod();

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
    <Section>
      <Collapsible
        icon={<AudioLines size={14} />}
        label="Fast Demod Channel Audio"
        defaultOpen={true}
      >
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
      </Collapsible>
    </Section>
  );
};

export default AudioDemodOptionsSidebar;
