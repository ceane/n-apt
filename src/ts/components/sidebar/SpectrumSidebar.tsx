import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
} from "react";
import styled from "styled-components";
import { SatelliteDish, Trash2, Unplug } from "lucide-react";
import {
  useAppSelector,
  useAppDispatch,
  selectNoteCards,
  selectNoteCardsCollapsed,
  setNoteCardsCollapsed,
  removeNoteCard,
  setTxSignal,
  setTxSampleRateHz,
  setTxIfftSize,
  setTxCenterFrequencyHz,
  setTxPowerDbm,
  setTxVgaGain,
  setTxSafetyEnabled,
  setTxSafetyLimit,
  setTxHopType,
  setTxHopStartFrequencyHz,
  setTxHopEndFrequencyHz,
  setTxHopChannels,
  setTxHopRateHz,
  setTxHopEnabled,
  setHackrfAmpEnabled,
  setDeviceKind,
  setShowTxSlider,
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
  mergeLastKnownRanges,
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
  DeviceProfile,
} from "@n-apt/consts/schemas/websocket";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { SnapshotControlsSection } from "@n-apt/components/sidebar/SnapshotControlsSection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import FileSelectionSidebar from "@n-apt/components/sidebar/FileSelectionSidebar";
import { TxSettingsSection } from "@n-apt/components/sidebar/TxSettingsSection";
import { Button } from "@n-apt/components/ui/Button";
import { ThemeSection } from "@n-apt/components/sidebar/ThemeSection";
import { Channels } from "@n-apt/components/sidebar/Channels";
import SourceInput from "@n-apt/components/sidebar/SourceInput";
import { TransmitPrompt } from "@n-apt/components/prompts/TransmitPrompt";
import { buildSdrLimitMarkers } from "@n-apt/utils/sdrLimitMarkers";
import {
  canUseWholeChannelSnapshot,
  clampSampleRateToSourceMaximum,
  isRtlSdrDevice,
  resolveCaptureAcquisitionMode,
} from "@n-apt/utils/sdrSampleRateGuards";
import {
  supportsApproxDbm,
  isMockLiveSource as checkIsMockLiveSource,
  isMockAptSource as checkIsMockAptSource,
  getMockDeviceProfile,
} from "@n-apt/utils/deviceCapabilities";
import { usePrompt } from "@n-apt/components/ui/PromptProvider";
import { Collapsible } from "@n-apt/components/ui/Collapsible";
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import { parseFrequency } from "@n-apt/utils/frequency";
import { resolveSampleRateSpec, SampleRateSpec } from "@n-apt/utils/signals";

const SidebarContent = memo(styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px 24px 24px;
  box-sizing: border-box;
  max-width: 100%;
  overflow-anchor: none;
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

const StickyHeaderWrapper = memo(styled.div<{ $isSticky?: boolean }>`
  position: sticky;
  top: 0;
  z-index: 20;
  background-color: ${(props: any) => props.theme.background};
  grid-column: 1 / -1;
  margin-left: -24px;
  margin-right: -24px;
  margin-top: calc(-24px - env(safe-area-inset-top, 0px));
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px 16px 24px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-bottom: 1px solid
    ${(props: any) =>
      props.$isSticky ? props.theme.borderHover : "transparent"};
  overflow-anchor: none;
  transition: border-bottom 0.2s ease;
`);

const STICKY_COMPACT_ENTER_OFFSET_PX = 0;
const STICKY_COMPACT_EXIT_OFFSET_PX = 16;
const TX_SIGNAL_PRESETS: Record<
  string,
  { centerFrequencyHz: number; bandwidthHz: number }
> = {
  d: { centerFrequencyHz: 137_100_000, bandwidthHz: 600_000 },
  d_sharp: { centerFrequencyHz: 137_100_000, bandwidthHz: 50_000 },
  wifi: { centerFrequencyHz: 13_875_000, bandwidthHz: 1_000_000 },
  "5g": { centerFrequencyHz: 137_100_000, bandwidthHz: 2_000_000 },
};
const TX_SETTINGS_SYNC_DEBOUNCE_MS = 16;

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

const TRANSMIT_WARNING_ACK_KEY = "napt.transmitWarningAccepted";

const hasAcceptedTransmitWarning = () => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(TRANSMIT_WARNING_ACK_KEY) === "true";
  } catch {
    return false;
  }
};

const markTransmitWarningAccepted = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(TRANSMIT_WARNING_ACK_KEY, "true");
  } catch {
    // If storage is unavailable, keep the safety prompt behavior unchanged.
  }
};

const buildTxSettingsSyncKey = (values: {
  sourceId?: string | null;
  txSignal?: string | null;
  centerFrequencyHz?: number | null;
  bandwidthHz?: number | null;
  ifftSize?: number | null;
  powerDbm?: number | null;
  vgaGainDb?: number | null;
  ampEnabled?: boolean | null;
  safetyEnabled?: boolean | null;
  safetyLimit?: string | null;
  hopEnabled?: boolean | null;
  hopType?: string | null;
  hopStartFrequencyHz?: number | null;
  hopEndFrequencyHz?: number | null;
  hopChannels?: string[] | null;
  hopRateHz?: number | null;
}) =>
  JSON.stringify({
    sourceId: values.sourceId ?? null,
    txSignal: values.txSignal ?? null,
    centerFrequencyHz: values.centerFrequencyHz ?? null,
    bandwidthHz: values.bandwidthHz ?? null,
    ifftSize: values.ifftSize ?? null,
    powerDbm: values.powerDbm ?? null,
    vgaGainDb: values.vgaGainDb ?? null,
    ampEnabled: values.ampEnabled ?? null,
    safetyEnabled: values.safetyEnabled ?? null,
    safetyLimit: values.safetyLimit ?? null,
    hopEnabled: values.hopEnabled ?? null,
    hopType: values.hopType ?? null,
    hopStartFrequencyHz: values.hopStartFrequencyHz ?? null,
    hopEndFrequencyHz: values.hopEndFrequencyHz ?? null,
    hopChannels: values.hopChannels ?? null,
    hopRateHz: values.hopRateHz ?? null,
  });

