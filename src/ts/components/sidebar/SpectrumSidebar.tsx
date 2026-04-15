import React, { useMemo, useState, useEffect, useCallback, memo } from "react";
import styled from "styled-components";
import { Unplug } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@n-apt/redux";
import { getSupportedSnapshotVideoFormat, type SnapshotVideoFormat, type SnapshotAspectRatio } from "@n-apt/hooks/useSnapshot";
import {
  setSourceMode,
  setSelectedFiles,
  triggerStitch,
  clearWaterfall,
  setStitchPaused,
  setFftFrameRate as setFftFrameRateAction,
  setTemporalResolution,
  setPowerScale,
  setSdrSettingsBundle,
  setStitchSourceSettings as setStitchSourceSettingsAction,
  setCaptureStatus,
  setDisplayMode,
  setFftWindow as setFftWindowAction,
} from "@n-apt/redux";
import { setSnapshotGrid as setSettingsSnapshotGrid } from "@n-apt/redux";
import {
  sendRestartDevice,
  sendCaptureCommand,
  sendCaptureStopCommand,
} from "@n-apt/redux/thunks/websocketThunks";
import { deriveStateFromConfig, useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/hooks/useGeolocation";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import type {
  CaptureRequest,
  CaptureFileType,
} from "@n-apt/consts/schemas/websocket";
import { type GeolocationData } from "@n-apt/consts/schemas/websocket";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import FileSelectionSidebar from "@n-apt/components/sidebar/FileSelectionSidebar";
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
import { Button } from "@n-apt/components/ui/Button";
import { ThemeSection } from "@n-apt/components/sidebar/ThemeSection";
import { Channels } from "@n-apt/components/sidebar/Channels";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import { usePrompt } from "@n-apt/components/ui/PromptProvider";
import { fileRegistry } from "@n-apt/utils/fileRegistry";

const SidebarContent = memo(styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px 24px 24px;
  box-sizing: border-box;
  max-width: 100%;
`);

const Section = memo(styled.div<{ $marginBottom?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: ${({ $marginBottom }) => $marginBottom || "0"};
  box-sizing: border-box;
  width: 100%;
`);

const SectionTitle = memo(styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props: any) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
`);

const SectionIcon = memo(styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: ${(props: any) => props.theme.metadataLabel};
`);

const SectionText = memo(styled.span`
  display: flex;
  align-items: center;
`);

