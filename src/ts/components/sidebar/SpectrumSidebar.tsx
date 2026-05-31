import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
} from "react";
import styled from "styled-components";
import { Trash2, Unplug } from "lucide-react";
import {
  useAppSelector,
  useAppDispatch,
  selectNoteCards,
  selectNoteCardsCollapsed,
  setNoteCardsCollapsed,
  removeNoteCard,
} from "@n-apt/redux";
import {
  getSupportedSnapshotVideoFormat,
  type SnapshotVideoFormat,
  type SnapshotAspectRatio,
} from "@n-apt/hooks/useSnapshot";
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
  setFileMetadata,
  bumpSnapshotSectionPulse,
} from "@n-apt/redux";
import { NaptMetadata } from "@n-apt/consts/types";

import { setSnapshotGrid as setSettingsSnapshotGrid } from "@n-apt/redux";
import {
  sendRestartDevice,
  sendCaptureCommand,
  sendCaptureStopCommand,
} from "@n-apt/redux/thunks/websocketThunks";
import {
  deriveStateFromConfig,
  useSdrSettings,
} from "@n-apt/hooks/useSdrSettings";
import { useLiveSampleRateControl } from "@n-apt/hooks/useLiveSampleRateControl";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/hooks/useGeolocation";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { LIVE_CONTROL_DEFAULTS } from "@n-apt/hooks/useSpectrumStore";
import type {
  CaptureRequest,
  CaptureFileType,
} from "@n-apt/consts/schemas/websocket";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import { TxSettingsSection } from "@n-apt/components/sidebar/TxSettingsSection";
import FileMetadata, {
  type NaptMetadata as FileMetadataNaptMetadata,
} from "@n-apt/components/sidebar/FileMetadata";
import SelectedFiles from "@n-apt/components/sidebar/SelectedFiles";
import { Button } from "@n-apt/components/ui/Button";
import { ThemeSection } from "@n-apt/components/sidebar/ThemeSection";
import { Channels } from "@n-apt/components/sidebar/Channels";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import { usePrompt } from "@n-apt/components/ui/PromptProvider";
import { Collapsible } from "@n-apt/components/ui/Collapsible";
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import { parseFrequency } from "@n-apt/utils/frequency";
import TxSliderOverlay from "@n-apt/components/TxSliderOverlay";
import {
  selectActiveSource,
  selectActiveSourceDerivedState,
} from "@n-apt/redux/selectors/performanceSelectors";

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

const NoteCardActionButton = memo(styled(Button)<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.borderHover : theme.border)};
  background-color: ${({ theme, $active }) =>
    $active ? theme.surfaceHover : theme.surface};
  color: ${({ theme }) => theme.textPrimary};
  box-shadow: none;

  &:hover {
    border-color: ${({ theme }) => theme.borderHover};
    color: ${({ theme }) => theme.textPrimary};
    background-color: ${({ theme }) => theme.surfaceHover};
  }
`);

const NoteRow = memo(styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: stretch;
  width: 100%;
`);

const NoteDeleteButton = memo(styled(Button)`
  min-width: 38px;
  width: 38px;
  padding: 0;
  justify-content: center;
  border: 1px solid ${(props) => props.theme.border};
  background-color: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textSecondary};
  box-shadow: none;

  &:hover {
    border-color: ${(props) => props.theme.danger};
    background-color: ${(props) => props.theme.danger}20;
    color: ${(props) => props.theme.danger};
  }
`);

const hasPersistedFftSize = (): boolean => {
  if (typeof window === "undefined") return false;

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of ["napt-sdr-settings-v2", "napt-sdr-settings"]) {
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { fftSize?: unknown };
        if (
          typeof parsed.fftSize === "number" &&
          Number.isFinite(parsed.fftSize) &&
          parsed.fftSize > 0
        ) {
          return true;
        }
      } catch {
        // Ignore bad cache entries and keep checking other stores.
      }
    }
  }

  return false;
};

type PlaybackAfterCaptureArgs = {
  liveCaptureStatus: {
    status: string;
    downloadUrl?: string | null;
    filename?: string | null;
  } | null;
  capturePlayback: boolean;
  sessionToken: string | null;
  aesKey: CryptoKey | null;
  dispatch: React.Dispatch<any>;
  storeDispatch: React.Dispatch<any>;
  setNaptMetadataError: (message: string | null) => void;
  getCancelled: () => boolean;
  schedule: (callback: () => void, delayMs: number) => void;
};

