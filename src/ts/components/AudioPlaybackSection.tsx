import React from "react";
import styled from "styled-components";
import type { FrequencyRegion, AudioDetectionResult } from "@n-apt/hooks/useFrequencyScanner";
import type { AudioPlaybackHandle } from "@n-apt/hooks/useAudioExtraction";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
`;

const AudioControlsContainer = styled.div`
  display: grid;
  gap: 12px;
  padding: 16px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
`;

const ControlRow = styled.div`
  display: grid;
  grid-auto-flow: column;
  gap: 8px;
  align-items: center;
  justify-content: start;
`;

const PlaybackButton = styled.button<{ $playing?: boolean; $disabled?: boolean }>`
  padding: 8px 16px;
  background-color: ${(props) => 
    props.$playing ? props.theme.primaryAnchor : "#1a1a1a"};
  border: 1px solid ${(props) => 
    props.$playing ? props.theme.primary : "#2a2a2a"};
  border-radius: 6px;
  color: ${(props) => (props.$playing ? props.theme.primary : "#ccc")};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) => props.theme.primary}0d;
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
  }
`;

const ExportButton = styled.button<{ $disabled?: boolean }>`
  padding: 6px 12px;
  background-color: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};

  &:hover {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
  }
`;

const RegionList = styled.div`
  display: grid;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
`;

const RegionItem = styled.div<{ $active?: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  background: ${(props) => (props.$active ? props.theme.primary + "15" : "#101010")};
  border: 1px solid ${(props) => (props.$active ? props.theme.primary : "#2a2a2a")};
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: #1a1a1a;
    border-color: #3a3a3a;
  }
`;

const RegionInfo = styled.div`
  display: grid;
  gap: 2px;
  font-size: 11px;
`;

const RegionFreq = styled.div`
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
`;

const RegionScore = styled.div`
  color: #888;
  font-family: "JetBrains Mono", monospace;
`;

const RegionActions = styled.div`
  display: grid;
  grid-auto-flow: column;
  gap: 4px;
`;

const MiniButton = styled.button`
  padding: 4px 8px;
  background: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #888;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  cursor: pointer;

  &:hover {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
  }
`;

const StatusText = styled.div<{ $tone?: "success" | "error" | "warning" }>`
  font-size: 11px;
  color: ${(props) =>
    props.$tone === "success"
      ? "#00ff66"
      : props.$tone === "error"
        ? "#ff6666"
        : props.$tone === "warning"
          ? "#ffcc33"
          : "#ccc"};
  font-family: "JetBrains Mono", monospace;
`;

const ProgressBar = styled.div`
  height: 2px;
  background: #2a2a2a;
  border-radius: 1px;
  overflow: hidden;
  margin-top: 8px;
`;

const ProgressFill = styled.div<{ $progress: number }>`
  height: 100%;
  width: ${(props) => props.$progress * 100}%;
  background: ${(props) => props.theme.primary};
  transition: width 0.2s ease;
`;

interface AudioPlaybackSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  detectedRegions: FrequencyRegion[];
  isScanning: boolean;
  scanProgress: number;
  isPlaying: boolean;
  audioPlayback: AudioPlaybackHandle;
  onRegionSelect: (region: FrequencyRegion) => Promise<AudioDetectionResult | null>;
  selectedRegion: FrequencyRegion | null;
  onScanStart: () => void;
}

export const AudioPlaybackSection: React.FC<AudioPlaybackSectionProps> = ({
  isOpen,
  onToggle,
  detectedRegions,
  isScanning,
  scanProgress,
  isPlaying,
  audioPlayback,
  onRegionSelect,
  selectedRegion,
  onScanStart,
}) => {
  const handlePlayRegion = async (region: FrequencyRegion) => {
    try {
      const result = await onRegionSelect(region);
      if (result) {
        await audioPlayback.playAudio(result.audioBuffer, result.sampleRate);
      }
    } catch (error) {
      console.error('Error playing region:', error);
    }
  };

  const handleStopPlayback = () => {
    audioPlayback.stopAudio();
  };

  const handleExportRegion = async (region: FrequencyRegion) => {
    try {
      const result = await onRegionSelect(region);
      if (result) {
        const filename = `n-apt-audio-${(region.centerFreq / 1_000_000).toFixed(3)}MHz.wav`;
        audioPlayback.exportToWAV(result.audioBuffer, result.sampleRate, filename);
      }
    } catch (error) {
      console.error('Error exporting region:', error);
    }
  };

  const handleMixSelected = async () => {
    if (detectedRegions.length === 0) return;

    try {
      const results = await Promise.all(
        detectedRegions.map(region => onRegionSelect(region))
      );
      
      const validResults = results.filter((result): result is AudioDetectionResult => result !== null);
      
      if (validResults.length > 0) {
        const mixed = audioPlayback.mixAudioRegions(
          validResults.map(result => ({ buffer: result.audioBuffer, gain: 0.8 }))
        );
        await audioPlayback.playAudio(mixed, 48000);
      }
    } catch (error) {
      console.error('Error mixing regions:', error);
    }
  };

  return (
    <Section>
      <div onClick={onToggle} style={{ cursor: 'pointer' }}>
        Audio Detection /{" "}
        {isScanning ? "Scanning..." : isOpen ? "▼" : "▶"}
      </div>

      {isOpen && (
        <AudioControlsContainer>
          <ControlRow>
            <PlaybackButton
              $playing={isPlaying}
              $disabled={isScanning || detectedRegions.length === 0}
              onClick={isPlaying ? handleStopPlayback : onScanStart}
            >
              {isScanning ? "Scanning..." : isPlaying ? "Stop" : "Scan for Audio"}
            </PlaybackButton>
            
            {detectedRegions.length > 0 && (
              <ExportButton onClick={handleMixSelected}>
                Mix All ({detectedRegions.length})
              </ExportButton>
            )}
          </ControlRow>

          {isScanning && (
            <div>
              <StatusText $tone="warning">
                Scanning for audio regions... {Math.round(scanProgress * 100)}%
              </StatusText>
              <ProgressBar>
                <ProgressFill $progress={scanProgress} />
              </ProgressBar>
            </div>
          )}

          {detectedRegions.length > 0 && (
            <div>
              <StatusText $tone="success">
                Found {detectedRegions.length} audio regions
              </StatusText>
              <RegionList>
                {detectedRegions.map((region, index) => (
                  <RegionItem
                    key={index}
                    $active={selectedRegion?.centerFreq === region.centerFreq}
                    onClick={() => handlePlayRegion(region)}
                  >
                    <RegionInfo>
                      <RegionFreq>
                        {(region.centerFreq / 1_000_000).toFixed(3)} MHz
                      </RegionFreq>
                      <RegionScore>
                        Score: {region.audioScore.toFixed(2)} | 
                        SNR: {region.snr.toFixed(1)}dB
                      </RegionScore>
                    </RegionInfo>
                    <RegionActions>
                      <MiniButton
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayRegion(region);
                        }}
                      >
                        Play
                      </MiniButton>
                      <MiniButton
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportRegion(region);
                        }}
                      >
                        Export
                      </MiniButton>
                    </RegionActions>
                  </RegionItem>
                ))}
              </RegionList>
            </div>
          )}

          {!isScanning && detectedRegions.length === 0 && (
            <StatusText>
              No audio regions detected. Try scanning with different thresholds.
            </StatusText>
          )}
        </AudioControlsContainer>
      )}
    </Section>
  );
};
