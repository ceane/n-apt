import React from "react";
import styled from "styled-components";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/maps/public/useGeolocation";
import { useDispatch } from "react-redux";
import type {
  CaptureStatus,
  CaptureFileType,
  DeviceState,
} from "@n-apt/consts/schemas/websocket";
import {
  addNotification,
  updateNotification,
} from "@n-apt/redux/slices/notificationsSlice";
import { useAppSelector } from "@n-apt/redux/store";
import { formatDurationMs, formatFileSize } from "@n-apt/math/formatters";
import { BYTES_PER_IQ_SAMPLE } from "@n-apt/math/signalData";
import { formatChannelFreq } from "@n-apt/math/frequency";
import { isValidNaptRange } from "@n-apt/math/signals";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Download,
  File as FileIcon,
  FileSignal,
  FolderOpen,
  HardDrive,
  LockKeyhole,
  MapPin,
  PanelLeftDashed,
  Scan,
  Trash2,
} from "lucide-react";
import {
  Row,
  Collapsible,
  ChannelsSelector,
} from "@n-apt/ui";
import { RadioTabs } from "@n-apt/ui/RadioTabs";
import {
  CheckboxSwitch as ToggleSwitch,
  CheckboxSwitchInput as ToggleSwitchInput,
  CheckboxSwitchSlider as ToggleSwitchSlider,
  SettingSelect,
  IconLabel,
} from "@n-apt/ui/SidebarPrimitives";
import { buildSafeDownloadUrl } from "@n-apt/ui/downloadUrl";
import { safeDownloadFilename } from "@n-apt/ui/downloadUrl";
import {
  CAPTURE_DESTINATION_STORAGE_KEY,
  CAPTURE_DESTINATION_PROVIDERS,
  resolveCaptureDestination,
  type CaptureDestinationId,
} from "@n-apt/capture/destinations";
import {
  getCaptureDirectoryPicker,
  loadLastCaptureDirectory,
  saveLastCaptureDirectory,
  saveCaptureToDirectory,
  type CaptureDirectoryPicker,
} from "@n-apt/capture/browserDestinations";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
`;

const CAPTURE_DOWNLOADS_STORAGE_KEY = "napt.iq-capture-downloads.v1";
const IQ_CAPTURE_COLLAPSIBLE_STORAGE_KEY = "napt.sidebar.iq-capture.open.v1";
const CAPTURE_DOWNLOAD_RETENTION_MS = 48 * 60 * 60 * 1000;

const loadIqCaptureOpenState = (): boolean | undefined => {
  try {
    const savedState = window.sessionStorage.getItem(
      IQ_CAPTURE_COLLAPSIBLE_STORAGE_KEY,
    );
    if (savedState === "open") return true;
    if (savedState === "closed") return false;
  } catch {
    // Keep the caller's default when session storage is unavailable.
  }
  return undefined;
};

const persistIqCaptureOpenState = (isOpen: boolean) => {
  try {
    window.sessionStorage.setItem(
      IQ_CAPTURE_COLLAPSIBLE_STORAGE_KEY,
      isOpen ? "open" : "closed",
    );
  } catch {
    // Collapsible state is optional when session storage is unavailable.
  }
};

const loadCaptureDestinationPreference = (): CaptureDestinationId => {
  try {
    return resolveCaptureDestination(
      window.localStorage.getItem(CAPTURE_DESTINATION_STORAGE_KEY),
    );
  } catch {
    return "local";
  }
};

type PersistedCaptureDownload = {
  jobId: string;
  downloadUrl: string;
  filename?: string;
  fileSize?: number;
  duration?: number;
  timestamp: number;
};

const loadPersistedCaptureDownloads = (): PersistedCaptureDownload[] => {
  try {
    const raw = window.localStorage.getItem(CAPTURE_DOWNLOADS_STORAGE_KEY);
    if (!raw) return [];
    const now = Date.now();
    const parsed = JSON.parse(raw) as PersistedCaptureDownload[];
    return parsed.filter(
      (download) =>
        typeof download.jobId === "string" &&
        typeof download.downloadUrl === "string" &&
        typeof download.timestamp === "number" &&
        now - download.timestamp < CAPTURE_DOWNLOAD_RETENTION_MS,
    );
  } catch {
    return [];
  }
};

const persistCaptureDownloads = (downloads: PersistedCaptureDownload[]) => {
  try {
    window.localStorage.setItem(
      CAPTURE_DOWNLOADS_STORAGE_KEY,
      JSON.stringify(downloads),
    );
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

const formatRelativeCaptureTime = (timestamp: number, now: number): string => {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hrs ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  const remainingHours = elapsedHours % 24;
  if (elapsedDays === 1 && remainingHours >= 18) {
    return "almost 2 days ago";
  }
  if (elapsedDays === 1 && remainingHours >= 12) {
    return "1 day and a half ago";
  }
  if (remainingHours === 0) {
    return `${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} ago`;
  }
  return `${elapsedDays} ${elapsedDays === 1 ? "day" : "days"}, ${remainingHours} hrs ago`;
};

const useCaptureDownloadClock = () => {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const timer = window.setInterval(updateClock, 60_000);
    document.addEventListener("visibilitychange", updateClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateClock);
    };
  }, []);

  return now;
};

// Channel descriptor used to trim a multi-channel capture header end-to-end
export interface ChannelDescriptor {
  center_freq_hz: number;
  size_hz: number;
  offset_bytes?: number;
  iq_length_bytes?: number;
  label?: string;
}

const SettingValue = styled.span`
  font-size: 14px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DurationUnit = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  margin-left: 6px;
  display: inline-flex;
  align-items: baseline;
