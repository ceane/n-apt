import React from "react";
import { IQCaptureControlsSection } from "../../src/ts/components/sidebar/IQCaptureControlsSection";
import { useWebSocket } from "../../src/ts/hooks/useWebSocket";
import type { CaptureFileType } from "../../src/ts/consts/schemas/websocket";

export const IQCaptureIntegrationTest: React.FC = () => {
  const {
    isConnected,
    deviceState,
    captureStatus,
    maxSampleRateHz,
    dataRef,
    sendCaptureCommand,
  } = useWebSocket("", null);

  // Mock state for testing
  const [activeCaptureAreas, setActiveCaptureAreas] = React.useState<string[]>([]);
  const [captureDurationS, setCaptureDurationS] = React.useState(5);
  const [captureDurationMode, setCaptureDurationMode] = React.useState<"timed" | "manual">("timed");
  const [captureFileType, setCaptureFileType] = React.useState<CaptureFileType>(".napt");
  const [acquisitionMode, setAcquisitionMode] = React.useState<"stepwise" | "interleaved" | "whole_sample">("stepwise");
  const [captureEncrypted, setCaptureEncrypted] = React.useState(false);
  const [capturePlayback, setCapturePlayback] = React.useState(false);
  const [captureGeolocation, setCaptureGeolocation] = React.useState(false);

  // Mock data for testing
  const mockAvailableCaptureAreas = [
    { label: "Onscreen", min: 0, max: 3.2 },
    { label: "Area A", min: 10, max: 20 },
    { label: "Area B", min: 20, max: 30 }
  ];

  const mockCaptureRange = {
    min: 10,
    max: 30,
    segments: [
      { label: "Area A", min: 10, max: 20 },
      { label: "Area B", min: 20, max: 30 }
    ]
  };

  const handleCapture = () => {
    if (activeCaptureAreas.length === 0) {
      alert("Please select at least one capture area");
      return;
    }

    if (captureDurationS <= 0) {
      alert("Please enter a valid duration");
      return;
    }

    // Validate sample rate
    const sampleRate = maxSampleRateHz || 3200000;
    if (sampleRate > 3200000) {
      alert("Sample rate exceeds maximum of 3.2MHz");
      return;
    }

    const selectedFragments = activeCaptureAreas.map(area => {
      const areaData = mockAvailableCaptureAreas.find(a => a.label === area);
      return {
        minFreq: areaData?.min || 0,
        maxFreq: areaData?.max || 30
      };
    });
    const sampleRateMHz = sampleRate / 1000000;
    const captureRangeSpan =
      selectedFragments.length > 0
        ? Math.max(...selectedFragments.map(fragment => fragment.maxFreq)) -
        Math.min(...selectedFragments.map(fragment => fragment.minFreq))
        : 0;
    const effectiveAcquisitionMode =
      activeCaptureAreas.includes("Onscreen") &&
        Math.abs(captureRangeSpan - sampleRateMHz) < 0.01
        ? "whole_sample"
        : acquisitionMode;

    sendCaptureCommand({
      jobId: `test-job-${Date.now()}`,
      fragments: selectedFragments,
      durationS: captureDurationS,
      fileType: captureFileType,
      acquisitionMode: effectiveAcquisitionMode,
      encrypted: captureEncrypted,
      fftSize: 1024,
      fftWindow: "Rectangular",
      geolocation: captureGeolocation ? {
        latitude: 0,
        longitude: 0,
        accuracy: 10,
        timestamp: Date.now()
      } : undefined,
    });
  };

  return (
    <div data-testid="iq-capture-integration-test">
      {/* Device Info Display */}
      {dataRef?.current?.deviceInfo && (
        <div data-testid="device-info">
          {dataRef.current.deviceInfo}
        </div>
      )}

      {/* Supported Sample Rates */}
      <div data-testid="supported-sample-rates">
        3.2MHz, 2.8MHz, 2.4MHz, 2.048MHz
      </div>

      {/* Capture Metadata Display */}
      {captureStatus?.status === "done" && (
        <div data-testid="capture-metadata">
          Sample Rate: {(maxSampleRateHz || 3200000) / 1000000}MHz
          Duration: {captureDurationS}s
          Size: 1.02 MB
        </div>
      )}

      {/* Main Capture Controls */}
      <IQCaptureControlsSection
        activeCaptureAreas={activeCaptureAreas}
        availableCaptureAreas={mockAvailableCaptureAreas}
        captureDurationMode={captureDurationMode}
        captureDurationS={captureDurationS}
        captureFileType={captureFileType}
        acquisitionMode={acquisitionMode}
        captureEncrypted={captureEncrypted}
        capturePlayback={capturePlayback}
        captureGeolocation={captureGeolocation}
        captureRange={mockCaptureRange}
        maxSampleRate={maxSampleRateHz || 3200000}
        captureStatus={captureStatus || { status: "idle", jobId: "" }}
        isConnected={isConnected || false}
        deviceState={deviceState || "disconnected"}
        onActiveCaptureAreasChange={setActiveCaptureAreas}
        onCaptureDurationModeChange={setCaptureDurationMode}
        onCaptureDurationSChange={setCaptureDurationS}
        onCaptureFileTypeChange={setCaptureFileType}
        onAcquisitionModeChange={setAcquisitionMode}
        onCaptureEncryptedChange={setCaptureEncrypted}
        onCapturePlaybackChange={setCapturePlayback}
        onCaptureGeolocationChange={setCaptureGeolocation}
        onCapture={handleCapture}
        onClearStatus={() => { }}
      />
    </div>
  );
};
