import React, { useState, useEffect, useMemo, useCallback } from "react";
import { getSupportedSnapshotVideoFormat, type SnapshotVideoFormat } from "@n-apt/hooks/useSnapshot";
import styled from "styled-components";
import FrequencyRangeSlider from "@n-apt/components/sidebar/FrequencyRangeSlider";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
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
import { GeolocationData } from "@n-apt/types/geolocation";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import SourceInput from "@n-apt/components/sidebar/SourceInput";

import { Row } from "@n-apt/components/ui";
import { ConnectionStatusSection, PauseButton } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { BodyAreasSection } from "@n-apt/components/sidebar/BodyAreasSection";
import { HotspotEditorSection } from "@n-apt/components/sidebar/HotspotEditorSection";
import { SignalFeaturesSection } from "@n-apt/components/sidebar/SignalFeaturesSection";

import FileProcessingSection from "@n-apt/components/sidebar/FileProcessingSection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import DrawSignalSidebar from "@n-apt/components/sidebar/DrawSignalSidebar";
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
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const AuthStatusText = styled.div<{ $status: string }>`
  color: ${(props) =>
    props.$status === "failed" || props.$status === "timeout"
      ? props.theme.danger
      : props.$status === "success"
        ? props.theme.primary
        : props.theme.textSecondary};
  font-size: 11px;
  font-weight: 500;
`;