const EMPTY_SELECTED_SOURCE_DERIVED = {
  deviceState: null,
  deviceName: null,
  deviceProfile: null,
  deviceInfo: null,
  backend: null,
  maxSampleRateHz: null,
  sampleRateOptions: [] as number[],
  sampleRateHz: null,
  sdrSettings: null,
};

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
    selectedSource,
    selectedSourceDerived = EMPTY_SELECTED_SOURCE_DERIVED,
    selectedSourceId = "",
    setSelectedSourceId = () => {},
    sources = [],
    wsConnection,
    manualVisualizerPaused,
    toggleVisualizerPause: toggleLiveVisualizerPause,
    cryptoCorrupted: liveCryptoCorrupted,
    deviceName: liveDeviceName,
    deviceProfile: liveDeviceProfile,
  } = useSpectrumStore();
  const lastSampleRateRef = useRef<number | null>(null);
  const mockManualSampleRateRef = useRef(false);
  const lastTxToggleTimeRef = useRef(0);
  const pendingTxStopSourceIdRef = useRef<string | null>(null);
  const lastTxSettingsSyncKeyRef = useRef<string | null>(null);
  const txSettingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
    stitchSourceSettings,
  } = liveState;
  const websocketChannels = useAppSelector((s) => s.websocket.channels);
  const channelFramesToUse = useMemo(
    () =>
      effectiveFrames.length > 0
        ? effectiveFrames
        : Array.isArray(websocketChannels) && websocketChannels.length > 0
          ? websocketChannels
          : [],
    [effectiveFrames, websocketChannels],
  );
  const activeFrameForArea = useMemo(() => {
    const area = activeSignalArea?.toLowerCase?.() ?? "";
    return (
      channelFramesToUse.find((frame) => frame.label.toLowerCase() === area) ??
      channelFramesToUse.find((frame) => frame.label === activeSignalArea) ??
      null
    );
  }, [activeSignalArea, channelFramesToUse]);
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
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const captureStatus = useAppSelector((s) => s.websocket.captureStatus);
  const spectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
  const websocketSources = useAppSelector((s) => s.websocket.sources);

  const { isAuthenticated, sessionToken, aesKey } = useAuthentication();
  const { getLocation } = useGeolocation();
  const liveIsConnected = wsConnection.isConnected ?? isConnected;
  const sourcesToUse = useMemo(() => {
    if (!liveIsConnected) {
      return [];
    }
    return sources.length > 0
      ? sources
      : Array.isArray(wsConnection.sources) && wsConnection.sources.length > 0
        ? wsConnection.sources
        : websocketSources;
  }, [liveIsConnected, sources, websocketSources, wsConnection.sources]);

  const liveBackend = selectedSourceDerived.backend ?? wsConnection.backend;
  const liveDeviceState =
    selectedSourceDerived.deviceState ?? wsConnection.deviceState;
  const liveDeviceLoadingReason =
    wsConnection.deviceLoadingReason ??
    (selectedSource?.status === "loading" ? "connect" : null);
  const liveIsPaused =
    manualVisualizerPaused ?? wsConnection.isPaused ?? isPaused;
  const liveCaptureStatus = wsConnection.captureStatus ?? captureStatus;
  const liveFramesToUse =
    channelFramesToUse.length > 0 ? channelFramesToUse : spectrumFrames;
  const liveSdrSettingsToUse =
    selectedSourceDerived.sdrSettings ?? effectiveSdrSettings;
  const liveDeviceNameToUse =
    selectedSourceDerived.deviceName ??
    liveDeviceName ??
    wsConnection.deviceName;
  const liveDeviceProfileToUse =
    selectedSourceDerived.deviceProfile ??
    liveDeviceProfile ??
    wsConnection.deviceProfile;
  const deviceTypeToUse =
    liveDeviceProfileToUse?.kind ?? liveBackend ?? undefined;
  const deviceTypeNormalized =
    deviceTypeToUse === "rtl-sdr" ? "rtl_sdr" : deviceTypeToUse;
  const activeDeviceConfig = deviceTypeNormalized
    ? liveSdrSettingsToUse?.devices?.[deviceTypeNormalized]
    : undefined;
  const gainLimits = activeDeviceConfig?.gain_limits;
  const liveSampleRateOptions = selectedSourceDerived.sampleRateOptions;
  const maxSampleRateHz =
    selectedSourceDerived.maxSampleRateHz ?? wsConnection.maxSampleRateHz;
  const deviceIdentity = useMemo(
    () => ({
      selectedSource,
      selectedSourceId,
      backend: liveBackend,
      deviceName: liveDeviceNameToUse,
      sourceMode,
    }),
    [
      selectedSource,
      selectedSourceId,
      liveBackend,
      liveDeviceNameToUse,
      sourceMode,
    ],
  );

  const isMockLiveSource = checkIsMockLiveSource(deviceIdentity);
  const isMockAptSource = checkIsMockAptSource(deviceIdentity);

  const mockTxDeviceProfile = useMemo<DeviceProfile | null>(() => {
    return getMockDeviceProfile(deviceIdentity);
  }, [deviceIdentity]);
  const liveDeviceProfileForDisplay =
    mockTxDeviceProfile ?? liveDeviceProfileToUse;
  const isHackrfOne =
    liveDeviceProfileForDisplay?.kind === "hackrf_one" ||
    liveBackend?.toLowerCase() === "hackrf_one";
  const isRtlSdr = isRtlSdrDevice({
    deviceKind: liveDeviceProfileForDisplay?.kind,
    backend: liveBackend,
    deviceName: liveDeviceNameToUse,
    isRtlSdr: liveDeviceProfileForDisplay?.is_rtl_sdr,
  });

  useEffect(() => {
    if (!liveDeviceProfileForDisplay?.kind) return;
    dispatch(setDeviceKind(liveDeviceProfileForDisplay.kind));
  }, [liveDeviceProfileForDisplay?.kind, dispatch]);

  useEffect(() => {
    const isPowerScaleSupported = supportsApproxDbm({
      deviceProfile: liveDeviceProfileForDisplay,
      backend: liveBackend,
      sourceMode,
    });

    if (!isPowerScaleSupported && powerScale === "dBm") {
      dispatch(setPowerScale("dB"));
      storeDispatch({ type: "SET_POWER_SCALE", powerScale: "dB" });
    }
  }, [
    liveDeviceProfileForDisplay,
    liveBackend,
    sourceMode,
    powerScale,
    dispatch,
    storeDispatch,
  ]);
  const mockResolved = useMemo(() => {
    if (!isMockLiveSource) return null;
    const spec = activeDeviceConfig?.sample_rate as SampleRateSpec | undefined;
    const activeFrameToPass = activeSignalAreaBounds
      ? {
          min_hz: activeSignalAreaBounds.min,
          max_hz: activeSignalAreaBounds.max,
        }
      : activeFrameForArea
        ? {
            min_hz: activeFrameForArea.min_hz,
            max_hz: activeFrameForArea.max_hz,
          }
        : null;
    const floorRate = 3_200_000;
    const maxRate = isMockAptSource
      ? (maxSampleRateHz ?? activeChannelSampleRate ?? floorRate)
      : Math.max(floorRate, activeChannelSampleRate ?? 0);
    return resolveSampleRateSpec(spec, activeFrameToPass, floorRate, maxRate);
  }, [
    isMockLiveSource,
    isMockAptSource,
    activeDeviceConfig?.sample_rate,
    activeSignalAreaBounds,
    activeFrameForArea,
    activeChannelSampleRate,
    maxSampleRateHz,
  ]);

  const liveManualSampleRateOptions = isMockLiveSource
    ? (liveSampleRateOptions.length > 0
        ? liveSampleRateOptions
        : (mockResolved?.options ?? [3_200_000]))
    : liveSampleRateOptions;
  const supportsWholeChannelSampleRate =
    sourceMode === "live" &&
    !isRtlSdr &&
    (isHackrfOne || isMockLiveSource);
  // Whole Channel is the selected channel's span. The source maximum is only
  // a ceiling; using it here would make Channel A inherit Channel C's rate.
  const liveWholeChannelSampleRate = activeChannelSampleRate;
  // For frame rate computation, use the actual SDR sample rate — NOT the
  // channel bandwidth.  The channel bandwidth (max_hz - min_hz) can exceed
  // the hardware sample rate and inflate floor(sampleRate / fftSize).
  const maxSampleRate = clampSampleRateToSourceMaximum(
    isMockLiveSource
      ? (sampleRateHzEffective ??
        liveSdrSettingsToUse?.sample_rate ??
        sampleRateHz ??
        maxSampleRateHz ??
        3_200_000)
      : (sampleRateHzEffective ??
        sampleRateHz ??
        maxSampleRateHz ??
        liveSdrSettingsToUse?.sample_rate ??
        0),
    maxSampleRateHz,
  );
  const sampleRateHzLocal =
    (typeof liveState.sampleRateHz === "number" &&
    Number.isFinite(liveState.sampleRateHz) &&
    liveState.sampleRateHz > 0
      ? clampSampleRateToSourceMaximum(liveState.sampleRateHz, maxSampleRateHz)
      : isMockLiveSource && mockResolved !== null
          ? clampSampleRateToSourceMaximum(mockResolved.rate, maxSampleRateHz)
        : typeof sampleRateHz === "number" &&
            Number.isFinite(sampleRateHz) &&
            sampleRateHz > 0
          ? clampSampleRateToSourceMaximum(sampleRateHz, maxSampleRateHz)
          : typeof sampleRateHzEffective === "number" &&
              Number.isFinite(sampleRateHzEffective) &&
              sampleRateHzEffective > 0
            ? clampSampleRateToSourceMaximum(
                sampleRateHzEffective,
                maxSampleRateHz,
              )
            : typeof liveSdrSettingsToUse?.sample_rate === "number" &&
                Number.isFinite(liveSdrSettingsToUse.sample_rate) &&
                liveSdrSettingsToUse.sample_rate > 0
              ? clampSampleRateToSourceMaximum(
                  liveSdrSettingsToUse.sample_rate,
                  maxSampleRateHz,
                )
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
    currentSampleRateHz:
      typeof liveState.sampleRateHz === "number" &&
      Number.isFinite(liveState.sampleRateHz) &&
      liveState.sampleRateHz > 0
        ? liveState.sampleRateHz
        : typeof sampleRateHzEffective === "number" &&
            Number.isFinite(sampleRateHzEffective) &&
            sampleRateHzEffective > 0
          ? sampleRateHzEffective
          : typeof liveSdrSettingsToUse?.sample_rate === "number" &&
              Number.isFinite(liveSdrSettingsToUse.sample_rate) &&
              liveSdrSettingsToUse.sample_rate > 0
            ? liveSdrSettingsToUse.sample_rate
            : undefined,
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
  const signalDisplaySampleRateOptions = isMockLiveSource
    ? liveManualSampleRateOptions
    : sampleRateOptions;

  const {
    wholeChannelSampleRate: hackrfWholeChannelSampleRate,
    handleSampleRateChange,
  } = useLiveSampleRateControl({
    sourceMode,
    supportsWholeChannelSampleRate,
    manualSampleRateOptions: liveManualSampleRateOptions,
    activeChannelSampleRate: liveWholeChannelSampleRate,
    maxSampleRateHz,
    activeSignalAreaBounds,
    frequencyRange,
    sampleRateHz: sampleRateHzLocal,
    fftSize,
    maxFrameRateLimit: maxFrameRate,
    setSampleRate,
    setFftFrameRate,
    applyFrequencyRange: (range) => {
      storeDispatch({ type: "SET_FREQUENCY_RANGE", range });
      wsConnection.sendFrequencyRange(range);
    },
  });
  const handleSignalDisplaySampleRateChange = useCallback(
    (nextSampleRate: number) => {
      const roundedNext = Math.round(nextSampleRate);
      const roundedWholeChannel =
        typeof hackrfWholeChannelSampleRate === "number" &&
        Number.isFinite(hackrfWholeChannelSampleRate)
          ? Math.round(hackrfWholeChannelSampleRate)
          : null;
      const roundedCurrent =
        typeof liveState.sampleRateHz === "number" &&
        Number.isFinite(liveState.sampleRateHz)
          ? Math.round(liveState.sampleRateHz)
          : null;
      const isLeavingWholeChannel =
        roundedWholeChannel !== null &&
        roundedCurrent === roundedWholeChannel &&
        roundedNext !== roundedWholeChannel;

      if (isLeavingWholeChannel && Number.isFinite(nextSampleRate)) {
        const anchoredRanges = liveFramesToUse.reduce<
          Record<string, { min: number; max: number }>
        >((ranges, frame) => {
          if (
            !frame?.label ||
            !Number.isFinite(frame.min_hz) ||
            !Number.isFinite(frame.max_hz) ||
            frame.max_hz <= frame.min_hz
          ) {
            return ranges;
          }
          const span = Math.max(1, Math.round(nextSampleRate));
          const range = {
            min: Math.round(frame.min_hz),
            max: Math.round(Math.min(frame.max_hz, frame.min_hz + span)),
          };
          ranges[frame.label] = range;
          ranges[frame.label.toLowerCase()] = range;
          return ranges;
        }, {});

        if (Object.keys(anchoredRanges).length > 0) {
          dispatch(mergeLastKnownRanges(anchoredRanges));
          storeDispatch({
            type: "MERGE_LAST_KNOWN_RANGES",
            ranges: anchoredRanges,
          });
        }
      }

      if (isMockLiveSource) {
        mockManualSampleRateRef.current =
          roundedWholeChannel === null || roundedNext !== roundedWholeChannel;
      }

      handleSampleRateChange(nextSampleRate);
    },
    [
      dispatch,
      handleSampleRateChange,
      hackrfWholeChannelSampleRate,
      isMockLiveSource,
      liveFramesToUse,
      liveState.sampleRateHz,
      storeDispatch,
    ],
  );

  useEffect(() => {
    if (
      sourceMode !== "live" ||
      !isMockLiveSource ||
      mockManualSampleRateRef.current ||
      typeof hackrfWholeChannelSampleRate !== "number" ||
      !Number.isFinite(hackrfWholeChannelSampleRate) ||
      hackrfWholeChannelSampleRate <= 0
    ) {
      return;
    }

    const roundedSampleRate =
      typeof sampleRateHzLocal === "number" &&
      Number.isFinite(sampleRateHzLocal)
        ? Math.round(sampleRateHzLocal)
        : null;
    const roundedWholeChannelRate = Math.round(hackrfWholeChannelSampleRate);
    if (roundedSampleRate === roundedWholeChannelRate) return;

    handleSampleRateChange(hackrfWholeChannelSampleRate);
  }, [
    handleSampleRateChange,
    hackrfWholeChannelSampleRate,
    isMockLiveSource,
    sampleRateHzLocal,
    sourceMode,
  ]);

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
  const txSignal = useAppSelector((state) => state.spectrum.txSignal || "wifi");
  const txSampleRateHz = useAppSelector(
    (state) => state.spectrum.txSampleRateHz,
  );
  const txIfftSize = useAppSelector((state) => state.spectrum.txIfftSize);
  const txCenterFrequencyHz = useAppSelector(
    (state) => state.spectrum.txCenterFrequencyHz,
  );
  const txPowerDbm = useAppSelector((state) => state.spectrum.txPowerDbm);
  const txVgaGain = useAppSelector((state) => state.spectrum.txVgaGain);
  const txSafetyEnabled = useAppSelector(
    (state) => state.spectrum.txSafetyEnabled,
  );
  const txSafetyLimit = useAppSelector((state) => state.spectrum.txSafetyLimit);
  const txHopType = useAppSelector(
    (state) => state.spectrum.txHopType ?? "range",
  );
  const txHopStartFrequencyHz = useAppSelector(
    (state) => state.spectrum.txHopStartFrequencyHz ?? 10_000_000,
  );
  const txHopEndFrequencyHz = useAppSelector(
    (state) => state.spectrum.txHopEndFrequencyHz ?? 20_000_000,
  );
  const txHopChannels = useAppSelector(
    (state) => state.spectrum.txHopChannels ?? ["a"],
  );
  const txHopRateHz = useAppSelector(
    (state) => state.spectrum.txHopRateHz ?? 10,
  );
  const txHopEnabled = useAppSelector(
    (state) => state.spectrum.txHopEnabled ?? false,
  );
  const [livePreviewStage, setLivePreviewStage] = useState(0);

  const mockTxSource = useMemo(() => {
    return sourcesToUse.find((s) => s.id === "mock-tx" || s.kind === "mock_tx");
  }, [sourcesToUse]);

  const txSignalPresets = useMemo(() => {
    const backendMockTx = (mockTxSource as any)?.mock_tx;
    if (backendMockTx?.signals) {
      const presets: Record<
        string,
        { centerFrequencyHz: number; bandwidthHz: number }
      > = {};
      for (const [key, sig] of Object.entries(backendMockTx.signals)) {
        const signalObj = sig as any;
        presets[key.toLowerCase()] = {
          centerFrequencyHz: signalObj.center_frequency_hz ?? 0,
          bandwidthHz: signalObj.bandwidth_hz ?? signalObj.sample_rate_hz ?? 0,
        };
      }
      return presets;
    }
    return TX_SIGNAL_PRESETS;
  }, [mockTxSource]);

  const signalOptions = useMemo(() => {
    const backendMockTx = (mockTxSource as any)?.mock_tx;
    if (backendMockTx?.signals) {
      return Object.entries(backendMockTx.signals).map(([key, sig]) => {
        const signalObj = sig as any;
        return {
          value: key.toLowerCase(),
          label: signalObj.label || key.toUpperCase(),
        };
      });
    }
    return [
      { value: "d", label: "D" },
      { value: "d_sharp", label: "D#" },
      { value: "wifi", label: "Mock WiFi" },
      { value: "5g", label: "Mock 5G" },
    ];
  }, [mockTxSource]);

  const isTransmittingGlobal = useMemo(() => {
    if (selectedSource && selectedSource.status === "transmitting") {
      return true;
    }
    return sourcesToUse.some((source) => source.status === "transmitting");
  }, [sourcesToUse, selectedSource]);

  const txTargetDeviceId = useMemo(() => {
    const transmittingSource = sourcesToUse.find(
      (s) => s.status === "transmitting",
    );
    if (selectedSource?.status === "transmitting") {
      return selectedSource.id;
    }
    if (transmittingSource) {
      return transmittingSource.id;
    }
    if (
      selectedSource &&
      (selectedSource.capability === "tx" ||
        selectedSource.capability === "tx_rx" ||
        selectedSource.kind === "mock_tx" ||
        selectedSource.kind === "mock-tx")
    ) {
      return selectedSource.id;
    }
    return sourcesToUse.find(
      (s) =>
        s.capability === "tx" ||
        s.capability === "tx_rx" ||
        s.kind === "mock_tx" ||
        s.kind === "mock-tx",
    )?.id;
  }, [sourcesToUse, selectedSource]);
  const selectedSourceCapability = selectedSource?.capability?.toLowerCase?.();
  const selectedSourceKind = selectedSource?.kind?.toLowerCase?.() ?? "";
  const selectedBackendKind =
    liveDeviceProfileForDisplay?.kind?.toLowerCase?.() ??
    liveBackend?.toLowerCase?.() ??
    "";
  const isTxCapableSelectedSource =
    selectedSourceCapability === "tx" ||
    selectedSourceCapability === "tx_rx" ||
    selectedSourceKind === "hackrf_one" ||
    selectedSourceKind === "mock_tx" ||
    selectedSourceKind === "mock-tx" ||
    selectedBackendKind === "hackrf_one" ||
    selectedBackendKind === "mock_tx";

  const handleToggleTransmitMode = useCallback(
    (sourceId: string, nextEnabled: boolean) => {
      if (!isConnected) {
        return;
      }
      const now = Date.now();
      if (nextEnabled && now - lastTxToggleTimeRef.current < 800) {
        console.warn("Throttling rapid transmit mode toggle request");
        return;
      }

      const source =
        selectedSource?.id === sourceId
          ? selectedSource
          : (sourcesToUse.find((entry) => entry.id === sourceId) ??
            (sourcesToUse.length === 1 ? sourcesToUse[0] : null));
      if (!source) {
        return;
      }

      const applyToggle = () => {
        pendingTxStopSourceIdRef.current = nextEnabled ? null : source.id;
        lastTxSettingsSyncKeyRef.current = nextEnabled
          ? buildTxSettingsSyncKey({
              sourceId: source.id,
              txSignal,
              centerFrequencyHz:
                txCenterFrequencyHz ??
                source.sdr?.settings?.center_frequency ??
                undefined,
              bandwidthHz:
                txSampleRateHz ??
                source.sdr?.settings?.sample_rate ??
                undefined,
              ifftSize: txIfftSize,
              powerDbm: txPowerDbm ?? undefined,
              vgaGainDb:
                txVgaGain ?? source.sdr?.settings?.hackrf_vga_gain ?? undefined,
              ampEnabled:
                source.sdr?.settings?.hackrf_amp_enable ??
                liveState?.hackrfAmpEnabled ??
                undefined,
              safetyEnabled: txSafetyEnabled,
              safetyLimit: txSafetyLimit,
              hopEnabled: txHopEnabled,
              hopType: txHopType,
              hopStartFrequencyHz: txHopStartFrequencyHz,
              hopEndFrequencyHz: txHopEndFrequencyHz,
              hopChannels: txHopChannels,
              hopRateHz: txHopRateHz,
            })
          : null;
        wsConnection.sendTransmitMode?.(nextEnabled, source.name ?? sourceId, {
          serialNumber: source.serial_number?.trim() || sourceId,
          centerFrequencyHz:
            txCenterFrequencyHz ??
            source.sdr?.settings?.center_frequency ??
            undefined,
          bandwidthHz:
            txSampleRateHz ?? source.sdr?.settings?.sample_rate ?? undefined,
          ifftSize: txIfftSize,
          powerDbm: txPowerDbm ?? undefined,
          vgaGainDb:
            txVgaGain ?? source.sdr?.settings?.hackrf_vga_gain ?? undefined,
          lnaGainDb:
            source.sdr?.settings?.hackrf_lna_gain ??
            liveState?.hackrfLnaGain ??
            undefined,
          ampEnabled:
            source.sdr?.settings?.hackrf_amp_enable ??
            liveState?.hackrfAmpEnabled ??
            undefined,
          tunerAgc:
            source.sdr?.settings?.tuner_agc ?? liveState?.tunerAGC ?? undefined,
          rtlAgc:
            source.sdr?.settings?.rtl_agc ?? liveState?.rtlAGC ?? undefined,
          ppm: source.sdr?.settings?.ppm ?? liveState?.ppm ?? undefined,
          txSafetyEnabled,
          txSafetyLimit,
          txSignal,
          txHopEnabled,
          txHopType,
          txHopStartFrequencyHz,
          txHopEndFrequencyHz,
          txHopChannels,
          txHopRateHz,
        });
      };

      if (nextEnabled) {
        lastTxToggleTimeRef.current = now;
        if (hasAcceptedTransmitWarning()) {
          applyToggle();
          return;
        }

        showPrompt({
          title: "Check Before You Transmit",
          message: <TransmitPrompt />,
          confirmText: "Continue (Accept Responsibility)",
          cancelText: "Let me think about it...",
          onConfirm: () => {
            markTransmitWarningAccepted();
            applyToggle();
          },
        });
        return;
      }

      lastTxToggleTimeRef.current = 0;
      applyToggle();
    },
    [
      liveState.hackrfAmpEnabled,
      liveState.hackrfLnaGain,
      liveState.ppm,
      liveState.rtlAGC,
      liveState.tunerAGC,
      selectedSource,
      showPrompt,
      sourcesToUse,
      txCenterFrequencyHz,
      txPowerDbm,
      txSampleRateHz,
      txVgaGain,
      txSafetyEnabled,
      txSafetyLimit,
      txSignal,
      txHopEnabled,
      txHopType,
      txHopStartFrequencyHz,
      txHopEndFrequencyHz,
      txHopChannels,
      txHopRateHz,
      isConnected,
      wsConnection.sendTransmitMode,
    ],
  );

  const handleTxSignalChange = useCallback(
    (value: string) => {
      dispatch(setTxSignal(value));
      const preset = txSignalPresets[value.toLowerCase()];
      if (!preset) return;
      dispatch(setTxCenterFrequencyHz(preset.centerFrequencyHz));
      dispatch(setTxSampleRateHz(preset.bandwidthHz));
    },
    [dispatch, txSignalPresets],
  );

  useEffect(() => {
    if (!isTransmittingGlobal) {
      pendingTxStopSourceIdRef.current = null;
      lastTxSettingsSyncKeyRef.current = null;
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
      return;
    }
    if (!txTargetDeviceId) return;
    if (pendingTxStopSourceIdRef.current === txTargetDeviceId) return;
    const source = sourcesToUse.find((entry) => entry.id === txTargetDeviceId);
    if (!source) return;
    const syncKey = buildTxSettingsSyncKey({
      sourceId: source.id,
      txSignal,
      centerFrequencyHz: txCenterFrequencyHz,
      bandwidthHz: txSampleRateHz,
      ifftSize: txIfftSize,
      powerDbm: txPowerDbm,
      vgaGainDb: txVgaGain,
      ampEnabled: hackrfAmpEnabled,
      safetyEnabled: txSafetyEnabled,
      safetyLimit: txSafetyLimit,
      hopEnabled: txHopEnabled,
      hopType: txHopType,
      hopStartFrequencyHz: txHopStartFrequencyHz,
      hopEndFrequencyHz: txHopEndFrequencyHz,
      hopChannels: txHopChannels,
      hopRateHz: txHopRateHz,
    });
    if (lastTxSettingsSyncKeyRef.current === syncKey) {
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
      return;
    }
    const sendTxSettings = () => {
      lastTxSettingsSyncKeyRef.current = syncKey;
      wsConnection.sendTransmitMode?.(true, source.name ?? txTargetDeviceId, {
        serialNumber: source.serial_number?.trim() || txTargetDeviceId,
        centerFrequencyHz: txCenterFrequencyHz,
        bandwidthHz: txSampleRateHz,
        ifftSize: txIfftSize,
        powerDbm: txPowerDbm,
        vgaGainDb: txVgaGain,
        ampEnabled: hackrfAmpEnabled,
        txSafetyEnabled,
        txSafetyLimit,
        txSignal,
        txHopEnabled,
        txHopType,
        txHopStartFrequencyHz,
        txHopEndFrequencyHz,
        txHopChannels,
        txHopRateHz,
      });
    };

    if (lastTxSettingsSyncKeyRef.current === null) {
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
      sendTxSettings();
      return;
    }

    if (txSettingsSyncTimerRef.current) {
      clearTimeout(txSettingsSyncTimerRef.current);
    }
    txSettingsSyncTimerRef.current = setTimeout(() => {
      txSettingsSyncTimerRef.current = null;
      sendTxSettings();
    }, TX_SETTINGS_SYNC_DEBOUNCE_MS);
  }, [
    isTransmittingGlobal,
    txTargetDeviceId,
    txSignal,
    txCenterFrequencyHz,
    txSampleRateHz,
    txIfftSize,
    txPowerDbm,
    txVgaGain,
    hackrfAmpEnabled,
    txSafetyEnabled,
    txSafetyLimit,
    txHopEnabled,
    txHopType,
    txHopStartFrequencyHz,
    txHopEndFrequencyHz,
    txHopChannels,
    txHopRateHz,
    sourcesToUse,
    wsConnection.sendTransmitMode,
  ]);

  useEffect(() => {
    return () => {
      if (txSettingsSyncTimerRef.current) {
        clearTimeout(txSettingsSyncTimerRef.current);
        txSettingsSyncTimerRef.current = null;
      }
    };
  }, []);

  const sourceDevices = useMemo(() => {
    const mappedSources = sourcesToUse.map((source) => {
      const isTransmitting = source.status === "transmitting";
      const isStreaming = source.status === "streaming";
      const isPaused = source.paused ?? false;
      const supportsTx =
        source.capability === "tx" || source.capability === "tx_rx";
      const isMockSource = source.capability === "mock";
      const isLiveConnected =
        source.status === "connected" || isStreaming || isMockSource;
      const canToggleStreaming = isLiveConnected;
      const actionLabel =
        isTransmitting || supportsTx
          ? isTransmitting
            ? "Stop Tx"
            : "Start Tx"
          : canToggleStreaming
            ? isPaused
              ? "Resume"
              : "Pause"
            : undefined;
      const actionTitle =
        isTransmitting || supportsTx
          ? isTransmitting
            ? "Stop transmit mode"
            : "Start transmit mode"
          : canToggleStreaming
            ? isPaused
              ? "Resume playback"
              : "Pause playback"
            : undefined;
      const onAction =
        isTransmitting || supportsTx
          ? () => handleToggleTransmitMode(source.id, !isTransmitting)
          : canToggleStreaming
            ? () => toggleLiveVisualizerPause(source.id)
            : undefined;

      return {
        id: source.id,
        name: source.name,
        backend: source.kind,
        capability: source.capability,
        duplex_mode:
          source.duplex_mode ??
          (source.kind === "mock_apt" || source.id === "mock-apt"
            ? "Simplex"
            : source.kind === "mock_tx" || source.id === "mock-tx"
              ? "Simplex"
              : null),
        summary: source.serial_number
          ? `SN ${source.serial_number}`
          : source.manufacturer
            ? source.manufacturer
            : undefined,
        status: {
          color: isTransmitting
            ? "#19d9ff"
            : isMockSource && isStreaming
              ? "#ffb000"
              : isStreaming
                ? "#19d97d"
                : undefined,
          label: source.status ?? undefined,
          paused: source.paused,
          loading: source.status === "loading",
          loadingLabel:
            source.status === "loading"
              ? source.kind === "hackrf_one"
                ? "Waiting for Rx…"
                : `Loading ${source.name}…`
              : undefined,
          actionLabel,
          actionTitle,
          onAction,
        },
      };
    });
    return mappedSources;
  }, [handleToggleTransmitMode, sourcesToUse, toggleLiveVisualizerPause]);
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
  }, [
    dispatch,
    isStitchPaused,
    selectedFiles.length,
    sourceMode,
    storeDispatch,
    stitchStatus,
  ]);

  const handleSourceFilesSelected = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const registeredFiles = files.map((file) => ({
        id: fileRegistry.register(file),
        name: file.name,
      }));

      dispatch(setSelectedFiles(registeredFiles));
      storeDispatch({ type: "SET_SELECTED_FILES", files: registeredFiles });
    },
    [dispatch, storeDispatch],
  );

  const handleSourceModeChange = useCallback(
    (mode: "live" | "file") => {
      if (mode === "file") {
        setLivePreviewStage(0);
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
  }, [availableCaptureAreas, activeCaptureAreasSet, visibleOnscreenRange]);

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
    const effectiveAcquisitionMode = resolveCaptureAcquisitionMode({
      requestedMode: acquisitionMode,
      isOnscreenActive: onscreenIsActive,
      onscreenSpanHz: onscreenSpan,
      hardwareSampleRateHz,
      deviceKind: liveDeviceProfileToUse?.kind,
      backend: liveBackend,
      deviceName: liveDeviceNameToUse,
      isRtlSdr: liveDeviceProfileToUse?.is_rtl_sdr,
    });

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
    liveDeviceProfileToUse?.kind,
    liveBackend,
    liveDeviceNameToUse,
    captureEncrypted,
    captureGeolocation,
    fftSize,
    fftWindow,
    dispatch,
    getLocation,
  ]);

  const handleSnapshot = () => {
    const canSnapshotWhole = canUseWholeChannelSnapshot({
      requestedWhole: snapshotWhole,
      deviceKind: liveDeviceProfileToUse?.kind,
      backend: liveBackend,
      deviceName: liveDeviceNameToUse,
      isRtlSdr: liveDeviceProfileToUse?.is_rtl_sdr,
    });
    dispatch(bumpSnapshotSectionPulse());
    window.dispatchEvent(
      new CustomEvent("napt-snapshot", {
        detail: {
          whole: canSnapshotWhole,
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
      if (naptMetadata !== null) {
        setNaptMetadata(null);
      }
      if (naptMetadataError !== null) {
        setNaptMetadataError(null);
      }
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
  }, [selectedPrimaryFile, aesKey, naptMetadata, naptMetadataError]);

  const limitMarkers = useMemo(
    () =>
      isMockLiveSource
        ? []
        : buildSdrLimitMarkers(wsConnection.sdrLimitMarkers),
    [isMockLiveSource, wsConnection.sdrLimitMarkers],
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

  const stickyWrapperRef = useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = useState(false);
  const stickyStartRef = useRef<number | null>(null);

  useEffect(() => {
    const wrapper = stickyWrapperRef.current;
    if (!wrapper) return;

    const findScrollParent = (element: HTMLElement): HTMLElement | Window => {
      let parent = element.parentElement;
      while (parent) {
        const { overflowY } = window.getComputedStyle(parent);
        if (
          /(auto|scroll|overlay)/.test(overflowY) &&
          parent.scrollHeight > parent.clientHeight
        ) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return window;
    };

    const scrollParent = findScrollParent(wrapper);
    const readScrollTop = () =>
      scrollParent === window
        ? window.scrollY
        : (scrollParent as HTMLElement).scrollTop;

    const readStickyStart = () => {
      if (scrollParent === window) {
        return wrapper.getBoundingClientRect().top + window.scrollY;
      }

      let top = 0;
      let current: HTMLElement | null = wrapper;

      while (current && current !== scrollParent) {
        top += current.offsetTop;
        current = current.offsetParent as HTMLElement | null;
      }

      return top;
    };

    if (stickyStartRef.current === null) {
      stickyStartRef.current = readStickyStart();
    }

    const updateStickyState = () => {
      const stickyStart = stickyStartRef.current ?? readStickyStart();
      const scrollTop = readScrollTop();
      const nextIsSticky = isSticky
        ? scrollTop >= stickyStart - STICKY_COMPACT_EXIT_OFFSET_PX
        : scrollTop >= stickyStart - STICKY_COMPACT_ENTER_OFFSET_PX;
      setIsSticky((current) =>
        current === nextIsSticky ? current : nextIsSticky,
      );
    };

    updateStickyState();
    scrollParent.addEventListener("scroll", updateStickyState, {
      passive: true,
    });
    window.addEventListener("resize", updateStickyState);

    return () => {
      scrollParent.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  }, [isSticky]);

  return (
    <SidebarContent>
      <StickyHeaderWrapper ref={stickyWrapperRef} $isSticky={isSticky}>
        <SectionTitle $fileMode={sourceMode === "file"}>
          <SectionIcon>
            <Unplug size={14} />
          </SectionIcon>
          <SectionText>Source</SectionText>
        </SectionTitle>

        <SourceInput
          sourceMode={sourceMode}
          compactActiveOnly={isSticky}
          fileModeColor="var(--color-file-mode)"
          livePreviewStage={livePreviewStage}
          fileActionLabel={fileActionLabel}
          fileActionTitle={fileActionTitle}
          selectedFilesCount={selectedFiles.length}
          onFileAction={handleFileAction}
          onFilesSelected={handleSourceFilesSelected}
          devices={sourceDevices}
          selectedDeviceId={
            sourceMode === "live" ? selectedSourceId : undefined
          }
          spaceBoundDeviceId={
            sourceMode === "live" ? selectedSourceId || null : null
          }
          onSelectedDeviceChange={(id) => {
            setSelectedSourceId(id);
            const nextSelectedDevice =
              sourcesToUse.find((entry) => entry.id === id) ?? null;
            const nextIsTxCapable =
              nextSelectedDevice?.capability?.toLowerCase().includes("tx") ??
              false;
            if (sourceMode === "live" && !nextIsTxCapable) {
              dispatch(setShowTxSlider(false));
            }
            if (sourceMode === "file") {
              handleSourceModeChange("live");
            }
            setLivePreviewStage(1);
          }}
          onToggleDeviceRxPause={(id) => {
            toggleLiveVisualizerPause(id);
          }}
          onToggleDeviceTxMode={(id) => {
            const current =
              sourceDevices.find((entry) => entry.id === id)?.status?.label ===
              "transmitting";
            handleToggleTransmitMode(id, !current);
          }}
          onSourceModeChange={handleSourceModeChange}
        />
      </StickyHeaderWrapper>

      {sourceMode === "live" ? (
        <>
          <Section>
            <ResetButton
              onClick={handleResetOptions}
              title="Reset sidebar and visualizer options to defaults"
            >
              Reset Options to Defaults
            </ResetButton>
          </Section>

          <Channels
            variant="spectrum"
            fileMode={false}
            limitMarkers={limitMarkers}
            rangeSlidersDisabled={visualizerLoading}
          />

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
            wholeChannelDisabled={isRtlSdr}
            wholeChannelDisabledReason="RTL-SDR is limited to its current 3.2MHz hardware window; whole-channel retune/stitch snapshots are disabled."
          />

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

          {isTxCapableSelectedSource ? (
            <Collapsible
              title="Tx Settings"
              icon={<SatelliteDish size={14} />}
              defaultOpen={true}
            >
              <TxSettingsSection
                signal={txSignal}
                bandwidthHz={txSampleRateHz}
                maxBandwidthHz={maxSampleRateHz}
                fftSize={fftSize}
                ifftSize={txIfftSize}
                ifftSizeOptions={fftSizeOptions}
                centerFrequencyHz={txCenterFrequencyHz}
                powerDbm={txPowerDbm}
                vgaGainDb={txVgaGain}
                ampEnabled={hackrfAmpEnabled}
                onSignalChange={handleTxSignalChange}
                signalOptions={signalOptions}
                onBandwidthChange={(value) =>
                  dispatch(setTxSampleRateHz(value))
                }
                onIfftSizeChange={(value) => dispatch(setTxIfftSize(value))}
                onCenterFrequencyChange={(value) =>
                  dispatch(setTxCenterFrequencyHz(value))
                }
                onPowerDbmChange={(value) => dispatch(setTxPowerDbm(value))}
                onVgaGainChange={(value) => dispatch(setTxVgaGain(value))}
                onAmpEnabledChange={(value) => setHackrfAmpEnabled(value)}
                isTransmitting={isTransmittingGlobal}
                onToggleTransmit={
                  txTargetDeviceId
                    ? () =>
                        handleToggleTransmitMode(
                          txTargetDeviceId,
                          !isTransmittingGlobal,
                        )
                    : undefined
                }
                safetyEnabled={txSafetyEnabled}
                onSafetyEnabledChange={(value) =>
                  dispatch(setTxSafetyEnabled(value))
                }
                safetyLimit={txSafetyLimit}
                onSafetyLimitChange={(value) =>
                  dispatch(setTxSafetyLimit(value))
                }
                hopEnabled={txHopEnabled}
                onHopEnabledChange={(value) => dispatch(setTxHopEnabled(value))}
                hopType={txHopType}
                onHopTypeChange={(value) => dispatch(setTxHopType(value))}
                hopStartFrequencyHz={txHopStartFrequencyHz}
                onHopStartFrequencyHzChange={(value) =>
                  dispatch(setTxHopStartFrequencyHz(value))
                }
                hopEndFrequencyHz={txHopEndFrequencyHz}
                onHopEndFrequencyHzChange={(value) =>
                  dispatch(setTxHopEndFrequencyHz(value))
                }
                hopChannels={txHopChannels}
                onHopChannelsChange={(value) =>
                  dispatch(setTxHopChannels(value))
                }
                hopRateHz={txHopRateHz}
                onHopRateHzChange={(value) => dispatch(setTxHopRateHz(value))}
                rxSampleRateHz={
                  activeChannelSampleRate ??
                  sampleRateHzLocal ??
                  liveSdrSettingsToUse?.sample_rate ??
                  maxSampleRate
                }
              />
            </Collapsible>
          ) : null}

          <SignalDisplaySection
            sourceMode={sourceMode}
            maxSampleRate={maxSampleRate}
            minReceiveSampleRate={liveSdrSettingsToUse?.min_receive_sample_rate}
            sampleRate={
              sampleRateHzLocal ??
              liveSdrSettingsToUse?.sample_rate ??
              maxSampleRate
            }
            sampleRateOptions={signalDisplaySampleRateOptions}
            wholeChannelSampleRate={hackrfWholeChannelSampleRate}
            fileCapturedRange={fileCapturedRange}
            fftFrameRate={fftFrameRate}
            maxFrameRate={maxFrameRate}
            fftSize={fftSize}
            fftSizeOptions={fftSizeOptions}
            fftWindow={fftWindow || "Rectangular"}
            temporalResolution={displayTemporalResolution}
            backend={liveBackend}
            deviceProfile={liveDeviceProfileForDisplay}
            powerScale={powerScale}
            displayMode={displayMode || "fft"}
            onFftFrameRateChange={setFftFrameRate}
            onFftSizeChange={setFftSize}
            onSampleRateChange={handleSignalDisplaySampleRateChange}
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

          <SourceSettingsSection
            sourceMode={sourceMode}
            deviceType={liveDeviceProfileForDisplay?.kind}
            gain={gain}
            gainLimits={gainLimits}
            hackrfLnaGain={liveState.hackrfLnaGain}
            hackrfVgaGain={liveState.hackrfVgaGain}
            hackrfAmpEnabled={liveState.hackrfAmpEnabled}
            hackrfBasebandBandwidth={liveState.hackrfBasebandBandwidth}
            hackrfCurrentSampleRate={
              sampleRateHzEffective ?? liveState.sampleRateHz
            }
            frequencyRangeMin={
              frequencyRange?.min ?? activeSignalAreaBounds?.min
            }
            ppm={ppm}
            tunerAGC={tunerAGC}
            rtlAGC={rtlAGC}
            isConnected={isServerConnected}
            stitchSourceSettings={stitchSourceSettings}
            onGainChange={setGain}
            onHackrfLnaGainChange={setHackrfLnaGain}
            onHackrfVgaGainChange={setHackrfVgaGain}
            onHackrfAmpEnabledChange={setHackrfAmpEnabled}
            onHackrfBasebandBandwidthChange={setHackrfBasebandBandwidth}
            onPpmChange={setPpm}
            onTunerAGCChange={setTunerAGC}
            onRtlAGCChange={setRtlAGC}
            onStitchSourceSettingsChange={(settings) =>
              dispatch({ type: "SET_STITCH_SOURCE_SETTINGS", settings })
            }
            onAgcModeChange={(nextTunerAGC, nextRtlAGC) => {
              setTunerAGC(nextTunerAGC);
              setRtlAGC(nextRtlAGC);
            }}
          />

          <ThemeSection />
        </>
      ) : (
        <>
          <FileSelectionSidebar
            selectedFiles={selectedFiles}
            onSelectedFilesChange={(files) => {
              dispatch(setSelectedFiles(files));
              storeDispatch({ type: "SET_SELECTED_FILES", files });
            }}
            stitchStatus={stitchStatus}
            isStitchPaused={isStitchPaused}
            onClear={() => {
              selectedFiles.forEach((file) => fileRegistry.remove(file.id));
              dispatch(setSelectedFiles([]));
              storeDispatch({ type: "SET_SELECTED_FILES", files: [] });
            }}
            selectedPrimaryFile={selectedPrimaryFile}
            naptMetadata={naptMetadata}
            naptMetadataError={naptMetadataError}
            sessionToken={sessionToken}
            showMetadata={true}
            signalDisplayProps={{
              maxSampleRate: maxSampleRate,
              minReceiveSampleRate:
                liveSdrSettingsToUse?.min_receive_sample_rate ?? undefined,
              sampleRate:
                sampleRateHzLocal ??
                liveSdrSettingsToUse?.sample_rate ??
                maxSampleRate,
              sampleRateOptions: signalDisplaySampleRateOptions,
              wholeChannelSampleRate: hackrfWholeChannelSampleRate,
              fileCapturedRange,
              fftFrameRate,
              maxFrameRate,
              fftSize,
              fftSizeOptions,
              fftWindow: fftWindow || "Rectangular",
              temporalResolution: displayTemporalResolution,
              backend: liveBackend,
              deviceProfile: liveDeviceProfileToUse,
              powerScale,
              displayMode: displayMode || "fft",
              onFftFrameRateChange: setFftFrameRate,
              onFftSizeChange: setFftSize,
              onSampleRateChange: handleSignalDisplaySampleRateChange,
              onFftWindowChange: (win) => {
                dispatch(setFftWindowAction(win));
                storeDispatch({ type: "SET_FFT_WINDOW", fftWindow: win });
              },
              onTemporalResolutionChange: (res) => {
                dispatch(setTemporalResolution(res));
                storeDispatch({
                  type: "SET_TEMPORAL_RESOLUTION",
                  resolution: res,
                });
              },
              onPowerScaleChange: (ps) => {
                dispatch(setPowerScale(ps));
                storeDispatch({ type: "SET_POWER_SCALE", powerScale: ps });
              },
              onDisplayModeChange: (mode) => {
                dispatch(setDisplayMode(mode));
                storeDispatch({ type: "SET_DISPLAY_MODE", displayMode: mode });
              },
              scheduleCoupledAdjustment,
            }}
          />

          <ThemeSection />
        </>
      )}
    </SidebarContent>
  );
};

export default SpectrumSidebar;
