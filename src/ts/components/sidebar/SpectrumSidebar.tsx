import React, { useMemo, useState, useEffect, useCallback } from "react";
import styled, { useTheme } from "styled-components";
import { useSpectrumStore, SourceMode } from "@n-apt/hooks/useSpectrumStore";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/hooks/useGeolocation";

import type {
  CaptureRequest,
  CaptureStatus,
  CaptureFileType,
  GeolocationData,
} from "@n-apt/consts/schemas/websocket";

// Reuse existing section components
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import FileProcessingSection from "@n-apt/components/sidebar/FileProcessingSection";
import { SignalFeaturesSection } from "@n-apt/components/sidebar/SignalFeaturesSection";
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { ThemeSection } from "@n-apt/components/sidebar/ThemeSection";
import FrequencyRangeSlider from "@n-apt/components/sidebar/FrequencyRangeSlider";
import { formatFrequency } from "@n-apt/consts/sdr";
import { Row } from "@n-apt/components/ui";

const SidebarContent = styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: 0 24px 24px 24px;
  box-sizing: border-box;
  max-width: 100%;
`;

const CapturingIndicator = styled.div`
  position: fixed;
  top: 24px;
  right: 24px;
  background-color: ${(props) => props.theme.danger || "#ff4444"};
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