const SettingValueText = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
`;

const LoadingText = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textMuted};
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
  onStopCaptureCommand?: () => void;
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
    format: "png" | "svg" | SnapshotVideoFormat;
    grid: boolean;
  }) => void;
  vizZoom?: number;
  vizPanOffset?: number;
  onVizPanChange?: (pan: number) => void;
  onClearCaptureStatus?: () => void;
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
  onStopCaptureCommand,
  spectrumFrames,
  activeTab,
  drawParams: _drawParams,
  onDrawParamsChange: _onDrawParamsChange,
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
  onClearCaptureStatus,
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
  const showPrompt = usePrompt();
  const [activeCaptureAreas, setActiveCaptureAreas] = useState<string[]>([
    "Onscreen",
  ]);
  const [acquisitionMode, setAcquisitionMode] = useState<
    "stepwise" | "interleaved" | "whole_sample"
  >("whole_sample");
  const [captureDurationMode, setCaptureDurationMode] = useState<"timed" | "manual">("timed");
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
  const [snapshotWhole, setSnapshotWhole] = useState(false);
  const [snapshotShowWaterfall, setSnapshotShowWaterfall] = useState(false);
  const [snapshotShowStats, setSnapshotShowStats] = useState(true);
  const supportedSnapshotVideoFormat = useMemo(
    () => getSupportedSnapshotVideoFormat(),
    [],
  );
  const [snapshotFormat, setSnapshotFormat] = useState<"png" | "svg" | SnapshotVideoFormat>(
    supportedSnapshotVideoFormat ?? "png",
  );

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
          const url = captureStatus.downloadUrl
            ? `${captureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`
            : undefined;
          if (!url) throw new Error("Missing capture download URL");
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

    const currentCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const hardwareSpanMHz =
      typeof maxSampleRate === "number" && Number.isFinite(maxSampleRate) && maxSampleRate > 0
        ? maxSampleRate / 1_000_000
        : frequencyRange.max - frequencyRange.min;
    const onscreenMin = currentCenter - hardwareSpanMHz / 2;
    const onscreenMax = currentCenter + hardwareSpanMHz / 2;

    const segments: Array<{ label: string; min: number; max: number }> = [];
    if (activeCaptureAreas.includes("Onscreen"))
      segments.push({
        label: "Onscreen",
        min: onscreenMin,
        max: onscreenMax,
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
        min: onscreenMin,
        max: onscreenMax,
      });
    }

    return {
      min: Math.min(...segments.map((r) => r.min)),
      max: Math.max(...segments.map((r) => r.max)),
      segments,
    };
  }, [
    frequencyRange,
    maxSampleRate,
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

    const captureRangeSpan = captureRange.max - captureRange.min;
    const hardwareSampleRateMHz = maxSampleRate / 1000000;
    const effectiveAcquisitionMode =
      activeCaptureAreas.includes("Onscreen") &&
        Math.abs(captureRangeSpan - hardwareSampleRateMHz) < 0.01
        ? "whole_sample"
        : acquisitionMode;

    const jobId = `cap_${Date.now()}`;
    const req: CaptureRequest = {
      jobId,
      fragments: captureRange.segments.map(s => ({ minFreq: s.min, maxFreq: s.max })),
      durationMode: captureDurationMode,
      durationS: captureDurationMode === "timed" ? Math.max(1, Math.round(Number(captureDurationS) || 1)) : undefined,
      fileType: captureFileTypeState,
      acquisitionMode: effectiveAcquisitionMode,
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
    acquisitionMode,
    captureDurationMode,
    activeCaptureAreas,
    captureEncrypted,
    captureGeolocation,
    captureFileTypeState,
    captureRange.max,
    captureRange.min,
    maxSampleRate,
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
          <DrawSignalSidebar
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
              fileModeColor="var(--color-file-mode)"
              onSourceModeChange={onSourceModeChange}
            />
          </Section>

          {sourceMode === "live" && (
            <IQCaptureControlsSection
              activeCaptureAreas={activeCaptureAreas}
              availableCaptureAreas={[
                {
                  label: "Onscreen",
                  min: captureRange.segments.find((segment) => segment.label === "Onscreen")?.min ?? 0,
                  max: captureRange.segments.find((segment) => segment.label === "Onscreen")?.max ?? 0,
                },
                ...((spectrumFrames || []).map(f => ({ label: f.label, min: f.min_mhz, max: f.max_mhz })))
              ]}
              acquisitionMode={acquisitionMode}
              captureDurationMode={captureDurationMode}
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
              onCaptureDurationModeChange={setCaptureDurationMode}
              onCaptureDurationSChange={setCaptureDurationS}
              onCaptureFileTypeChange={setCaptureFileType}
              onCaptureEncryptedChange={setCaptureEncrypted}
              onCapturePlaybackChange={setCapturePlayback}
              onCaptureGeolocationChange={setCaptureGeolocation}
              onCapture={handleCapture}
              onStopCapture={onStopCaptureCommand}
              onClearStatus={() => {
                if (onClearCaptureStatus) {
                  onClearCaptureStatus();
                } else {
                  dispatch({ type: 'SET_SDR_SETTINGS_BUNDLE', settings: { captureStatus: null } as any });
                }
              }}
            />
          )}

          <SnapshotControlsSection
            snapshotWhole={snapshotWhole}
            snapshotShowWaterfall={snapshotShowWaterfall}
            snapshotShowStats={snapshotShowStats}
            snapshotShowGeolocation={false}
            snapshotGeolocationError={null}
            snapshotFormat={snapshotFormat}
            supportedSnapshotVideoFormat={supportedSnapshotVideoFormat}
            snapshotGridPreference={snapshotGridPreference ?? true}
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotShowGeolocationChange={() => { }}
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
                selectedFiles={selectedFiles as any}
                onSelectedFilesChange={onSelectedFilesChange as any}
                stitchStatus={stitchStatus}
                isStitchPaused={isStitchPaused}
                onStitch={onStitch}
                onClear={onClear}
                onStitchPauseToggle={onStitchPauseToggle}
                selectedNaptFile={selectedNaptFile as any}
                naptMetadata={naptMetadata}
                naptMetadataError={naptMetadataError}
              />

            </>
          ) : (
            <>
              <Section>
                <SectionTitle>Channels</SectionTitle>
                <div style={{ display: "grid", gap: "16px", width: "100%", gridColumn: "1 / -1" }}>
                  {Array.isArray(spectrumFrames) && spectrumFrames.length > 0 ? (
                    spectrumFrames.map((frame) => {
                      const label = frame.label;
                      const min = frame.min_mhz;
                      const max = frame.max_mhz;
                      const span = max - min;

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
                        const hardwareCenter =
                          (frequencyRange.min + frequencyRange.max) / 2;
                        const hardwareSpan =
                          typeof sampleRateMHz === "number"
                            ? Math.min(sampleRateMHz, span)
                            : span;
                        const visualSpan = hardwareSpan / vizZoom;
                        const halfVisualSpan = visualSpan / 2;
                        let visualCenter = hardwareCenter + vizPanOffset;

                        visualCenter = Math.max(
                          min + halfVisualSpan,
                          Math.min(max - halfVisualSpan, visualCenter),
                        );

                        visibleMin = visualCenter - halfVisualSpan;
                        visibleMax = visualCenter + halfVisualSpan;
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
                                if (onVizPanChange) onVizPanChange(desiredPan);
                              } else {
                                let newHardwareCenter = visualCenter;
                                let newHardwareMin =
                                  newHardwareCenter - halfHardware;
                                let newHardwareMax =
                                  newHardwareCenter + halfHardware;

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

                                handleRangeChange(label, {
                                  min: newHardwareMin,
                                  max: newHardwareMax,
                                });

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
                    <LoadingText>
                      Signal configuration loading...
                    </LoadingText>
                  )}
                </div>
              </Section>

              <SignalFeaturesSection
                sourceMode={sourceMode ?? "live"}
                deviceState={deviceState ?? "disconnected"}
                isConnected={isConnected}
                selectedFilesCount={selectedFiles.length}
                heterodyningStatusText="Not verified"
                heterodyningVerifyDisabled={true}
                onVerifyHeterodyning={() => { }}
              />

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
    </SidebarContent>
  );
};

export default Sidebar;
