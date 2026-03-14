import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import FrequencyRangeSlider from "@n-apt/components/sidebar/FrequencyRangeSlider";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import type { GeolocationData } from "@n-apt/consts/schemas/websocket";
import type {
  SDRSettings,
  DeviceState,
  DeviceLoadingReason,
  CaptureRequest,
  CaptureStatus,
  CaptureFileType,
  FrequencyRange,
  SdrSettingsConfig,
} from "@n-apt/hooks/useWebSocket";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import SourceInput from "@n-apt/components/sidebar/SourceInput";

import { Row, CollapsibleTitle } from "@n-apt/components/ui";
import { ConnectionStatusSection, PauseButton } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { BodyAreasSection } from "@n-apt/components/sidebar/BodyAreasSection";
import { HotspotEditorSection } from "@n-apt/components/sidebar/HotspotEditorSection";

import FileProcessingSection from "@n-apt/components/sidebar/FileProcessingSection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import DrawMockNAPTSidebar from "@n-apt/components/sidebar/DrawMockNAPTSidebar";
import { useSpectrumStore, LIVE_CONTROL_DEFAULTS, type DrawParams } from "@n-apt/hooks/useSpectrumStore";
import { usePrompt } from "@n-apt/components/ui";

type NaptMetadata = {
  sample_rate?: number;
  sample_rate_hz?: number;
  capture_sample_rate_hz?: number;
  hardware_sample_rate_hz?: number;
  center_frequency?: number;
  center_frequency_hz?: number;
  frequency_range?: [number, number];
  fft?: { size?: number; window?: string };
  format?: string;
  data_format?: string;
  timestamp_utc?: string;
  hardware?: string;
  gain?: number;
  ppm?: number;
  frame_rate?: number;
  fft_size?: number;
  duration_s?: number;
  // New fields
  acquisition_mode?: string;
  source_device?: string;
  fft_window?: string;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  // Geolocation data
  geolocation?: GeolocationData;
};

const SidebarContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px
    calc(24px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  overflow-x: visible;
  position: relative;
  box-sizing: border-box;
  flex: 1;
  max-width: 100%;
`;

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
`;

const SectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? "#d9aa34" : "#555")};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
`;

const AuthStatusText = styled.div<{ $status: string }>`
  color: ${(props) =>
    props.$status === "failed" || props.$status === "timeout"
      ? "#f87171"
      : props.$status === "success"
        ? "#00d4ff"
        : "#888"};
  font-size: 11px;
  font-weight: 500;
`;

const SettingValueText = styled.div`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
`;

const CapturingIndicator = styled.div`
  position: fixed;
  top: 24px;
  right: 24px;
  background-color: #ff4444;
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  z-index: 1000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 8px;
`;

const CapturingDot = styled.div`
  width: 8px;
  height: 8px;
  background-color: white;
  border-radius: 50%;
  animation: pulse 1.5s infinite;

  @keyframes pulse {
    from {
      opacity: 1;
    }
    to {
      opacity: 0.4;
    }
  }
`;

const HeterodyningContainer = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-content: start;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
  grid-column: 1 / -1;
`;

const VerifyButton = styled.button`
  font-size: 11px;
  padding: 6px 12px;
  min-width: 80px;
  background-color: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  color: #00d4ff;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
`;

