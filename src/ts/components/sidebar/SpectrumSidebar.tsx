import React, { useMemo, useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { useSpectrumStore, SourceMode } from "@n-apt/hooks/useSpectrumStore";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
import type { CaptureRequest, CaptureFileType } from "@n-apt/hooks/useWebSocket";

// Reuse existing section components
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import FileProcessingSection from "@n-apt/components/sidebar/FileProcessingSection";
import { SignalFeaturesSection } from "@n-apt/components/sidebar/SignalFeaturesSection";
import InfoPopover from "@n-apt/components/InfoPopover";

const SidebarContent = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 24px 24px 24px;
`;

const Section = styled.div<{ $marginBottom?: string }>`
  margin-bottom: ${({ $marginBottom }) => $marginBottom || "32px"};
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
  frame_rate?: number;
  fft_size?: number;
  duration_s?: number;
};

export const SpectrumSidebar: React.FC = () => {
  const {
    state,
    dispatch,
    effectiveSdrSettings,
    sampleRateHzEffective,
    wsConnection: {
      isConnected, deviceState, backend,
      maxSampleRateHz, captureStatus, autoFftOptions,
      sendSettings, sendCaptureCommand
    },
  } = useSpectrumStore();

  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();

  const maxSampleRate = sampleRateHzEffective ?? maxSampleRateHz ?? 0;
  const sampleRateMHz = sampleRateHzEffective ? sampleRateHzEffective / 1_000_000 : null;

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
    setFftSize,
    setFftWindow,
    setFftFrameRate,
    setGain,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    scheduleCoupledAdjustment,
  } = useSdrSettings({
    maxSampleRate,
    sdrSettings: effectiveSdrSettings ?? null,
    onSettingsChange: (settings) => {
      if (settings.frameRate !== undefined) {
        dispatch({ type: "SET_FFT_FRAME_RATE", fftFrameRate: settings.frameRate });
      }
      sendSettings(settings);
    }
  });

  // Capture UI state
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureOnscreen, setCaptureOnscreen] = useState(true);
  const [captureAreaA, setCaptureAreaA] = useState(false);
  const [captureAreaB, setCaptureAreaB] = useState(false);
  const [captureDurationS, setCaptureDurationS] = useState(1);
  const [captureFileTypeState, setCaptureFileTypeState] = useState<CaptureFileType>(".napt");
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

  // Memoized values for sections
  const selectedNaptFile = useMemo(() => {
    if (state.sourceMode !== "file") return null;
    if (state.selectedFiles.length !== 1) return null;
    const f = state.selectedFiles[0];
    return f.name.toLowerCase().endsWith(".napt") ? f : null;
  }, [state.sourceMode, state.selectedFiles]);

  const fileCapturedRange = useMemo(() => {
    if (state.sourceMode !== "file" || state.selectedFiles.length === 0) return null;
    let minFreq = Infinity;
    let maxFreq = -Infinity;
    for (const f of state.selectedFiles) {
      if (f.name.toLowerCase().endsWith(".napt")) continue;
      const match = f.name.match(/iq_(\d+\.?\d*)MHz/);
      if (match) {
        const freq = parseFloat(match[1]);
        const halfSpan = sampleRateMHz ? sampleRateMHz / 2 : null;
        if (halfSpan === null) continue;
        minFreq = Math.min(minFreq, freq - halfSpan);
        maxFreq = Math.max(maxFreq, freq + halfSpan);
      }
    }
    return minFreq === Infinity ? null : { min: Math.max(0, minFreq), max: maxFreq };
  }, [state.sourceMode, state.selectedFiles, sampleRateMHz]);

  const captureRange = useMemo(() => {
    if (!state.frequencyRange) return { min: 0, max: 0, segments: [] };
    const segments: any[] = [];
    if (captureOnscreen) segments.push({ label: "Onscreen", min: state.frequencyRange.min, max: state.frequencyRange.max });
    // Area A/B would need more frames data if we want to support them specifically
    return {
      min: Math.min(...segments.map(r => r.min), state.frequencyRange.min),
      max: Math.max(...segments.map(r => r.max), state.frequencyRange.max),
      segments
    };
  }, [state.frequencyRange, captureOnscreen]);

  // Handlers
  const handleCapture = useCallback(() => {
    if (!isConnected || deviceState === "loading" || !isAuthenticated) return;
    const req: CaptureRequest = {
      jobId: `cap_${Date.now()}`,
      minFreq: captureRange.min,
      maxFreq: captureRange.max,
      durationS: Math.max(1, Math.round(captureDurationS)),
      fileType: captureFileTypeState,
      encrypted: captureFileTypeState === ".napt" ? true : captureEncrypted,
      fftSize,
      fftWindow,
    };
    sendCaptureCommand(req);
  }, [isConnected, deviceState, isAuthenticated, captureRange, captureDurationS, captureFileTypeState, captureEncrypted, fftSize, fftWindow, sendCaptureCommand]);

  const handleSnapshot = () => {
    window.dispatchEvent(new CustomEvent("napt-snapshot", {
      detail: {
        whole: snapshotWhole,
        showWaterfall: snapshotShowWaterfall,
        showStats: snapshotShowStats,
        format: snapshotFormat,
        grid: state.snapshotGridPreference ?? true
      }
    }));
  };

  // NAPT Metadata Effect
  useEffect(() => {
    let cancelled = false;
    if (!selectedNaptFile || !aesKey) {
      setNaptMetadata(null);
      if (selectedNaptFile && !aesKey) setNaptMetadataError("Locked (no session key)");
      return;
    }
    const run = async () => {
      try {
        const buf = await selectedNaptFile.file.arrayBuffer();
        const b64 = new TextDecoder().decode(new Uint8Array(buf)).trim();
        const bytes = await decryptPayloadBytes(aesKey, b64);
        const newlineIdx = bytes.indexOf(10);
        if (newlineIdx <= 0) throw new Error("Invalid NAPT payload");
        const meta = JSON.parse(new TextDecoder().decode(bytes.slice(0, newlineIdx)));
        if (!cancelled) setNaptMetadata(meta);
      } catch (e: any) {
        if (!cancelled) setNaptMetadataError(e?.message || "Failed to read metadata");
      }
    };
    run();
    return () => { cancelled = true; };
  }, [selectedNaptFile, aesKey]);

  return (
    <SidebarContent>
      <Section>
        <SectionTitle $fileMode={state.sourceMode === "file"}>Source</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Input</SettingLabel>
            <InfoPopover title="Source" content="Select the signal source." />
          </SettingLabelContainer>
          <SettingSelect
            value={state.sourceMode}
            onChange={(e) => dispatch({ type: "SET_SOURCE_MODE", mode: e.target.value as SourceMode })}
            style={{ minWidth: "130px" }}
          >
            <option value="live">{backend === "mock_apt" ? "Mock APT SDR" : (backend || "Live SDR")}</option>
            <option value="file" style={{ color: "#d9aa34" }}>File Selection</option>
          </SettingSelect>
        </SettingRow>
      </Section>

      {state.sourceMode === "file" && (
        <Section>
          <FileProcessingSection
            selectedFiles={state.selectedFiles}
            onSelectedFilesChange={(files) => dispatch({ type: "SET_SELECTED_FILES", files })}
            stitchStatus={state.stitchStatus}
            isStitchPaused={state.isStitchPaused}
            onStitch={() => dispatch({ type: "TRIGGER_STITCH" })}
            onClear={() => {
              dispatch({ type: "SET_SELECTED_FILES", files: [] });
              dispatch({ type: "CLEAR_WATERFALL" });
            }}
            onStitchPauseToggle={() => dispatch({ type: "TOGGLE_STITCH_PAUSE" })}
            selectedNaptFile={selectedNaptFile}
            naptMetadata={naptMetadata}
            naptMetadataError={naptMetadataError}
            sessionToken={sessionToken}
          />
        </Section>
      )}

      {state.sourceMode === "live" && (
        <>
          <IQCaptureControlsSection
            isOpen={captureOpen}
            onToggle={() => setCaptureOpen(!captureOpen)}
            captureOnscreen={captureOnscreen}
            captureAreaA={captureAreaA}
            captureAreaB={captureAreaB}
            captureDurationS={captureDurationS}
            captureFileType={captureFileTypeState}
            captureEncrypted={captureEncrypted}
            capturePlayback={capturePlayback}
            captureRange={captureRange}
            maxSampleRate={maxSampleRate}
            captureStatus={captureStatus}
            isConnected={isConnected}
            deviceState={deviceState}
            onCaptureOnscreenChange={setCaptureOnscreen}
            onCaptureAreaAChange={setCaptureAreaA}
            onCaptureAreaBChange={setCaptureAreaB}
            onCaptureDurationSChange={setCaptureDurationS}
            onCaptureFileTypeChange={setCaptureFileTypeState}
            onCaptureEncryptedChange={setCaptureEncrypted}
            onCapturePlaybackChange={setCapturePlayback}
            onCapture={handleCapture}
          />

          <SnapshotControlsSection
            isOpen={snapshotOpen}
            onToggle={() => setSnapshotOpen(!snapshotOpen)}
            snapshotWhole={snapshotWhole}
            snapshotShowWaterfall={snapshotShowWaterfall}
            snapshotShowStats={snapshotShowStats}
            snapshotFormat={snapshotFormat}
            snapshotGridPreference={state.snapshotGridPreference ?? true}
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotFormatChange={setSnapshotFormat}
            onSnapshotGridPreferenceChange={(pref) => dispatch({ type: "SET_SNAPSHOT_GRID", preference: pref })}
            onSnapshot={handleSnapshot}
          />

          <SignalFeaturesSection
            sourceMode={state.sourceMode}
            deviceState={deviceState || "disconnected"}
            isConnected={isConnected}
            selectedFilesCount={state.selectedFiles.length}
          />

          <SignalDisplaySection
            sourceMode="live"
            maxSampleRate={maxSampleRate}
            fileCapturedRange={fileCapturedRange}
            fftFrameRate={fftFrameRate}
            maxFrameRate={maxFrameRate}
            fftSize={fftSize}
            fftSizeOptions={fftSizeOptions}
            fftWindow={fftWindow}
            temporalResolution={state.displayTemporalResolution}
            autoFftOptions={autoFftOptions}
            onFftFrameRateChange={setFftFrameRate}
            onFftSizeChange={setFftSize}
            onFftWindowChange={setFftWindow}
            onTemporalResolutionChange={(res) => dispatch({ type: "SET_TEMPORAL_RESOLUTION", resolution: res })}
            scheduleCoupledAdjustment={scheduleCoupledAdjustment}
          />

          <SourceSettingsSection
            sourceMode="live"
            ppm={ppm}
            gain={gain}
            tunerAGC={tunerAGC}
            rtlAGC={rtlAGC}
            stitchSourceSettings={state.stitchSourceSettings}
            isConnected={isConnected}
            onPpmChange={setPpm}
            onGainChange={setGain}
            onTunerAGCChange={setTunerAGC}
            onRtlAGCChange={setRtlAGC}
            onStitchSourceSettingsChange={(settings) => dispatch({ type: "SET_STITCH_SOURCE_SETTINGS", settings })}
            onAgcModeChange={(tuner, rtl) => {
              setTunerAGC(tuner);
              setRtlAGC(rtl);
            }}
          />
        </>
      )}
    </SidebarContent>
  );
};

export default SpectrumSidebar;