const Section = styled.div<{ $marginBottom?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: ${({ $marginBottom }) => $marginBottom || "0"};
  box-sizing: border-box;
  width: 100%;
`;

const SectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? props.theme.fileMode : props.theme.metadataLabel)};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
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
  min-width: 0;
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
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primaryAlpha};
  }

  option {
    background-color: ${(props) => props.theme.fftBackground || "#0a0a0a"};
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
  }
`;

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

export const SpectrumSidebar: React.FC = () => {
  const {
    state,
    dispatch,
    effectiveSdrSettings,
    sampleRateHzEffective,
    toggleVisualizerPause,
    cryptoCorrupted,
    effectiveFrames,
    wsConnection: {
      isConnected,
      deviceState,
      backend,
      deviceLoadingReason,
      maxSampleRateHz,
      captureStatus,
      autoFftOptions,
      sendSettings,
      sendCaptureCommand,
      sendRestartDevice,
      sendFrequencyRange,
    },
  } = useSpectrumStore();

  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();
  const { getLocation } = useGeolocation();
  const theme = useTheme();

  const maxSampleRate = sampleRateHzEffective ?? maxSampleRateHz ?? 0;
  const sampleRateMHz = sampleRateHzEffective
    ? sampleRateHzEffective / 1_000_000
    : null;

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
        dispatch({
          type: "SET_FFT_FRAME_RATE",
          fftFrameRate: settings.frameRate,
        });
      }
      sendSettings(settings);
    },
  });

  // Capture UI state
  const [captureOpen, setCaptureOpen] = useState(false);
  const [activeCaptureAreas, setActiveCaptureAreas] = useState<string[]>(["Onscreen"]);
  const [acquisitionMode, setAcquisitionMode] = useState<"stepwise" | "interleaved">("stepwise");
  const [captureDurationS, setCaptureDurationS] = useState(1);
  const [captureFileTypeState, setCaptureFileTypeState] =
    useState<CaptureFileType>(".napt");
  const [captureEncrypted, setCaptureEncrypted] = useState(true);
  const [capturePlayback, setCapturePlayback] = useState(false);
  const [captureGeolocation, setCaptureGeolocation] = useState(false);

  // Snapshot UI state
  const [snapshotOpen, setSnapshotOpen] = useState(false);
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
          dispatch({ type: "SET_SOURCE_MODE", mode: "file" });

          // 2. Clear existing files
          dispatch({ type: "SET_SELECTED_FILES", files: [] });
          dispatch({ type: "CLEAR_WATERFALL" });

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
          dispatch({
            type: "SET_SELECTED_FILES",
            files: [{ name: filename, file, downloadUrl: captureStatus.downloadUrl }],
          });

          // 5. Trigger stitching/playback
          setTimeout(() => {
            dispatch({ type: "TRIGGER_STITCH" });
          }, 500);
        } catch (e) {
          console.error("Playback after capture failed:", e);
        }
      };
      run();
    }
  }, [captureStatus, capturePlayback, sessionToken, dispatch]);

  // Memoized values for sections
  const selectedPrimaryFile = useMemo(() => {
    if (state.sourceMode !== "file") return null;
    if (state.selectedFiles.length !== 1) return null;
    const f = state.selectedFiles[0];
    const lower = f.name.toLowerCase();
    return lower.endsWith(".napt") || lower.endsWith(".wav") ? f : null;
  }, [state.sourceMode, state.selectedFiles]);

  // Initial paused state for file mode - always reset to paused when entering file mode
  useEffect(() => {
    if (state.sourceMode === "file") {
      dispatch({ type: "SET_STITCH_PAUSED", paused: true });
    }
  }, [state.sourceMode, dispatch]);

  const fileCapturedRange = useMemo(() => {
    if (state.sourceMode !== "file" || state.selectedFiles.length === 0)
      return null;
    let minFreq = Infinity;
    let maxFreq = -Infinity;

    // If we have metadata for a single file, use that
    if (state.selectedFiles.length === 1 && naptMetadata) {
      const freq =
        (naptMetadata.center_frequency_hz ||
          naptMetadata.center_frequency ||
          0) / 1_000_000;
      const sampleRate =
        (naptMetadata.capture_sample_rate_hz ||
          naptMetadata.sample_rate_hz ||
          naptMetadata.sample_rate ||
          0) / 1_000_000;
      if (sampleRate > 0) {
        return {
          min: Math.max(0, freq - sampleRate / 2),
          max: freq + sampleRate / 2,
        };
      }
    }

    // Fallback to filename parsing
    for (const f of state.selectedFiles) {
      const match = f.name.match(/iq_(\d+\.?\d*)MHz/);
      if (match) {
        const freq = parseFloat(match[1]);
        const sampleRate = sampleRateMHz ?? 3.2; // Use current sample rate or fallback
        minFreq = Math.min(minFreq, freq - sampleRate / 2);
        maxFreq = Math.max(maxFreq, freq + sampleRate / 2);
      }
    }
    return minFreq === Infinity
      ? null
      : { min: Math.max(0, minFreq), max: maxFreq };
  }, [state.sourceMode, state.selectedFiles, naptMetadata]);

  const availableCaptureAreas = useMemo(() => {
    const areas: Array<{ label: string; min: number; max: number }> = [];
    if (state.frequencyRange) {
      areas.push({
        label: "Onscreen",
        min: state.frequencyRange.min,
        max: state.frequencyRange.max,
      });
    }
    if (Array.isArray(effectiveFrames)) {
      effectiveFrames.forEach((frame) => {
        areas.push({
          label: frame.label,
          min: frame.min_mhz,
          max: frame.max_mhz,
        });
      });
    }
    return areas;
  }, [state.frequencyRange, effectiveFrames]);

  const activeFragments = useMemo(() => {
    return availableCaptureAreas
      .filter((a) => activeCaptureAreas.includes(a.label))
      .map((a) => ({ minFreq: a.min, maxFreq: a.max }));
  }, [availableCaptureAreas, activeCaptureAreas]);

  const captureRange = useMemo(() => {
    const segments = availableCaptureAreas.filter((a) =>
      activeCaptureAreas.includes(a.label)
    );
    if (segments.length === 0 && state.frequencyRange) {
      return {
        min: state.frequencyRange.min,
        max: state.frequencyRange.max,
        segments: [],
      };
    }
    const mins = segments.map((s) => s.min);
    const maxs = segments.map((s) => s.max);
    return {
      min: Math.min(...mins, state.frequencyRange?.min ?? Infinity),
      max: Math.max(...maxs, state.frequencyRange?.max ?? -Infinity),
      segments,
    };
  }, [availableCaptureAreas, activeCaptureAreas, state.frequencyRange]);

  // Handlers
  const handleCapture = useCallback(async () => {
    if (!isConnected || deviceState === "loading" || !isAuthenticated) return;

    // Default to the overall range if no active fragments
    let fragments = activeFragments;
    if (fragments.length === 0 && state.frequencyRange) {
      fragments = [{ minFreq: state.frequencyRange.min, maxFreq: state.frequencyRange.max }];
    }

    let geolocationData = undefined;
    if (captureFileTypeState === ".napt" && captureGeolocation) {
      try {
        const location = await getLocation();
        geolocationData = location || undefined;
      } catch (error) {
        console.warn("Failed to get geolocation for capture:", error);
        // Continue without geolocation if it fails
      }
    }

    const req: CaptureRequest = {
      jobId: `cap_${Date.now()}`,
      fragments,
      durationS: Math.max(1, Math.round(captureDurationS)),
      fileType: captureFileTypeState,
      acquisitionMode: acquisitionMode,
      encrypted: captureFileTypeState === ".napt" ? true : captureEncrypted,
      fftSize,
      fftWindow,
      geolocation: geolocationData,
    };
    sendCaptureCommand(req);
  }, [
    isConnected,
    deviceState,
    isAuthenticated,
    activeFragments,
    state.frequencyRange,
    captureDurationS,
    captureFileTypeState,
    acquisitionMode,
    captureEncrypted,
    captureGeolocation,
    fftSize,
    fftWindow,
    sendCaptureCommand,
    getLocation,
  ]);

  const handleSnapshot = () => {
    window.dispatchEvent(
      new CustomEvent("napt-snapshot", {
        detail: {
          whole: snapshotWhole,
          showWaterfall: snapshotShowWaterfall,
          showStats: snapshotShowStats,
          format: snapshotFormat,
          grid: state.snapshotGridPreference ?? true,
        },
      }),
    );
  };

  // NAPT/WAV Metadata Effect
  useEffect(() => {
    let cancelled = false;
    if (!selectedPrimaryFile) {
      setNaptMetadata(null);
      return;
    }

    const isNapt = selectedPrimaryFile.name.toLowerCase().endsWith(".napt");
    const isWav = selectedPrimaryFile.name.toLowerCase().endsWith(".wav");

    if (isNapt && !aesKey) {
      setNaptMetadata(null);
      setNaptMetadataError("Locked (no session key)");
      return;
    }

    const run = async () => {
      try {
        const buf = await selectedPrimaryFile.file.arrayBuffer();

        if (isNapt && aesKey) {
          // Read the first 2048 bytes (header size)
          const headerSize = Math.min(2048, buf.byteLength);
          const headerBytes = new Uint8Array(buf, 0, headerSize);
          const newlineIdx = headerBytes.indexOf(10); // Find newline terminator
          if (newlineIdx <= 0) throw new Error("Invalid NAPT header");

          const jsonStr = new TextDecoder().decode(
            headerBytes.slice(0, newlineIdx),
          );
          const metaObj = JSON.parse(jsonStr);

          if (!cancelled) {
            // The metadata object itself is inside `metadata` key
            const metadata = metaObj.metadata || metaObj;
            setNaptMetadata(metadata);
            setNaptMetadataError(null);
          }
        } else if (isWav) {
          // Parse WAV RIFF for nAPT chunk
          const view = new DataView(buf);
          const text = (off: number, len: number) =>
            String.fromCharCode(...new Uint8Array(buf, off, len));

          if (text(0, 4) === "RIFF" && text(8, 4) === "WAVE") {
            let offset = 12;
            let meta: any = null;
            while (offset + 8 <= buf.byteLength) {
              const chunkId = text(offset, 4);
              const chunkSize = view.getUint32(offset + 4, true);
              if (chunkId === "nAPT") {
                const metaBytes = new Uint8Array(buf, offset + 8, chunkSize);
                const nullIdx = metaBytes.indexOf(0);
                const jsonStr = new TextDecoder().decode(
                  nullIdx !== -1 ? metaBytes.slice(0, nullIdx) : metaBytes,
                );
                meta = JSON.parse(jsonStr);
                break;
              }
              offset += 8 + chunkSize + (chunkSize % 2);
            }
            if (!cancelled) {
              if (meta) {
                setNaptMetadata(meta);
                setNaptMetadataError(null);
              } else {
                setNaptMetadata(null);
                // No error, just no metadata found
              }
            }
          }
        }
      } catch (e: any) {
        if (!cancelled)
          setNaptMetadataError(e?.message || "Failed to read metadata");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedPrimaryFile, aesKey]);

  const limitMarkers = useMemo(() => {
    const limits = effectiveSdrSettings?.limits;
    if (!limits) return [];
    const markers: Array<{ freq: number; label: string }> = [];
    if (typeof limits.lower_limit_mhz === "number") {
      markers.push({
        freq: limits.lower_limit_mhz,
        label:
          limits.lower_limit_label ??
          `${formatFrequency(limits.lower_limit_mhz)} / Lower limit`,
      });
    }
    if (typeof limits.upper_limit_mhz === "number") {
      markers.push({
        freq: limits.upper_limit_mhz,
        label:
          limits.upper_limit_label ??
          `${formatFrequency(limits.upper_limit_mhz)} / Upper limit`,
      });
    }
    return markers;
  }, [effectiveSdrSettings?.limits]);

  const handleRangeChange = useCallback(
    (label: string, range: { min: number; max: number }) => {
      if (state.activeSignalArea === label) {
        dispatch({ type: "SET_FREQUENCY_RANGE", range });
        sendFrequencyRange(range);
      }
    },
    [state.activeSignalArea, dispatch, sendFrequencyRange],
  );

  return (
    <SidebarContent>
      {captureStatus?.status === "started" && (
        <CapturingIndicator>
          <CapturingDot />
          Capturing...
        </CapturingIndicator>
      )}
      <Section>
        <SectionTitle $fileMode={state.sourceMode === "file"}>
          Source
        </SectionTitle>
        <Row label="Input" tooltip="Select the signal source.">
          <SettingSelect
            value={state.sourceMode}
            onChange={(e) =>
              dispatch({
                type: "SET_SOURCE_MODE",
                mode: e.target.value as SourceMode,
              })
            }
            style={{ minWidth: "130px" }}
          >
            <option value="live">
              {backend === "rtl-sdr" || backend === "rtlsdr" || backend === "rtltcp" || backend === "rtl-tcp"
                ? "RTL-SDR"
                : backend?.includes("mock")
                  ? "Mock APT SDR"
                  : backend || "Mock SDR"}
            </option>
            <option value="file" style={{ color: theme.fileMode }}>
              File Selection
            </option>
          </SettingSelect>
        </Row>
      </Section>

      {state.sourceMode === "file" && (
        <Section>
          <FileProcessingSection
            selectedFiles={state.selectedFiles}
            onSelectedFilesChange={(files) =>
              dispatch({ type: "SET_SELECTED_FILES", files })
            }
            stitchStatus={state.stitchStatus}
            isStitchPaused={state.isStitchPaused}
            onStitch={() => dispatch({ type: "TRIGGER_STITCH" })}
            onClear={() => {
              dispatch({ type: "SET_SELECTED_FILES", files: [] });
              dispatch({ type: "CLEAR_WATERFALL" });
            }}
            onStitchPauseToggle={() =>
              dispatch({ type: "TOGGLE_STITCH_PAUSE" })
            }
            selectedNaptFile={selectedPrimaryFile}
            naptMetadata={naptMetadata}
            naptMetadataError={naptMetadataError}
            sessionToken={sessionToken}
          />
        </Section>
      )}

      {state.sourceMode === "live" && (
        <>
          <ConnectionStatusSection
            isConnected={isConnected}
            deviceState={deviceState}
            deviceLoadingReason={deviceLoadingReason}
            isPaused={state.visualizerPaused}
            cryptoCorrupted={cryptoCorrupted}
            onPauseToggle={toggleVisualizerPause}
            onRestartDevice={() => sendRestartDevice()}
          />

          <IQCaptureControlsSection
            isOpen={captureOpen}
            onToggle={() => setCaptureOpen(!captureOpen)}
            activeCaptureAreas={activeCaptureAreas}
            availableCaptureAreas={availableCaptureAreas}
            captureDurationS={captureDurationS}
            captureFileType={captureFileTypeState}
            acquisitionMode={acquisitionMode}
            captureEncrypted={captureEncrypted}
            capturePlayback={capturePlayback}
            captureGeolocation={captureGeolocation}
            captureRange={captureRange}
            maxSampleRate={maxSampleRate}
            captureStatus={captureStatus}
            isConnected={isConnected}
            deviceState={deviceState}
            onActiveCaptureAreasChange={setActiveCaptureAreas}
            onCaptureDurationSChange={setCaptureDurationS}
            onCaptureFileTypeChange={setCaptureFileTypeState}
            onAcquisitionModeChange={setAcquisitionMode}
            onCaptureEncryptedChange={setCaptureEncrypted}
            onCapturePlaybackChange={setCapturePlayback}
            onCaptureGeolocationChange={setCaptureGeolocation}
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
            onSnapshotGridPreferenceChange={(pref) =>
              dispatch({ type: "SET_SNAPSHOT_GRID", preference: pref })
            }
            onSnapshot={handleSnapshot}
          />

          <Section>
            <SectionTitle>Signal areas of interest</SectionTitle>
            <div style={{ display: "grid", gap: "16px", width: "100%", gridColumn: "1 / -1" }}>
              {Array.isArray(effectiveFrames) && effectiveFrames.length > 0 ? (
                effectiveFrames.map((frame) => {
                  const label = frame.label;
                  const min = frame.min_mhz;
                  const max = frame.max_mhz;
                  const span = max - min;

                  // If this is the active frame and we are zoomed in,
                  // calculate the visual range based on zoom and pan offset
                  // NOTE: Use frequencyRange (SDR center) not frame min/max for center calculation
                  const lastRange = state.lastKnownRanges[label];
                  let visibleMin = lastRange ? lastRange.min : min;
                  let visibleMax = lastRange
                    ? lastRange.max
                    : min +
                    (typeof sampleRateMHz === "number"
                      ? Math.min(sampleRateMHz, span)
                      : span);
                  let externalFreqRange =
                    state.activeSignalArea === label
                      ? (state.frequencyRange ?? undefined)
                      : undefined;

                  if (
                    state.activeSignalArea === label &&
                    state.vizZoom > 1 &&
                    state.frequencyRange
                  ) {
                    // Use frequencyRange (SDR tuned range) for center calculation
                    // This matches what FFTCanvas does
                    const hardwareCenter =
                      (state.frequencyRange.min + state.frequencyRange.max) / 2;
                    // Zoom applies to the hardware window width (sample rate), not the full signal area span
                    const hardwareSpan =
                      typeof sampleRateMHz === "number"
                        ? Math.min(sampleRateMHz, span)
                        : span;
                    const visualSpan = hardwareSpan / state.vizZoom;
                    const halfVisualSpan = visualSpan / 2;
                    // vizPanOffset is in MHz exactly
                    let visualCenter = hardwareCenter + state.vizPanOffset;

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
                          (state.activeSignalArea === label ? state.vizZoom : 1)
                          : null
                      }
                      limitMarkers={limitMarkers}
                      isActive={state.activeSignalArea === label}
                      onActivate={() =>
                        dispatch({ type: "SET_SIGNAL_AREA", area: label })
                      }
                      onRangeChange={(range: { min: number; max: number }) => {
                        if (
                          state.activeSignalArea === label &&
                          state.vizZoom > 1 &&
                          state.frequencyRange
                        ) {
                          const visualCenter = (range.min + range.max) / 2;
                          const hardwareSpan =
                            typeof sampleRateMHz === "number"
                              ? Math.min(sampleRateMHz, span)
                              : span;
                          const halfHardware = hardwareSpan / 2;
                          const currentHardwareCenter =
                            (state.frequencyRange.min +
                              state.frequencyRange.max) /
                            2;
                          const halfVisualSpan =
                            hardwareSpan / (2 * state.vizZoom);
                          const maxPan = halfHardware - halfVisualSpan;

                          const desiredPan = visualCenter - currentHardwareCenter;

                          if (Math.abs(desiredPan) <= maxPan + 0.001) {
                            // Pan is within hardware bounds — just update pan offset
                            dispatch({ type: "SET_VIZ_PAN", pan: desiredPan });
                          } else {
                            // Pan exceeds hardware bounds — retune hardware to reach the edge
                            let newHardwareCenter = visualCenter;
                            let newHardwareMin = newHardwareCenter - halfHardware;
                            let newHardwareMax = newHardwareCenter + halfHardware;

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
                            const remainingPan = visualCenter - newHardwareCenter;
                            dispatch({ type: "SET_VIZ_PAN", pan: remainingPan });
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
                <div
                  style={{ color: "#777", fontSize: "12px", fontStyle: "italic" }}
                >
                  No active signal areas
                </div>
              )}
            </div>
          </Section>

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
            onTemporalResolutionChange={(res) =>
              dispatch({ type: "SET_TEMPORAL_RESOLUTION", resolution: res })
            }
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
            onStitchSourceSettingsChange={(settings) =>
              dispatch({ type: "SET_STITCH_SOURCE_SETTINGS", settings })
            }
            onAgcModeChange={(tuner, rtl) => {
              setTunerAGC(tuner);
              setRtlAGC(rtl);
            }}
          />
        </>
      )}
      <ThemeSection />
    </SidebarContent>
  );
};

export default SpectrumSidebar;