interface SidebarProps {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  backend: string | null;
  maxSampleRateHz: number | null;
  sampleRateHz?: number | null;
  sdrSettings?: SdrSettingsConfig | null;
  captureStatus: CaptureStatus;
  autoFftOptions?: {
    type: "auto_fft_options";
    autoSizes: number[];
    recommended: number;
  } | null;
  onCaptureCommand: (req: CaptureRequest) => void;
  spectrumFrames?: Array<{
    id: string;
    label: string;
    min_mhz: number;
    max_mhz: number;
    description: string;
  }>;
  activeTab: string;
  drawParams: DrawParams[];
  onDrawParamsChange: (params: DrawParams[]) => void;
  sourceMode: "live" | "file";
  onSourceModeChange: (mode: "live" | "file") => void;
  stitchStatus: string;
  activeSignalArea: string;
  onSignalAreaChange: (area: string) => void;
  onFrequencyRangeChange?: (range: { min: number; max: number }) => void;
  frequencyRange?: FrequencyRange;
  onPauseToggle: () => void;
  onSettingsChange?: (settings: SDRSettings) => void;
  displayTemporalResolution?: "low" | "medium" | "high";
  onDisplayTemporalResolutionChange?: (
    resolution: "low" | "medium" | "high",
  ) => void;
  selectedFiles: { name: string; file: File }[];
  onSelectedFilesChange: (files: { name: string; file: File }[]) => void;
  stitchSourceSettings: { gain: number; ppm: number };
  onStitchSourceSettingsChange: (settings: {
    gain: number;
    ppm: number;
  }) => void;
  isStitchPaused: boolean;
  onStitchPauseToggle: () => void;
  onStitch: () => void;
  onClear: () => void;
  onRestartDevice?: () => void;
  snapshotGridPreference?: boolean;
  onSnapshotGridPreferenceChange?: (preference: boolean) => void;
  onSnapshot?: (options: {
    whole: boolean;
    showWaterfall: boolean;
    showStats: boolean;
    format: "png" | "svg";
    grid: boolean;
  }) => void;
  vizZoom?: number;
  vizPanOffset?: number;
  onVizPanChange?: (pan: number) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isConnected,
  deviceState,
  deviceLoadingReason,
  isPaused,
  backend,
  maxSampleRateHz,
  sampleRateHz,
  sdrSettings,
  captureStatus,
  autoFftOptions,
  onCaptureCommand,
  spectrumFrames,
  activeTab,
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
  onSnapshot,
  vizZoom = 1,
  vizPanOffset = 0,
  onVizPanChange,
}) => {
  const { state, dispatch, wsConnection, cryptoCorrupted, deviceName, deviceProfile } = useSpectrumStore();
  const { isAuthenticated, authState, aesKey, sessionToken } =
    useAuthentication();
  const maxSampleRate =
    typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
      ? sampleRateHz
      : (maxSampleRateHz ?? 0);
  const sampleRateMHz =
    typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
      ? sampleRateHz / 1_000_000
      : null;
  const isMockLiveSource =
    sourceMode === "live" &&
    (backend?.toLowerCase().includes("mock") ||
      deviceName?.toLowerCase().includes("mock"));
  const limitMarkers = useMemo(
    () => buildSdrLimitMarkers(sdrSettings ?? null),
    [sdrSettings],
  );
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
    sendCurrentSettings: _sendCurrentSettings,
    scheduleCoupledAdjustment,
  } = useSdrSettings({
    maxSampleRate,
    sdrSettings: wsConnection.sdrSettings,
    onSettingsChange,
  });

  const resetLiveControls = useCallback(() => {
    const recommendedFftSize = autoFftOptions?.recommended ?? fftSize;
    const recommendedFrameRate = Math.max(
      1,
      Math.min(maxFrameRate, fftFrameRate),
    );
    dispatch({
      type: "RESET_LIVE_CONTROLS",
      fftSize: recommendedFftSize,
      fftFrameRate: recommendedFrameRate,
    });
    onSettingsChange?.({
      fftSize: recommendedFftSize,
      fftWindow: LIVE_CONTROL_DEFAULTS.fftWindow,
      frameRate: recommendedFrameRate,
      gain: LIVE_CONTROL_DEFAULTS.gain,
      ppm: LIVE_CONTROL_DEFAULTS.ppm,
      tunerAGC: LIVE_CONTROL_DEFAULTS.tunerAGC,
      rtlAGC: LIVE_CONTROL_DEFAULTS.rtlAGC,
    });
  }, [
    autoFftOptions?.recommended,
    dispatch,
    fftFrameRate,
    fftSize,
    maxFrameRate,
    onSettingsChange,
  ]);

  // Auto-apply recommended FFT size on first load
  useEffect(() => {
    if (state.isAutoFftApplied) return;
    if (
      !wsConnection.autoFftOptions ||
      typeof wsConnection.autoFftOptions.recommended !== "number"
    )
      return;

    // When the auto FFT options are received, update the UI state and backend
    setFftSize(wsConnection.autoFftOptions.recommended);
    // Since FFT size can affect frame rate, schedule the adjustment to keep them coupled
    scheduleCoupledAdjustment(
      "fftSize",
      wsConnection.autoFftOptions.recommended,
      fftFrameRate,
    );
    dispatch({ type: "SET_AUTO_FFT_APPLIED", applied: true });
  }, [
    wsConnection.autoFftOptions,
    setFftSize,
    scheduleCoupledAdjustment,
    fftFrameRate,
    state.isAutoFftApplied,
    dispatch,
  ]);

  // Capture UI state
  const [captureOpen, setCaptureOpen] = useState(false);
  const showPrompt = usePrompt();
  const [activeCaptureAreas, setActiveCaptureAreas] = useState<string[]>([
    "Onscreen",
  ]);
  const [acquisitionMode, setAcquisitionMode] = useState<
    "stepwise" | "interleaved"
  >("interleaved");
  const [captureDurationS, setCaptureDurationS] = useState(1);
  const setCaptureFileType = (fileType: CaptureFileType) => {
    setCaptureFileTypeState(fileType);
    // When .wav is selected, turn off encryption
    if (fileType === ".wav") {
      setCaptureEncrypted(false);
    }
  };

  const [captureFileTypeState, setCaptureFileTypeState] =
    useState<CaptureFileType>(".napt");
  const [captureEncrypted, setCaptureEncrypted] = useState(true);
  const [capturePlayback, setCapturePlayback] = useState(false);
  const [captureGeolocation, setCaptureGeolocation] = useState(false);

  // Snapshot UI state
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  // Signal features UI state
  const [signalFeaturesOpen, setSignalFeaturesOpen] = useState(false);
  const [snapshotWhole, setSnapshotWhole] = useState(false);
  const [snapshotShowWaterfall, setSnapshotShowWaterfall] = useState(false);
  const [snapshotShowStats, setSnapshotShowStats] = useState(true);
  const [snapshotFormat, setSnapshotFormat] = useState<"png" | "svg">("png");

  // NAPT metadata state
  const [naptMetadata, setNaptMetadata] = useState<NaptMetadata | null>(null);
  const [naptMetadataError, setNaptMetadataError] = useState<string | null>(
    null,
  );

  // Handle Playback after capture
  useEffect(() => {
    if (
      captureStatus?.status === "done" &&
      capturePlayback &&
      captureStatus.downloadUrl
    ) {
      const run = async () => {
        try {
          // 1. Switch to file mode
          onSourceModeChange("file");

          // 2. Clear existing files first
          onClear();

          // 3. Fetch the file
          const url = `${captureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`;
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status}`);
          const blob = await response.blob();
          const filename = captureStatus.filename || "capture.napt";
          const file = new File([blob], filename, {
            type: "application/octet-stream",
          });

          // 4. Update selected files
          onSelectedFilesChange([{ name: filename, file }]);

          // 5. Trigger stitching/playback
          // We wait a bit for the state to settle
          setTimeout(() => {
            onStitch();
          }, 500);
        } catch (e) {
          console.error("Playback after capture failed:", e);
        }
      };
      run();
    }
  }, [
    captureStatus,
    capturePlayback,
    onSourceModeChange,
    onClear,
    onSelectedFilesChange,
    onStitch,
  ]);

  // Calculate capture range
  const captureRange = useMemo(() => {
    if (!frequencyRange) {
      return {
        min: 0,
        max: 0,
        segments: [] as Array<{ label: string; min: number; max: number }>,
      };
    }

    const segments: Array<{ label: string; min: number; max: number }> = [];
    if (activeCaptureAreas.includes("Onscreen"))
      segments.push({
        label: "Onscreen",
        min: frequencyRange.min,
        max: frequencyRange.max,
      });

    // Add dynamically mapped areas that are checked
    spectrumFrames?.forEach((f) => {
      if (activeCaptureAreas.includes(f.label)) {
        segments.push({ label: f.label, min: f.min_mhz, max: f.max_mhz });
      }
    });

    if (segments.length === 0) {
      segments.push({
        label: "Onscreen",
        min: frequencyRange.min,
        max: frequencyRange.max,
      });
    }

    return {
      min: Math.min(...segments.map((r) => r.min)),
      max: Math.max(...segments.map((r) => r.max)),
      segments,
    };
  }, [
    frequencyRange,
    activeCaptureAreas,
    spectrumFrames,
  ]);

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

    // Try to use actual metadata first for more accurate range calculation
    if (naptMetadata && naptMetadata.frequency_range) {
      return {
        min: Math.max(0, naptMetadata.frequency_range[0]),
        max: naptMetadata.frequency_range[1]
      };
    }

    // Fallback to filename parsing for individual files
    for (const f of selectedFiles) {
      if (f.name.toLowerCase().endsWith(".napt")) {
        continue;
      }
      const match = f.name.match(/iq_(\d+\.?\d*)MHz/);
      if (match) {
        const freq = parseFloat(match[1]);
        // For multiple captures, try to determine actual capture rate from metadata
        let captureRateMHz = sampleRateMHz;

        // If we have metadata, use the actual capture sample rate
        if (naptMetadata && naptMetadata.capture_sample_rate_hz) {
          captureRateMHz = naptMetadata.capture_sample_rate_hz / 1_000_000;
        }

        const halfSpan =
          typeof captureRateMHz === "number" && Number.isFinite(captureRateMHz)
            ? captureRateMHz / 2
            : null;
        if (halfSpan === null) continue;
        minFreq = Math.min(minFreq, freq - halfSpan);
        maxFreq = Math.max(maxFreq, freq + halfSpan);
      }
    }
    if (minFreq === Infinity) return null;
    return { min: Math.max(0, minFreq), max: maxFreq };
  }, [sourceMode, selectedFiles, naptMetadata, sampleRateMHz]);

  // Handle capture
  const handleCapture = useCallback(async () => {
    if (!isConnected || deviceState === "loading") return;
    if (!isAuthenticated) return;

    if (captureRange.min === 0 && captureRange.max === 0) return;

    let geolocationData = undefined;
    if (captureFileTypeState === ".napt" && captureGeolocation) {
      try {
        // Get geolocation data
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });

        geolocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude || undefined,
          timestamp: position.timestamp,
        };
      } catch (error) {
        console.warn("Failed to get geolocation for capture:", error);
        // Continue without geolocation if it fails
      }
    }

    const jobId = `cap_${Date.now()}`;
    const req: CaptureRequest = {
      jobId,
      fragments: captureRange.segments.map(s => ({ minFreq: s.min, maxFreq: s.max })),
      durationS: Math.max(1, Math.round(Number(captureDurationS) || 1)),
      fileType: captureFileTypeState,
      acquisitionMode,
      encrypted: captureFileTypeState === ".napt" ? true : captureEncrypted,
      fftSize,
      fftWindow,
      geolocation: geolocationData,
    };
    onCaptureCommand(req);
  }, [
    isConnected,
    deviceState,
    isAuthenticated,
    captureRange.min,
    captureRange.max,
    captureDurationS,
    captureFileTypeState,
    captureEncrypted,
    captureGeolocation,
    fftSize,
    fftWindow,
    onCaptureCommand,
  ]);

  const handleSnapshot = useCallback(() => {
    if (!onSnapshot) return;

    onSnapshot({
      whole: snapshotWhole,
      showWaterfall: snapshotShowWaterfall,
      showStats: snapshotShowStats,
      format: snapshotFormat,
      grid: snapshotGridPreference ?? true,
    });
  }, [
    onSnapshot,
    snapshotWhole,
    snapshotShowWaterfall,
    snapshotShowStats,
    snapshotFormat,
    snapshotGridPreference,
  ]);

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
  const handleRangeChange = useCallback(
    (label: string, range: { min: number; max: number }) => {
      if (activeSignalArea === label) {
        onFrequencyRangeChange?.(range);
      }
    },
    [activeSignalArea, onFrequencyRangeChange],
  );

  const SignalFeaturesSection = () => {
    const isFileSource = sourceMode === "file";
    const classificationStatusText = isFileSource
      ? selectedFiles.length > 0
        ? "Yes"
        : "No"
      : deviceState === "connected"
        ? "Yes"
        : "No";
    const classificationDisabled = isFileSource
      ? selectedFiles.length === 0
      : !isConnected || deviceState !== "connected";

    return (
      <Section>
        <CollapsibleTitle
          label="Signal Features /"
          isOpen={signalFeaturesOpen}
          onToggle={() => setSignalFeaturesOpen((prev) => !prev)}
        />

        {signalFeaturesOpen && (
          <>
            <Row label={<>N-APT<span role="img" aria-label="brain" style={{ marginLeft: "6px" }}>🧠</span></>} tooltipTitle="N-APT" tooltip="N-APT stands for: Neuro Automatic Picture Transmission. These radio waves are modulated akin to APT signals (unknown reasons at this time) but unique in their ability to intercept, process and alter the brain and nervous system.<br><br>Through LF/HF frequencies (frequencies that survive attenuation of the skull and/or body; and lose less energy with longer distances/obstacles), it functions from triangulation, time of flight depth, heterodyning (it's key feature which ensures bioelectrical reception), phase shifting, center frequencies, impedance & endpoint signals processing (suspected as Kaiser, Bayes' Theorem/Posterior Probability, etc.).<br><br>It is an unprecedented formula of radio waves and neurotechnology with nascent efforts to decipher its modulation and content.">
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <div
                  style={{ fontSize: "12px", color: "#ccc", fontWeight: 500 }}
                >
                  {classificationStatusText}
                </div>
                <button
                  disabled={classificationDisabled}
                  style={{
                    fontSize: "11px",
                    padding: "6px 12px",
                    minWidth: "80px",
                    opacity: classificationDisabled ? 0.5 : 1,
                    cursor: classificationDisabled ? "not-allowed" : "pointer",
                    backgroundColor: "#1a1a1a",
                    border: "1px solid #2a2a2a",
                    borderRadius: "6px",
                    color: classificationDisabled ? "#666" : "#00d4ff",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  Classify?
                </button>
              </div>
            </Row>

            <Row label="Heterodyned?">
              <HeterodyningContainer>
                No
                <VerifyButton>Verify</VerifyButton>
              </HeterodyningContainer>
            </Row>
          </>
        )}
      </Section>
    );
  };

  // Minimal sidebar mode: only show connection status and auth state
  if (!isAuthenticated) {
    const authStatusMap = {
      connecting: "Connecting to server...",
      awaiting_challenge: "Establishing secure channel...",
      ready: "Awaiting authentication...",
      authenticating: "Verifying credentials...",
      failed: "Authentication failed — Server disconnected 500",
      timeout: "Authentication timed out",
      success: "Authenticated — starting stream...",
    };
    const authStatusText =
      authStatusMap[authState as keyof typeof authStatusMap] ??
      "Awaiting authentication...";

    return (
      <SidebarContent>
        <Section>
          <SectionTitle>Connection</SectionTitle>
          <ConnectionStatusSection
            isConnected={isConnected}
            deviceState={deviceState}
            deviceLoadingReason={deviceLoadingReason}
            isPaused={isPaused}
            cryptoCorrupted={cryptoCorrupted}
            onPauseToggle={onPauseToggle}
            onRestartDevice={onRestartDevice}
          />
        </Section>

        <Section>
          <SectionTitle>Authentication</SectionTitle>
          <Row label="Status">
            <AuthStatusText $status={authState}>
              {authStatusText}
            </AuthStatusText>
          </Row>
          {backend && (
            <Row label="Backend">
              <SettingValueText>
                {backend === "rtl-sdr" ? "RTL-SDR" : "Mock APT SDR"}
              </SettingValueText>
            </Row>
          )}
        </Section>
      </SidebarContent>
    );
  }

  return (
    <SidebarContent>
      {/* Capturing indicator */}
      {captureStatus?.status === "started" && (
        <CapturingIndicator>
          <CapturingDot />
          Capturing... {captureStatus.jobId}
        </CapturingIndicator>
      )}

      {activeTab === "draw" && (
        <>
          {sourceMode === "live" && (
            <ConnectionStatusSection
              isConnected={isConnected}
              deviceState={deviceState}
              deviceLoadingReason={deviceLoadingReason}
              isPaused={isPaused}
              cryptoCorrupted={cryptoCorrupted}
              onPauseToggle={onPauseToggle}
              onRestartDevice={onRestartDevice}
            />
          )}
          {sourceMode === "live" && (
            <PauseButton
              $paused={false}
              onClick={() => {
                showPrompt({
                  title: "Reset Options to Defaults",
                  message: "Reset all live options to defaults?",
                  confirmText: "Reset",
                  cancelText: "Cancel",
                  variant: "danger",
                  onConfirm: resetLiveControls,
                });
              }}
              title="Reset sidebar and visualizer options to defaults"
            >
              Reset Options to Defaults
            </PauseButton>
          )}
          <DrawMockNAPTSidebar
            drawParams={drawParams}
            activeClumpIndex={state.activeClumpIndex}
            globalNoiseFloor={state.globalNoiseFloor}
            onDrawParamsChange={onDrawParamsChange}
            onActiveClumpIndexChange={(index) =>
              dispatch({ type: "SET_ACTIVE_CLUMP_INDEX", index })
            }
            onGlobalNoiseFloorChange={(noise) =>
              dispatch({ type: "SET_GLOBAL_NOISE_FLOOR", noise })
            }
            onResetParams={() => dispatch({ type: "RESET_DRAW_PARAMS" })}
          />
        </>
      )}

      {activeTab === "visualizer" && (
        <>
          {sourceMode === "live" && (
            <ConnectionStatusSection
              isConnected={isConnected}
              deviceState={deviceState}
              deviceLoadingReason={deviceLoadingReason}
              isPaused={isPaused}
              cryptoCorrupted={cryptoCorrupted}
              onPauseToggle={onPauseToggle}
              onRestartDevice={onRestartDevice}
            />
          )}
          {sourceMode === "live" && (
            <PauseButton
              $paused={false}
              onClick={() => {
                showPrompt({
                  title: "Reset Options to Defaults",
                  message: "Reset all live options to defaults?",
                  confirmText: "Reset",
                  cancelText: "Cancel",
                  variant: "danger",
                  onConfirm: resetLiveControls,
                });
              }}
              title="Reset sidebar and visualizer options to defaults"
            >
              Reset Options to Defaults
            </PauseButton>
          )}

          <Section>
            <SectionTitle $fileMode={sourceMode === "file"}>
              Source
            </SectionTitle>
            <SourceInput
              sourceMode={sourceMode}
              backend={backend}
              deviceName={deviceName}
              fileModeColor="#d9aa34"
              onSourceModeChange={onSourceModeChange}
            />
          </Section>

          {sourceMode === "live" && (
            <IQCaptureControlsSection
              isOpen={captureOpen}
              onToggle={() => setCaptureOpen(!captureOpen)}
              activeCaptureAreas={activeCaptureAreas}
              availableCaptureAreas={[
                { label: "Onscreen", min: frequencyRange?.min ?? 0, max: frequencyRange?.max ?? 0 },
                ...((spectrumFrames || []).map(f => ({ label: f.label, min: f.min_mhz, max: f.max_mhz })))
              ]}
              acquisitionMode={acquisitionMode}
              captureDurationS={captureDurationS}
              captureFileType={captureFileTypeState}
              captureEncrypted={captureEncrypted}
              capturePlayback={capturePlayback}
              captureGeolocation={captureGeolocation}
              captureRange={captureRange}
              maxSampleRate={maxSampleRate}
              captureStatus={captureStatus}
              isConnected={isConnected}
              deviceState={deviceState}
              onActiveCaptureAreasChange={setActiveCaptureAreas}
              onAcquisitionModeChange={setAcquisitionMode}
              onCaptureDurationSChange={setCaptureDurationS}
              onCaptureFileTypeChange={setCaptureFileType}
              onCaptureEncryptedChange={setCaptureEncrypted}
              onCapturePlaybackChange={setCapturePlayback}
              onCaptureGeolocationChange={setCaptureGeolocation}
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
            onSnapshotGridPreferenceChange={
              onSnapshotGridPreferenceChange || (() => { })
            }
            onSnapshot={handleSnapshot}
          />

          <BodyAreasSection />
          <HotspotEditorSection />

          {sourceMode === "file" ? (
            <>
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

              <SignalFeaturesSection />
            </>
          ) : (
            <>
              <Section>
                <SectionTitle>Signal areas of interest</SectionTitle>
                <div style={{ display: "grid", gap: "16px", width: "100%", gridColumn: "1 / -1" }}>
                  {Array.isArray(spectrumFrames) && spectrumFrames.length > 0 ? (
                    spectrumFrames.map((frame) => {
                      const label = frame.label;
                      const min = frame.min_mhz;
                      const max = frame.max_mhz;
                      const span = max - min;

                      // If this is the active frame and we are zoomed in,
                      // calculate the visual range based on zoom and pan offset
                      // NOTE: Use frequencyRange (SDR center) not frame min/max for center calculation
                      let visibleMin = min;
                      let visibleMax =
                        min +
                        (typeof sampleRateMHz === "number"
                          ? Math.min(sampleRateMHz, span)
                          : span);
                      let externalFreqRange =
                        activeSignalArea === label ? frequencyRange : undefined;

                      if (
                        activeSignalArea === label &&
                        vizZoom > 1 &&
                        frequencyRange
                      ) {
                        // Use frequencyRange (SDR tuned range) for center calculation
                        // This matches what FFTCanvas does
                        const hardwareCenter =
                          (frequencyRange.min + frequencyRange.max) / 2;
                        // Zoom applies to the hardware window width (sample rate), not the full signal area span
                        const hardwareSpan =
                          typeof sampleRateMHz === "number"
                            ? Math.min(sampleRateMHz, span)
                            : span;
                        const visualSpan = hardwareSpan / vizZoom;
                        const halfVisualSpan = visualSpan / 2;
                        // vizPanOffset is in MHz exactly
                        let visualCenter = hardwareCenter + vizPanOffset;

                        // Clamp visual center so the visual window stays within signal area bounds
                        visualCenter = Math.max(
                          min + halfVisualSpan,
                          Math.min(max - halfVisualSpan, visualCenter),
                        );

                        visibleMin = visualCenter - halfVisualSpan;
                        visibleMax = visualCenter + halfVisualSpan;

                        // Don't use externalFrequencyRange when zoomed - let the slider
                        // use visibleMin/visibleMax props directly for the zoomed view
                        externalFreqRange = undefined;
                      }

                      return (
                        <FrequencyRangeSlider
                          key={frame.id}
                          label={label}
                          minFreq={min}
                          maxFreq={max}
                          visibleMin={visibleMin}
                          visibleMax={visibleMax}
                          sampleRateMHz={
                            typeof sampleRateMHz === "number"
                              ? sampleRateMHz /
                              (activeSignalArea === label ? vizZoom : 1)
                              : null
                          }
                          limitMarkers={limitMarkers}
                          isActive={activeSignalArea === label}
                          onActivate={() => onSignalAreaChange?.(label)}
                          onRangeChange={(range) => {
                            if (
                              activeSignalArea === label &&
                              vizZoom > 1 &&
                              frequencyRange
                            ) {
                              const visualCenter = (range.min + range.max) / 2;
                              const hardwareSpan =
                                typeof sampleRateMHz === "number"
                                  ? Math.min(sampleRateMHz, span)
                                  : span;
                              const halfHardware = hardwareSpan / 2;
                              const currentHardwareCenter =
                                (frequencyRange.min + frequencyRange.max) / 2;
                              const halfVisualSpan = hardwareSpan / (2 * vizZoom);
                              const maxPan = halfHardware - halfVisualSpan;

                              const desiredPan =
                                visualCenter - currentHardwareCenter;

                              if (Math.abs(desiredPan) <= maxPan + 0.001) {
                                // Pan is within hardware bounds — just update pan offset
                                if (onVizPanChange) onVizPanChange(desiredPan);
                              } else {
                                // Pan exceeds hardware bounds — retune hardware to reach the edge
                                let newHardwareCenter = visualCenter;
                                let newHardwareMin =
                                  newHardwareCenter - halfHardware;
                                let newHardwareMax =
                                  newHardwareCenter + halfHardware;

                                // Clamp hardware range to signal area bounds
                                if (newHardwareMin < min) {
                                  newHardwareMin = min;
                                  newHardwareMax = min + hardwareSpan;
                                }
                                if (newHardwareMax > max) {
                                  newHardwareMax = max;
                                  newHardwareMin = max - hardwareSpan;
                                }
                                newHardwareCenter =
                                  (newHardwareMin + newHardwareMax) / 2;

                                // Retune hardware
                                handleRangeChange(label, {
                                  min: newHardwareMin,
                                  max: newHardwareMax,
                                });

                                // Set remaining pan offset relative to new hardware center
                                const remainingPan =
                                  visualCenter - newHardwareCenter;
                                if (onVizPanChange) onVizPanChange(remainingPan);
                              }
                            } else {
                              handleRangeChange(label, range);
                            }
                          }}
                          isDeviceConnected={deviceState === "connected"}
                          externalFrequencyRange={externalFreqRange}
                        />
                      );
                    })
                  ) : (
                    <div style={{ fontSize: "11px", color: "#666" }}>
                      Signal configuration loading...
                    </div>
                  )}
                </div>
              </Section>

              <SignalFeaturesSection />

              <SignalDisplaySection
                sourceMode={sourceMode}
                maxSampleRate={maxSampleRate}
                fileCapturedRange={fileCapturedRange}
                fftFrameRate={fftFrameRate}
                maxFrameRate={maxFrameRate}
                fftSize={fftSize}
                fftSizeOptions={fftSizeOptions}
                fftWindow={fftWindow}
                temporalResolution={displayTemporalResolution || "medium"}
                autoFftOptions={autoFftOptions || null}
                backend={backend}
                deviceProfile={deviceProfile}
                powerScale={state.powerScale}
                onFftFrameRateChange={setFftFrameRate}
                onFftSizeChange={setFftSize}
                onFftWindowChange={setFftWindow}
                onTemporalResolutionChange={
                  onDisplayTemporalResolutionChange || (() => { })
                }
                onPowerScaleChange={(powerScale) =>
                  dispatch({ type: "SET_POWER_SCALE", powerScale })
                }
                scheduleCoupledAdjustment={scheduleCoupledAdjustment}
              />

              <SourceSettingsSection
                sourceMode={sourceMode}
                gain={gain}
                ppm={ppm}
                tunerAGC={tunerAGC}
                rtlAGC={rtlAGC}
                stitchSourceSettings={stitchSourceSettings}
                isConnected={isConnected}
                disableAgcControls={isMockLiveSource}
                onGainChange={setGain}
                onPpmChange={setPpm}
                onTunerAGCChange={setTunerAGC}
                onRtlAGCChange={setRtlAGC}
                onStitchSourceSettingsChange={onStitchSourceSettingsChange}
                onAgcModeChange={() => { }}
              />
            </>
          )}
        </>
      )}
      {captureStatus?.status === "started" && (
        <CapturingIndicator>
          <CapturingDot />
          Capturing...
        </CapturingIndicator>
      )}
    </SidebarContent>
  );
};

export default Sidebar;
