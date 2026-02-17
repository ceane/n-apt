import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import InfoPopover from "@n-apt/components/InfoPopover";
import FrequencyRangeSlider from "@n-apt/components/FrequencyRangeSlider";
import DrawMockNAPTSidebar from "./DrawMockNAPTSidebar";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
import { renderSpectrumSvg, renderFullRangeSpectrumSvg, drawSpectrumGrid } from "@n-apt/fft/FFTCanvasRenderer";
import { FFT_AREA_MIN } from "@n-apt/consts";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import type {
  SDRSettings,
  DeviceState,
  DeviceLoadingReason,
  CaptureRequest,
  CaptureStatus,
  CaptureFileType,
} from "@n-apt/hooks/useWebSocket";

// Import extracted section components
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import { FileProcessingSection } from "@n-apt/components/sidebar/FileProcessingSection";

type NaptMetadata = {
  sample_rate?: number;
  center_frequency?: number;
  frequency_range?: [number, number];
  fft?: { size?: number; window?: string };
  format?: string;
  timestamp_utc?: string;
  hardware?: string;
  gain?: number;
  ppm?: number;
};

const SidebarContainer = styled.aside`
  width: 360px;
  min-width: 360px;
  height: 100vh;
  background-color: #0d0d0d;
  border-right: 1px solid #1a1a1a;
  display: flex;
  flex-direction: column;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px
    calc(24px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  overflow-x: visible;
  position: relative;
  box-sizing: border-box;
`;

const TabContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 12px 16px;
  background-color: ${(props) => (props.$active ? "#1a1a1a" : "transparent")};
  border: 1px solid ${(props) => (props.$active ? "#2a2a2a" : "transparent")};
  border-radius: 8px;
  color: ${(props) => (props.$active ? "#00d4ff" : "#666")};
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #1a1a1a;
    color: ${(props) => (props.$active ? "#00d4ff" : "#888")};
  }
`;

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? "#d9aa34" : "#555")};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #1a1a1a;
  user-select: none;
`;

const SettingLabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 80px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
  }