`;

// Fixed-height container for duration controls to prevent layout thrash
const DurationBlock = styled.div`
  height: 6rem;
  display: grid;
  grid-template-columns: 1fr;
  align-items: center;
`;

const DurationInputOrTextRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  height: 3.5rem;
`;

const DurationManualCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
`;

const DurationInputBox = styled.input`
  width: 3.5rem;
  height: 2rem;
  background: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 6px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 14px;
  text-align: right;
  padding: 0;
  outline: none;

  &:hover {
    border-color: ${(props) => props.theme.primary};
  }
`;

const DurationEstimate = styled.div`
  margin-top: 4px;
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
`;

const CaptureActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
  margin-top: 0;
  grid-column: 1 / -1;
`;

const PlaybackOption = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 6px;
  justify-content: start;
`;

const PlaybackLabel = styled.label`
  font-size: 11px;
  color: ${(props) => props.theme.textPrimary};
  white-space: nowrap;
  margin: 0;
`;

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) =>
    props.$paused ? props.theme.primaryAnchor : props.theme.surface};
  border: 1px solid
    ${(props) =>
      props.$paused ? props.theme.primary : props.theme.borderHover};
  border-radius: 8px;
  color: ${(props) =>
    props.$paused ? props.theme.primary : props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: ${(props) => props.theme.primary}0d;
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
  }
`;

const CaptureButton = styled(PauseButton)<{ $disabled: boolean }>`
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
`;

const StatusDownloadsCard = styled.div`
  display: grid;
  gap: 12px;
  grid-column: 1 / -1;
  margin-top: 12px;
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  padding: 12px;
  min-width: 0;
  z-index: 10;
  position: relative;
`;

const InfoCardTitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 2px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const CaptureAvailableDot = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 7px;
  border-radius: 50%;
  background: ${(props) => props.theme.primary};
  vertical-align: middle;
`;

const InfoRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-width: 0;
`;

const InfoLabel = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  min-width: 0;
`;

const DownloadMeta = styled.div`
  margin-top: 7px;
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
`;

const DownloadCard = styled.div<{ $latest?: boolean }>`
  display: grid;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  min-width: 0;
  opacity: ${(props) => (props.$latest ? 1 : 0.85)};
`;

const DownloadLink = styled.a`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-family: ${(props) => props.theme.typography.mono};
  text-decoration: none;
  display: block;
  word-break: break-all;
  overflow-wrap: anywhere;
  white-space: normal;
  min-width: 0;
`;

const StatusValue = styled.div<{
  $tone: "warning" | "success" | "error" | "muted";
}>`
  font-size: 12px;
  font-family: ${(props) => props.theme.typography.mono};
  color: ${(props) =>
    props.$tone === "success"
      ? props.theme.success
      : props.$tone === "error"
        ? props.theme.danger
        : props.$tone === "warning"
          ? props.theme.warning
          : props.theme.textSecondary};
  text-align: right;
  white-space: nowrap;
`;

const ErrorSettingValue = styled(SettingValue)`
  color: ${(props) => props.theme.danger};
  font-size: 11px;
`;

const ValidationWarning = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background-color: ${(props) => props.theme.warning}15;
  border-left: 3px solid ${(props) => props.theme.warning};
  border-radius: 4px;
  margin-top: 8px;
  grid-column: 1 / -1;
`;

const WarningText = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.warning};
  line-height: 1.4;
  font-weight: 500;
`;

const WarningIcon = styled(AlertTriangle)`
  color: ${(props) => props.theme.warning};
  flex-shrink: 0;
  margin-top: 1px;
`;

const DownloadsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const DestinationControls = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  width: 100%;
`;

const DestinationButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 42px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  padding: 10px 12px;
  color: ${(props) => props.theme.textPrimary};
  background: ${(props) =>
    props.theme.mode === "light"
      ? props.theme.primaryAnchor
      : props.theme.surface};
  font: 12px ${(props) => props.theme.typography.mono};
  cursor: pointer;

  &:hover {
    background: ${(props) => props.theme.colors.surfaceHover};
    border-color: ${(props) => props.theme.borderHover};
  }

  span:first-of-type {
    flex: 0 0 auto;
  }

  span:nth-of-type(2) {
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: ${(props) => props.theme.textSecondary};
  }

  svg:last-child {
    flex: 0 0 auto;
  }
`;

const DestinationMenu = styled.div`
  position: absolute;
  z-index: 10000;
  top: calc(100% + 4px);
  right: 0;
  display: grid;
  width: 100%;
  box-sizing: border-box;
  padding: 4px;
  background: ${(props) => props.theme.colors.surface};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
`;

const DestinationOption = styled.button<{ $disabled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px;
  border: 0;
  border-radius: 3px;
  color: ${(props) =>
    props.$disabled ? props.theme.textMuted : props.theme.textPrimary};
  background: transparent;
  text-align: left;
  font: 11px ${(props) => props.theme.typography.mono};
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};

  &:hover:not(:disabled) {
    background: ${(props) => props.theme.colors.surfaceHover};
  }
`;