const ResetButton = memo(styled(Button)`
  width: 100%;
  border: 1px solid ${(props) => props.theme.borderHover};
`);

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
  const dispatch = useAppDispatch();
  const {
    state: liveState,
    dispatch: storeDispatch,
    effectiveFrames,
    effectiveSdrSettings,
    sampleRateHzEffective,
    wsConnection,
    manualVisualizerPaused,
    toggleVisualizerPause: toggleLiveVisualizerPause,
    cryptoCorrupted: liveCryptoCorrupted,
    deviceName: liveDeviceName,
    deviceProfile: liveDeviceProfile,
  } = useSpectrumStore();

  // Get state from Redux
  const {
    frequencyRange,
    activeSignalArea,
    fftSize,
    fftWindow,
    fftFrameRate,
    gain,
    ppm,
    tunerAGC,
    rtlAGC,
    displayTemporalResolution,
    powerScale,
    sampleRateHz,
    sourceMode,
    selectedFiles,
    stitchStatus,
    isStitchPaused,
    snapshotGridPreference,
    vizZoom,
    vizPanOffset,
    displayMode,
  } = liveState;

  const isConnected = useAppSelector((s) => s.websocket.isConnected);
  const connectionStatus = useAppSelector((s) => s.websocket.connectionStatus);
  const deviceState = useAppSelector((s) => s.websocket.deviceState);
  const deviceLoadingReason = useAppSelector((s) => s.websocket.deviceLoadingReason);
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const deviceName = useAppSelector((s) => s.websocket.deviceName);
  const deviceProfile = useAppSelector((s) => s.websocket.deviceProfile);
  const maxSampleRateHz = useAppSelector((s) => s.websocket.maxSampleRateHz);
  const captureStatus = useAppSelector((s) => s.websocket.captureStatus);
  const autoFftOptions = useAppSelector((s) => s.websocket.autoFftOptions);
  const spectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
  const backend = useAppSelector((s) => s.websocket.backend);
  const sdrSettings = useAppSelector((s) => s.websocket.sdrSettings);

  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();
  const { getLocation } = useGeolocation();

  const liveBackend = wsConnection.backend ?? backend;
  const liveDeviceState = wsConnection.deviceState ?? deviceState;
  const liveDeviceLoadingReason =
    wsConnection.deviceLoadingReason ?? deviceLoadingReason;
  const liveIsConnected = wsConnection.isConnected ?? isConnected;
  const liveIsPaused = manualVisualizerPaused ?? wsConnection.isPaused ?? isPaused;
  const liveCaptureStatus = wsConnection.captureStatus ?? captureStatus;
  const liveAutoFftOptions = wsConnection.autoFftOptions ?? autoFftOptions;
  const liveFramesToUse = effectiveFrames.length > 0 ? effectiveFrames : spectrumFrames;
  const liveSdrSettingsToUse = effectiveSdrSettings ?? sdrSettings;
  const liveDeviceNameToUse = liveDeviceName ?? wsConnection.deviceName ?? deviceName;
  const liveDeviceProfileToUse =
    liveDeviceProfile ?? wsConnection.deviceProfile ?? deviceProfile;
  const isMockLiveSource =
    sourceMode === "live" &&
    (liveBackend?.toLowerCase().includes("mock") ||
      liveDeviceNameToUse?.toLowerCase().includes("mock"));
  const maxSampleRate =
    sampleRateHzEffective ??
    sampleRateHz ??
    maxSampleRateHz ??
    liveSdrSettingsToUse?.sample_rate ??
    0;
  const sampleRateMHz = maxSampleRate ? maxSampleRate / 1_000_000 : null;
  const isServerConnected = useMemo(
    () =>
      liveIsConnected ||
      connectionStatus === "connected" ||
      connectionStatus === "reconnecting",
    [liveIsConnected, connectionStatus],
  );

  const sendLiveSettings = useCallback(
    (settings: {
      fftSize?: number;
      fftWindow?: string;
      frameRate?: number;
      gain?: number;
      ppm?: number;
      tunerAGC?: boolean;
      rtlAGC?: boolean;
    }) => {
      if (sourceMode !== "live") return;
      wsConnection.sendSettings(settings);
    },
    [sourceMode, wsConnection],
  );

  const {
    maxFrameRate,
    fftSizeOptions,
    setFftSize,
    setFftFrameRate,
    setGain,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    scheduleCoupledAdjustment,
  } = useSdrSettings({
    maxSampleRate,
    sdrSettings: liveSdrSettingsToUse,
    spectrumStateOverride: {
      fftSize,
      fftWindow,
      fftFrameRate,
      gain,
      ppm,
      tunerAGC,
      rtlAGC,
    },
    onSettingsChange: (settings) => {
      if (settings.frameRate !== undefined) {
        dispatch(setFftFrameRateAction(settings.frameRate));
        storeDispatch({
          type: "SET_FFT_FRAME_RATE",
          fftFrameRate: settings.frameRate,
        });
      }
      storeDispatch({
        type: "SET_SDR_SETTINGS_BUNDLE",
        settings: {
          ...(settings.fftSize !== undefined ? { fftSize: settings.fftSize } : {}),
          ...(settings.fftWindow !== undefined ? { fftWindow: settings.fftWindow } : {}),
          ...(settings.frameRate !== undefined ? { fftFrameRate: settings.frameRate } : {}),
          ...(settings.gain !== undefined ? { gain: settings.gain } : {}),
          ...(settings.ppm !== undefined ? { ppm: settings.ppm } : {}),
          ...(settings.tunerAGC !== undefined ? { tunerAGC: settings.tunerAGC } : {}),
          ...(settings.rtlAGC !== undefined ? { rtlAGC: settings.rtlAGC } : {}),
        },
      });
      sendLiveSettings(settings);
    },
  });

  useEffect(() => {
    if (!liveSdrSettingsToUse) return;
    const derived = deriveStateFromConfig(maxSampleRate, liveSdrSettingsToUse);
    const nextSettings = {
      ...(typeof derived.gain === "number" ? { gain: derived.gain } : {}),
      ...(typeof derived.ppm === "number" ? { ppm: derived.ppm } : {}),
      ...(typeof derived.tunerAGC === "boolean"
        ? { tunerAGC: derived.tunerAGC }
        : {}),
      ...(typeof derived.rtlAGC === "boolean" ? { rtlAGC: derived.rtlAGC } : {}),
      ...(typeof liveState.fftSize !== "number" || liveState.fftSize <= 0
        ? { fftSize: derived.fftSize }
        : {}),
      ...(typeof liveState.fftFrameRate !== "number" || liveState.fftFrameRate <= 0
        ? { fftFrameRate: derived.fftFrameRate }
        : {}),
      ...(!liveState.fftWindow ? { fftWindow: derived.fftWindow } : {}),
    };
    dispatch(setSdrSettingsBundle(nextSettings));
    storeDispatch({
      type: "SET_SDR_SETTINGS_BUNDLE",
      settings: nextSettings,
    });
  }, [
    dispatch,
    maxSampleRate,
    liveSdrSettingsToUse,
    storeDispatch,
    liveState.fftSize,
    liveState.fftFrameRate,
    liveState.fftWindow,
  ]);

  useEffect(() => {
    if (liveState.isAutoFftApplied) return;
    if (
      !liveAutoFftOptions ||
      typeof liveAutoFftOptions.recommended !== "number"
    ) {
      return;
    }

    setFftSize(liveAutoFftOptions.recommended);
    scheduleCoupledAdjustment(
      "fftSize",
      liveAutoFftOptions.recommended,
      fftFrameRate,
    );
    storeDispatch({ type: "SET_AUTO_FFT_APPLIED", applied: true });
  }, [
    liveAutoFftOptions,
    setFftSize,
    scheduleCoupledAdjustment,
    fftFrameRate,
    liveState.isAutoFftApplied,
    storeDispatch,
  ]);

  // Capture UI state
  const showPrompt = usePrompt();
  const [activeCaptureAreas, setActiveCaptureAreas] = useState<string[]>(["Onscreen"]);
  const [acquisitionMode, setAcquisitionMode] = useState<"stepwise" | "interleaved" | "whole_sample">("stepwise");
  const [captureDurationMode, setCaptureDurationMode] = useState<"timed" | "manual">("timed");
  const [captureDurationS, setCaptureDurationS] = useState(1);
  const [captureFileTypeState, setCaptureFileTypeState] =
    useState<CaptureFileType>(".napt");
  const [captureEncrypted, setCaptureEncrypted] = useState(true);
  const [capturePlayback, setCapturePlayback] = useState(false);
  const [captureGeolocation, setCaptureGeolocation] = useState(false);

  // Snapshot UI state
  const [snapshotWhole, setSnapshotWhole] = useState(false);
  const [snapshotShowWaterfall, setSnapshotShowWaterfall] = useState(false);
  const [snapshotShowStats, setSnapshotShowStats] = useState(true);
  const [snapshotShowGeolocation, setSnapshotShowGeolocation] = useState(false);
  const [snapshotGeolocationError, setSnapshotGeolocationError] = useState<string | null>(null);
  const [snapshotGeolocationPosition, setSnapshotGeolocationPosition] = useState<{ lat: string, lon: string } | null>(null);
  const supportedSnapshotVideoFormat = useMemo(
    () => getSupportedSnapshotVideoFormat(),
    [],
  );
  const [snapshotFormat, setSnapshotFormat] = useState<"png" | "svg" | SnapshotVideoFormat>("png");
  const [snapshotAspectRatio, setSnapshotAspectRatio] = useState<SnapshotAspectRatio>("default");

  // NAPT metadata state
  const [naptMetadata, setNaptMetadata] = useState<NaptMetadata | null>(null);
  const [naptMetadataError, setNaptMetadataError] = useState<string | null>(
    null,
  );

  // Handle Playback after capture
  useEffect(() => {
    if (
      liveCaptureStatus?.status === "done" &&
      capturePlayback &&
      liveCaptureStatus.downloadUrl
    ) {
      const run = async () => {
        try {
          // 1. Switch to file mode
          dispatch(setSourceMode("file"));
          storeDispatch({ type: "SET_SOURCE_MODE", mode: "file" });
          dispatch(setSelectedFiles([]));
          storeDispatch({ type: "SET_SELECTED_FILES", files: [] });
          dispatch(clearWaterfall());

          // 3. Fetch the file
          const url = liveCaptureStatus.downloadUrl
            ? `${liveCaptureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`
            : undefined;
          if (!url) throw new Error("Missing capture download URL");
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status} `);
          const blob = await response.blob();
          const filename = liveCaptureStatus.filename || "capture.napt";
          const file = new File([blob], filename, {
            type: "application/octet-stream",
          });

          // 4. Update selected files
          const id = fileRegistry.register(file);
          const serializedFile = {
            id,
            name: filename,
            downloadUrl: liveCaptureStatus.downloadUrl
          };

          dispatch(setSelectedFiles([serializedFile]));
          storeDispatch({
            type: "SET_SELECTED_FILES",
            files: [serializedFile],
          });

          // 5. Trigger stitching/playback
          setTimeout(() => {
            dispatch(triggerStitch());
            storeDispatch({ type: "TRIGGER_STITCH" });
          }, 500);
        } catch (e) {
          console.error("Playback after capture failed:", e);
        }
      };
      run();
    }
  }, [liveCaptureStatus, capturePlayback, sessionToken, dispatch, storeDispatch]);

  // Toggle visualizer pause
  const toggleVisualizerPause = useCallback(() => {
    toggleLiveVisualizerPause();
  }, [toggleLiveVisualizerPause]);

  // Memoized values for sections
  const selectedPrimaryFile = useMemo(() => {
    if (sourceMode !== "file") return null;
    if (selectedFiles.length !== 1) return null;
    const f = selectedFiles[0];
    const lower = f.name.toLowerCase();
    return lower.endsWith(".napt") || lower.endsWith(".wav") ? f : null;
  }, [sourceMode, selectedFiles]);

  // Initial paused state for file mode - always reset to paused when entering file mode
  useEffect(() => {
    if (sourceMode === "file") {
      dispatch(setStitchPaused(true));
      storeDispatch({ type: "SET_STITCH_PAUSED", paused: true });
    }
  }, [sourceMode, dispatch, storeDispatch]);

  const fileCapturedRange = useMemo(() => {
    if (sourceMode !== "file" || selectedFiles.length === 0)
      return null;
    let minFreq = Infinity;
    let maxFreq = -Infinity;

    // If we have metadata for a single file, use that
    if (selectedFiles.length === 1 && naptMetadata) {
      const freq =
        (naptMetadata.center_frequency_hz ||
          naptMetadata.center_frequency ||
          0) / 1_000_000;
      const sampleRate =
        (naptMetadata.capture_sample_rate_hz ||
          naptMetadata.sample_rate_hz ||
          naptMetadata.sample_rate ||
          0) / 1_000_000;
      minFreq = freq - sampleRate / 2;
      maxFreq = freq + sampleRate / 2;
    }

    // Fallback to filename parsing
    for (const f of selectedFiles) {
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
  }, [sourceMode, selectedFiles, naptMetadata]);

  const visibleOnscreenRange = useMemo(() => {
    if (!frequencyRange) {
      if (
        typeof liveSdrSettingsToUse?.center_frequency === "number" &&
        typeof liveSdrSettingsToUse?.sample_rate === "number"
      ) {
        const centerMHz = liveSdrSettingsToUse.center_frequency / 1_000_000;
        const hardwareSpanMHz = liveSdrSettingsToUse.sample_rate / 1_000_000;
        return {
          min: centerMHz - hardwareSpanMHz / 2,
          max: centerMHz + hardwareSpanMHz / 2,
        };
      }
      return null;
    }

    const activeFrame =
      liveFramesToUse.find(
        (frame) =>
          frame.label.toLowerCase() === (activeSignalArea ?? "").toLowerCase(),
      ) ?? liveFramesToUse[0];

    const fallbackSpan = frequencyRange.max - frequencyRange.min;
    const hardwareMin = activeFrame?.min_mhz ?? frequencyRange.min;
    const hardwareMax = activeFrame?.max_mhz ?? frequencyRange.max;
    const hardwareSpan =
      typeof sampleRateMHz === "number" && Number.isFinite(sampleRateMHz)
        ? Math.min(sampleRateMHz, Math.max(0, hardwareMax - hardwareMin || fallbackSpan))
        : Math.max(0, hardwareMax - hardwareMin || fallbackSpan);

    const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;
    if (safeZoom <= 1 || hardwareSpan <= 0) {
      const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
      const halfHardware = hardwareSpan / 2;
      return {
        min: Math.max(hardwareMin, hardwareCenter - halfHardware),
        max: Math.min(hardwareMax, hardwareCenter + halfHardware),
      };
    }

    const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const visualSpan = Math.min(hardwareSpan, hardwareSpan / safeZoom);
    const halfVisualSpan = visualSpan / 2;
    const boundedCenter = Math.max(
      hardwareMin + halfVisualSpan,
      Math.min(hardwareMax - halfVisualSpan, hardwareCenter + vizPanOffset),
    );

    return {
      min: Math.max(hardwareMin, boundedCenter - halfVisualSpan),
      max: Math.min(hardwareMax, boundedCenter + halfVisualSpan),
    };
  }, [
    frequencyRange,
    liveSdrSettingsToUse,
    liveFramesToUse,
    activeSignalArea,
    vizZoom,
    vizPanOffset,
  ]);

  const availableCaptureAreas = useMemo(() => {
    const areas: Array<{ label: string; min: number; max: number }> = [];
    if (visibleOnscreenRange) {
      areas.push({
        label: "Onscreen",
        min: visibleOnscreenRange.min,
        max: visibleOnscreenRange.max,
      });
    } else if (
      typeof liveSdrSettingsToUse?.center_frequency === "number" &&
      typeof liveSdrSettingsToUse?.sample_rate === "number"
    ) {
      const centerMHz = liveSdrSettingsToUse.center_frequency / 1_000_000;
      const spanMHz = liveSdrSettingsToUse.sample_rate / 1_000_000;
      areas.push({
        label: "Onscreen",
        min: centerMHz - spanMHz / 2,
        max: centerMHz + spanMHz / 2,
      });
    }
    if (Array.isArray(liveFramesToUse)) {
      liveFramesToUse.forEach((frame) => {
        areas.push({
          label: frame.label,
          min: frame.min_mhz,
          max: frame.max_mhz,
        });
      });
    }
    return areas;
  }, [visibleOnscreenRange, liveFramesToUse, liveSdrSettingsToUse]);

  const activeFragments = useMemo(() => {
    return availableCaptureAreas
      .filter((a) => activeCaptureAreas.includes(a.label))
      .map((a) => ({ minFreq: a.min, maxFreq: a.max }));
  }, [availableCaptureAreas, activeCaptureAreas]);

  const captureRange = useMemo(() => {
    const segments = availableCaptureAreas.filter((a) =>
      activeCaptureAreas.includes(a.label)
    );
    if (segments.length === 0 && visibleOnscreenRange) {
      return {
        min: visibleOnscreenRange.min,
        max: visibleOnscreenRange.max,
        segments: [],
      };
    }
    if (segments.length === 0) {
      return { min: 0, max: 0, segments: [] };
    }
    const mins = segments.map((s) => s.min);
    const maxs = segments.map((s) => s.max);
    return {
      min: Math.min(...mins),
      max: Math.max(...maxs),
      segments,
    };
  }, [availableCaptureAreas, activeCaptureAreas, visibleOnscreenRange]);

  // Handlers
  const handleStopCapture = useCallback(() => {
    dispatch(sendCaptureStopCommand(liveCaptureStatus?.jobId));
  }, [dispatch, liveCaptureStatus?.jobId]);

  const handleCapture = useCallback(async () => {
    if (!isServerConnected || liveDeviceState === "loading" || !isAuthenticated) return;

    // Clear previous capture status before starting new one
    dispatch(setCaptureStatus(null));

    // Default to the overall range if no active fragments
    let fragments = activeFragments;
    if (fragments.length === 0 && visibleOnscreenRange) {
      fragments = [
        {
          minFreq: visibleOnscreenRange.min,
          maxFreq: visibleOnscreenRange.max,
        },
      ];
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

    const onscreenIsActive = activeCaptureAreas.includes("Onscreen");
    const onscreenSpan = visibleOnscreenRange
      ? visibleOnscreenRange.max - visibleOnscreenRange.min
      : 0;
    const hardwareSampleRateMHz = maxSampleRate / 1_000_000;
    const effectiveAcquisitionMode =
      onscreenIsActive &&
        hardwareSampleRateMHz > 0 &&
        Math.abs(onscreenSpan - hardwareSampleRateMHz) < 0.01
        ? "whole_sample"
        : acquisitionMode;

    const req: CaptureRequest = {
      jobId: `cap_${Date.now()} `,
      fragments,
      durationMode: captureDurationMode,
      durationS: Math.max(1, Math.round(captureDurationS)),
      fileType: captureFileTypeState,
      acquisitionMode: effectiveAcquisitionMode,
      encrypted: captureFileTypeState === ".napt" ? true : captureEncrypted,
      fftSize,
      fftWindow,
      geolocation: geolocationData,
    };
    dispatch(sendCaptureCommand(req));
  }, [
    isServerConnected,
    liveDeviceState,
    isAuthenticated,
    activeFragments,
    activeCaptureAreas,
    visibleOnscreenRange,
    captureDurationMode,
    captureDurationS,
    captureFileTypeState,
    acquisitionMode,
    maxSampleRate,
    captureEncrypted,
    captureGeolocation,
    fftSize,
    fftWindow,
    dispatch,
    getLocation,
  ]);

  const handleSnapshot = () => {
    window.dispatchEvent(
      new CustomEvent("napt-snapshot", {
        detail: {
          whole: snapshotWhole,
          showWaterfall: snapshotShowWaterfall,
          showStats: snapshotShowStats,
          showGeolocation: snapshotShowGeolocation && snapshotShowStats,
          geolocation: snapshotGeolocationPosition,
          format: snapshotFormat,
          grid: snapshotGridPreference,
          aspectRatio: snapshotAspectRatio,
          fileTimestamp: sourceMode === "file" && naptMetadata?.timestamp_utc
            ? naptMetadata.timestamp_utc
            : undefined,
        },
      }),
    );
  };

  const handleSnapshotGeolocationToggle = useCallback((enabled: boolean) => {
    if (!enabled) {
      setSnapshotShowGeolocation(false);
      setSnapshotGeolocationError(null);
      return;
    }

    // Pre-flight check
    if (!navigator.geolocation) {
      setSnapshotGeolocationError("Not supported by browser");
      return;
    }

    setSnapshotShowGeolocation(true);
    setSnapshotGeolocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Success - we have permission and it works
        setSnapshotGeolocationPosition({
          lat: pos.coords.latitude.toFixed(6),
          lon: pos.coords.longitude.toFixed(6)
        });
        setSnapshotGeolocationError(null);
      },
      (err) => {
        // Map specific technical errors to user-friendly messages
        let msg = err.message || "Permission denied";
        if (msg.includes("kCLErrorLocationUnknown")) {
          msg = "Location currently unavailable (System error)";
        } else if (err.code === 1) {
          msg = "Permission denied (User blocked)";
        } else if (err.code === 2) {
          msg = "Position unavailable (Check GPS/Network)";
        } else if (err.code === 3) {
          msg = "Timeout fetching location";
        }

        setSnapshotGeolocationError(msg);
        setSnapshotShowGeolocation(false);
        setSnapshotGeolocationPosition(null);
      },
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false }
    );
  }, []);

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
        const fileObj = fileRegistry.get(selectedPrimaryFile.id);
        if (!fileObj) throw new Error("File not found in registry");

        const buf = await fileObj.arrayBuffer();

        if (isNapt && aesKey) {
          // Read up to 8192 bytes to cover both 2048 and 4096-byte padded headers
          const maxHeaderRead = Math.min(8192, buf.byteLength);
          const headerBytes = new Uint8Array(buf, 0, maxHeaderRead);
          const newlineIdx = headerBytes.indexOf(10); // Find newline terminator

          // Robust parsing: try newline first, then JSON boundary detection
          let jsonStr: string;
          if (newlineIdx > 0) {
            jsonStr = new TextDecoder().decode(headerBytes.slice(0, newlineIdx));
          } else {
            // Fallback: find the closing brace of the root JSON object
            const headerText = new TextDecoder().decode(headerBytes);
            let braceDepth = 0;
            let inString = false;
            let escape = false;
            let jsonEnd = -1;
            for (let ci = 0; ci < headerText.length; ci++) {
              const c = headerText[ci];
              if (escape) { escape = false; continue; }
              if (c === '\\') { escape = true; continue; }
              if (c === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (c === '{') braceDepth++;
              if (c === '}') { braceDepth--; if (braceDepth === 0) { jsonEnd = ci + 1; break; } }
            }
            if (jsonEnd <= 0) throw new Error("Invalid NAPT header");
            jsonStr = headerText.slice(0, jsonEnd);
          }

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
            String.fromCharCode(...Array.from(new Uint8Array(buf, off, len)));

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

  const limitMarkers = useMemo(
    () => buildSdrLimitMarkers(liveSdrSettingsToUse),
    [liveSdrSettingsToUse],
  );

  const resetLiveControls = useCallback(() => {
    storeDispatch({ type: "RESET_LIVE_CONTROLS", fftSize, fftFrameRate });
  }, [storeDispatch, fftSize, fftFrameRate]);

  useEffect(() => {
    setActiveCaptureAreas((current) => {
      const validLabels = new Set(availableCaptureAreas.map((area) => area.label));
      const next = current.filter((label) => validLabels.has(label));
      return next.length > 0 ? next : (validLabels.has("Onscreen") ? ["Onscreen"] : next);
    });
  }, [availableCaptureAreas]);

  return (
    <SidebarContent>
      <Section>
        <SectionTitle $fileMode={sourceMode === "file"}>
          <SectionIcon>
            <Unplug size={14} />
          </SectionIcon>
          <SectionText>Source</SectionText>
        </SectionTitle>

        <SourceInput
          sourceMode={sourceMode}
          backend={liveBackend}
          deviceName={liveDeviceNameToUse}
          fileModeColor="var(--color-file-mode)"
          onSourceModeChange={(mode) => {
            dispatch(setSourceMode(mode));
            storeDispatch({ type: "SET_SOURCE_MODE", mode });
          }}
        />
      </Section>

      {sourceMode === "file" && (
        <>
          <FileSelectionSidebar
            selectedFiles={selectedFiles}
            onSelectedFilesChange={(files: { id: string; name: string; downloadUrl?: string }[]) => {
              dispatch(setSelectedFiles(files));
              storeDispatch({ type: "SET_SELECTED_FILES", files });
            }}
            stitchStatus={stitchStatus}
            isStitchPaused={isStitchPaused}
            onStitch={() => {
              dispatch(triggerStitch());
              storeDispatch({ type: "TRIGGER_STITCH" });
            }}
            onClear={() => {
              dispatch(setSelectedFiles([]));
              storeDispatch({ type: "SET_SELECTED_FILES", files: [] });
              dispatch(clearWaterfall());
            }}
            onStitchPauseToggle={() => {
              dispatch(setStitchPaused(!isStitchPaused));
              storeDispatch({ type: "SET_STITCH_PAUSED", paused: !isStitchPaused });
            }}
            selectedPrimaryFile={selectedPrimaryFile}
            naptMetadata={naptMetadata}
            naptMetadataError={naptMetadataError}
            sessionToken={sessionToken}
          />

          <SnapshotControlsSection
            snapshotWhole={snapshotWhole}
            snapshotShowWaterfall={snapshotShowWaterfall}
            snapshotShowStats={snapshotShowStats}
            snapshotShowGeolocation={snapshotShowGeolocation}
            snapshotGeolocationError={snapshotGeolocationError}
            snapshotFormat={snapshotFormat}
            supportedSnapshotVideoFormat={supportedSnapshotVideoFormat}
            snapshotGridPreference={snapshotGridPreference}
            snapshotAspectRatio={snapshotAspectRatio}
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotShowGeolocationChange={handleSnapshotGeolocationToggle}
            onSnapshotFormatChange={setSnapshotFormat}
            onSnapshotGridPreferenceChange={(pref) => {
              dispatch(setSettingsSnapshotGrid(pref));
              storeDispatch({ type: "SET_SNAPSHOT_GRID", preference: pref });
            }}
            onSnapshotAspectRatioChange={setSnapshotAspectRatio}
            onSnapshot={handleSnapshot}
            isFileMode={true}
            hasFileLoaded={!!selectedPrimaryFile}
          />
          <SignalDisplaySection
            sourceMode={sourceMode}
            maxSampleRate={maxSampleRate}
            fileCapturedRange={fileCapturedRange}
            fftFrameRate={4}
            maxFrameRate={4}
            fftSize={1024}
            fftSizeOptions={[1024]}
            fftWindow={fftWindow || "Rectangular"}
            temporalResolution={displayTemporalResolution}
            autoFftOptions={null}
            backend={null}
            deviceProfile={null}
            powerScale={powerScale}
            displayMode={displayMode || "fft"}
            onFftFrameRateChange={() => { }}
            onFftSizeChange={() => { }}
            onFftWindowChange={(win) => {
              dispatch(setFftWindowAction(win));
              storeDispatch({ type: "SET_FFT_WINDOW", fftWindow: win });
            }}
            onTemporalResolutionChange={(res) => {
              dispatch(setTemporalResolution(res));
              storeDispatch({ type: "SET_TEMPORAL_RESOLUTION", resolution: res });
            }}
            onPowerScaleChange={(ps) => {
              dispatch(setPowerScale(ps));
              storeDispatch({ type: "SET_POWER_SCALE", powerScale: ps });
            }}
            onDisplayModeChange={(mode) => {
              dispatch(setDisplayMode(mode));
              storeDispatch({ type: "SET_DISPLAY_MODE", displayMode: mode });
            }}
            scheduleCoupledAdjustment={() => { }}
          />
        </>
      )}

      {sourceMode === "live" && (
        <>
          <ConnectionStatusSection
            isConnected={isServerConnected}
            deviceState={liveDeviceState}
            deviceLoadingReason={liveDeviceLoadingReason}
            isPaused={liveIsPaused}
            cryptoCorrupted={liveCryptoCorrupted}
            onPauseToggle={toggleVisualizerPause}
            onRestartDevice={() => dispatch(sendRestartDevice())}
          />

          <Section>
            <ResetButton
              onClick={() => {
                showPrompt({
                  title: "Reset Options to Defaults?",
                  message: "Reset options like zoom, signal display, source settings and all other options to the app's default settings?",
                  confirmText: "Reset",
                  cancelText: "Cancel",
                  variant: "danger",
                  onConfirm: resetLiveControls,
                });
              }}
              title="Reset sidebar and visualizer options to defaults"
            >
              Reset Options to Defaults
            </ResetButton>
          </Section>

          <IQCaptureControlsSection
            activeCaptureAreas={activeCaptureAreas}
            availableCaptureAreas={availableCaptureAreas}
            captureDurationMode={captureDurationMode}
            captureDurationS={captureDurationS}
            captureFileType={captureFileTypeState}
            acquisitionMode={acquisitionMode}
            captureEncrypted={captureEncrypted}
            capturePlayback={capturePlayback}
            captureGeolocation={captureGeolocation}
            captureRange={captureRange}
            maxSampleRate={maxSampleRate}
            captureStatus={liveCaptureStatus}
            isConnected={isServerConnected}
            deviceState={liveDeviceState}
            onActiveCaptureAreasChange={setActiveCaptureAreas}
            onCaptureDurationModeChange={setCaptureDurationMode}
            onCaptureDurationSChange={setCaptureDurationS}
            onCaptureFileTypeChange={setCaptureFileTypeState}
            onAcquisitionModeChange={setAcquisitionMode}
            onCaptureEncryptedChange={setCaptureEncrypted}
            onCapturePlaybackChange={setCapturePlayback}
            onCaptureGeolocationChange={setCaptureGeolocation}
            onCapture={handleCapture}
            onStopCapture={handleStopCapture}
            onClearStatus={() => dispatch(setCaptureStatus(null))}
          />

          <SnapshotControlsSection
            snapshotWhole={snapshotWhole}
            snapshotShowWaterfall={snapshotShowWaterfall}
            snapshotShowStats={snapshotShowStats}
            snapshotShowGeolocation={snapshotShowGeolocation}
            snapshotGeolocationError={snapshotGeolocationError}
            snapshotFormat={snapshotFormat}
            supportedSnapshotVideoFormat={supportedSnapshotVideoFormat}
            snapshotGridPreference={snapshotGridPreference}
            snapshotAspectRatio={snapshotAspectRatio}
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotShowGeolocationChange={handleSnapshotGeolocationToggle}
            onSnapshotFormatChange={setSnapshotFormat}
            onSnapshotGridPreferenceChange={(pref) => {
              dispatch(setSettingsSnapshotGrid(pref));
              storeDispatch({ type: "SET_SNAPSHOT_GRID", preference: pref });
            }}
            onSnapshotAspectRatioChange={setSnapshotAspectRatio}
            onSnapshot={handleSnapshot}
          />

          <Channels
            variant="spectrum"
            fileMode={false}
            limitMarkers={limitMarkers}
          />

          <SignalDisplaySection
            sourceMode={sourceMode}
            maxSampleRate={maxSampleRate}
            fileCapturedRange={fileCapturedRange}
            fftFrameRate={fftFrameRate}
            maxFrameRate={maxFrameRate}
            fftSize={fftSize}
            fftSizeOptions={fftSizeOptions}
            fftWindow={fftWindow || "Rectangular"}
            temporalResolution={displayTemporalResolution}
            autoFftOptions={liveAutoFftOptions}
            backend={liveBackend}
            deviceProfile={liveDeviceProfileToUse}
            powerScale={powerScale}
            displayMode={displayMode || "fft"}
            onFftFrameRateChange={setFftFrameRate}
            onFftSizeChange={setFftSize}
            onFftWindowChange={(win) => {
              dispatch(setFftWindowAction(win));
              storeDispatch({ type: "SET_FFT_WINDOW", fftWindow: win });
            }}
            onTemporalResolutionChange={(res) => {
              dispatch(setTemporalResolution(res));
              storeDispatch({ type: "SET_TEMPORAL_RESOLUTION", resolution: res });
            }}
            onPowerScaleChange={(ps) => {
              dispatch(setPowerScale(ps));
              storeDispatch({ type: "SET_POWER_SCALE", powerScale: ps });
            }}
            onDisplayModeChange={(mode) => {
              dispatch(setDisplayMode(mode));
              storeDispatch({ type: "SET_DISPLAY_MODE", displayMode: mode });
            }}
            scheduleCoupledAdjustment={scheduleCoupledAdjustment}
          />

          <SourceSettingsSection
            sourceMode="live"
            ppm={ppm}
            gain={gain}
            tunerAGC={tunerAGC}
            rtlAGC={rtlAGC}
            stitchSourceSettings={{ gain: 0, ppm: 0 }}
            isConnected={isServerConnected}
            disableAgcControls={isMockLiveSource}
            onPpmChange={setPpm}
            onGainChange={setGain}
            onTunerAGCChange={setTunerAGC}
            onRtlAGCChange={setRtlAGC}
            onStitchSourceSettingsChange={(settings) => {
              dispatch(setStitchSourceSettingsAction(settings));
              storeDispatch({
                type: "SET_STITCH_SOURCE_SETTINGS",
                settings,
              });
            }}
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