`;

interface SidebarProps {
  isConnected: boolean;
  isAuthenticated: boolean;
  authState: string;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  _serverPaused: boolean;
  backend: string | null;
  deviceInfo: string | null;
  maxSampleRateHz: number | null;
  sessionToken: string | null;
  aesKey: CryptoKey | null;
  captureStatus: CaptureStatus;
  onCaptureCommand: (req: CaptureRequest) => void;
  spectrumFrames?: Array<{ id: string; label: string; min_mhz: number; max_mhz: number; description: string }>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  drawParams: {
    spikeCount: number;
    spikeWidth: number;
    centerSpikeBoost: number;
    floorAmplitude: number;
    decayRate: number;
    envelopeWidth: number;
  };
  onDrawParamsChange: (params: any) => void;
  sourceMode: "live" | "file";
  onSourceModeChange: (mode: "live" | "file") => void;
  stitchStatus: string;
  activeSignalArea: string;
  onSignalAreaChange: (area: string) => void;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
  frequencyRange?: { min: number; max: number };
  onPauseToggle: () => void;
  onSettingsChange?: (settings: SDRSettings) => void;
  displayTemporalResolution?: "low" | "medium" | "high";
  onDisplayTemporalResolutionChange?: (resolution: "low" | "medium" | "high") => void;
  selectedFiles: { name: string; file: File }[];
  onSelectedFilesChange: (files: { name: string; file: File }[]) => void;
  stitchSourceSettings: { gain: number; ppm: number };
  onStitchSourceSettingsChange: (settings: { gain: number; ppm: number }) => void;
  isStitchPaused: boolean;
  onStitchPauseToggle: () => void;
  onStitch: () => void;
  onClear: () => void;
  onRestartDevice?: () => void;
  snapshotGridPreference?: boolean;
  onSnapshotGridPreferenceChange?: (preference: boolean) => void;
  fftWaveform?: Float32Array | number[] | null;
  getCurrentWaveform?: () => Float32Array | number[] | null;
  centerFrequencyMHz?: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  isConnected,
  isAuthenticated,
  authState,
  deviceState,
  deviceLoadingReason,
  isPaused,
  _serverPaused,
  backend,
  deviceInfo,
  maxSampleRateHz,
  sessionToken,
  aesKey,
  captureStatus,
  onCaptureCommand,
  spectrumFrames,
  activeTab,
  onTabChange,
  drawParams,
  onDrawParamsChange,
  sourceMode,
  onSourceModeChange,
  stitchStatus,
  activeSignalArea,
  onSignalAreaChange,
  onFrequencyRangeChange,
  frequencyRange,
  onPauseToggle,
  onSettingsChange,
  displayTemporalResolution,
  onDisplayTemporalResolutionChange,
  selectedFiles,
  onSelectedFilesChange,
  stitchSourceSettings,
  onStitchSourceSettingsChange,
  isStitchPaused,
  onStitchPauseToggle,
  onStitch,
  onClear,
  onRestartDevice,
  snapshotGridPreference,
  onSnapshotGridPreferenceChange,
  fftWaveform,
  getCurrentWaveform,
  centerFrequencyMHz,
}) => {
  // Use the extracted SDR settings hook
  const maxSampleRate = maxSampleRateHz || 3_200_000;
  const {
    fftSize,
    fftWindow,
    fftFrameRate,
    maxFrameRate,
    gain,
    ppm,
    tunerAGC,
    rtlAGC,
    fftSizeOptions,
    clampGain,
    setFftSize,
    setFftWindow,
    setFftFrameRate,
    setGain,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    sendCurrentSettings,
    scheduleCoupledAdjustment,
  } = useSdrSettings({ maxSampleRate, onSettingsChange });

  // Capture UI state
  const [captureOpen, setCaptureOpen] = useState(true);
  const [captureOnscreen, setCaptureOnscreen] = useState(true);
  const [captureAreaA, setCaptureAreaA] = useState(false);
  const [captureAreaB, setCaptureAreaB] = useState(false);
  const [captureDurationS, setCaptureDurationS] = useState(1);
  const [captureFileType, setCaptureFileType] = useState<CaptureFileType>(".napt");
  const [captureEncrypted, setCaptureEncrypted] = useState(true);
  const [capturePlayback, setCapturePlayback] = useState(false);

  // Snapshot UI state
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotWhole, setSnapshotWhole] = useState(false);
  const [snapshotShowWaterfall, setSnapshotShowWaterfall] = useState(false);
  const [snapshotShowStats, setSnapshotShowStats] = useState(true);
  const [snapshotFormat, setSnapshotFormat] = useState<"png" | "svg">("png");

  // NAPT metadata state
  const [naptMetadata, setNaptMetadata] = useState<NaptMetadata | null>(null);
  const [naptMetadataError, setNaptMetadataError] = useState<string | null>(null);

  // Calculate capture range
  const captureRange = useMemo(() => {
    if (!frequencyRange) {
      return { min: 0, max: 0, segments: [] as Array<{ label: string; min: number; max: number }> };
    }

    const fallbackA = { label: "A", min: 0.0, max: 4.47 };
    const fallbackB = { label: "B", min: 24.72, max: 29.88 };

    const findFrameByLabel = (label: string) =>
      spectrumFrames?.find((f) => f.label.toLowerCase() === label.toLowerCase()) ?? null;

    const frameA = findFrameByLabel("A");
    const frameB = findFrameByLabel("B");

    const AREA_A = frameA
      ? { label: "A", min: frameA.min_mhz, max: frameA.max_mhz }
      : fallbackA;
    const AREA_B = frameB
      ? { label: "B", min: frameB.min_mhz, max: frameB.max_mhz }
      : fallbackB;

    const segments: Array<{ label: string; min: number; max: number }> = [];
    if (captureOnscreen) segments.push({ label: "Onscreen", min: frequencyRange.min, max: frequencyRange.max });
    if (captureAreaA) segments.push(AREA_A);
    if (captureAreaB) segments.push(AREA_B);

    if (segments.length === 0) {
      segments.push({ label: "Onscreen", min: frequencyRange.min, max: frequencyRange.max });
    }

    return {
      min: Math.min(...segments.map((r) => r.min)),
      max: Math.max(...segments.map((r) => r.max)),
      segments,
    };
  }, [frequencyRange, captureOnscreen, captureAreaA, captureAreaB, spectrumFrames]);

  // File processing state
  const selectedNaptFile = useMemo(() => {
    if (sourceMode !== "file") return null;
    if (selectedFiles.length !== 1) return null;
    const f = selectedFiles[0];
    return f.name.toLowerCase().endsWith(".napt") ? f : null;
  }, [sourceMode, selectedFiles]);

  const fileCapturedRange = useMemo(() => {
    if (sourceMode !== "file" || selectedFiles.length === 0) return null;
    let minFreq = Infinity;
    let maxFreq = -Infinity;
    for (const f of selectedFiles) {
      if (f.name.toLowerCase().endsWith(".napt")) {
        continue;
      }
      const match = f.name.match(/iq_(\d+\.?\d*)MHz/);
      if (match) {
        const freq = parseFloat(match[1]);
        minFreq = Math.min(minFreq, freq - 1.6);
        maxFreq = Math.max(maxFreq, freq + 1.6);
      }
    }
    if (minFreq === Infinity) return null;
    return { min: Math.max(0, minFreq), max: maxFreq };
  }, [sourceMode, selectedFiles]);

  // Handle capture
  const handleCapture = useCallback(() => {
    if (!isConnected || deviceState === "loading") return;
    if (!isAuthenticated) return;

    if (captureRange.min === 0 && captureRange.max === 0) return;

    const jobId = `cap_${Date.now()}`;
    const req: CaptureRequest = {
      jobId,
      minFreq: captureRange.min,
      maxFreq: captureRange.max,
      durationS: Math.max(1, Math.round(Number(captureDurationS) || 1)),
      fileType: captureFileType,
      encrypted: captureFileType === ".napt" ? true : captureEncrypted,
      fftSize,
      fftWindow,
    };
    onCaptureCommand(req);
  }, [
    isConnected,
    deviceState,
    isAuthenticated,
    captureRange.min,
    captureRange.max,
    captureDurationS,
    captureFileType,
    captureEncrypted,
    fftSize,
    fftWindow,
    onCaptureCommand,
  ]);

  // Handle snapshot (simplified version)
  const handleSnapshot = useCallback(async () => {
    console.log("Snapshot functionality would be implemented here");
  }, []);

  // Load NAPT metadata
  useEffect(() => {
    let cancelled = false;
    setNaptMetadata(null);
    setNaptMetadataError(null);

    const run = async () => {
      if (!selectedNaptFile) return;
      if (!aesKey) {
        setNaptMetadataError("Locked (no session key)");
        return;
      }

      try {
        const buf = await selectedNaptFile.file.arrayBuffer();
        const b64 = new TextDecoder().decode(new Uint8Array(buf)).trim();
        const bytes = await decryptPayloadBytes(aesKey, b64);
        const newlineIdx = bytes.indexOf(10);
        if (newlineIdx <= 0) {
          throw new Error("Invalid NAPT payload (missing metadata header)");
        }
        const metaJson = new TextDecoder().decode(bytes.slice(0, newlineIdx));
        const meta = JSON.parse(metaJson) as NaptMetadata;
        if (!cancelled) {
          setNaptMetadata(meta);
          setNaptMetadataError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setNaptMetadata(null);
          setNaptMetadataError(e?.message || "Failed to read NAPT metadata");
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedNaptFile, aesKey]);

  // Handle frequency range changes for signal areas
  const handleAreaARangeChange = useCallback(
    (range: { min: number; max: number }) => {
      if (activeSignalArea === "A") {
        onFrequencyRangeChange?.(range);
      }
    },
    [activeSignalArea, onFrequencyRangeChange],
  );

  const handleAreaBRangeChange = useCallback(
    (range: { min: number; max: number }) => {
      if (activeSignalArea === "B") {
        onFrequencyRangeChange?.(range);
      }
    },
    [activeSignalArea, onFrequencyRangeChange],
  );

  // Minimal sidebar mode: only show connection status and auth state
  if (!isAuthenticated) {
    const authStatusMap = {
      connecting: "Connecting to server...",
      awaiting_challenge: "Establishing secure channel...",
      ready: "Awaiting authentication...",
      authenticating: "Verifying credentials...",
      failed: "Authentication failed",
      timeout: "Authentication timed out",
      success: "Authenticated — starting stream...",
    };
    const authStatusText = authStatusMap[authState as keyof typeof authStatusMap] ?? "Awaiting authentication...";

    return (
      <SidebarContainer>
        <Section>
          <SectionTitle>Connection</SectionTitle>
          <ConnectionStatusSection
            isConnected={isConnected}
            deviceState={deviceState}
            deviceLoadingReason={deviceLoadingReason}
            isPaused={isPaused}
            onPauseToggle={onPauseToggle}
            onRestartDevice={onRestartDevice}
          />
        </Section>

        <Section>
          <SectionTitle>Authentication</SectionTitle>
          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Status</SettingLabel>
            </SettingLabelContainer>
            <div style={{
              color: authState === "failed" || authState === "timeout" ? "#f87171" : authState === "success" ? "#00d4ff" : "#888",
              fontSize: "11px",
              fontWeight: 500,
            }}>
              {authStatusText}
            </div>
          </SettingRow>
          {backend && (
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Backend</SettingLabel>
              </SettingLabelContainer>
              <div style={{ fontSize: "12px", color: "#ccc", fontWeight: 500 }}>
                {backend === "rtl-sdr" ? "RTL-SDR" : "Mock"}
              </div>
            </SettingRow>
          )}
        </Section>
      </SidebarContainer>
    );
  }

  return (
    <SidebarContainer>
      {/* Capturing indicator */}
      {captureStatus?.status === "started" && (
        <div style={{
          position: "fixed",
          top: "24px",
          right: "24px",
          backgroundColor: "#ff4444",
          color: "white",
          padding: "8px 12px",
          borderRadius: "6px",
          fontSize: "12px",
          fontWeight: "600",
          fontFamily: "JetBrains Mono, monospace",
          zIndex: 1000,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>
          <div style={{
            width: "8px",
            height: "8px",
            backgroundColor: "white",
            borderRadius: "50%",
            animation: "pulse 1.5s infinite"
          }} />
          Capturing... {captureStatus.jobId}
        </div>
      )}

      <TabContainer>
        <Tab $active={activeTab === "visualizer"} onClick={() => onTabChange("visualizer")}>
          See FFT of N-APT (LF/HF freqs)
        </Tab>
        <Tab $active={activeTab === "analysis"} onClick={() => onTabChange("analysis")}>
          Decode N-APT with ML
        </Tab>
        <Tab $active={activeTab === "draw"} onClick={() => onTabChange("draw")}>
          Draw N-APT with Math/ML
        </Tab>
      </TabContainer>

      {activeTab === "visualizer" && (
        <>
          {sourceMode === "live" && (
            <ConnectionStatusSection
              isConnected={isConnected}
              deviceState={deviceState}
              deviceLoadingReason={deviceLoadingReason}
              isPaused={isPaused}
              onPauseToggle={onPauseToggle}
              onRestartDevice={onRestartDevice}
            />
          )}

          <Section>
            <SectionTitle $fileMode={sourceMode === "file"}>Source</SectionTitle>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>Input</SettingLabel>
                <InfoPopover
                  title="Source"
                  content="Select the signal source: live SDR device for real-time capture, or file selection to analyze previously recorded I/Q data."
                />
              </SettingLabelContainer>
              <SettingSelect
                value={sourceMode}
                onChange={(e) => onSourceModeChange(e.target.value as "live" | "file")}
                style={{ minWidth: "130px" }}
              >
                <option value="live">
                  {backend === "rtl-sdr" ? "RTL-SDR" : backend === "mock" ? "Mock SDR" : "Live SDR"}
                </option>
                <option value="file" style={{ color: "#d9aa34" }}>
                  File Selection
                </option>
              </SettingSelect>
            </SettingRow>
          </Section>

          {sourceMode === "live" && (
            <IQCaptureControlsSection
              isOpen={captureOpen}
              onToggle={() => setCaptureOpen(!captureOpen)}
              captureOnscreen={captureOnscreen}
              captureAreaA={captureAreaA}
              captureAreaB={captureAreaB}
              captureDurationS={captureDurationS}
              captureFileType={captureFileType}
              captureEncrypted={captureEncrypted}
              capturePlayback={capturePlayback}
              captureRange={captureRange}
              maxSampleRate={maxSampleRate}
              captureStatus={captureStatus}
              isConnected={isConnected}
              deviceState={deviceState}
              isAuthenticated={isAuthenticated}
              sessionToken={sessionToken}
              onCaptureOnscreenChange={setCaptureOnscreen}
              onCaptureAreaAChange={setCaptureAreaA}
              onCaptureAreaBChange={setCaptureAreaB}
              onCaptureDurationSChange={setCaptureDurationS}
              onCaptureFileTypeChange={setCaptureFileType}
              onCaptureEncryptedChange={setCaptureEncrypted}
              onCapturePlaybackChange={setCapturePlayback}
              onCapture={handleCapture}
            />
          )}

          <SnapshotControlsSection
            isOpen={snapshotOpen}
            onToggle={() => setSnapshotOpen(!snapshotOpen)}
            snapshotWhole={snapshotWhole}
            snapshotShowWaterfall={snapshotShowWaterfall}
            snapshotShowStats={snapshotShowStats}
            snapshotFormat={snapshotFormat}
            snapshotGridPreference={snapshotGridPreference ?? true}
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotFormatChange={setSnapshotFormat}
            onSnapshotGridPreferenceChange={onSnapshotGridPreferenceChange || (() => { })}
            onSnapshot={handleSnapshot}
          />

          {sourceMode === "file" && (
            <FileProcessingSection
              selectedFiles={selectedFiles}
              stitchStatus={stitchStatus}
              isStitchPaused={isStitchPaused}
              selectedNaptFile={selectedNaptFile}
              naptMetadata={naptMetadata}
              naptMetadataError={naptMetadataError}
              onSelectedFilesChange={onSelectedFilesChange}
              onStitch={onStitch}
              onClear={onClear}
              onStitchPauseToggle={onStitchPauseToggle}
            />
          )}

          {sourceMode === "live" && (
            <Section>
              <SectionTitle>Signal areas of interest</SectionTitle>
              {(Array.isArray(spectrumFrames) && spectrumFrames.length > 0
                ? spectrumFrames
                : [
                  { id: "frame_a", label: "A", min_mhz: 0.0, max_mhz: 4.47, description: "" },
                  { id: "frame_b", label: "B", min_mhz: 24.72, max_mhz: 29.88, description: "" },
                ]
              ).map((frame) => {
                const label = frame.label;
                const min = frame.min_mhz;
                const max = frame.max_mhz;
                const span = max - min;
                const window = Math.min(3.2, Math.max(0.2, span));
                return (
                  <FrequencyRangeSlider
                    key={frame.id}
                    label={label}
                    minFreq={min}
                    maxFreq={max}
                    visibleMin={min}
                    visibleMax={min + window}
                    isActive={activeSignalArea === label}
                    onActivate={() => onSignalAreaChange?.(label)}
                    onRangeChange={label === "A" ? handleAreaARangeChange : handleAreaBRangeChange}
                    isDeviceConnected={deviceState === "connected"}
                    externalFrequencyRange={activeSignalArea === label ? frequencyRange : undefined}
                  />
                );
              })}
            </Section>
          )}

          <Section>
            <SectionTitle>Signal Features</SectionTitle>
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>
                  N-APT
                  <span role="img" aria-label="brain" style={{ marginLeft: "6px" }}>
                    🧠
                  </span>
                </SettingLabel>
                <InfoPopover
                  title="N-APT"
                  content="N-APT stands for: Neuro Automatic Picture Transmission. These radio waves are modulated akin to APT signals (unknown reasons at this time) but unique in their ability to intercept, process and alter the brain and nervous system."
                />
              </SettingLabelContainer>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ fontSize: "12px", color: "#ccc", fontWeight: 500 }}>
                  {deviceState === "connected" ? "Yes" : "No"}
                </div>
                <button
                  disabled={!isConnected || deviceState !== "connected"}
                  style={{
                    fontSize: "11px",
                    padding: "6px 12px",
                    minWidth: "80px",
                    opacity: !isConnected || deviceState !== "connected" ? 0.5 : 1,
                    cursor: !isConnected || deviceState !== "connected" ? "not-allowed" : "pointer",
                    backgroundColor: "#1a1a1a",
                    border: "1px solid #2a2a2a",
                    borderRadius: "6px",
                    color: !isConnected || deviceState !== "connected" ? "#666" : "#00d4ff",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  Classify?
                </button>
              </div>
            </SettingRow>
          </Section>

          <SignalDisplaySection
            sourceMode={sourceMode}
            maxSampleRate={maxSampleRate}
            fileCapturedRange={fileCapturedRange}
            fftFrameRate={fftFrameRate}
            maxFrameRate={maxFrameRate}
            fftSize={fftSize}
            fftWindow={fftWindow}
            temporalResolution={displayTemporalResolution || "medium"}
            onFftFrameRateChange={setFftFrameRate}
            onFftSizeChange={setFftSize}
            onFftWindowChange={setFftWindow}
            onTemporalResolutionChange={onDisplayTemporalResolutionChange || (() => { })}
            scheduleCoupledAdjustment={scheduleCoupledAdjustment}
          />

          <SourceSettingsSection
            sourceMode={sourceMode}
            ppm={ppm}
            gain={gain}
            tunerAGC={tunerAGC}
            rtlAGC={rtlAGC}
            stitchSourceSettings={stitchSourceSettings}
            isConnected={isConnected}
            onPpmChange={setPpm}
            onGainChange={setGain}
            onTunerAGCChange={setTunerAGC}
            onRtlAGCChange={setRtlAGC}
            onStitchSourceSettingsChange={onStitchSourceSettingsChange}
            onAgcModeChange={(tuner, rtl) => {
              setTunerAGC(tuner);
              setRtlAGC(rtl);
              sendCurrentSettings({ tunerAGC: tuner, rtlAGC: rtl });
            }}
          />
        </>
      )}

      {activeTab === "draw" && (
        <DrawMockNAPTSidebar
          drawParams={drawParams}
          onDrawParamsChange={onDrawParamsChange}
        />
      )}
    </SidebarContainer>
  );
};

export default Sidebar;
