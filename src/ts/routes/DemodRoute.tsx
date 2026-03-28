import React from "react";
import styled from "styled-components";
import { AnalysisTriggers } from "@n-apt/components/analysis/AnalysisTriggers";
import { VisionScene } from "@n-apt/components/analysis/VisionScene";
import { AptDemodViz } from "@n-apt/components/analysis/AptDemodViz";
import ClassificationControls from "@n-apt/components/ClassificationControls";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { fileWorkerManager } from "@n-apt/workers/fileWorkerManager";

const DemodContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  gap: 24px;
  overflow-y: auto;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
`;

export const DemodRoute: React.FC = () => {
  const { aesKey } = useAuthentication();
  const {
    currentIQData,
    setCurrentIQData,
    analysisSession,
  } = useDemod();

  const [captureMeta, setCaptureMeta] = React.useState<any>(null);

  // Classification controls state
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [captureLabel, setCaptureLabel] = React.useState<"target" | "noise" | null>(null);
  const [capturedSamples, setCapturedSamples] = React.useState(0);
  const [activeSignalArea] = React.useState("full");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await fileWorkerManager.loadFile(file.name, aesKey);
      if (result && result.rawData) {
        setCaptureMeta(result.metadata);
        // Max 100K samples per frame snippet
        const samples = Math.min(result.rawData.length, 100000);
        const dataPortion = result.rawData.slice(0, samples);
        setCurrentIQData(new Uint8Array(dataPortion));
      }
    } catch (err) {
      console.error("Failed to load local capture file:", err);
    }
  };

  // Classification controls handlers
  const handleCaptureStart = React.useCallback((label: "target" | "noise") => {
    setIsCapturing(true);
    setCaptureLabel(label);
    setCapturedSamples(0);
    // TODO: Implement actual capture logic
    console.log(`Starting ${label} capture`);
  }, []);

  const handleCaptureStop = React.useCallback(() => {
    setIsCapturing(false);
    setCaptureLabel(null);
    // TODO: Implement actual stop logic
    console.log("Stopping capture");
  }, []);

  // Initialize with mock data if none exists
  React.useEffect(() => {
    if (!currentIQData) {
      const samples = 32768; // 1 second at 32.768 kHz
      const iqData = new Uint8Array(samples * 2);

      let currentPhase = 0;
      for (let i = 0; i < samples; i++) {
        const t = i / samples;

        // 2400 Hz subcarrier
        const subcarrierPhase = 2 * Math.PI * 2400 * t;

        // AM modulate the subcarrier with a 4 Hz signal (simulating image stripes)
        const amSignal = Math.sin(2 * Math.PI * 4 * t) * 0.5 + 0.5; // 0 to 1

        // The composite subcarrier audio signal
        const audio = amSignal * Math.sin(subcarrierPhase); // Range -1 to 1

        // FM Modulate the RF Carrier (deviation = 17000 Hz)
        const instantaneousDeviation = 17000 * audio;

        // Accumulate phase integral
        currentPhase += (instantaneousDeviation / samples) * 2 * Math.PI;

        iqData[i * 2] = Math.floor((Math.sin(currentPhase) * 0.5 + 1) * 128);
        iqData[i * 2 + 1] = Math.floor((Math.cos(currentPhase) * 0.5 + 1) * 128);
      }
      setCurrentIQData(iqData);
    }
  }, [currentIQData, setCurrentIQData]);

  return (
    <DemodContainer>
      <ClassificationControls
        isDeviceConnected={true}
        activeSignalArea={activeSignalArea}
        isCapturing={isCapturing}
        captureLabel={captureLabel}
        capturedSamples={capturedSamples}
        onCaptureStart={handleCaptureStart}
        onCaptureStop={handleCaptureStop}
      />

      <div style={{ paddingBottom: 12 }}>
        <input type="file" onChange={handleFileUpload} accept=".napt,.wav" style={{ color: "white" }} />
      </div>

      <AnalysisTriggers />

      {analysisSession.state === 'capturing' && analysisSession.type === 'vision' && (
        <VisionScene session={analysisSession} />
      )}

      {currentIQData && (
        <AptDemodViz
          iqData={currentIQData}
          sampleRate={captureMeta?.capture_sample_rate_hz || (captureMeta?.sampleRate) || 32768}
          centerFreq={captureMeta?.center_frequency_hz ? (captureMeta.center_frequency_hz / 1e6) : 137.1}
          minFreq={captureMeta?.frequency_range?.[0]}
          maxFreq={captureMeta?.frequency_range?.[1]}
        />
      )}
    </DemodContainer>
  );
};

export default DemodRoute;
