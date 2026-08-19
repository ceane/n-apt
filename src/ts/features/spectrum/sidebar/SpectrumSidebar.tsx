import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
} from "react";
import styled from "styled-components";
import { SatelliteDish, Trash2, Unplug, ChevronDown } from "lucide-react";
import { useLocation } from "react-router";
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
  setTxGeometry,
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
  setRemoveDcSpike,
  setFrequencyRange,
  setActiveSignalArea,
  setSourceBinding,
} from "@n-apt/redux";
import {
  getSupportedSnapshotVideoFormat,
  type SnapshotVideoFormat,
  type SnapshotAspectRatio,
} from "@n-apt/capture/public/useSnapshot";
import {
  setSourceMode,
  setSelectedFiles,
  triggerStitch,
  clearWaterfall,
  setStitchPaused,
  setFftFrameRate as setFftFrameRateAction,
  setTemporalResolution,
  setPowerScale,
  setSampleRate as setSampleRateAction,
  setSdrSettingsBundle,
  setBasebandFilterPinned as setBasebandFilterPinnedAction,
  resetLiveControls as resetLiveControlsAction,
  setStitchSourceSettings as setStitchSourceSettingsAction,
  setCaptureStatus,
  setDisplayMode,
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
import { requestNextLiveFrame } from "@n-apt/redux/thunks/websocketThunks";
import {
  deriveStateFromConfig,
  useSdrSettings,
} from "@n-apt/settings/public/useSdrSettings";
import {
  resolveHackrfBasebandSampleRateHz,
  useLiveSampleRateControl,
} from "@n-apt/spectrum/hooks/useLiveSampleRateControl";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/maps/public/useGeolocation";
import { reverseGeocodeSnapshotLocation } from "@n-apt/capture";
import { useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { useSpectrumTransport } from "@n-apt/spectrum/hooks/useSpectrumTransport";
import { LIVE_CONTROL_DEFAULTS } from "@n-apt/spectrum/hooks/useSpectrumStore";
import type {
  CaptureRequest,
  CaptureFileType,
  DeviceProfile,
} from "@n-apt/consts/schemas/websocket";
import { SignalDisplaySection } from "@n-apt/spectrum";
import { IQCaptureControlsSection } from "@n-apt/capture";
import { SnapshotControlsSection } from "@n-apt/capture";
import { SourceSettingsSection } from "@n-apt/spectrum";
import { FileSelectionSidebar } from "@n-apt/capture";
import { TxSettingsSection } from "@n-apt/transmit";
import { Button } from "@n-apt/ui/Button";
import { ThemeSection } from "@n-apt/settings";
import { Channels } from "@n-apt/spectrum";
import SourceInput from "@n-apt/spectrum/sidebar/SourceInput";
import { TransmitPrompt } from "@n-apt/transmit";
import { buildSdrLimitMarkers } from "@n-apt/math/sdrLimitMarkers";
import { shouldCompactSidebarSourceList } from "@n-apt/app/layout/sidebarStickyState";
import {
  canUseWholeChannelSnapshot,
  clampSampleRateToSourceMaximum,
  isRtlSdrDevice,
  isHackrfDevice,
  resolveCaptureAcquisitionMode,
} from "@n-apt/app/infrastructure/io/sdrSampleRateGuards";
import { resolveWholeChannelViewport } from "@n-apt/spectrum/utils/wholeChannelPresentation";
import {
  supportsApproxDbm,
  isMockLiveSource as checkIsMockLiveSource,
  isMockAptSource as checkIsMockAptSource,
  getMockDeviceProfile,
  isMockTxSource,
} from "@n-apt/app/infrastructure/services/deviceCapabilities";
import { usePrompt } from "@n-apt/ui/PromptProvider";
import { Collapsible } from "@n-apt/ui/Collapsible";
import { fileRegistry } from "@n-apt/app/infrastructure/io/fileRegistry";
import { buildSafeDownloadUrl } from "@n-apt/ui/downloadUrl";
import { LinkCardItemView } from "@n-apt/ui/LinkCardGrid";
import {
  LINGO_AND_LEARN_LINK_CARD,
  START_PAGE_LINK_CARD,
} from "@n-apt/app/navigationLinkCards";
import { getSettingsDefaults } from "@n-apt/settings/public/settingsDefaults";
import {
  buildCenteredFrequencyRange,
  parseFrequency,
} from "@n-apt/math/frequency";
import { resolveSampleRateSpec, SampleRateSpec } from "@n-apt/math/signals";
import {
  canToggleTransmitMode,
  resolveSourceModeManagement,
  resolveSourceModeTransition,
  resolveTxStopTransition,
  shouldRetainTxStandbyAfterStop,
} from "@n-apt/app/infrastructure/streams/sourceModeManagement";
import { resolveMockTxTransmitSettings } from "@n-apt/transmit/public/txSliderPlacement";

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

const SidebarNavigationLinkCards = memo(styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  grid-column: 1 / -1;
  width: 100%;
  margin-top: 180px;

  & > article {
    width: 56%;
    justify-self: start;
  }
`);

const SPECTRUM_NAVIGATION_LINK_CARDS = [
  START_PAGE_LINK_CARD,
  LINGO_AND_LEARN_LINK_CARD,
];

const Section = memo(styled.div<{ $marginBottom?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: ${({ $marginBottom }) => $marginBottom || "0"};
  box-sizing: border-box;
  width: 100%;
`);

const SectionTitle = memo(styled.div<{
  $fileMode?: boolean;
  $nested?: boolean;
}>`
  font-size: 11px;
  color: ${(props: any) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: ${({ $nested }) => ($nested ? "0" : "1rem")};
  margin-bottom: 0;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: ${({ $nested }) => ($nested ? "auto" : "1 / -1")};
  flex: ${({ $nested }) => ($nested ? "1 1 auto" : "none")};
  min-width: ${({ $nested }) => ($nested ? "0" : "auto")};
  display: flex;
  align-items: center;
  gap: 8px;
`);

const SourceHeaderRow = memo(styled.div`
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 1rem;
`);

const SourceCompactExpandButton = memo(styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid ${(props: any) => props.theme.borderHover};
  border-radius: 8px;
  background: ${(props: any) => props.theme.surface};
  color: ${(props: any) => props.theme.metadataLabel};
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: ${(props: any) => props.theme.surfaceHover};
    color: ${(props: any) => props.theme.textPrimary};
  }
`);

const SourceExpandChevron = memo(styled(ChevronDown)<{ $expanded: boolean }>`
  width: 14px;
  height: 14px;
  transition: transform 0.2s ease;
  transform: rotate(${({ $expanded }) => ($expanded ? "180deg" : "0deg")});
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
    dispatch(setSelectedFiles([]));
    dispatch(clearWaterfall());

    const url = buildSafeDownloadUrl(
      liveCaptureStatus.downloadUrl,
      sessionToken,
    );
    if (!url) throw new Error("Invalid capture download URL");

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

    console.log("File registered and selected. ID:", id);

    schedule(() => {
      if (getCancelled()) return;
      console.log("Triggering stitch...");
      dispatch(triggerStitch());
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
  supportsBasebandFilter: false,
};

export const SpectrumSidebar: React.FC<SpectrumSidebarProps> = ({
  onCreateNoteCard,
  visualizerLoading = false,
}) => {
  const location = useLocation();
  const sidebarSection = new URLSearchParams(location.search).get(
    "sidebarSection",
  );
  const iqCaptureRequested = sidebarSection === "iq-capture";
  const fileSelectionRequested = sidebarSection === "file";
  const sourceParam = new URLSearchParams(location.search).get("source");
  const fileSelectionSourceRequested = sourceParam === "fileSelection";
  const [autoBrowseRequested, setAutoBrowseRequested] = useState(
    fileSelectionSourceRequested,
  );
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
    setVisualizerPause: setLiveVisualizerPause,
    cryptoCorrupted: liveCryptoCorrupted,
    deviceName: liveDeviceName,
    deviceProfile: liveDeviceProfile,
  } = useSpectrumStore();
  const spectrumTransport = useSpectrumTransport();
  const initializedSampleRateKeyRef = useRef<string | null>(null);
  const lastTxToggleTimeRef = useRef(0);
  const pendingTxStopSourceIdRef = useRef<string | null>(null);
  const lastTxSettingsSyncKeyRef = useRef<string | null>(null);
  const txSettingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [txPreviewSourceId, setTxPreviewSourceId] = useState<string | null>(
    null,
  );
  const txSuiteSourceId = useAppSelector(
    (state) => state.sourceRouting?.bindings?.["tx-suite:tx"] ?? null,
  );
  const allowNegativeFrequencies = useAppSelector(
    (state) => state.settings.mirrorIqBasebandBelowZero,
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
    removeDcSpike,
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
  const txHopType = useAppSelector(
    (state) => state.spectrum.txHopType ?? "range",
  );
  const txHopChannels = useAppSelector(
    (state) => state.spectrum.txHopChannels ?? ["a"],
  );

  const channelPool = useMemo(() => {
    const defaultChannels = [
      { label: "A", min: 18_000, max: 4_390_000 },
      { label: "B", min: 24_100_000, max: 30_370_000 },
      { label: "C", min: 4_750_000, max: 23_000_000 },
    ];
    return websocketChannels && websocketChannels.length > 0
      ? websocketChannels.map((ch) => ({
          label: ch.label,
          min: ch.min_hz,
          max: ch.max_hz,
        }))
      : defaultChannels;
  }, [websocketChannels]);

  const selectedTxHopChannels = useMemo(() => {
    if (
      txHopType !== "channels" ||
      !txHopChannels ||
      txHopChannels.length === 0
    ) {
      return [];
    }
    const uppercase = txHopChannels.map((l) => l.toUpperCase());
    return uppercase
      .map((l) => channelPool.find((ch) => ch.label.toUpperCase() === l))
      .filter((ch): ch is { label: string; min: number; max: number } => !!ch);
  }, [txHopType, txHopChannels, channelPool]);

  const activeSignalAreaBounds = useMemo(() => {
    const activeCh = selectedTxHopChannels.find(
      (ch) => ch.label.toUpperCase() === activeSignalArea?.toUpperCase(),
    );
    if (activeCh) {
      return { min: activeCh.min, max: activeCh.max };
    }
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
    const poolCh = channelPool.find(
      (ch) => ch.label.toUpperCase() === activeSignalArea?.toUpperCase(),
    );
    if (poolCh) {
      return { min: poolCh.min, max: poolCh.max };
    }
    const fallbackCh = selectedTxHopChannels[0] ?? channelPool[0];
    if (fallbackCh) {
      return { min: fallbackCh.min, max: fallbackCh.max };
    }
    return null;
  }, [
    selectedTxHopChannels,
    activeSignalArea,
    activeFrameForArea,
    signalAreaBounds,
    channelPool,
  ]);

  const activeChannelSampleRate = useMemo(() => {
    const activeCh = selectedTxHopChannels.find(
      (ch) => ch.label.toUpperCase() === activeSignalArea?.toUpperCase(),
    );
    if (activeCh) {
      return Math.max(0, activeCh.max - activeCh.min);
    }
    if (
      activeSignalAreaBounds &&
      activeSignalAreaBounds.max > activeSignalAreaBounds.min
    ) {
      return activeSignalAreaBounds.max - activeSignalAreaBounds.min;
    }
    if (
      activeFrameForArea &&
      activeFrameForArea.max_hz > activeFrameForArea.min_hz
    ) {
      return activeFrameForArea.max_hz - activeFrameForArea.min_hz;
    }
    const poolCh = channelPool.find(
      (ch) => ch.label.toUpperCase() === activeSignalArea?.toUpperCase(),
    );
    if (poolCh) {
      return Math.max(0, poolCh.max - poolCh.min);
    }
    const fallbackCh = selectedTxHopChannels[0] ?? channelPool[0];
    if (fallbackCh) {
      return Math.max(0, fallbackCh.max - fallbackCh.min);
    }
    return null;
  }, [
    selectedTxHopChannels,
    activeSignalArea,
    activeSignalAreaBounds,
    activeFrameForArea,
    channelPool,
  ]);

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
    ? (liveSdrSettingsToUse as any)?.devices?.[deviceTypeNormalized]
    : undefined;
  const gainLimits = activeDeviceConfig?.gain_limits;
  const liveSampleRateOptions = selectedSourceDerived.sampleRateOptions;
  const supportsBasebandFilter =
    selectedSourceDerived.supportsBasebandFilter ??
    wsConnection.supportsBasebandFilter ??
    false;
  const basebandFilterPinned = useAppSelector(
    (s) => s.spectrum.basebandFilterPinned,
  );
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
  const isMockTxLiveSource = isMockTxSource({
    id: selectedSource?.id ?? selectedSourceId,
    kind: selectedSource?.kind ?? liveBackend,
  });
  const selectedSourceMaxSampleRateHz =
    typeof selectedSource?.sdr?.max_sample_rate === "number" &&
    Number.isFinite(selectedSource.sdr.max_sample_rate) &&
    selectedSource.sdr.max_sample_rate > 0
      ? selectedSource.sdr.max_sample_rate
      : null;
  const selectedSourceSampleRateOptions = (
    selectedSource?.sdr?.sample_rate_options ?? []
  ).filter((rate): rate is number => Number.isFinite(rate) && rate > 0);
  const mockSourceMaximumHz =
    selectedSourceMaxSampleRateHz ??
    (selectedSourceSampleRateOptions.length > 0
      ? Math.max(...selectedSourceSampleRateOptions)
      : maxSampleRateHz);
  const sampleRateControlMaximumHz = isMockTxLiveSource
    ? Math.max(mockSourceMaximumHz ?? 0, activeChannelSampleRate ?? 0)
    : maxSampleRateHz;

  const mockTxDeviceProfile = useMemo<DeviceProfile | null>(() => {
    return getMockDeviceProfile(deviceIdentity);
  }, [deviceIdentity]);
  const liveDeviceProfileForDisplay =
    mockTxDeviceProfile ?? liveDeviceProfileToUse;
  const isHackrfOne = isHackrfDevice({
    deviceKind: liveDeviceProfileForDisplay?.kind,
    backend: liveBackend,
    deviceName: liveDeviceNameToUse,
    sourceId: selectedSource?.id ?? selectedSourceId,
  });
  const isHackrfForBaseband =
    isHackrfOne ||
    [
      liveDeviceProfileToUse?.kind,
      liveBackend,
      liveDeviceNameToUse,
      selectedSource?.id ?? selectedSourceId,
    ].some(
      (value) =>
        typeof value === "string" && value.toLowerCase().includes("hackrf"),
    );
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
    }
  }, [
    liveDeviceProfileForDisplay,
    liveBackend,
    sourceMode,
    powerScale,
    dispatch,
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
    ? liveSampleRateOptions.length > 0
      ? liveSampleRateOptions
      : (mockResolved?.options ?? [3_200_000])
    : liveSampleRateOptions;
  const supportsWholeChannelSampleRate = sourceMode === "live" && !isRtlSdr;
  const wholeChannelViewport = activeSignalAreaBounds
    ? resolveWholeChannelViewport({
        channelBounds: activeSignalAreaBounds,
        maxSampleRateHz:
          isMockLiveSource || isHackrfOne
            ? Math.max(maxSampleRateHz ?? 0, 20_000_000)
            : (maxSampleRateHz ?? activeChannelSampleRate ?? 0),
      })
    : null;
  const liveWholeChannelSampleRate = wholeChannelViewport
    ? wholeChannelViewport.max - wholeChannelViewport.min
    : activeChannelSampleRate;
  // For frame rate computation, use the actual SDR sample rate — NOT the
  // channel bandwidth.  The channel bandwidth (max_hz - min_hz) can exceed
  // the hardware sample rate and inflate floor(sampleRate / fftSize).
  const maxSampleRate = clampSampleRateToSourceMaximum(
    isMockLiveSource
      ? (sampleRateHzEffective ??
          liveSdrSettingsToUse?.sample_rate ??
          sampleRateHz ??
          sampleRateControlMaximumHz ??
          3_200_000)
      : (sampleRateHzEffective ??
          sampleRateHz ??
          sampleRateControlMaximumHz ??
          liveSdrSettingsToUse?.sample_rate ??
          0),
    sampleRateControlMaximumHz,
  );
  const sampleRateHzLocal =
    (typeof liveState.sampleRateHz === "number" &&
    Number.isFinite(liveState.sampleRateHz) &&
    liveState.sampleRateHz > 0
      ? clampSampleRateToSourceMaximum(
          liveState.sampleRateHz,
          sampleRateControlMaximumHz,
        )
      : isMockLiveSource && mockResolved !== null
        ? clampSampleRateToSourceMaximum(
            mockResolved.rate,
            sampleRateControlMaximumHz,
          )
        : typeof sampleRateHz === "number" &&
            Number.isFinite(sampleRateHz) &&
            sampleRateHz > 0
          ? clampSampleRateToSourceMaximum(
              sampleRateHz,
              sampleRateControlMaximumHz,
            )
          : typeof sampleRateHzEffective === "number" &&
              Number.isFinite(sampleRateHzEffective) &&
              sampleRateHzEffective > 0
            ? clampSampleRateToSourceMaximum(
                sampleRateHzEffective,
                sampleRateControlMaximumHz,
              )
            : typeof liveSdrSettingsToUse?.sample_rate === "number" &&
                Number.isFinite(liveSdrSettingsToUse.sample_rate) &&
                liveSdrSettingsToUse.sample_rate > 0
              ? clampSampleRateToSourceMaximum(
                  liveSdrSettingsToUse.sample_rate,
                  sampleRateControlMaximumHz,
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
    setFftWindow,
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
      }
      dispatch(
        setSdrSettingsBundle({
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
        }),
      );
      sendLiveSettings(settings);
    },
  });
  const signalDisplaySampleRateOptions = isMockLiveSource
    ? liveManualSampleRateOptions
    : sampleRateOptions;

  const setSampleRateForVisualizer = useCallback(
    (rate: number) => {
      storeDispatch({ type: "SET_SAMPLE_RATE", sampleRateHz: rate });
      dispatch(setSampleRateAction(rate));
      setSampleRate(rate);
    },
    [dispatch, storeDispatch, setSampleRate],
  );

  const syncHackrfBasebandToSampleRate = useCallback(
    (rate: number) => {
      if (
        !isHackrfForBaseband ||
        sourceMode !== "live" ||
        !Number.isFinite(rate) ||
        rate <= 0 ||
        basebandFilterPinned
      ) {
        return;
      }
      setHackrfBasebandBandwidth(Math.round(rate));
    },
    [isHackrfForBaseband, setHackrfBasebandBandwidth, sourceMode, basebandFilterPinned],
  );

  const {
    wholeChannelSampleRate: hackrfWholeChannelSampleRate,
    isWholeChannelMode,
    handleSampleRateChange,
  } = useLiveSampleRateControl({
    sourceMode,
    supportsWholeChannelSampleRate,
    manualSampleRateOptions: liveManualSampleRateOptions,
    activeChannelSampleRate: liveWholeChannelSampleRate,
    maxSampleRateHz: isHackrfOne
      ? Math.max(sampleRateControlMaximumHz ?? 0, 20_000_000)
      : sampleRateControlMaximumHz,
    activeSignalAreaBounds,
    frequencyRange,
    sampleRateHz: sampleRateHzLocal,
    fftSize,
    maxFrameRateLimit: maxFrameRate,
    setSampleRate: setSampleRateForVisualizer,
    onSampleRateApplied: syncHackrfBasebandToSampleRate,
    setFftFrameRate,
    applyFrequencyRange: useCallback(
      (range) => {
        dispatch(setFrequencyRange(range));
        spectrumTransport.sendFrequencyRange(range);
      },
      [dispatch, spectrumTransport],
    ),
  });
  const sampleRateSourceKey =
    selectedSource?.id ||
    selectedSourceId ||
    liveDeviceNameToUse ||
    liveBackend ||
    null;
  const sampleRateInitializationKey =
    sampleRateSourceKey &&
    typeof liveWholeChannelSampleRate === "number" &&
    Number.isFinite(liveWholeChannelSampleRate)
      ? `${sampleRateSourceKey}:${activeSignalArea ?? ""}:${Math.round(liveWholeChannelSampleRate)}`
      : null;

  useEffect(() => {
    if (
      sourceMode !== "live" ||
      !supportsWholeChannelSampleRate ||
      !sampleRateInitializationKey ||
      initializedSampleRateKeyRef.current === sampleRateInitializationKey ||
      typeof liveWholeChannelSampleRate !== "number" ||
      !Number.isFinite(liveWholeChannelSampleRate) ||
      liveWholeChannelSampleRate <= 0
    ) {
      return;
    }

    initializedSampleRateKeyRef.current = sampleRateInitializationKey;
    const currentRate =
      typeof sampleRateHzLocal === "number" &&
      Number.isFinite(sampleRateHzLocal)
        ? Math.round(sampleRateHzLocal)
        : null;
    const configuredFloor =
      liveSdrSettingsToUse?.min_receive_sample_rate ??
      liveSdrSettingsToUse?.sample_rate ??
      3_200_000;
    const isWholeChannelStartupRate =
      currentRate === 2_000_000 ||
      currentRate === Math.round(configuredFloor) ||
      isWholeChannelMode;

    if (isWholeChannelStartupRate) {
      handleSampleRateChange(liveWholeChannelSampleRate, "whole");
    }
  }, [
    handleSampleRateChange,
    liveWholeChannelSampleRate,
    liveSdrSettingsToUse?.min_receive_sample_rate,
    liveSdrSettingsToUse?.sample_rate,
    sampleRateHzLocal,
    sampleRateInitializationKey,
    sourceMode,
    supportsWholeChannelSampleRate,
    isWholeChannelMode,
  ]);

  const handleSignalDisplaySampleRateChange = useCallback(
    (nextSampleRate: number, mode?: "whole" | "manual") => {
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
        }
      }

      handleSampleRateChange(nextSampleRate, mode);
    },
    [
      dispatch,
      handleSampleRateChange,
      hackrfWholeChannelSampleRate,
      liveFramesToUse,
      liveState.sampleRateHz,
    ],
  );

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
  const settingsDefaults = getSettingsDefaults();
  const [activeCaptureAreas, setActiveCaptureAreas] = useState<string[]>([
    ...settingsDefaults.capture.activeCaptureAreas,
  ]);
  const [acquisitionMode, setAcquisitionMode] = useState<
    "stepwise" | "interleaved" | "whole_sample"
  >(settingsDefaults.capture.acquisitionMode);
  const [captureDurationMode, setCaptureDurationMode] = useState<
    "timed" | "manual"
  >(settingsDefaults.capture.captureDurationMode);
  const [captureDurationS, setCaptureDurationS] = useState(
    settingsDefaults.capture.captureDurationS,
  );
  const [captureFileTypeState, setCaptureFileTypeState] =
    useState<CaptureFileType>(settingsDefaults.capture.captureFileType);
  const [captureEncrypted, setCaptureEncrypted] = useState(
    settingsDefaults.capture.captureEncrypted,
  );
  const [capturePlayback, setCapturePlayback] = useState(
    settingsDefaults.capture.capturePlayback,
  );
  const [captureGeolocation, setCaptureGeolocation] = useState(
    settingsDefaults.capture.captureGeolocation,
  );

  // Snapshot UI state
  const [snapshotWhole, setSnapshotWhole] = useState(
    settingsDefaults.snapshot.snapshotWhole,
  );
  const [snapshotShowWaterfall, setSnapshotShowWaterfall] = useState(
    settingsDefaults.snapshot.snapshotShowWaterfall,
  );
  const [snapshotShowStats, setSnapshotShowStats] = useState(
    settingsDefaults.snapshot.snapshotShowStats,
  );
  const [snapshotShowGeolocation, setSnapshotShowGeolocation] = useState(
    settingsDefaults.snapshot.snapshotShowGeolocation,
  );
  const [snapshotUseThemeColors, setSnapshotUseThemeColors] = useState(
    settingsDefaults.snapshot.snapshotUseThemeColors,
  );
  const [snapshotGeolocationError, setSnapshotGeolocationError] = useState<
    string | null
  >(null);
  const [snapshotGeolocationPosition, setSnapshotGeolocationPosition] =
    useState<{ lat: string; lon: string } | null>(null);
  const [snapshotLocationLabel, setSnapshotLocationLabel] = useState<string | null>(null);
  const supportedSnapshotVideoFormat = useMemo(
    () => getSupportedSnapshotVideoFormat(),
    [],
  );
  const snapshotPulseToken = useAppSelector(
    (state) => state.snapshot.pulseToken,
  );
  const [snapshotFormat, setSnapshotFormat] = useState<
    "png" | "svg" | SnapshotVideoFormat | "animated-svg"
  >(settingsDefaults.snapshot.snapshotFormat);
  const [snapshotAspectRatio, setSnapshotAspectRatio] =
    useState<SnapshotAspectRatio>(
      settingsDefaults.snapshot.snapshotAspectRatio,
    );
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
  const txHopStartFrequencyHz = useAppSelector(
    (state) => state.spectrum.txHopStartFrequencyHz ?? 10_000_000,
  );
  const txHopEndFrequencyHz = useAppSelector(
    (state) => state.spectrum.txHopEndFrequencyHz ?? 20_000_000,
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

  const isTxModeGlobal = useMemo(() => {
    return resolveSourceModeManagement({
      source: selectedSource,
      txBindingSourceId: txSuiteSourceId,
      txPreviewSourceId,
    }).isTxMode;
  }, [selectedSource, txPreviewSourceId, txSuiteSourceId]);

  const selectedBackendKind =
    liveDeviceProfileForDisplay?.kind?.toLowerCase?.() ??
    liveBackend?.toLowerCase?.() ??
    "";

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
      const isPhysicalHackRfSource =
        source.kind?.toLowerCase?.() === "hackrf_one" ||
        (selectedSource?.id === source.id &&
          selectedBackendKind === "hackrf_one");
      if (
        isPhysicalHackRfSource &&
        !canToggleTransmitMode({
          nextEnabled,
          sourceId,
          txBindingSourceId: txSuiteSourceId,
          txPreviewSourceId,
        })
      ) {
        return;
      }

      const applyToggle = () => {
        pendingTxStopSourceIdRef.current = nextEnabled ? null : source.id;
        const fallbackCenterHz =
          txCenterFrequencyHz ??
          source.sdr?.settings?.center_frequency ??
          undefined;
        const fallbackBandwidthHz =
          txSampleRateHz ?? source.sdr?.settings?.sample_rate ?? undefined;
        const rangeViewSampleRateHz =
          frequencyRange &&
          Number.isFinite(frequencyRange.min) &&
          Number.isFinite(frequencyRange.max)
            ? frequencyRange.max - frequencyRange.min
            : undefined;
        const transmitSettings =
          nextEnabled &&
          typeof fallbackCenterHz === "number" &&
          Number.isFinite(fallbackCenterHz) &&
          typeof fallbackBandwidthHz === "number" &&
          Number.isFinite(fallbackBandwidthHz)
            ? resolveMockTxTransmitSettings({
                txCenterHz: fallbackCenterHz,
                viewSampleRateHz: rangeViewSampleRateHz,
                txBandwidthHz: fallbackBandwidthHz,
              })
            : null;
        lastTxSettingsSyncKeyRef.current = nextEnabled
          ? buildTxSettingsSyncKey({
              sourceId: source.id,
              txSignal,
              centerFrequencyHz:
                transmitSettings?.centerFrequencyHz ?? fallbackCenterHz,
              bandwidthHz: transmitSettings?.bandwidthHz ?? fallbackBandwidthHz,
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
        const isPhysicalHackRf = isPhysicalHackRfSource;
        if (
          nextEnabled &&
          source.duplex_mode?.toLowerCase?.() === "half-duplex" &&
          isPhysicalHackRf
        ) {
          // HackRF cannot receive and transmit simultaneously. Stop RX first so
          // the backend can switch the device cleanly into TX standby/active mode.
          spectrumTransport.sendPauseCommand(true, source.id);
        }
        wsConnection.sendTransmitStatus?.(
          nextEnabled,
          source.name ?? sourceId,
          {
            serialNumber: source.serial_number?.trim() || sourceId,
            ...(transmitSettings ?? {
              centerFrequencyHz: fallbackCenterHz,
              bandwidthHz: fallbackBandwidthHz,
            }),
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
              source.sdr?.settings?.tuner_agc ??
              liveState?.tunerAGC ??
              undefined,
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
          },
        );
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
      frequencyRange,
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
      txPreviewSourceId,
      txSuiteSourceId,
      wsConnection.sendTransmitStatus,
      spectrumTransport.sendPauseCommand,
    ],
  );

  const jumpMonitorToTypedTxGeometry = useCallback(
    (centerHz: number) => {
      if (!Number.isFinite(centerHz)) return;
      const spanHz =
        frequencyRange &&
        Number.isFinite(frequencyRange.min) &&
        Number.isFinite(frequencyRange.max) &&
        frequencyRange.max > frequencyRange.min
          ? frequencyRange.max - frequencyRange.min
          : txSampleRateHz;
      if (!Number.isFinite(spanHz) || spanHz <= 0) return;
      dispatch(
        setFrequencyRange(
          buildCenteredFrequencyRange(
            centerHz,
            spanHz,
            0,
          ),
        ),
      );
    },
    [allowNegativeFrequencies, dispatch, frequencyRange, txSampleRateHz],
  );

  const handleTxSignalChange = useCallback(
    (value: string) => {
      dispatch(setTxSignal(value));
      const preset = txSignalPresets[value.toLowerCase()];
      if (!preset) return;
      dispatch(
        setTxGeometry({
          centerFrequencyHz: preset.centerFrequencyHz,
          sampleRateHz: preset.bandwidthHz,
        }),
      );
      jumpMonitorToTypedTxGeometry(preset.centerFrequencyHz);
    },
    [dispatch, jumpMonitorToTypedTxGeometry, txSignalPresets],
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
    const rangeViewSampleRateHz =
      frequencyRange &&
      Number.isFinite(frequencyRange.min) &&
      Number.isFinite(frequencyRange.max)
        ? frequencyRange.max - frequencyRange.min
        : undefined;
    const rangeViewCenterHz =
      frequencyRange &&
      Number.isFinite(frequencyRange.min) &&
      Number.isFinite(frequencyRange.max)
        ? (frequencyRange.min + frequencyRange.max) / 2
        : null;
    // Ongoing transmit sync is passive: keep the current monitor view.
    const transmitSettings = resolveMockTxTransmitSettings({
      txCenterHz: txCenterFrequencyHz,
      viewCenterHz: rangeViewCenterHz,
      viewSampleRateHz: rangeViewSampleRateHz,
      txBandwidthHz: txSampleRateHz,
      alignMonitor: false,
    });
    const syncKey = buildTxSettingsSyncKey({
      sourceId: source.id,
      txSignal,
      centerFrequencyHz: transmitSettings.centerFrequencyHz,
      bandwidthHz: transmitSettings.bandwidthHz,
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
      wsConnection.sendTransmitStatus?.(true, source.name ?? txTargetDeviceId, {
        serialNumber: source.serial_number?.trim() || txTargetDeviceId,
        ...transmitSettings,
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
    frequencyRange,
    sourcesToUse,
    wsConnection.sendTransmitStatus,
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
      const isTxPreviewing = source.id === txPreviewSourceId;
      const isStreaming =
        source.status === "receiving" || source.status === "streaming";
      const isPaused =
        source.status === "paused" ||
        isTxPreviewing ||
        (source.paused ?? false);
      const supportsTx =
        source.capability === "tx" || source.capability === "tx_rx";
      const isMockSource = source.capability === "mock";
      const isLoading =
        source.status === "loading" || source.status === "initializing";
      // A loading source has no veritable stream yet: it must not accept
      // Pause/Resume (the pill shows a spinner instead) and switching to it
      // must not be treated as live-connected.
      const isLiveConnected =
        !isLoading &&
        (source.status === "connected" ||
          source.status === "paused" ||
          isStreaming ||
          isMockSource);
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
        active_duplex_mode: source.active_duplex_mode,
        active_duplex_modes: source.active_duplex_modes,
        summary: source.serial_number
          ? `SN ${source.serial_number}`
          : source.manufacturer
            ? source.manufacturer
            : undefined,
        status: {
          color: isTransmitting
            ? "#19d9ff"
            : isTxPreviewing
              ? "#19d9ff"
              : isMockSource && isStreaming
                ? "#ffb000"
                : isStreaming
                  ? "#19d97d"
                  : undefined,
          label: isTxPreviewing ? "standby" : (source.status ?? undefined),
          paused: isPaused,
          loading:
            source.status === "loading" || source.status === "initializing",
          loadingLabel:
            source.status === "initializing"
              ? `Initializing ${source.name}…`
              : source.status === "loading"
                ? source.kind === "hackrf_one"
                  ? "Rx active · waiting for first frame…"
                  : `Loading ${source.name}…`
                : undefined,
          actionLabel,
          actionTitle,
          onAction,
        },
      };
    });
    return mappedSources;
  }, [
    handleToggleTransmitMode,
    sourcesToUse,
    toggleLiveVisualizerPause,
    txPreviewSourceId,
  ]);
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
  }, [sourceMode, selectedFiles, lastAutoProcessSignature, dispatch]);

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
      return;
    }
    dispatch(setStitchPaused(!isStitchPaused));
  }, [
    dispatch,
    isStitchPaused,
    selectedFiles.length,
    sourceMode,
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
    },
    [dispatch],
  );

  const handleSourceModeChange = useCallback(
    (mode: "live" | "file") => {
      if (mode === "file") {
        setLivePreviewStage(0);
      } else {
        setLivePreviewStage(0);
      }
      dispatch(setSourceMode(mode));
    },
    [dispatch],
  );

  // Initial paused state for file mode - always reset to paused when entering file mode
  useEffect(() => {
    if (sourceMode === "file") {
      dispatch(setStitchPaused(true));
    }
  }, [sourceMode, dispatch]);

  useEffect(() => {
    if (!iqCaptureRequested || sourceMode === "live") return;
    handleSourceModeChange("live");
  }, [handleSourceModeChange, iqCaptureRequested, sourceMode]);

  useEffect(() => {
    if (!fileSelectionRequested || sourceMode === "file") return;
    handleSourceModeChange("file");
  }, [fileSelectionRequested, handleSourceModeChange, sourceMode]);

  // Tracks whether the file-selection deep link drove source mode within this
  // mount. Leaving the deep link (param removed) resets back to live sources,
  // but a manual File Selection on the regular app never sets this, so it is
  // not reset.
  const fileDeepLinkActiveRef = useRef(fileSelectionSourceRequested);

  useEffect(() => {
    if (fileSelectionSourceRequested) {
      fileDeepLinkActiveRef.current = true;
      if (sourceMode !== "file") handleSourceModeChange("file");
      return;
    }
    // Leaving the file-selection deep link (e.g. navigating back to the start
    // page) should return the source to live SDR/mock sources instead of
    // leaving the app stuck in file mode. Skip when the sidebarSection=file
    // deep link is still requesting file mode, so the two don't fight.
    if (
      fileDeepLinkActiveRef.current &&
      !fileSelectionRequested &&
      sourceMode === "file"
    ) {
      fileDeepLinkActiveRef.current = false;
      handleSourceModeChange("live");
    }
  }, [
    fileSelectionRequested,
    fileSelectionSourceRequested,
    handleSourceModeChange,
    sourceMode,
  ]);

  // Returning to the spectrum view (a fresh mount) after navigating back from
  // the file-selection deep link should return to live SDR/mock sources. The
  // transition effect above only survives within a mount, so this covers the
  // unmount/remount path. It runs once per mount, so a manual File Selection
  // made later on the regular app is never reset.
  useEffect(() => {
    if (
      !fileSelectionSourceRequested &&
      !fileSelectionRequested &&
      sourceMode === "file"
    ) {
      handleSourceModeChange("live");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutoBrowseHandled = useCallback(() => {
    setAutoBrowseRequested(false);
  }, []);

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
    const configuredSampleRate =
      typeof sampleRateHzLocal === "number" &&
      Number.isFinite(sampleRateHzLocal) &&
      sampleRateHzLocal > 0
        ? sampleRateHzLocal
        : null;
    const hardwareSpan = configuredSampleRate
      ? Math.min(
          configuredSampleRate,
          Math.max(0, hardwareMax - hardwareMin || fallbackSpan),
        )
      : Math.max(0, hardwareMax - hardwareMin || fallbackSpan);

    const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;
    if (hardwareSpan <= 0) {
      const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
      const halfHardware = hardwareSpan / 2;
      return {
        min: allowNegativeFrequencies
          ? hardwareCenter - halfHardware
          : Math.max(hardwareMin, hardwareCenter - halfHardware),
        max: allowNegativeFrequencies
          ? hardwareCenter + halfHardware
          : Math.min(hardwareMax, hardwareCenter + halfHardware),
      };
    }

    const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const visualSpan = Math.min(hardwareSpan, hardwareSpan / safeZoom);
    const halfVisualSpan = visualSpan / 2;
    if (allowNegativeFrequencies) {
      const center = hardwareCenter + vizPanOffset;
      return {
        min: center - halfVisualSpan,
        max: center + halfVisualSpan,
      };
    }
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
    allowNegativeFrequencies,
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
          locationLabel: snapshotLocationLabel,
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
        void reverseGeocodeSnapshotLocation(
          pos.coords.latitude.toFixed(6),
          pos.coords.longitude.toFixed(6),
        )
          .then(setSnapshotLocationLabel)
          .catch(() => setSnapshotLocationLabel(null));
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
        setSnapshotLocationLabel(null);
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
    dispatch(resetLiveControlsAction({ fftSize, fftFrameRate }));
  }, [dispatch, fftSize, fftFrameRate]);

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
  const [sourceListExpanded, setSourceListExpanded] = useState(false);
  const sourceListExpandedRef = useRef(false);
  sourceListExpandedRef.current = sourceListExpanded;

  useEffect(() => {
    if (!isSticky) {
      setSourceListExpanded(false);
    }
  }, [isSticky]);

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
    const updateStickyState = () => {
      const scrollContainerTop =
        scrollParent === window
          ? 0
          : (scrollParent as HTMLElement).getBoundingClientRect().top;
      const nextIsSticky = shouldCompactSidebarSourceList({
        headerTop: wrapper.getBoundingClientRect().top,
        scrollContainerTop,
        wasCompact: isSticky,
      });
      setIsSticky((current) =>
        current === nextIsSticky ? current : nextIsSticky,
      );
      if (sourceListExpandedRef.current) {
        setSourceListExpanded(false);
      }
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
      <StickyHeaderWrapper
        ref={stickyWrapperRef}
        $isSticky={isSticky}
        data-sidebar-sticky-header
      >
        <SourceHeaderRow>
          <SectionTitle $fileMode={sourceMode === "file"} $nested>
            <SectionIcon>
              <Unplug size={14} />
            </SectionIcon>
            <SectionText>Source</SectionText>
          </SectionTitle>
          {isSticky ? (
            <SourceCompactExpandButton
              type="button"
              aria-expanded={sourceListExpanded}
              aria-label={
                sourceListExpanded
                  ? "Collapse source list"
                  : "Expand source list to choose a device"
              }
              onClick={() => setSourceListExpanded((expanded) => !expanded)}
            >
              <SourceExpandChevron $expanded={sourceListExpanded} aria-hidden />
            </SourceCompactExpandButton>
          ) : null}
        </SourceHeaderRow>

        <SourceInput
          sourceMode={sourceMode}
          compactActiveOnly={isSticky && !sourceListExpanded}
          fileModeColor="var(--color-file-mode)"
          livePreviewStage={livePreviewStage}
          fileActionLabel={fileActionLabel}
          fileActionTitle={fileActionTitle}
          selectedFilesCount={selectedFiles.length}
          autoBrowseRequested={
            autoBrowseRequested && selectedFiles.length === 0
          }
          onAutoBrowseHandled={handleAutoBrowseHandled}
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
            const source = sourcesToUse.find((entry) => entry.id === id);
            const mode = resolveSourceModeManagement({
              source,
              txBindingSourceId: txSuiteSourceId,
              txPreviewSourceId,
            });
            const transition = mode.isTxMode
              ? resolveSourceModeTransition({
                  sourceId: id,
                  duplexMode: mode.duplexMode,
                  fromMode: "tx",
                  toMode: "rx",
                })
              : null;
            setTxPreviewSourceId(null);
            dispatch(
              setSourceBinding({
                group: "tx-suite",
                role: "tx",
                sourceId: null,
              }),
            );
            if (transition?.actions.includes("request_rx_mode")) {
              dispatch(setTxHopEnabled(false));
              handleToggleTransmitMode(id, false);
            }
            // Leaving Tx is an explicit Rx handoff. Do not invert the
            // backend's possibly stale paused flag in that branch. For a
            // normal Rx card, preserve the existing Pause/Resume toggle.
            if (transition?.actions.includes("request_rx_frame")) {
              if (setLiveVisualizerPause) {
                setLiveVisualizerPause(false, id);
              } else {
                spectrumTransport.sendPauseCommand(false, id);
              }
            } else {
              toggleLiveVisualizerPause(id);
            }
            if (transition?.actions.includes("request_rx_frame")) {
              // The first Rx frame replaces the Tx standby preview after the
              // mode handoff; do not let the old Tx I/Q remain on canvas.
              dispatch(requestNextLiveFrame());
            }
          }}
          onToggleDeviceTxMode={(id) => {
            const current =
              sourceDevices.find((entry) => entry.id === id)?.status?.label ===
              "transmitting";
            const source = sourcesToUse.find((entry) => entry.id === id);
            const mode = resolveSourceModeManagement({
              source,
              txBindingSourceId: txSuiteSourceId,
              txPreviewSourceId,
            });
            const stopTransition =
              current && mode.isTxMode && mode.duplexMode !== "simplex"
                ? resolveTxStopTransition({
                    sourceId: id,
                    duplexMode: mode.duplexMode,
                  })
                : null;
            const retainTxStandby = shouldRetainTxStandbyAfterStop({
              isTransmitting: current,
              isHalfDuplex: mode.duplexMode === "half_duplex",
              isTxMode: mode.isTxMode,
            });
            setTxPreviewSourceId(retainTxStandby ? id : null);
            if (
              stopTransition &&
              stopTransition.actions.includes("enter_tx_standby") &&
              txSuiteSourceId !== id
            ) {
              // Preserve the Tx source/view while the backend changes the
              // activity state from transmitting to standby.
              dispatch(
                setSourceBinding({
                  group: "tx-suite",
                  role: "tx",
                  sourceId: id,
                }),
              );
            }
            handleToggleTransmitMode(id, !current);
          }}
          onPreviewDeviceTx={(id) => {
            // Preview requests are routed through the Tx Suite's bound source.
            // The pill can remain visible while selection state is catching up,
            // so always bind the clicked device instead of silently dropping
            // the request when it differs from selectedSourceId for a frame.
            // Stop the live Rx stream first; otherwise its next frame replaces
            // the one-shot Tx preview immediately.
            spectrumTransport.sendPauseCommand(true, id);
            setTxPreviewSourceId(id);
            dispatch(
              setSourceBinding({
                group: "tx-suite",
                role: "tx",
                sourceId: id,
              }),
            );
            dispatch({ type: "txSuite/requestPreview" });
          }}
          onSourceModeChange={handleSourceModeChange}
          txBindingSourceId={txSuiteSourceId}
          txPreviewSourceId={txPreviewSourceId}
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
            onSampleRateChange={handleSignalDisplaySampleRateChange}
          />

          <IQCaptureControlsSection
            defaultOpen={iqCaptureRequested}
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

          {isTxModeGlobal ? (
            <Collapsible
              title="Tx Settings"
              icon={<SatelliteDish size={14} />}
              defaultOpen={true}
            >
              <TxSettingsSection
                signal={txSignal}
                bandwidthHz={txSampleRateHz}
                fftSize={fftSize}
                ifftSize={txIfftSize}
                ifftSizeOptions={fftSizeOptions}
                centerFrequencyHz={txCenterFrequencyHz}
                powerDbm={txPowerDbm}
                vgaGainDb={txVgaGain}
                ampEnabled={hackrfAmpEnabled}
                onSignalChange={handleTxSignalChange}
                signalOptions={signalOptions}
                onBandwidthChange={(value) => {
                  dispatch(setTxSampleRateHz(value));
                  jumpMonitorToTypedTxGeometry(txCenterFrequencyHz);
                }}
                onIfftSizeChange={(value) => dispatch(setTxIfftSize(value))}
                onCenterFrequencyChange={(value) => {
                  dispatch(setTxCenterFrequencyHz(value));
                  jumpMonitorToTypedTxGeometry(value);
                }}
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
                onHopChannelsChange={(value) => {
                  dispatch(setTxHopChannels(value));
                  if (value.length > 0) {
                    const primaryLabel = value[0].toUpperCase();
                    dispatch(setActiveSignalArea(primaryLabel));
                  }
                }}
                hopRateHz={txHopRateHz}
                onHopRateHzChange={(value) => dispatch(setTxHopRateHz(value))}
                rxSampleRateHz={
                  sampleRateHzLocal ??
                  liveSdrSettingsToUse?.sample_rate ??
                  sampleRateHzEffective ??
                  maxSampleRate
                }
              />
            </Collapsible>
          ) : null}

          <SignalDisplaySection
            sourceMode={sourceMode}
            maxSampleRate={maxSampleRate}
            minReceiveSampleRate={
              liveSdrSettingsToUse?.min_receive_sample_rate ?? undefined
            }
            sampleRate={
              sampleRateHzLocal ??
              liveSdrSettingsToUse?.sample_rate ??
              maxSampleRate
            }
            sampleRateOptions={signalDisplaySampleRateOptions}
            wholeChannelSampleRate={hackrfWholeChannelSampleRate}
            isWholeChannelMode={isWholeChannelMode}
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
            removeDcSpike={removeDcSpike}
            displayMode={displayMode || "fft"}
            onFftFrameRateChange={setFftFrameRate}
            onFftSizeChange={setFftSize}
            onSampleRateChange={handleSignalDisplaySampleRateChange}
            onFftWindowChange={setFftWindow}
            onTemporalResolutionChange={(res) => {
              dispatch(setTemporalResolution(res));
            }}
            onPowerScaleChange={(ps) => {
              dispatch(setPowerScale(ps));
            }}
            onRemoveDcSpikeChange={(enabled) => {
              dispatch(setRemoveDcSpike(enabled));
            }}
            onDisplayModeChange={(mode) => {
              dispatch(setDisplayMode(mode));
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
            supportsBasebandFilter={supportsBasebandFilter}
            basebandFilterPinned={basebandFilterPinned}
            onBasebandFilterPinnedChange={(pinned) =>
              dispatch(setBasebandFilterPinnedAction(pinned))
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
              dispatch(setStitchSourceSettingsAction(settings))
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
            }}
            stitchStatus={stitchStatus}
            isStitchPaused={isStitchPaused}
            onClear={() => {
              selectedFiles.forEach((file) => fileRegistry.remove(file.id));
              dispatch(setSelectedFiles([]));
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
              deviceProfile: liveDeviceProfileForDisplay,
              powerScale,
              removeDcSpike,
              displayMode: displayMode || "fft",
              onFftFrameRateChange: setFftFrameRate,
              onFftSizeChange: setFftSize,
              onSampleRateChange: handleSignalDisplaySampleRateChange,
              onFftWindowChange: setFftWindow,
              onTemporalResolutionChange: (res) => {
                dispatch(setTemporalResolution(res));
              },
              onPowerScaleChange: (ps) => {
                dispatch(setPowerScale(ps));
              },
              onRemoveDcSpikeChange: (enabled) => {
                dispatch(setRemoveDcSpike(enabled));
              },
              onDisplayModeChange: (mode) => {
                dispatch(setDisplayMode(mode));
              },
              scheduleCoupledAdjustment,
            }}
          />

          <ThemeSection />
        </>
      )}

      <SidebarNavigationLinkCards aria-label="More from N-APT">
        {SPECTRUM_NAVIGATION_LINK_CARDS.map((card) => (
          <LinkCardItemView key={card.title} {...card} />
        ))}
      </SidebarNavigationLinkCards>
    </SidebarContent>
  );
};

export default SpectrumSidebar;