const playbackAfterCapture = async (
  args: PlaybackAfterCaptureArgs,
  retryCount = 0,
) => {
  const {
    liveCaptureStatus,
    capturePlayback,
    sessionToken,
    aesKey,
    dispatch,
    storeDispatch,
    setNaptMetadataError,
    getCancelled,
    schedule,
  } = args;

  if (
    liveCaptureStatus?.status !== "done" ||
    !capturePlayback ||
    !liveCaptureStatus.downloadUrl
  ) {
    return;
  }

  try {
    if (!sessionToken || !aesKey) {
      if (retryCount < 10) {
        console.log(
          `PlaybackAfterCapture: Waiting for auth state... (attempt ${retryCount + 1})`,
        );
        schedule(() => {
          void playbackAfterCapture(args, retryCount + 1);
        }, 500);
        return;
      }
      throw new Error(
        "Authentication state (session token or AES key) not ready after multiple retries",
      );
    }

    if (getCancelled()) return;

    console.group("PlaybackAfterCapture Flow");
    console.log("Status: done, triggering transition...");
    console.log("Download URL:", liveCaptureStatus.downloadUrl);
    console.log("Session Token present:", !!sessionToken);
    console.log("AES Key present:", !!aesKey);

    dispatch(setSourceMode("file"));
    storeDispatch({ type: "SET_SOURCE_MODE", mode: "file" });
    dispatch(setSelectedFiles([]));
    storeDispatch({ type: "SET_SELECTED_FILES", files: [] });
    dispatch(clearWaterfall());

    const url = `${liveCaptureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken)}`;

    let response;
    try {
      response = await fetch(url);
    } catch (fetchErr) {
      if (retryCount < 3) {
        console.warn(
          "PlaybackAfterCapture: Fetch failed, retrying...",
          fetchErr,
        );
        console.groupEnd();
        schedule(() => {
          void playbackAfterCapture(args, retryCount + 1);
        }, 1000);
        return;
      }
      throw fetchErr;
    }

    if (getCancelled()) return;

    console.log("Fetch status:", response.status);

    if (response.status === 401) {
      console.error(
        "PlaybackAfterCapture: 401 Unauthorized. Session might be stale.",
      );
      throw new Error(
        "Playback failed: Unauthorized (401). Please try logging in again.",
      );
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const blob = await response.blob();
    const filename = liveCaptureStatus.filename || "capture.napt";
    const file = new File([blob], filename, {
      type: "application/octet-stream",
    });

    const id = fileRegistry.register(file);
    const serializedFile = {
      id,
      name: filename,
      downloadUrl: liveCaptureStatus.downloadUrl,
    };

    dispatch(setSelectedFiles([serializedFile]));
    storeDispatch({
      type: "SET_SELECTED_FILES",
      files: [serializedFile],
    });

    console.log("File registered and selected. ID:", id);

    schedule(() => {
      if (getCancelled()) return;
      console.log("Triggering stitch...");
      dispatch(triggerStitch());
      storeDispatch({ type: "TRIGGER_STITCH" });
      console.groupEnd();
    }, 800);
  } catch (e) {
    console.error("Playback after capture failed:", e);
    console.groupEnd();
    if (e instanceof Error) {
      setNaptMetadataError(`Playback failed: ${e.message}`);
    }
  }
};

interface SpectrumSidebarProps {
  onCreateNoteCard?: () => void;
  visualizerLoading?: boolean;
}

export const SpectrumSidebar: React.FC<SpectrumSidebarProps> = ({
  onCreateNoteCard,
  visualizerLoading = false,
}) => {
  const dispatch = useAppDispatch();
  const notesCollapsed = useAppSelector(selectNoteCardsCollapsed);
  const noteCards = useAppSelector(selectNoteCards);
  const { showPrompt } = usePrompt();
  const {
    state: liveState,
    dispatch: storeDispatch,
    effectiveFrames,
    effectiveSdrSettings,
    sampleRateHzEffective,
    signalAreaBounds,
    wsConnection,
    manualVisualizerPaused,
    toggleVisualizerPause: toggleLiveVisualizerPause,
    cryptoCorrupted: liveCryptoCorrupted,
    deviceName: liveDeviceName,
    deviceProfile: liveDeviceProfile,
  } = useSpectrumStore();
  const lastSampleRateRef = useRef<number | null>(null);

  // Get state from Redux
  const {
    frequencyRange,
    activeSignalArea,
    fftSize,
    fftWindow,
    fftFrameRate,
    gain,
    hackrfLnaGain,
    hackrfVgaGain,
    hackrfAmpEnabled,
    hackrfBasebandBandwidth,
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
  const activeFrameForArea = useMemo(() => {
    const area = activeSignalArea?.toLowerCase?.() ?? "";
    return (
      effectiveFrames.find((frame) => frame.label.toLowerCase() === area) ??
      effectiveFrames.find((frame) => frame.label === activeSignalArea) ??
      null
    );
  }, [activeSignalArea, effectiveFrames]);
  const activeSignalAreaBounds = useMemo(() => {
    const mappedBounds =
      signalAreaBounds?.[activeSignalArea] ??
      signalAreaBounds?.[activeSignalArea?.toLowerCase?.()];
    if (mappedBounds && mappedBounds.max > mappedBounds.min) {
      return mappedBounds;
    }
    if (
      activeFrameForArea &&
      activeFrameForArea.max_hz > activeFrameForArea.min_hz
    ) {
      return {
        min: activeFrameForArea.min_hz,
        max: activeFrameForArea.max_hz,
      };
    }
    return null;
  }, [activeFrameForArea, activeSignalArea, signalAreaBounds]);
  const activeChannelSampleRate = useMemo(
    () =>
      activeSignalAreaBounds &&
      activeSignalAreaBounds.max > activeSignalAreaBounds.min
        ? activeSignalAreaBounds.max - activeSignalAreaBounds.min
        : activeFrameForArea &&
            activeFrameForArea.max_hz > activeFrameForArea.min_hz
          ? activeFrameForArea.max_hz - activeFrameForArea.min_hz
          : null,
    [activeFrameForArea, activeSignalAreaBounds],
  );

  const isConnected = useAppSelector((s) => s.websocket.isConnected);
  const connectionStatus = useAppSelector((s) => s.websocket.connectionStatus);
  const activeSource = useAppSelector(selectActiveSource);
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const captureStatus = useAppSelector((s) => s.websocket.captureStatus);
  const spectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);

  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();
  const { getLocation } = useGeolocation();

  const liveBackend = wsConnection.backend ?? activeSourceDerived.backend;
  const liveDeviceState = wsConnection.deviceState ?? activeSourceDerived.deviceState;
  const liveDeviceLoadingReason =
    wsConnection.deviceLoadingReason ??
    (activeSource?.status === "loading" ? "connect" : null);
  const liveIsConnected = wsConnection.isConnected ?? isConnected;
  const liveIsPaused =
    manualVisualizerPaused ?? wsConnection.isPaused ?? isPaused;
  const liveCaptureStatus = wsConnection.captureStatus ?? captureStatus;
  const liveFramesToUse =
    effectiveFrames.length > 0 ? effectiveFrames : spectrumFrames;
  const liveSdrSettingsToUse =
    effectiveSdrSettings ?? activeSourceDerived.sdrSettings;
  const liveDeviceNameToUse =
    liveDeviceName ?? wsConnection.deviceName ?? activeSourceDerived.deviceName;
  const liveDeviceProfileToUse =
    liveDeviceProfile ?? wsConnection.deviceProfile ?? activeSourceDerived.deviceProfile;
  const deviceTypeToUse =
    liveDeviceProfileToUse?.kind ?? liveBackend ?? undefined;
  const deviceTypeNormalized =
    deviceTypeToUse === "rtl-sdr" ? "rtl_sdr" : deviceTypeToUse;
  const activeDeviceConfig = deviceTypeNormalized
    ? liveSdrSettingsToUse?.devices?.[deviceTypeNormalized]
    : undefined;
  const gainLimits = activeDeviceConfig?.gain_limits;
  const isHackrfOne =
    liveDeviceProfileToUse?.kind === "hackrf_one" ||
    liveBackend?.toLowerCase() === "hackrf_one";
  const liveSampleRateOptions =
    wsConnection.sampleRateOptions.length > 0
      ? wsConnection.sampleRateOptions
      : activeSourceDerived.sampleRateOptions;
  const maxSampleRateHz =
    wsConnection.maxSampleRateHz ?? activeSourceDerived.maxSampleRateHz;
  const isMockLiveSource =
    sourceMode === "live" &&
    !!(
      liveBackend?.toLowerCase().includes("mock") ||
      liveDeviceNameToUse?.toLowerCase().includes("mock")
    );
  const liveManualSampleRateOptions = isMockLiveSource
    ? liveSampleRateOptions.length > 0
      ? liveSampleRateOptions
      : [3_200_000]
    : liveSampleRateOptions;
  const supportsWholeChannelSampleRate =
    sourceMode === "live" && (isHackrfOne || isMockLiveSource);
  const maxSampleRate =
    sampleRateHzEffective ??
    sampleRateHz ??
    maxSampleRateHz ??
    liveSdrSettingsToUse?.sample_rate ??
    0;
  const sampleRateHzLocal =
    (typeof liveState.sampleRateHz === "number" &&
    Number.isFinite(liveState.sampleRateHz) &&
    liveState.sampleRateHz > 0
      ? liveState.sampleRateHz
      : typeof sampleRateHz === "number" &&
          Number.isFinite(sampleRateHz) &&
          sampleRateHz > 0
        ? sampleRateHz
        : typeof sampleRateHzEffective === "number" &&
            Number.isFinite(sampleRateHzEffective) &&
            sampleRateHzEffective > 0
          ? sampleRateHzEffective
          : typeof liveSdrSettingsToUse?.sample_rate === "number" &&
              Number.isFinite(liveSdrSettingsToUse.sample_rate) &&
              liveSdrSettingsToUse.sample_rate > 0
            ? liveSdrSettingsToUse.sample_rate
            : maxSampleRate) || null;
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
      sampleRate?: number;
      gain?: number;
      hackrfLnaGain?: number;
      hackrfVgaGain?: number;
      hackrfAmpEnabled?: boolean;
      tunerBandwidth?: number;
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
    sampleRateOptions,
    setFftSize,
    setFftFrameRate,
    setSampleRate,
    setGain,
    setHackrfLnaGain,
    setHackrfVgaGain,
    setHackrfAmpEnabled,
    setHackrfBasebandBandwidth,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    scheduleCoupledAdjustment,
  } = useSdrSettings({
    maxSampleRate,
    minReceiveSampleRate:
      liveSdrSettingsToUse?.min_receive_sample_rate ?? undefined,
    sampleRateOptions: liveManualSampleRateOptions,
    sdrSettings: liveSdrSettingsToUse,
    deviceType: liveDeviceProfileToUse?.kind ?? liveBackend ?? undefined,
    spectrumStateOverride: {
      fftSize,
      fftWindow,
      fftFrameRate,
      gain,
      hackrfLnaGain: liveState.hackrfLnaGain,
      hackrfVgaGain: liveState.hackrfVgaGain,
      hackrfAmpEnabled: liveState.hackrfAmpEnabled,
      hackrfBasebandBandwidth: liveState.hackrfBasebandBandwidth,
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
          ...(settings.fftSize !== undefined
            ? { fftSize: settings.fftSize }
            : {}),
          ...(settings.fftWindow !== undefined
            ? { fftWindow: settings.fftWindow }
            : {}),
          ...(settings.frameRate !== undefined
            ? { fftFrameRate: settings.frameRate }
            : {}),
          ...(settings.sampleRate !== undefined
            ? { sampleRateHz: settings.sampleRate }
            : {}),
          ...(settings.gain !== undefined ? { gain: settings.gain } : {}),
          ...(settings.hackrfLnaGain !== undefined
            ? { hackrfLnaGain: settings.hackrfLnaGain }
            : {}),
          ...(settings.hackrfVgaGain !== undefined
            ? { hackrfVgaGain: settings.hackrfVgaGain }
            : {}),
          ...(settings.hackrfAmpEnabled !== undefined
            ? { hackrfAmpEnabled: settings.hackrfAmpEnabled }
            : {}),
          ...(settings.tunerBandwidth !== undefined
            ? { hackrfBasebandBandwidth: settings.tunerBandwidth }
            : {}),
          ...(settings.ppm !== undefined ? { ppm: settings.ppm } : {}),
          ...(settings.tunerAGC !== undefined
            ? { tunerAGC: settings.tunerAGC }
            : {}),
          ...(settings.rtlAGC !== undefined ? { rtlAGC: settings.rtlAGC } : {}),
        },
      });
      sendLiveSettings(settings);
    },
  });

  const {
    wholeChannelSampleRate: hackrfWholeChannelSampleRate,
    handleSampleRateChange,
  } = useLiveSampleRateControl({
    sourceMode,
    supportsWholeChannelSampleRate,
    manualSampleRateOptions: sampleRateOptions,
    activeChannelSampleRate,
    activeSignalAreaBounds,
    frequencyRange,
    sampleRateHz: liveState.sampleRateHz,
    setSampleRate,
    applyFrequencyRange: (range) => {
      storeDispatch({ type: "SET_FREQUENCY_RANGE", range });
      wsConnection.sendFrequencyRange(range);
    },
  });

  const hackrfBasebandCurrentSampleRate =
    isHackrfOne && sourceMode === "live" ? (sampleRateHzLocal ?? null) : null;

  useEffect(() => {
    if (
      !isHackrfOne ||
      sourceMode !== "live" ||
      typeof hackrfBasebandCurrentSampleRate !== "number" ||
      !Number.isFinite(hackrfBasebandCurrentSampleRate) ||
      hackrfBasebandCurrentSampleRate <= 0 ||
      liveState.hackrfBasebandBandwidth === 0
    ) {
      return;
    }

    const nextBandwidth = Math.round(hackrfBasebandCurrentSampleRate);
    if (lastSampleRateRef.current !== nextBandwidth) {
      lastSampleRateRef.current = nextBandwidth;
      setHackrfBasebandBandwidth(nextBandwidth);
    }
  }, [
    hackrfBasebandCurrentSampleRate,
    isHackrfOne,
    setHackrfBasebandBandwidth,
    sourceMode,
    liveState.hackrfBasebandBandwidth,
  ]);

  useEffect(() => {
    if (!liveSdrSettingsToUse) return;
    const derived = deriveStateFromConfig(maxSampleRate, liveSdrSettingsToUse);
    const nextSettings = {
      ...(typeof derived.gain === "number" ? { gain: derived.gain } : {}),
      ...(typeof derived.ppm === "number" &&
      (typeof liveState.ppm !== "number" ||
        liveState.ppm === 0 ||
        liveState.ppm === LIVE_CONTROL_DEFAULTS.ppm)
        ? { ppm: derived.ppm }
        : {}),
      ...(typeof derived.tunerAGC === "boolean"
        ? { tunerAGC: derived.tunerAGC }
        : {}),
      ...(typeof derived.rtlAGC === "boolean"
        ? { rtlAGC: derived.rtlAGC }
        : {}),
      // Only apply bandwidth from config on initial load (when it's null/unset);
      // once the user or sample-rate sync has set a value, don't overwrite it.
      ...(typeof derived.hackrfBasebandBandwidth === "number" &&
      (typeof liveState.hackrfBasebandBandwidth !== "number" ||
        liveState.hackrfBasebandBandwidth === null)
        ? { hackrfBasebandBandwidth: derived.hackrfBasebandBandwidth }
        : {}),
      ...(typeof liveState.fftSize !== "number" || liveState.fftSize <= 0
        ? { fftSize: derived.fftSize }
        : {}),
      ...(typeof liveState.sampleRateHz !== "number" ||
      liveState.sampleRateHz <= 0
        ? { sampleRateHz: liveSdrSettingsToUse?.sample_rate ?? maxSampleRate }
        : {}),
      ...(typeof liveState.fftFrameRate !== "number" ||
      liveState.fftFrameRate <= 0
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
    liveState.sampleRateHz,
    liveState.fftFrameRate,
    liveState.fftWindow,
    liveState.hackrfBasebandBandwidth,
  ]);

  // Capture UI state
  const [activeCaptureAreas, setActiveCaptureAreas] = useState<string[]>([
    "Onscreen",
  ]);
  const [acquisitionMode, setAcquisitionMode] = useState<
    "stepwise" | "interleaved" | "whole_sample"
  >("stepwise");
  const [captureDurationMode, setCaptureDurationMode] = useState<
    "timed" | "manual"
  >("timed");
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
  const [snapshotUseThemeColors, setSnapshotUseThemeColors] = useState(false);
  const [snapshotGeolocationError, setSnapshotGeolocationError] = useState<
    string | null
  >(null);
  const [snapshotGeolocationPosition, setSnapshotGeolocationPosition] =
    useState<{ lat: string; lon: string } | null>(null);
  const supportedSnapshotVideoFormat = useMemo(
    () => getSupportedSnapshotVideoFormat(),
    [],
  );
  const snapshotPulseToken = useAppSelector(
    (state) => state.snapshot.pulseToken,
  );
  const [snapshotFormat, setSnapshotFormat] = useState<
    "png" | "svg" | SnapshotVideoFormat | "animated-svg"
  >("png");
  const [snapshotAspectRatio, setSnapshotAspectRatio] =
    useState<SnapshotAspectRatio>("default");
  const [txSignal, setTxSignal] = useState("apt");
  const [txSampleRateHz, setTxSampleRateHz] = useState(2_400_000);
  const [txCenterFrequencyHz, setTxCenterFrequencyHz] = useState(137_100_000);
  const [txPowerDbm, setTxPowerDbm] = useState(-18);
  const [txVgaGain, setTxVgaGain] = useState(16);
  const [txOverlayPosition, setTxOverlayPosition] = useState(62);
  const [selectedMockDeviceId, setSelectedMockDeviceId] = useState("device-1");
  const [mockDevices, setMockDevices] = useState([
    {
      id: "device-1",
      name:
        (liveBackend ?? backend ?? "").toLowerCase().includes("mock")
          ? "Mock APT SDR"
          : "Mock APT SDR",
      backend: liveBackend || backend || "mock_apt",
      deviceType: liveDeviceProfileToUse?.kind ?? backend ?? "rtl_sdr",
      txMode: false,
      ppm,
      gain,
      hackrfLnaGain: liveState.hackrfLnaGain,
      hackrfVgaGain: liveState.hackrfVgaGain,
      hackrfAmpEnabled: liveState.hackrfAmpEnabled,
      hackrfBasebandBandwidth: liveState.hackrfBasebandBandwidth,
      tunerAGC,
      rtlAGC,
    },
    {
      id: "device-2",
      // Temporary placeholder until real multi-device backend discovery is wired up.
      name: "HackRF One #2",
      backend: "hackrf_one",
      deviceType: "hackrf_one",
      txMode: true,
      ppm: 0,
      gain: 0,
      hackrfLnaGain: 32,
      hackrfVgaGain: 18,
      hackrfAmpEnabled: true,
      hackrfBasebandBandwidth: 3_200_000,
      tunerAGC: false,
      rtlAGC: false,
    },
  ]);
  const [livePreviewStage, setLivePreviewStage] = useState(0);
  const activeCaptureAreasSet = useMemo(
    () => new Set(activeCaptureAreas),
    [activeCaptureAreas],
  );

  // NAPT metadata state
  const [naptMetadata, setNaptMetadata] = useState<NaptMetadata | null>(null);
  const [naptMetadataError, setNaptMetadataError] = useState<string | null>(
    null,
  );
  const [lastAutoProcessSignature, setLastAutoProcessSignature] = useState<
    string | null
  >(null);

  useEffect(() => {
    dispatch(setFileMetadata(naptMetadata));
  }, [naptMetadata, dispatch]);

  useEffect(() => {
    if (sourceMode !== "file") return;
    if (selectedFiles.length === 0) {
      setLastAutoProcessSignature(null);
      return;
    }

    const signature = selectedFiles
      .map((file) => `${file.id}:${file.name}`)
      .sort()
      .join("|");

    if (!signature || signature === lastAutoProcessSignature) return;

    setLastAutoProcessSignature(signature);
    dispatch(triggerStitch());
    storeDispatch({ type: "TRIGGER_STITCH" });
  }, [
    sourceMode,
    selectedFiles,
    lastAutoProcessSignature,
    dispatch,
    storeDispatch,
  ]);

  // Handle Playback after capture
  useEffect(() => {
    if (
      liveCaptureStatus?.status !== "done" ||
      !capturePlayback ||
      !liveCaptureStatus.downloadUrl
    ) {
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    void playbackAfterCapture({
      liveCaptureStatus,
      capturePlayback,
      sessionToken,
      aesKey,
      dispatch,
      storeDispatch,
      setNaptMetadataError,
      getCancelled: () => cancelled,
      schedule: (callback, delayMs) => {
        timerId = setTimeout(callback, delayMs);
      },
    });
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [
    liveCaptureStatus,
    capturePlayback,
    sessionToken,
    aesKey,
    dispatch,
    storeDispatch,
  ]);

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

  const isMockFile = useMemo(() => {
    const metadataSource = [naptMetadata?.source_device, naptMetadata?.hardware]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return metadataSource.includes("mock");
  }, [naptMetadata]);

  const fileActionLabel = useMemo(() => {
    if (sourceMode !== "file") return "File";
    const status = stitchStatus?.toLowerCase?.() ?? "";
    if (!selectedFiles.length) return "Browse";
    if (status.includes("processing") || status.includes("loading")) {
      return "Process [auto]";
    }
    if (isStitchPaused) return "Play";
    return "Pause";
  }, [isStitchPaused, selectedFiles.length, sourceMode, stitchStatus]);

  const fileActionTitle = useMemo(() => {
    if (sourceMode !== "file") return "Switch to File Selection";
    const status = stitchStatus?.toLowerCase?.() ?? "";
    if (!selectedFiles.length) return "Browse files";
    if (status.includes("processing") || status.includes("loading")) {
      return "Process selected file automatically";
    }
    if (isStitchPaused) return "Resume playback";
    return "Pause playback";
  }, [isStitchPaused, selectedFiles.length, sourceMode, stitchStatus]);

  const handleFileAction = useCallback(() => {
    if (sourceMode !== "file") {
      return;
    }
    if (!selectedFiles.length) return;
    const status = stitchStatus?.toLowerCase?.() ?? "";
    if (status.includes("processing") || status.includes("loading")) {
      dispatch(triggerStitch());
      storeDispatch({ type: "TRIGGER_STITCH" });
      return;
    }
    dispatch(setStitchPaused(!isStitchPaused));
    storeDispatch({
      type: "SET_STITCH_PAUSED",
      paused: !isStitchPaused,
    });
  }, [dispatch, isStitchPaused, selectedFiles.length, sourceMode, storeDispatch, stitchStatus]);

  const handleSourceFilesSelected = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const registeredFiles = files.map((file) => ({
        id: fileRegistry.register(file),
        name: file.name,
      }));

      dispatch(setSelectedFiles(registeredFiles));
      storeDispatch({ type: "SET_SELECTED_FILES", files: registeredFiles });
      dispatch(clearWaterfall());
    },
    [dispatch, storeDispatch],
  );

  const handleSourceModeChange = useCallback(
    (mode: "live" | "file") => {
      if (mode === "file") {
        setLivePreviewStage(0);
        setMockDevices((current) =>
          current.map((entry) => ({ ...entry, txMode: false })),
        );
      } else {
        setLivePreviewStage(0);
      }
      dispatch(setSourceMode(mode));
      storeDispatch({ type: "SET_SOURCE_MODE", mode });
    },
    [dispatch, storeDispatch],
  );

  // Initial paused state for file mode - always reset to paused when entering file mode
  useEffect(() => {
    if (sourceMode === "file") {
      dispatch(setStitchPaused(true));
      storeDispatch({ type: "SET_STITCH_PAUSED", paused: true });
    }
  }, [sourceMode, dispatch, storeDispatch]);

  const fileCapturedRange = useMemo(() => {
    if (sourceMode !== "file" || selectedFiles.length === 0) return null;
    let minFreq = Infinity;
    let maxFreq = -Infinity;

    // If we have metadata for a single file, use that
    if (selectedFiles.length === 1 && naptMetadata) {
      const freq =
        naptMetadata.center_frequency_hz || naptMetadata.center_frequency || 0;
      const sampleRate =
        naptMetadata.capture_sample_rate_hz ||
        naptMetadata.sample_rate_hz ||
        naptMetadata.sample_rate ||
        0;
      minFreq = freq - sampleRate / 2;
      maxFreq = freq + sampleRate / 2;
    }

    // Fallback to filename parsing
    for (const f of selectedFiles) {
      const match = f.name.match(/iq_([\d._]+[a-zA-Z]*)/);
      if (match) {
        const freq = parseFrequency(match[1], "MHz") || 0;
        const sampleRate = sampleRateHzLocal ?? 3_200_000; // Use current sample rate or fallback
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
        const centerFreq = liveSdrSettingsToUse.center_frequency;
        const hardwareSpan = liveSdrSettingsToUse.sample_rate;
        return {
          min: centerFreq - hardwareSpan / 2,
          max: centerFreq + hardwareSpan / 2,
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
    const hardwareMin = activeFrame?.min_hz ?? frequencyRange.min;
    const hardwareMax = activeFrame?.max_hz ?? frequencyRange.max;
    const hardwareSpan =
      typeof sampleRateHzLocal === "number" &&
      Number.isFinite(sampleRateHzLocal)
        ? Math.min(
            sampleRateHzLocal,
            Math.max(0, hardwareMax - hardwareMin || fallbackSpan),
          )
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
      const centerFreq = liveSdrSettingsToUse.center_frequency;
      const spanFreq = liveSdrSettingsToUse.sample_rate;
      areas.push({
        label: "Onscreen",
        min: centerFreq - spanFreq / 2,
        max: centerFreq + spanFreq / 2,
      });
    }
    if (Array.isArray(liveFramesToUse)) {
      liveFramesToUse.forEach((frame) => {
        areas.push({
          label: frame.label,
          min: frame.min_hz,
          max: frame.max_hz,
        });
      });
    }
    return areas;
  }, [visibleOnscreenRange, liveFramesToUse, liveSdrSettingsToUse]);

  const activeFragments = useMemo(() => {
    return availableCaptureAreas.reduce<{ minFreq: number; maxFreq: number }[]>(
      (acc, a) => {
        if (activeCaptureAreasSet.has(a.label)) {
          acc.push({ minFreq: a.min, maxFreq: a.max });
        }
        return acc;
      },
      [],
    );
  }, [availableCaptureAreas, activeCaptureAreasSet]);

  const captureRange = useMemo(() => {
    const segments = availableCaptureAreas.filter((a) =>
      activeCaptureAreasSet.has(a.label),
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
    if (!isServerConnected || liveDeviceState === "loading" || !isAuthenticated)
      return;

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
    const hardwareSampleRateHz = maxSampleRate;
    const effectiveAcquisitionMode =
      onscreenIsActive &&
      hardwareSampleRateHz > 0 &&
      Math.abs(onscreenSpan - hardwareSampleRateHz) < 10_000
        ? "whole_sample"
        : acquisitionMode;

    const req: CaptureRequest = {
      jobId: `cap_${Date.now()}`,
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
    dispatch(bumpSnapshotSectionPulse());
    window.dispatchEvent(
      new CustomEvent("napt-snapshot", {
        detail: {
          whole: snapshotWhole,
          showWaterfall: snapshotShowWaterfall,
          showStats: snapshotShowStats,
          showGeolocation: snapshotShowGeolocation && snapshotShowStats,
          geolocation: snapshotGeolocationPosition,
          activeSignalAreaBounds,
          gain,
          ppm,
          format: snapshotFormat,
          grid: snapshotGridPreference,
          aspectRatio: snapshotAspectRatio,
          useThemeColors: snapshotUseThemeColors,
          fileTimestamp:
            sourceMode === "file" && naptMetadata?.timestamp_utc
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
          lon: pos.coords.longitude.toFixed(6),
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
      { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false },
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

    console.log(
      "Metadata Effect: isNapt?",
      isNapt,
      "aesKey present?",
      !!aesKey,
    );
    if (isNapt && !aesKey) {
      console.warn("Metadata Effect: NAPT file but NO aesKey!");
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
            jsonStr = new TextDecoder().decode(
              headerBytes.slice(0, newlineIdx),
            );
          } else {
            // Fallback: find the closing brace of the root JSON object
            const headerText = new TextDecoder().decode(headerBytes);
            let braceDepth = 0;
            let inString = false;
            let escape = false;
            let jsonEnd = -1;
            for (let ci = 0; ci < headerText.length; ci++) {
              const c = headerText[ci];
              if (escape) {
                escape = false;
                continue;
              }
              if (c === "\\") {
                escape = true;
                continue;
              }
              if (c === '"') {
                inString = !inString;
                continue;
              }
              if (inString) continue;
              if (c === "{") braceDepth++;
              if (c === "}") {
                braceDepth--;
                if (braceDepth === 0) {
                  jsonEnd = ci + 1;
                  break;
                }
              }
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
    () => buildSdrLimitMarkers(wsConnection.sdrLimitMarkers),
    [wsConnection.sdrLimitMarkers],
  );

  const resetLiveControls = useCallback(() => {
    storeDispatch({ type: "RESET_LIVE_CONTROLS", fftSize, fftFrameRate });
  }, [storeDispatch, fftSize, fftFrameRate]);

  const handleRestartDevice = useCallback(() => {
    dispatch(sendRestartDevice());
  }, [dispatch]);

  const handleResetOptions = useCallback(() => {
    showPrompt({
      title: "Reset Options to Defaults?",
      message:
        "Reset options like zoom, signal display, source settings and all other options to the app's default settings?",
      confirmText: "Reset",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: resetLiveControls,
    });
  }, [resetLiveControls, showPrompt]);

  useEffect(() => {
    setActiveCaptureAreas((current) => {
      const validLabels = new Set(
        availableCaptureAreas.map((area) => area.label),
      );
      const next = current.filter((label) => validLabels.has(label));
      return next.length > 0
        ? next
        : validLabels.has("Onscreen")
          ? ["Onscreen"]
          : next;
    });
  }, [availableCaptureAreas]);

  return (
    <SidebarContent>
      <Section style={{ position: "sticky", top: 16, zIndex: 20 }}>
        <SectionTitle $fileMode={sourceMode === "file"}>
          <SectionIcon>
            <Unplug size={14} />
          </SectionIcon>
          <SectionText>Source</SectionText>
        </SectionTitle>

        <SourceInput
          sourceMode={sourceMode}
          fileModeColor="var(--color-file-mode)"
          livePreviewStage={livePreviewStage}
          fileActionLabel={fileActionLabel}
          fileActionTitle={fileActionTitle}
          selectedFilesCount={selectedFiles.length}
          onFileAction={handleFileAction}
          onFilesSelected={handleSourceFilesSelected}
          devices={mockDevices.map((device) => ({
            id: device.id,
            name: device.name,
            backend: device.backend,
            txMode: device.txMode,
            summary: `PPM ${device.ppm} · Gain ${device.gain} dB`,
            status:
              device.id === "device-1"
                ? {
                    color:
                      liveDeviceState === "loading"
                        ? "var(--color-warning)"
                        : liveDeviceState === "connected" &&
                            liveCryptoCorrupted
                          ? "var(--color-danger)"
                          : liveDeviceState === "connected"
                            ? "var(--color-primary)"
                            : "var(--color-secondary)",
                    label:
                      liveDeviceState === "loading"
                        ? liveDeviceLoadingReason === "restart"
                          ? "restarting"
                          : "loading"
                        : liveDeviceState === "connected"
                          ? device.name === "Mock APT SDR"
                            ? "streaming"
                            : "connected"
                          : "offline",
                    loading: liveDeviceState === "loading",
                    paused: liveIsPaused,
                    actionLabel:
                      liveDeviceState === "loading"
                        ? liveDeviceLoadingReason === "restart"
                          ? "Restarting…"
                          : "Loading…"
                        : liveDeviceState === "connected"
                          ? liveIsPaused
                            ? "Resume"
                            : "Pause"
                          : "Restart",
                    actionTitle:
                      liveDeviceState === "loading"
                        ? liveDeviceLoadingReason === "restart"
                          ? "Device is restarting..."
                          : "Device is being initialized..."
                        : liveDeviceState === "connected"
                          ? liveIsPaused
                            ? "Resume device"
                            : "Pause device"
                          : "Restart device",
                    onAction:
                      liveDeviceState === "loading"
                        ? undefined
                        : liveDeviceState === "connected"
                          ? toggleVisualizerPause
                          : handleRestartDevice,
                  }
                : undefined,
          }))}
          selectedDeviceId={selectedMockDeviceId}
          onSelectedDeviceChange={(id) => {
            if (sourceMode === "file") {
              if (selectedMockDeviceId === id && livePreviewStage >= 1) {
                handleSourceModeChange("live");
                return;
              }
              setSelectedMockDeviceId(id);
              setLivePreviewStage(1);
              return;
            }
            setSelectedMockDeviceId(id);
          }}
          onToggleDeviceTxMode={(id) =>
            setMockDevices((current) =>
              current.map((entry) =>
                entry.id === id ? { ...entry, txMode: !entry.txMode } : entry,
              ),
            )
          }
          onSourceModeChange={handleSourceModeChange}
        />
      </Section>

      {sourceMode === "file" && (
        <>
          {selectedFiles.length > 0 && (
            <>
              <Section>
                <SelectedFiles
                  title="Selected Files"
                  selectedFiles={selectedFiles}
                  onRemoveFile={(index) => {
                    const fileToRemove = selectedFiles[index];
                    if (fileToRemove) {
                      fileRegistry.remove(fileToRemove.id);
                    }
                    const nextFiles = selectedFiles.filter((_, i) => i !== index);
                    dispatch(setSelectedFiles(nextFiles));
                    storeDispatch({
                      type: "SET_SELECTED_FILES",
                      files: nextFiles,
                    });
                  }}
                  onClear={() => {
                    selectedFiles.forEach((file) => fileRegistry.remove(file.id));
                    dispatch(setSelectedFiles([]));
                    storeDispatch({ type: "SET_SELECTED_FILES", files: [] });
                    dispatch(clearWaterfall());
                  }}
                  sessionToken={sessionToken}
                />
              </Section>

              <FileMetadata
                selectedNaptFile={selectedPrimaryFile}
                naptMetadata={naptMetadata as FileMetadataNaptMetadata | null}
                naptMetadataError={naptMetadataError}
                sessionToken={sessionToken}
                showTitle={true}
              />
            </>
          )}

          <SnapshotControlsSection
            snapshotWhole={snapshotWhole}
            snapshotShowWaterfall={snapshotShowWaterfall}
            snapshotShowStats={snapshotShowStats}
            snapshotShowGeolocation={snapshotShowGeolocation}
            snapshotGeolocationError={snapshotGeolocationError}
            snapshotUseThemeColors={snapshotUseThemeColors}
            snapshotFormat={snapshotFormat}
            supportedSnapshotVideoFormat={supportedSnapshotVideoFormat}
            snapshotGridPreference={snapshotGridPreference}
            snapshotAspectRatio={snapshotAspectRatio}
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotUseThemeColorsChange={setSnapshotUseThemeColors}
            onSnapshotShowGeolocationChange={handleSnapshotGeolocationToggle}
            onSnapshotFormatChange={setSnapshotFormat}
            onSnapshotGridPreferenceChange={(pref) => {
              dispatch(setSettingsSnapshotGrid(pref));
              storeDispatch({ type: "SET_SNAPSHOT_GRID", preference: pref });
            }}
            onSnapshotAspectRatioChange={setSnapshotAspectRatio}
            onSnapshot={handleSnapshot}
            titlePulseToken={snapshotPulseToken}
            isFileMode={true}
            hasFileLoaded={!!selectedPrimaryFile}
          />
          <SignalDisplaySection
            sourceMode={sourceMode}
            maxSampleRate={maxSampleRate}
            minReceiveSampleRate={liveSdrSettingsToUse?.min_receive_sample_rate}
            sampleRate={
              sampleRateHzLocal ??
              liveSdrSettingsToUse?.sample_rate ??
              maxSampleRate
            }
            sampleRateOptions={sampleRateOptions}
            wholeChannelSampleRate={hackrfWholeChannelSampleRate}
            fileCapturedRange={fileCapturedRange}
            fftFrameRate={4}
            maxFrameRate={4}
            fftSize={1024}
            fftSizeOptions={[1024]}
            fftWindow={fftWindow || "Rectangular"}
            temporalResolution={displayTemporalResolution}
            backend={null}
            deviceProfile={null}
            powerScale={powerScale}
            displayMode={displayMode || "fft"}
            onFftFrameRateChange={() => {}}
            onFftSizeChange={() => {}}
            onSampleRateChange={() => {}}
            onFftWindowChange={(win) => {
              dispatch(setFftWindowAction(win));
              storeDispatch({ type: "SET_FFT_WINDOW", fftWindow: win });
            }}
            onTemporalResolutionChange={(res) => {
              dispatch(setTemporalResolution(res));
              storeDispatch({
                type: "SET_TEMPORAL_RESOLUTION",
                resolution: res,
              });
            }}
            onPowerScaleChange={(ps) => {
              dispatch(setPowerScale(ps));
              storeDispatch({ type: "SET_POWER_SCALE", powerScale: ps });
            }}
            onDisplayModeChange={(mode) => {
              dispatch(setDisplayMode(mode));
              storeDispatch({ type: "SET_DISPLAY_MODE", displayMode: mode });
            }}
            scheduleCoupledAdjustment={() => {}}
          />
        </>
      )}

      {sourceMode === "live" && (
        <>
          <Collapsible
            key={`notes-collapsible-${notesCollapsed ? "closed" : "open"}`}
            title="Notes"
            defaultOpen={!notesCollapsed}
            onOpenChange={(isOpen) => dispatch(setNoteCardsCollapsed(!isOpen))}
          >
            <Section $marginBottom="12px">
              <NoteCardActionButton
                $variant="secondary"
                type="button"
                onClick={onCreateNoteCard}
                disabled={!onCreateNoteCard}
                title="Create a note from the current spectrum"
              >
                New Note
              </NoteCardActionButton>
              <NoteCardActionButton
                $variant="secondary"
                $active={!notesCollapsed}
                type="button"
                onClick={() => dispatch(setNoteCardsCollapsed(!notesCollapsed))}
                title={notesCollapsed ? "Show saved notes" : "Hide saved notes"}
              >
                {notesCollapsed ? "Show Notes" : "Hide Notes"}
              </NoteCardActionButton>
            </Section>
            <Section>
              {noteCards.length === 0 ? (
                <div
                  style={{
                    color: "inherit",
                    opacity: 0.7,
                    fontSize: "12px",
                    gridColumn: "1 / -1",
                  }}
                >
                  No notes
                </div>
              ) : (
                noteCards.map((noteCard) => (
                  <NoteRow key={noteCard.id}>
                    <NoteCardActionButton
                      $variant="secondary"
                      type="button"
                      title={noteCard.title || "Saved note"}
                      style={{ justifyContent: "flex-start" }}
                    >
                      {noteCard.title?.trim() || "Untitled note"}
                    </NoteCardActionButton>
                    <NoteDeleteButton
                      $variant="secondary"
                      type="button"
                      aria-label={`Delete note ${noteCard.title?.trim() || "Untitled note"}`}
                      title="Delete note"
                      onClick={() => {
                        showPrompt({
                          title: "Delete note?",
                          message:
                            "This will permanently remove the saved note from the sidebar.",
                          confirmText: "Delete",
                          cancelText: "Cancel",
                          variant: "danger",
                          onConfirm: () =>
                            dispatch(removeNoteCard(noteCard.id)),
                        });
                      }}
                    >
                      <Trash2 size={14} />
                    </NoteDeleteButton>
                  </NoteRow>
                ))
              )}
            </Section>
          </Collapsible>

          <Section>
            <ResetButton
              onClick={handleResetOptions}
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
            snapshotUseThemeColors={snapshotUseThemeColors}
            snapshotFormat={snapshotFormat}
            supportedSnapshotVideoFormat={supportedSnapshotVideoFormat}
            snapshotGridPreference={snapshotGridPreference}
            snapshotAspectRatio={snapshotAspectRatio}
            onSnapshotWholeChange={setSnapshotWhole}
            onSnapshotShowWaterfallChange={setSnapshotShowWaterfall}
            onSnapshotShowStatsChange={setSnapshotShowStats}
            onSnapshotUseThemeColorsChange={setSnapshotUseThemeColors}
            onSnapshotShowGeolocationChange={handleSnapshotGeolocationToggle}
            onSnapshotFormatChange={setSnapshotFormat}
            onSnapshotGridPreferenceChange={(pref) => {
              dispatch(setSettingsSnapshotGrid(pref));
              storeDispatch({ type: "SET_SNAPSHOT_GRID", preference: pref });
            }}
            onSnapshotAspectRatioChange={setSnapshotAspectRatio}
            onSnapshot={handleSnapshot}
            titlePulseToken={snapshotPulseToken}
          />

          <Channels
            variant="spectrum"
            fileMode={false}
            limitMarkers={limitMarkers}
            rangeSlidersDisabled={visualizerLoading}
          />

          <SignalDisplaySection
            sourceMode={sourceMode}
            maxSampleRate={maxSampleRate}
            minReceiveSampleRate={liveSdrSettingsToUse?.min_receive_sample_rate}
            sampleRate={
              sampleRateHzLocal ??
              liveSdrSettingsToUse?.sample_rate ??
              maxSampleRate
            }
            sampleRateOptions={sampleRateOptions}
            wholeChannelSampleRate={hackrfWholeChannelSampleRate}
            fileCapturedRange={fileCapturedRange}
            fftFrameRate={fftFrameRate}
            maxFrameRate={maxFrameRate}
            fftSize={fftSize}
            fftSizeOptions={fftSizeOptions}
            fftWindow={fftWindow || "Rectangular"}
            temporalResolution={displayTemporalResolution}
            backend={liveBackend}
            deviceProfile={liveDeviceProfileToUse}
            powerScale={powerScale}
            displayMode={displayMode || "fft"}
            onFftFrameRateChange={setFftFrameRate}
            onFftSizeChange={setFftSize}
            onSampleRateChange={handleSampleRateChange}
            onFftWindowChange={(win) => {
              dispatch(setFftWindowAction(win));
              storeDispatch({ type: "SET_FFT_WINDOW", fftWindow: win });
            }}
            onTemporalResolutionChange={(res) => {
              dispatch(setTemporalResolution(res));
              storeDispatch({
                type: "SET_TEMPORAL_RESOLUTION",
                resolution: res,
              });
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

          <TxSettingsSection
            signal={txSignal}
            sampleRateHz={txSampleRateHz}
            maxSampleRateHz={maxSampleRate}
            centerFrequencyHz={txCenterFrequencyHz}
            powerDbm={txPowerDbm}
            vgaGainDb={txVgaGain}
            onSignalChange={setTxSignal}
            onSampleRateChange={setTxSampleRateHz}
            onCenterFrequencyChange={setTxCenterFrequencyHz}
            onPowerDbmChange={setTxPowerDbm}
            onVgaGainChange={setTxVgaGain}
          />
        </>
      )}

      <ThemeSection />
    </SidebarContent>
  );
};

export default SpectrumSidebar;
