import React, { useState, useCallback } from "react";
import styled from "styled-components";
import { AudioPlaybackSection } from "@n-apt/components/AudioPlaybackSection";
import type { FrequencyRegion, AudioDetectionResult } from "@n-apt/hooks/useFrequencyScanner";

const DemodContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 20px;
`;


import { useDemod } from "@n-apt/contexts/DemodContext";

export const DemodRoute: React.FC = () => {
  const {
    scanner,
    audioPlayback,
    currentIQData,
    setCurrentIQData,
  } = useDemod();

  const [audioSectionOpen, setAudioSectionOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<FrequencyRegion | null>(null);

  // Initialize with mock data if none exists
  React.useEffect(() => {
    if (!currentIQData) {
      const samples = 32768; // 32K samples
      const iqData = new Uint8Array(samples * 2);
      for (let i = 0; i < samples; i++) {
        const t = i / samples;
        const phase = t * Math.PI * 2 * (1000 + Math.sin(t * 10) * 500) / 1000;
        iqData[i * 2] = Math.floor((Math.sin(phase) * 0.5 + 1) * 128);
        iqData[i * 2 + 1] = Math.floor((Math.cos(phase) * 0.5 + 1) * 128);
      }
      setCurrentIQData(iqData);
    }
  }, [currentIQData, setCurrentIQData]);

  const handleRegionSelect = useCallback(async (region: FrequencyRegion): Promise<AudioDetectionResult | null> => {
    if (!currentIQData) return null;
    setSelectedRegion(region);
    return await scanner.demodulateRegion(currentIQData, region);
  }, [currentIQData, scanner]);

  return (
    <DemodContainer>
      <div style={{ fontSize: "18px", fontWeight: "bold", color: "#00d4ff", marginBottom: "16px" }}>
        N-APT Audio Demodulation
      </div>

      <AudioPlaybackSection
        isOpen={audioSectionOpen}
        onToggle={() => setAudioSectionOpen(!audioSectionOpen)}
        detectedRegions={scanner.detectedRegions}
        isScanning={scanner.isScanning}
        scanProgress={scanner.scanProgress}
        isPlaying={audioPlayback.isPlaying}
        audioPlayback={audioPlayback}
        onRegionSelect={handleRegionSelect}
        selectedRegion={selectedRegion}
      />
    </DemodContainer>
  );
};

export default DemodRoute;