const DestinationHint = styled.div`
  padding: 4px 7px 6px;
  color: ${(props) => props.theme.textMuted};
  font-size: 10px;
`;

const SaveCaptureButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  background: transparent;
  color: ${(props) => props.theme.textSecondary};
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
`;

const ClearStatusButton = styled.button`
  background: none;
  border: none;
  color: ${(props) => props.theme.textMuted};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  padding: 2px 4px;
`;

const SectionBody = styled.div`
  display: grid;
  gap: 12px;
  min-width: 0;
  width: 100%;
`;

interface CaptureRange {
  min: number;
  max: number;
  segments: Array<{ label: string; min: number; max: number }>;
}

interface IQCaptureControlsSectionProps {
  variant?: "sidebar" | "node";
  defaultOpen?: boolean;
  open?: boolean;
  activeCaptureAreas: string[];
  availableCaptureAreas: Array<{
    label: string;
    min: number;
    max: number;
    extra?: React.ReactNode;
  }>;
  rangeExtras?: React.ReactNode;
  captureDurationMode: "timed" | "manual";
  captureDurationS: number;
  captureFileType: CaptureFileType;
  isMockSource?: boolean;
  acquisitionMode: "stepwise" | "interleaved" | "whole_sample";
  captureEncrypted: boolean;
  capturePlayback: boolean;
  captureGeolocation: boolean;
  captureRange: CaptureRange;
  maxSampleRate: number;
  captureStatus: CaptureStatus;
  isConnected: boolean;
  deviceState: DeviceState;
  onActiveCaptureAreasChange: (areas: string[]) => void;
  onCaptureDurationModeChange?: (mode: "timed" | "manual") => void;
  onCaptureDurationSChange: (value: number) => void;
  onCaptureFileTypeChange: (value: CaptureFileType) => void;
  onAcquisitionModeChange: (
    mode: "stepwise" | "interleaved" | "whole_sample",
  ) => void;
  onCaptureEncryptedChange: (value: boolean) => void;
  onCapturePlaybackChange: (value: boolean) => void;
  onCaptureGeolocationChange: (value: boolean) => void;
  onCapture: () => void;
  onStopCapture?: () => void;
  onClearStatus: () => void;
  channels?: ChannelDescriptor[];
  onCaptureWithChannels?: (channels: ChannelDescriptor[]) => void;
}

export const IQCaptureControlsSection: React.FC<
  IQCaptureControlsSectionProps
> = ({
  variant = "sidebar",
  defaultOpen = false,
  open,
  activeCaptureAreas,
  availableCaptureAreas,
  captureDurationMode,
  captureDurationS,
  captureFileType,
  isMockSource = false,
  acquisitionMode,
  captureEncrypted,
  capturePlayback,
  captureGeolocation,
  captureRange,
  maxSampleRate,
  captureStatus,
  isConnected,
  deviceState,
  onActiveCaptureAreasChange,
  onCaptureDurationModeChange,
  onCaptureDurationSChange,
  onCaptureFileTypeChange,
  onAcquisitionModeChange,
  onCaptureEncryptedChange,
  onCapturePlaybackChange,
  onCaptureGeolocationChange,
  onCapture,
  onStopCapture,
  onClearStatus,
  rangeExtras,
  channels,
  onCaptureWithChannels,
}) => {
  const captureDownloadNow = useCaptureDownloadClock();
  const [persistedDownloads, setPersistedDownloads] = React.useState<
    PersistedCaptureDownload[]
  >(loadPersistedCaptureDownloads);
  const [captureDestination, setCaptureDestination] = React.useState<CaptureDestinationId>(
    loadCaptureDestinationPreference,
  );
  const [captureFolderName, setCaptureFolderName] = React.useState("");
  const folderPickerAvailable = getCaptureDirectoryPicker() !== null;
  const [destinationMenuOpen, setDestinationMenuOpen] = React.useState(false);
  const [aspectAvailable, setAspectAvailable] = React.useState(false);
  const [destinationMessage, setDestinationMessage] = React.useState("");
  const [savingCaptureId, setSavingCaptureId] = React.useState<string | null>(null);
  const directoryHandle = React.useRef<Awaited<ReturnType<CaptureDirectoryPicker>> | null>(null);
  const [savedCollapsibleOpen] = React.useState(loadIqCaptureOpenState);
  const initialCaptureDestination = React.useRef(captureDestination).current;

  React.useEffect(() => {
    let active = true;
    void loadLastCaptureDirectory().then((directory) => {
      if (!active) return;
      if (directory) {
        directoryHandle.current = directory;
      }
      if (initialCaptureDestination === "folder" && directory) {
        setCaptureFolderName("Local folder");
      }
      if (initialCaptureDestination === "folder" && !directory) {
        setCaptureDestination("local");
        try {
          window.localStorage.setItem(CAPTURE_DESTINATION_STORAGE_KEY, "local");
        } catch {
          // Keep the in-memory fallback when storage is unavailable.
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);
  // Build derived channels from the capture range segments when channels aren't provided
  const derivedChannels: ChannelDescriptor[] = React.useMemo(() => {
    if (!captureRange?.segments) return [];
    return captureRange.segments.map((seg, idx) => {
      const minHz = seg.min;
      const maxHz = seg.max;
      const centerHz = Math.round((minHz + maxHz) / 2);
      const widthHz = Math.round(maxHz - minHz);
      return {
        center_freq_hz: centerHz,
        size_hz: widthHz,
        label: seg.label ?? `Ch${idx + 1}`,
      } as ChannelDescriptor;
    });
  }, [captureRange?.segments]);

  // Final channels payload to pass to backend (UI-chosen or derived)
  const channelsPayload: ChannelDescriptor[] =
    typeof channels !== "undefined" && channels && channels.length > 0
      ? channels
      : derivedChannels;

  const triggerWithChannels = () => {
    onCapture();
    if (typeof onCaptureWithChannels === "function") {
      onCaptureWithChannels(channelsPayload);
    }
  };
  const { isAuthenticated, sessionToken } = useAuthentication();
  const dispatch = useDispatch();

  React.useEffect(() => {
    let active = true;
    setAspectAvailable(false);
    if (!isAuthenticated || !sessionToken || typeof fetch === "undefined") return;
    const query = new URLSearchParams({ token: sessionToken });
    fetch(`/api/capture/destinations?${query.toString()}`)
      .then(async (response) => {
        if (!response.ok || !active) return;
        const body = (await response.json()) as {
          destinations?: { id: string; available: boolean }[];
        };
        if (active) {
          setAspectAvailable(
            body.destinations?.some(
              (destination) =>
                destination.id === "aspect" && destination.available,
            ) ?? false,
          );
        }
      })
      .catch(() => {
        if (active) setAspectAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, sessionToken]);

  const updateCaptureDestination = (destination: CaptureDestinationId) => {
    setCaptureDestination(destination);
    setDestinationMessage("");
    try {
      window.localStorage.setItem(CAPTURE_DESTINATION_STORAGE_KEY, destination);
    } catch {
      // Destination preference is optional when browser storage is unavailable.
    }
  };

  const chooseCaptureFolder = async () => {
    const picker = getCaptureDirectoryPicker();
    if (!picker) {
      directoryHandle.current = null;
      updateCaptureDestination("local");
      setDestinationMenuOpen(false);
      setDestinationMessage(
        "Folder selection is unavailable in this browser; using browser Downloads.",
      );
      return;
    }
    try {
      directoryHandle.current = await picker();
      setCaptureFolderName("Local folder");
      updateCaptureDestination("folder");
      setDestinationMenuOpen(false);
      void saveLastCaptureDirectory(directoryHandle.current);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDestinationMessage(
        error instanceof Error ? error.message : "Could not select a folder.",
      );
    }
  };

  const triggerBrowserDownload = (url: string, filename: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener noreferrer";
    link.click();
  };

  const saveCaptureToDestination = async (
    download: PersistedCaptureDownload,
  ) => {
    const filename = safeDownloadFilename(download.filename);
    const downloadUrl = buildSafeDownloadUrl(
      download.downloadUrl,
      sessionToken,
    );
    if (!downloadUrl) {
      setDestinationMessage("This capture has no safe download URL.");
      return;
    }

    if (captureDestination === "local") {
      triggerBrowserDownload(downloadUrl, filename);
      setDestinationMessage(`Started browser download: ${filename}`);
      return;
    }

    setSavingCaptureId(download.jobId);
    setDestinationMessage("");
    try {
      if (captureDestination === "aspect") {
        const query = new URLSearchParams({
          token: sessionToken ?? "",
          jobId: download.jobId,
        });
        const response = await fetch(
          `/api/capture/save/aspect?${query.toString()}`,
          { method: "POST" },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          files?: string[];
        };
        if (!response.ok) {
          throw new Error(body.error || `Aspect save failed: HTTP ${response.status}`);
        }
        setDestinationMessage(
          `Saved ${body.files?.join(", ") || filename} to Aspect.`,
        );
        return;
      }

      const picker = getCaptureDirectoryPicker();
      const pickDirectory: CaptureDirectoryPicker = directoryHandle.current
        ? async () => directoryHandle.current!
        : picker ?? (async () => {
            throw new Error("Folder selection is unavailable in this browser.");
          });
      await saveCaptureToDirectory(downloadUrl, filename, pickDirectory);
      setDestinationMessage(`Saved ${filename} to the selected folder.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (captureDestination === "folder") {
        directoryHandle.current = null;
        updateCaptureDestination("local");
        triggerBrowserDownload(downloadUrl, filename);
        setDestinationMessage(
          `Selected folder is unavailable. Started browser download for ${filename}.`,
        );
      } else {
        setDestinationMessage(
          error instanceof Error ? error.message : "Could not save capture.",
        );
      }
    } finally {
      setSavingCaptureId(null);
    }
  };

  // Access live SDR settings from store for validation
  const gain = useAppSelector((s) => s.spectrum.gain);
  const ppm = useAppSelector((s) => s.spectrum.ppm);

  const {
    isSupported,
    requestPermission,
    error: geoError,
    isLoading: geoLoading,
  } = useGeolocation();

  const mappedCaptureAreas = React.useMemo(() => {
    return availableCaptureAreas.map((area) => {
      const matchingSegment = captureRange.segments.find(
        (seg) => seg.label === area.label,
      );
      return {
        label: matchingSegment?.label ?? area.label,
        min: matchingSegment?.min ?? area.min,
        max: matchingSegment?.max ?? area.max,
        extra: area.extra,
        totalLabel: formatChannelFreq(
          (matchingSegment?.max ?? area.max) - (matchingSegment?.min ?? area.min),
        ),
      };
    });
  }, [availableCaptureAreas, captureRange.max, captureRange.min, captureRange.segments]);

  const handleActiveCaptureAreasChange = (nextAreas: string[]) => {
    const hwHz = maxSampleRate;
    const _nextOnscreenOnly =
      nextAreas.includes("Onscreen") && nextAreas.length === 1;
    const nextHasChannel = nextAreas.some((a) => a !== "Onscreen");

    const nextSelectedSegments = mappedCaptureAreas.filter((a) =>
      nextAreas.includes(a.label),
    );
    const nextMin =
      nextSelectedSegments.length > 0
        ? Math.min(...nextSelectedSegments.map((s) => s.min))
        : 0;
    const nextMax =
      nextSelectedSegments.length > 0
        ? Math.max(...nextSelectedSegments.map((s) => s.max))
        : 0;
    const nextSpan = nextMax - nextMin;

    if (nextAreas.includes("Onscreen")) {
      if (acquisitionMode !== "whole_sample") {
        onAcquisitionModeChange("whole_sample");
      }
    } else if (nextHasChannel && nextSpan > hwHz) {
      if (acquisitionMode === "whole_sample") {
        onAcquisitionModeChange("stepwise");
      }
    }

    onActiveCaptureAreasChange(nextAreas);
  };

  const hasOnscreenSelected = activeCaptureAreas.includes("Onscreen");
  const hasChannelSelected = activeCaptureAreas.some((a) => a !== "Onscreen");
  const onscreenOnly = hasOnscreenSelected && !hasChannelSelected;

  /**
   * .napt Validation Logic
   *
   * Requirements:
   * 1. Frequency: Selected range must be within signals.channels (A, B, C)
   * 2. Gain: >= 20dB
   * 3. PPM: >= 1
   *
   * Future: Integrate Spike Detection here.
   */
  const naptValidation = React.useMemo(() => {
    const isGainValid = gain >= 20;
    const isPpmValid = ppm >= 1;

    // Check frequency range validity
    // availableCaptureAreas is populated from the channel definitions in signals.yaml.
    const segments = captureRange?.segments || [];
    const selectedSegments = segments.filter((seg) =>
      activeCaptureAreas.includes(seg.label),
    );

    let isFreqValid = selectedSegments.length > 0;
    const invalidSegments: string[] = [];

    for (const seg of selectedSegments) {
      if (!isValidNaptRange(seg, availableCaptureAreas)) {
        isFreqValid = false;
        invalidSegments.push(seg.label);
      }
    }

    // TODO: Spike Detection validation hook
    // One day we will check for the presence of stable APT-like spikes before allowing .napt
    const isSpikeDetectionValid = true;

    const isValid =
      isGainValid && isPpmValid && isFreqValid && isSpikeDetectionValid;

    const reasons: string[] = [];
    if (!isGainValid) reasons.push(`Gain too low (${gain}dB < 20dB)`);
    if (!isPpmValid) reasons.push(`PPM too low (${ppm} < 1)`);
    if (!isFreqValid) {
      if (selectedSegments.length === 0) {
        reasons.push("No capture areas selected");
      } else {
        reasons.push(
          `Range outside N-APT channels: ${invalidSegments.join(", ")}`,
        );
      }
    }

    return { isValid, reasons, isGainValid, isPpmValid, isFreqValid };
  }, [gain, ppm, captureRange, activeCaptureAreas, availableCaptureAreas]);

  // Raw .iq is the lossless default fallback when .napt eligibility is lost.
  React.useEffect(() => {
    if (isMockSource && captureFileType === ".napt") {
      onCaptureFileTypeChange(".iq");
      return;
    }
    if (
      captureFileType === ".napt" &&
      !naptValidation.isValid &&
      activeCaptureAreas.length > 0
    ) {
      onCaptureFileTypeChange(".iq");
    }
  }, [
    naptValidation.isValid,
    captureFileType,
    isMockSource,
    onCaptureFileTypeChange,
    activeCaptureAreas.length,
  ]);

  const selectedCaptureSpanHz =
    activeCaptureAreas.length > 0
      ? Math.max(0, captureRange.max - captureRange.min)
      : 0;
  const estimatedTimedDataBytes =
    Math.max(0, captureDurationS) *
    selectedCaptureSpanHz *
    BYTES_PER_IQ_SAMPLE.u8;

  // Notification effect for capture status changes
  React.useEffect(() => {
    const captureNotificationId = `capture-${captureStatus?.jobId || "unknown"}`;

    if (captureStatus?.status === "started") {
      dispatch(
        addNotification({
          id: captureNotificationId,
          type: "info",
          title: "Capturing...",
          message: captureStatus.message || "I/Q capture in progress",
          duration: 0, // Don't auto-dismiss while capturing
        }),
      );
    } else if (captureStatus?.status === "progress") {
      // Update notification with progress if available
      dispatch(
        updateNotification({
          id: captureNotificationId,
          updates: {
            message: captureStatus.message || "Processing...",
          },
        }),
      );
    } else if (captureStatus?.status === "done") {
      dispatch(
        updateNotification({
          id: captureNotificationId,
          updates: {
            type: "success",
            title: "Capture Complete",
            message: captureStatus.filename
              ? `New capture ready for download\n${captureStatus.fileSize ? formatFileSize(captureStatus.fileSize) : ""}`
              : "I/Q capture completed successfully",
            duration: 5000, // Auto-dismiss after 5 seconds
          },
        }),
      );
    } else if (captureStatus?.status === "failed") {
      dispatch(
        updateNotification({
          id: captureNotificationId,
          updates: {
            type: "error",
            title: "Capture Failed",
            message:
              captureStatus.error ||
              captureStatus.message ||
              "I/Q capture failed",
            duration: 8000, // Keep error notification longer
          },
        }),
      );
    }
  }, [captureStatus, dispatch]);

  React.useEffect(() => {
    if (captureStatus?.status !== "done" || !captureStatus.downloadUrl) return;
    const download: PersistedCaptureDownload = {
      jobId: captureStatus.jobId,
      downloadUrl: captureStatus.downloadUrl,
      filename: captureStatus.filename,
      fileSize: captureStatus.fileSize,
      duration: captureStatus.duration,
      timestamp: captureStatus.timestamp ?? Date.now(),
    };
    setPersistedDownloads((current) => {
      const next = [
        download,
        ...current.filter((item) => item.jobId !== download.jobId),
      ].filter(
        (item) => Date.now() - item.timestamp < CAPTURE_DOWNLOAD_RETENTION_MS,
      );
      persistCaptureDownloads(next);
      return next;
    });
  }, [captureStatus]);

  const clearPersistedDownloads = () => {
    setPersistedDownloads([]);
    persistCaptureDownloads([]);
    onClearStatus();
  };

  // Calculate capture range span to determine appropriate mode
  const captureRangeSpan = captureRange.max - captureRange.min;
  const hardwareSampleRateHz = maxSampleRate;
  const hasOnscreenCaptureArea = activeCaptureAreas.includes("Onscreen");

  const captureCoversChannel =
    hasOnscreenCaptureArea ||
    (hardwareSampleRateHz > 0 &&
      captureRangeSpan > 0 &&
      hardwareSampleRateHz >= captureRangeSpan);
  const _isOnscreenExactMatch =
    onscreenOnly &&
    hardwareSampleRateHz > 0 &&
    Math.abs(captureRangeSpan - hardwareSampleRateHz) < 10_000;
  const isWiderThanHardware =
    !hasOnscreenCaptureArea &&
    captureRangeSpan > hardwareSampleRateHz;

  // GUARDS: Determine appropriate capture mode based on capture type
  let effectiveAcquisitionMode = acquisitionMode;

  if (captureCoversChannel) {
    // Hardware sample rate covers the selected channel span → force whole_sample
    effectiveAcquisitionMode = "whole_sample";
  } else if (isWiderThanHardware) {
    // Wider than hardware → only stepwise or interleaved allowed
    if (acquisitionMode === "whole_sample") {
      effectiveAcquisitionMode = "stepwise";
    } else {
      effectiveAcquisitionMode = acquisitionMode;
    }
  } else {
    // Narrower than hardware but not exact match → user's choice
    effectiveAcquisitionMode = acquisitionMode;
  }
  const statusTone =
    captureStatus?.status === "done"
      ? "success"
      : captureStatus?.status === "failed"
        ? "error"
        : captureStatus?.status === "started" ||
            captureStatus?.status === "progress"
          ? "warning"
          : "muted";
  const statusText =
    captureStatus?.status === "done"
      ? "Complete"
      : captureStatus?.status === "failed"
        ? `Failed: ${captureStatus.error || "Unknown error"}`
        : captureStatus?.status === "started" ||
            captureStatus?.status === "progress"
          ? "In progress..."
          : "Idle";
  const hasSelectedCaptureAreas = activeCaptureAreas.length > 0;
  const isCaptureActive = captureStatus?.status === "started";
  const encryptionLocked =
    isMockSource || captureFileType === ".napt" || captureFileType === ".wav";
  const isCaptureDisabled =
    !isConnected ||
    deviceState === "loading" ||
    !isAuthenticated ||
    (!isCaptureActive && !hasSelectedCaptureAreas);

  const handleGeolocationToggle = async (enabled: boolean) => {
    if (enabled) {
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        // If permission denied, keep toggle off
        onCaptureGeolocationChange(false);
        return;
      }
    }
    onCaptureGeolocationChange(enabled);
  };
  const capturePhaseMessage = captureStatus?.message;
  const captureButtonLabel = isCaptureActive ? "Stop" : "Capture";
  const handleCaptureClick = isCaptureActive
    ? (onStopCapture ?? triggerWithChannels)
    : triggerWithChannels;
  const handleDurationModeChange =
    onCaptureDurationModeChange ?? (() => undefined);

  const captureContent = (
    <>
      <ChannelsSelector
        label="Ranges"
        icon={Scan}
        channels={mappedCaptureAreas}
        selectedLabels={activeCaptureAreas}
        onChange={handleActiveCaptureAreasChange}
        rangeExtras={rangeExtras}
      />

      <Row label={<IconLabel icon={Clock} text="Duration" />}>
        <DurationBlock>
          <RadioTabs
            value={captureDurationMode}
            onChange={(v) => handleDurationModeChange(v as "timed" | "manual")}
            options={[
              { value: "timed", label: "Timed" },
              { value: "manual", label: "Manual" },
            ]}
          />

          <DurationInputOrTextRow>
            {captureDurationMode === "timed" ? (
              <div style={{}}>
                <DurationInputBox
                  type="number"
                  min="1"
                  step="1"
                  value={Math.round(captureDurationS)}
                  name="iq-capture-duration"
                  onChange={(e) =>
                    onCaptureDurationSChange(parseInt(e.target.value) || 1)
                  }
                />
                <DurationUnit>s</DurationUnit>
                {activeCaptureAreas.length > 0 && (
                  <DurationEstimate>
                    Estimated data: {formatFileSize(estimatedTimedDataBytes)}
                  </DurationEstimate>
                )}
              </div>
            ) : (
              <DurationManualCenter>
                <SettingValue>
                  I/Q Capture runs until <br /> you press Stop.
                </SettingValue>
              </DurationManualCenter>
            )}
          </DurationInputOrTextRow>
        </DurationBlock>
      </Row>

      <Row label={<IconLabel icon={FileIcon} text="File type" />}>
        <div
          style={{ display: "flex", flexDirection: "column", width: "100%" }}
        >
          <SettingSelect
            value={captureFileType}
            onChange={(e) =>
              onCaptureFileTypeChange(e.target.value as CaptureFileType)
            }
          >
            <option value=".napt" disabled={isMockSource || !naptValidation.isValid}>
              .napt {!naptValidation.isValid ? "(Invalid)" : ""}
            </option>
            <option value=".iq">.iq</option>
            <option value=".wav">.wav</option>
          </SettingSelect>

          {!naptValidation.isValid && (
            <ValidationWarning>
              <WarningIcon size={14} />
              <WarningText>
                .napt format requires: gain ≥ 20dB, ppm ≥ 1, and frequency
                within N-APT channels.
                <br />
                <strong>Issues:</strong> {naptValidation.reasons.join(", ")}
              </WarningText>
            </ValidationWarning>
          )}
        </div>
      </Row>

      <Row
        label={<IconLabel icon={PanelLeftDashed} text="Acquisition Mode" />}
        tooltipTitle="Capture Mode Selection"
        tooltip="Stepwise: Captures frequency ranges sequentially. Interleaved: Rapidly sweeps and interleaves results. Whole Sample: Captures exact hardware sample rate without movement."
      >
        <SettingSelect
          value={effectiveAcquisitionMode}
          onChange={(e) =>
            onAcquisitionModeChange(
              e.target.value as "stepwise" | "interleaved" | "whole_sample",
            )
          }
          disabled={captureCoversChannel}
        >
          {(!isWiderThanHardware || captureCoversChannel) && (
            <option value="whole_sample">Whole Sample</option>
          )}
          {!captureCoversChannel && (
            <>
              <option value="stepwise">Stepwise</option>
              <option value="interleaved">Interleaved (TDMS)</option>
            </>
          )}
        </SettingSelect>
      </Row>

      <Row
        label={<IconLabel icon={LockKeyhole} text="Encrypted (AES-256-GCM)" />}
      >
        <ToggleSwitch
          $disabled={encryptionLocked}
        >
          <ToggleSwitchInput
            type="checkbox"
            checked={!isMockSource &&
              (captureFileType === ".napt" || (captureFileType === ".iq" && captureEncrypted))}
            disabled={encryptionLocked}
            onChange={(e) => onCaptureEncryptedChange(e.target.checked)}
          />
          <ToggleSwitchSlider
            $disabled={encryptionLocked}
          />
        </ToggleSwitch>
      </Row>

      <Row
        label={<IconLabel icon={MapPin} text="Geolocation" />}
        tooltipTitle="Location data (lat, long, accuracy, altitude)"
        tooltip="Adds your current location to the capture metadata. Requires browser permission to access location."
      >
        <ToggleSwitch
          $disabled={!isSupported || geoLoading}
        >
          <ToggleSwitchInput
            type="checkbox"
            checked={captureGeolocation}
            disabled={!isSupported || geoLoading}
            onChange={(e) => handleGeolocationToggle(e.target.checked)}
          />
          <ToggleSwitchSlider
            $disabled={!isSupported || geoLoading}
          />
        </ToggleSwitch>
      </Row>

      {geoError && (
        <Row label="">
          <ErrorSettingValue>{geoError}</ErrorSettingValue>
        </Row>
      )}

      <CaptureActions>
        <DestinationControls>
          <DestinationButton
            type="button"
            aria-haspopup="menu"
            aria-expanded={destinationMenuOpen}
            onClick={() => setDestinationMenuOpen((open) => !open)}
          >
            <Download size={14} />
            <span>Download to</span>
            <span>
              {captureDestination === "folder"
                ? captureFolderName || "~/Downloads"
                : captureDestination === "aspect"
                  ? "Aspect"
                  : "~/Downloads"}
            </span>
            <ChevronDown size={14} />
          </DestinationButton>
          {destinationMenuOpen && (
            <DestinationMenu role="menu" aria-label="Capture destination">
              <DestinationOption
                type="button"
                role="menuitem"
                onClick={() => {
                  directoryHandle.current = null;
                  setCaptureFolderName("");
                  updateCaptureDestination("local");
                  setDestinationMenuOpen(false);
                }}
              >
                <Download size={12} />
                {CAPTURE_DESTINATION_PROVIDERS.find(
                  (provider) => provider.id === "local",
                )?.label}
              </DestinationOption>
              <DestinationOption
                type="button"
                role="menuitem"
                $disabled={!folderPickerAvailable}
                disabled={!folderPickerAvailable}
                title={
                  folderPickerAvailable
                    ? "Choose where captures are saved"
                    : "Folder selection is unavailable in this browser"
                }
                onClick={() => void chooseCaptureFolder()}
              >
                <FolderOpen size={12} />
                {CAPTURE_DESTINATION_PROVIDERS.find(
                  (provider) => provider.id === "folder",
                )?.label}
              </DestinationOption>
              <DestinationOption
                type="button"
                role="menuitem"
                $disabled={!aspectAvailable}
                disabled={!aspectAvailable}
                title={
                  aspectAvailable
                    ? "Save captures to the configured Aspect mount"
                    : "Set N_APT_ASPECT_PATH in the backend environment"
                }
                onClick={() => {
                  updateCaptureDestination("aspect");
                  setDestinationMenuOpen(false);
                }}
              >
                <HardDrive size={12} />
                {CAPTURE_DESTINATION_PROVIDERS.find(
                  (provider) => provider.id === "aspect",
                )?.label}
              </DestinationOption>
              {!aspectAvailable && (
                <DestinationHint>
                  Set N_APT_ASPECT_PATH in the backend environment.
                </DestinationHint>
              )}
            </DestinationMenu>
          )}
        </DestinationControls>
        <CaptureButton
          $paused={false}
          $disabled={isCaptureDisabled}
          onClick={handleCaptureClick}
          disabled={isCaptureDisabled}
        >
          {captureButtonLabel}
        </CaptureButton>

        <PlaybackOption>
          <input
            type="checkbox"
            checked={capturePlayback}
            onChange={(e) => onCapturePlaybackChange(e.target.checked)}
          />
          <PlaybackLabel>Playback after capture</PlaybackLabel>
        </PlaybackOption>
      </CaptureActions>

      <StatusDownloadsCard>
        <DownloadsHeader>
          <InfoCardTitle>Downloads</InfoCardTitle>
          <ClearStatusButton
            onClick={clearPersistedDownloads}
            title="Clear capture status"
          >
            <Trash2 size={12} /> Clear
          </ClearStatusButton>
        </DownloadsHeader>
        {destinationMessage && (
          <DestinationHint role="status">{destinationMessage}</DestinationHint>
        )}
        {persistedDownloads.length > 0 && isAuthenticated ? (
          persistedDownloads.map((download) => (
            <DownloadCard
              key={download.jobId}
              $latest={download.jobId === persistedDownloads[0]?.jobId}
            >
              <InfoRow>
                <div style={{ minWidth: 0 }}>
                  <DownloadLink
                    href={buildSafeDownloadUrl(download.downloadUrl, sessionToken)}
                    download={download.filename || "capture"}
                    rel="noopener noreferrer"
                    title={download.filename || "Download"}
                  >
                    {download.filename || "Download"}
                  </DownloadLink>
                  <DownloadMeta>
                    {formatRelativeCaptureTime(
                      download.timestamp,
                      captureDownloadNow,
                    )}
                    {" / "}
                    {typeof download.fileSize === "number" &&
                      formatFileSize(download.fileSize)}
                    {" / "}
                    {typeof download.duration === "number" &&
                      formatDurationMs(download.duration)}
                  </DownloadMeta>
                </div>
                <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                  <StatusValue $tone="success">Complete</StatusValue>
                  <SaveCaptureButton
                    type="button"
                    disabled={savingCaptureId === download.jobId}
                    onClick={() => void saveCaptureToDestination(download)}
                    title={`Save ${download.filename || "capture"} to the selected destination`}
                  >
                    {savingCaptureId === download.jobId
                      ? "Saving…"
                      : captureDestination === "aspect"
                        ? "Save to Aspect"
                        : captureDestination === "folder"
                          ? "Save to folder"
                          : "Save to Downloads"}
                  </SaveCaptureButton>
                </div>
              </InfoRow>
            </DownloadCard>
          ))
        ) : (
          <InfoRow>
            <InfoLabel>
              {capturePhaseMessage ||
                (captureStatus?.status === "started" ||
                captureStatus?.status === "progress"
                  ? "Capturing now..."
                  : "No downloads yet")}
            </InfoLabel>
            <StatusValue $tone={statusTone}>{statusText}</StatusValue>
          </InfoRow>
        )}
      </StatusDownloadsCard>
    </>
  );

  return (
    <Section data-sidebar-scroll-root="iq-capture">
      {variant === "sidebar" ? (
        <Collapsible
          icon={<FileSignal size={14} />}
          label={
            <>
              Take an I/Q Capture
              {persistedDownloads.length > 0 && (
                <CaptureAvailableDot title="Saved captures available" />
              )}
            </>
          }
          defaultOpen={savedCollapsibleOpen ?? defaultOpen}
          open={open ?? savedCollapsibleOpen}
          onOpenChange={persistIqCaptureOpenState}
          sectionId="iq-capture"
        >
          <SectionBody>{captureContent}</SectionBody>
        </Collapsible>
      ) : (
        <SectionBody>{captureContent}</SectionBody>
      )}
    </Section>
  );
};
