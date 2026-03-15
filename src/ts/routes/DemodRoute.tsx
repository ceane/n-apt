import React, { useState, useCallback } from "react";
import styled from "styled-components";
import { useFrequencyScanner } from "@n-apt/hooks/useFrequencyScanner";
import { useAudioExtraction } from "@n-apt/hooks/useAudioExtraction";
import { AudioPlaybackSection } from "@n-apt/components/AudioPlaybackSection";
import type { FrequencyRegion, AudioDetectionResult } from "@n-apt/hooks/useFrequencyScanner";

const DemodContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 20px;
`;

const ControlsSection = styled.div`
  display: grid;
  gap: 16px;
  padding: 16px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
`;

const ControlRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: end;
`;

const ControlGroup = styled.div`
  display: grid;
  gap: 8px;
`;

const Label = styled.label`
  font-size: 12px;
  color: #888;
  font-family: "JetBrains Mono", monospace;
`;

const Input = styled.input`
  background-color: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 6px 8px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }
`;

const Select = styled.select`
  background-color: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 6px 8px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
  }
`;

const _Button = styled.button<{ $disabled?: boolean }>`
  padding: 10px 16px;
  background-color: ${(props) => props.theme.primary};
  border: 1px solid ${(props) => props.theme.primary};
  border-radius: 6px;
  color: white;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) => props.$disabled ? props.theme.primary : props.theme.primaryAnchor};
  }
`;

const StatusText = styled.div<{ $tone?: "success" | "error" | "warning" }>`
  font-size: 12px;
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

export const DemodRoute: React.FC = () => {
  const [selectedChannel, setSelectedChannel] = useState<"A" | "B">("A");
  const [windowSizeHz, setWindowSizeHz] = useState(25000); // 25kHz windows
  const [stepSizeHz, setStepSizeHz] = useState(10000); // 10kHz steps
  const [audioThreshold, setAudioThreshold] = useState(0.3);
  const [audioSectionOpen, setAudioSectionOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<FrequencyRegion | null>(null);
  const [currentIQData, setCurrentIQData] = useState<Uint8Array | null>(null);

  // Channel frequency ranges from signals.yaml
  const channelRanges = {
    A: { min: 0.018, max: 4.37 },
    B: { min: 24.72, max: 29.88 }
  };

  // Initialize hooks
  const frequencyScanner = useFrequencyScanner({
    windowSizeHz,
    stepSizeHz,
    audioThreshold,
    sampleRate: 3200000, // 3.2MHz from signals.yaml
    _fftSize: 32768,
  });

  const audioPlayback = useAudioExtraction({
    _targetSampleRate: 48000,
    _bufferSize: 4096,
    enableFiltering: true,
  });

  // Mock I/Q data generation (replace with real data from your capture system)
  const generateMockIQData = useCallback(() => {
    const samples = 32768; // 32K samples
    const iqData = new Uint8Array(samples * 2); // I and Q

    for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
      // Generate mock I/Q data with some structure
      const t = sampleIndex / samples;
      const freq = 1000 + Math.sin(t * Math.PI * 2) * 500; // Varying frequency
      const phase = t * Math.PI * 2 * freq / 1000;

      // Add some noise and modulation
      const iValue = Math.sin(phase) * 0.5 + (Math.random() - 0.5) * 0.2;
      const qValue = Math.cos(phase) * 0.5 + (Math.random() - 0.5) * 0.2;

      iqData[sampleIndex * 2] = Math.floor((iValue + 1) * 128); // Convert to uint8
      iqData[sampleIndex * 2 + 1] = Math.floor((qValue + 1) * 128);
    }

    return iqData;
  }, []);

  const handleScanStart = useCallback(async () => {
    if (!currentIQData) {
      // Generate mock data for testing
      const mockData = generateMockIQData();
      setCurrentIQData(mockData);

      // Start scanning with mock data
      await frequencyScanner.scanForAudio(mockData, channelRanges[selectedChannel]);
    } else {
      // Scan with existing data
      await frequencyScanner.scanForAudio(currentIQData, channelRanges[selectedChannel]);
    }
  }, [currentIQData, selectedChannel, channelRanges, frequencyScanner, generateMockIQData]);

  const handleRegionSelect = useCallback(async (region: FrequencyRegion): Promise<AudioDetectionResult | null> => {
    if (!currentIQData) return null;

    setSelectedRegion(region);
    return await frequencyScanner.demodulateRegion(currentIQData, region);
  }, [currentIQData, frequencyScanner]);

  return (
    <DemodContainer>
      <div style={{ fontSize: "18px", fontWeight: "bold", color: "#00d4ff", marginBottom: "16px" }}>
        N-APT Audio Demodulation
      </div>

      <ControlsSection>
        <ControlRow>
          <ControlGroup>
            <Label>Channel</Label>
            <Select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value as "A" | "B")}
            >
              <option value="A">Channel A (0.018-4.37 MHz)</option>
              <option value="B">Channel B (24.72-29.88 MHz)</option>
            </Select>
          </ControlGroup>

          <ControlGroup>
            <Label>Window Size (Hz)</Label>
            <Input
              type="number"
              value={windowSizeHz}
              onChange={(e) => setWindowSizeHz(Number(e.target.value))}
              min="1000"
              max="100000"
              step="5000"
            />
          </ControlGroup>

          <ControlGroup>
            <Label>Step Size (Hz)</Label>
            <Input
              type="number"
              value={stepSizeHz}
              onChange={(e) => setStepSizeHz(Number(e.target.value))}
              min="1000"
              max="50000"
              step="1000"
            />
          </ControlGroup>

          <ControlGroup>
            <Label>Audio Threshold</Label>
            <Input
              type="number"
              value={audioThreshold}
              onChange={(e) => setAudioThreshold(Number(e.target.value))}
              min="0.1"
              max="1.0"
              step="0.05"
            />
          </ControlGroup>
        </ControlRow>

        <StatusText>
          Scanning {selectedChannel} with {windowSizeHz}Hz windows, {stepSizeHz}Hz steps
        </StatusText>
      </ControlsSection>

      <AudioPlaybackSection
        isOpen={audioSectionOpen}
        onToggle={() => setAudioSectionOpen(!audioSectionOpen)}
        detectedRegions={frequencyScanner.detectedRegions}
        isScanning={frequencyScanner.isScanning}
        scanProgress={frequencyScanner.scanProgress}
        isPlaying={audioPlayback.isPlaying}
        audioPlayback={audioPlayback}
        onRegionSelect={handleRegionSelect}
        selectedRegion={selectedRegion}
        onScanStart={handleScanStart}
      />
    </DemodContainer>
  );
};

export default DemodRoute;
