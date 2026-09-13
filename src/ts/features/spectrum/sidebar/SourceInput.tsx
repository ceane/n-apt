import React, { useRef, useEffect } from "react";
import styled from "styled-components";
import { Loader2 } from "lucide-react";
import type { SourceMode } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { isMockDevice } from "@n-apt/app/infrastructure/services/deviceCapabilities";
import { VaultStatus } from "@n-apt/ui/VaultStatus";
import { resolveSourceModeManagement } from "@n-apt/app/infrastructure/streams/sourceModeManagement";
import { resolveLiveSourcePauseButtonState } from "@n-apt/spectrum/public/liveSourceLifecycle";

const SourceInputWrapper = styled.div`
  display: grid;
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
`;

const DevicePicker = styled.div`
  display: grid;
  gap: 8px;
  grid-column: 1 / -1;
  width: 100%;
`;

const DevicePills = styled.div`
  display: grid;
  gap: 8px;
`;

const SelectionModeHint = styled.div`
  color: ${({ theme }) => theme.textSecondary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const DevicePill = styled.div<{
  $selected?: boolean;
  $opacity?: number;
}>`
  display: grid;
  box-sizing: border-box;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid
    ${({ theme, $selected }) => ($selected ? theme.primary : theme.borderHover)};
  background: ${({ theme, $selected }) =>
    $selected ? `${theme.primary}14` : theme.surface};
  color: ${({ theme }) => theme.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  opacity: ${({ $opacity = 1 }) => $opacity};
  transition:
    opacity 0.18s ease,
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;
`;

const FilePill = styled.div<{ $active?: boolean }>`
  display: grid;
  box-sizing: border-box;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: 96px;
  padding: 16px 16px 16px 18px;
  border-radius: 22px;
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.primary : theme.borderHover)};
  background: ${({ theme, $active }) =>
    $active ? theme.primaryAnchor : theme.surface};
  color: ${({ theme }) => theme.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease;

  &:hover {
    transform: translateY(-1px);
  }
`;

const FilePillMain = styled.div`
  display: grid;
  align-content: center;
  gap: 2px;
  min-width: 0;
  text-align: left;
`;

const FilePillName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: inherit;
`;

const FilePillMeta = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.65;
`;

const FilePillSecondaryRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const FileBrowseLink = styled.button`
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 10px;
  letter-spacing: 0.04em;
  opacity: 0.82;
  margin-top: 6px;
  padding: 2px 0 0;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-transform: uppercase;
  user-select: none;

  &:hover {
    opacity: 1;
  }
`;

const HiddenFileInput = styled.input`
  position: fixed;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
`;

export const isSourceDeviceSelected = (
  sourceMode: SourceMode,
  deviceId: string,
  selectedDeviceId?: string,
) => sourceMode === "live" && deviceId === selectedDeviceId;

const DevicePillMain = styled.div<{ $opacity?: number }>`
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: left;
  opacity: ${({ $opacity = 1 }) => $opacity};
  transition: opacity 0.18s ease;
`;

const DevicePillName = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
`;

const DevicePillMeta = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: normal;
  line-height: 1.3;
`;

const DeviceStatusDot = styled.span<{
  $active?: boolean;
  $loading?: boolean;
  $blink?: boolean;
}>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ $active, $loading }) =>
    $loading ? "#f4c542" : $active ? "#19d9ff" : "#666"};
  box-shadow: ${({ $active }) =>
    $active ? "0 0 0 2px rgba(25, 217, 255, 0.12)" : "none"};
  flex-shrink: 0;
  opacity: ${({ $blink = false }) => ($blink ? 1 : 0.25)};
  transition: opacity 90ms linear;
`;

const DeviceActionButton = styled.button<{
  $active?: boolean;
  $opacity?: number;
  $danger?: boolean;
  $muted?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 3px;
  width: 65px;
  aspect-ratio: 1;
  padding: 0;
  border-radius: 50%;
  border: 1px solid
    ${({ theme, $active, $danger }) =>
      $danger
        ? `${theme.danger}80`
        : $active
          ? theme.primary
          : theme.borderHover};
  background: ${({ theme, $active, $danger }) =>
    $danger
      ? `${theme.danger}18`
      : $active
        ? theme.primaryAnchor
        : theme.surface};
  color: ${({ theme, $active, $danger }) =>
    $danger ? theme.danger : $active ? theme.primary : theme.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  line-height: 1.05;
  cursor: pointer;
  box-shadow: none;
  user-select: none;
  opacity: ${({ $opacity = 1, $muted = false }) => ($muted ? 0.45 : $opacity)};
  transition:
    transform 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease,
    border-color 0.16s ease,
    opacity 0.18s ease;

  &:hover {
    transform: translateY(-1px);
    background: ${({ theme, $danger }) =>
      $danger ? `${theme.danger}26` : `${theme.primary}0d`};
    border-color: ${({ theme, $danger }) =>
      $danger ? theme.danger : theme.primary};
    color: ${({ theme, $danger }) => ($danger ? theme.danger : theme.primary)};
  }

  &:disabled {
    cursor: not-allowed;
    transform: none;
    opacity: 0.35;
    pointer-events: none;
  }
`;

const DeviceActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: end;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 170px;
`;

const DeviceLoadingState = styled.div`
  width: 65px;
  aspect-ratio: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 3px;
  border-radius: 50%;
  border: 1px solid ${({ theme }) => theme.borderHover};
  background: ${({ theme }) => theme.surface};
  color: ${({ theme }) => theme.warning};
  opacity: 0.9;
`;

const DeviceLoadingHint = styled.span`
  font-size: 8px;
  line-height: 1;
  max-width: 58px;
  text-align: center;
  opacity: 0.75;
  overflow-wrap: anywhere;
  white-space: normal;
`;

const FileActionButton = styled(DeviceActionButton)`
  width: 65px;
  aspect-ratio: 1;
  justify-self: end;
  border-radius: 50%;
`;

const ActionHint = styled.span`
  display: block;
  color: ${({ theme }) => theme.textSecondary};
  font-size: 9px;
  line-height: 1;
  max-width: 58px;
  opacity: 0.65;
  overflow-wrap: anywhere;
  white-space: normal;
`;

const ActionLabel = styled.span`
  display: block;
  line-height: 1.05;
  white-space: nowrap;
`;

const TxModeActionButton = styled(DeviceActionButton)`
  gap: 2px;
  line-height: 1;
  padding: 7px;

  ${ActionLabel} {
    font-size: 11px;
  }
`;

const DeviceRestartButton = styled(DeviceActionButton)`
  gap: 2px;

  ${ActionLabel} {
    font-size: 11px;
    white-space: normal;
    line-height: 1.05;
  }
`;

interface SourceInputProps {
  sourceMode: SourceMode;
  backend?: string | null;
  deviceName?: string | null;
  compactActiveOnly?: boolean;
  fileModeColor?: string;
  livePreviewStage?: number;
  fileActionLabel?: string;
  fileActionTitle?: string;
  selectedFilesCount?: number;
  autoBrowseRequested?: boolean;
  onAutoBrowseHandled?: () => void;
  onFileAction?: () => void;
  onFilesSelected?: (files: File[]) => void;
  onSourceModeChange: (mode: SourceMode) => void;
  spaceBoundDeviceId?: string | null;
  devices?: Array<{
    id: string;
    name: string;
    backend?: string | null;
    capability?: "rx" | "tx" | "tx_rx" | "mock" | string;
    duplex_mode?: string | null;
    active_duplex_mode?: string | null;
    active_duplex_modes?: string[] | null;
    summary?: string;
    status?: {
      color?: string;
      label?: string;
      paused?: boolean;
      loading?: boolean;
      loadingLabel?: string;
      canPause?: boolean;
      canRestart?: boolean;
      restarting?: boolean;
      hideAction?: boolean;
      actionLabel?: string;
      actionTitle?: string;
      onAction?: () => void;
      onRestart?: () => void;
    };
  }>;
  selectedDeviceId?: string;
  onSelectedDeviceChange?: (id: string) => void;
  selectionMode?: "single" | "multi";
  maxSelectedDevices?: number;
  selectedDeviceIds?: string[];
  onSelectedDevicesChange?: (ids: string[]) => void;
  onToggleDeviceRxPause?: (id: string) => void;
  onToggleDeviceTxMode?: (id: string) => void;
  onPreviewDeviceTx?: (id: string) => void;
  deviceTxActionsEnabled?: boolean;
  txBindingSourceId?: string | null;
  txPreviewSourceId?: string | null;
}

export const SourceInput: React.FC<SourceInputProps> = ({
  sourceMode,
  compactActiveOnly = false,
  fileModeColor: _fileModeColor,
  livePreviewStage = 0,
  fileActionLabel,
  fileActionTitle,
  selectedFilesCount = 0,
  autoBrowseRequested = false,
  onAutoBrowseHandled,
  onFileAction,
  onFilesSelected,
  onSourceModeChange,
  spaceBoundDeviceId,
  devices,
  selectedDeviceId,
  onSelectedDeviceChange,
  selectionMode = "single",
  maxSelectedDevices = 2,
  selectedDeviceIds = [],
  onSelectedDevicesChange,
  onToggleDeviceRxPause,
  onToggleDeviceTxMode,
  onPreviewDeviceTx,
  deviceTxActionsEnabled = true,
  txBindingSourceId,
  txPreviewSourceId,
}) => {
  const fileSelectionActive = sourceMode === "file";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [transmittingDotOn, setTransmittingDotOn] = React.useState(true);

  useEffect(() => {
    if (!autoBrowseRequested || sourceMode !== "file") return;
    fileInputRef.current?.click();
    onAutoBrowseHandled?.();
  }, [autoBrowseRequested, onAutoBrowseHandled, sourceMode]);

  const fileButtonLabel =
    fileActionLabel || (fileSelectionActive ? "Browse" : "File");
  const showFileSpaceHint =
    fileSelectionActive &&
    (fileButtonLabel === "Play" || fileButtonLabel === "Pause");
  const isFileLoading = fileButtonLabel.toLowerCase().includes("process");

  const _formatCapability = (
    capability?: string | null,
    isHalfDuplex?: boolean,
  ): string => {
    if (!capability) return "unknown";
    if (capability === "tx_rx") return isHalfDuplex ? "Half-Duplex" : "TX/RX";
    return capability.toUpperCase();
  };

  const formatStatusLabel = (
    status?: string | null,
    isMock?: boolean,
  ): string | null => {
    if (!status) return null;
    if (status === "transmitting")
      return isMock ? "Transmitting (Mock Tx)" : "Transmitting (Tx)";
    if (status === "connected" || status === "streaming") return "Connected";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const formatDuplexMode = (duplexMode?: string | null): string | null => {
    const normalized = duplexMode?.trim();
    if (!normalized) return null;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };
  const formatRxTxLabel = (
    capability?: string | null,
    duplexMode?: string | null,
    _status?: string | null,
  ) => {
    const normalizedDuplex = duplexMode?.toLowerCase?.() ?? "";
    if (normalizedDuplex === "half-duplex") {
      return "Rx/Tx";
    }
    return capability?.toLowerCase().includes("tx") ? "Tx" : "Rx";
  };
  const sourceDevicesRaw = devices ?? [];
  const isMockDeviceLocal = (device: (typeof sourceDevicesRaw)[number]) =>
    isMockDevice({
      capability: device.capability,
      id: device.id,
      name: device.name,
      backend: device.backend,
    });
  const isDeviceConnected = (device: (typeof sourceDevicesRaw)[number]) => {
    const label = device.status?.label?.toLowerCase?.() ?? "";
    return !["disconnected", "offline", "stale", "error"].includes(label);
  };
  const hasConnectedHardwareSource = sourceDevicesRaw.some(
    (device) => !isMockDeviceLocal(device) && isDeviceConnected(device),
  );
  // The mock fallback must stay visible while it is the actual active stream
  // (the backend fell back to it after a hardware unplug) so the pill list
  // matches what is really on screen. It is dropped whenever a real hardware
  // source is present and streaming/transmitting — the mock is then not the
  // active fallback, and the "hardware replaces mock" rule applies.
  const activeHardwareStreaming = sourceDevicesRaw.some(
    (device) =>
      !isMockDeviceLocal(device) &&
      (device.status?.label?.toLowerCase?.() === "receiving" ||
        device.status?.label?.toLowerCase?.() === "streaming" ||
        device.status?.label?.toLowerCase?.() === "transmitting"),
  );
  const activeMockFallbackDevice =
    sourceMode === "live" && !activeHardwareStreaming
      ? (sourceDevicesRaw.find(
          (device) =>
            isMockDeviceLocal(device) &&
            device.id === selectedDeviceId &&
            (device.status?.label?.toLowerCase?.() === "receiving" ||
              device.status?.label?.toLowerCase?.() === "streaming"),
        ) ?? null)
      : null;
  const sourceDevices = hasConnectedHardwareSource
    ? sourceDevicesRaw.filter(
        (device) =>
          !isMockDeviceLocal(device) ||
          device.status?.label?.toLowerCase?.() === "transmitting" ||
          (activeMockFallbackDevice !== null &&
            device.id === activeMockFallbackDevice.id),
      )
    : sourceDevicesRaw;
  const isHalfDuplexDevice = (device: (typeof sourceDevices)[number]) =>
    device.duplex_mode?.toLowerCase?.() === "half-duplex";
  const getStatusLabel = (status: unknown): string => {
    if (typeof status === "string") return status;
    if (
      status &&
      typeof status === "object" &&
      "label" in status &&
      typeof (status as any).label === "string"
    ) {
      return (status as any).label;
    }
    return "";
  };
  const isRxActiveStatus = (device: (typeof sourceDevices)[number]) =>
    ["receiving", "connected", "streaming"].includes(
      getStatusLabel(device.status).toLowerCase(),
    );

  const isHalfDuplexRxActive = (device: (typeof sourceDevices)[number]) =>
    device.duplex_mode?.toLowerCase?.() === "half-duplex" &&
    resolveLiveSourcePauseButtonState({
      isRxMode: resolveSourceModeManagement({
        source: {
          ...device,
          status: getStatusLabel(device.status),
          paused: device.status?.paused,
        },
        txBindingSourceId,
        txPreviewSourceId,
      }).isRxMode,
      isStreaming: isRxActiveStatus(device),
      paused: device.status?.paused === true,
    }).label === "Pause Rx";
  const _isStreamingDevice = (device: (typeof sourceDevices)[number]) =>
    resolveSourceModeManagement({
      source: {
        ...device,
        status: getStatusLabel(device.status),
        paused: device.status?.paused,
      },
      txBindingSourceId,
      txPreviewSourceId,
    }).isRxMode && isRxActiveStatus(device);
  const isTxModeDevice = (device: (typeof sourceDevices)[number]) =>
    resolveSourceModeManagement({
      source: {
        ...device,
        status: getStatusLabel(device.status),
        paused: device.status?.paused,
      },
      txBindingSourceId,
      txPreviewSourceId,
    }).isTxMode;
  const isTransmittingDevice = (device: (typeof sourceDevices)[number]) =>
    getStatusLabel(device.status).toLowerCase() === "transmitting";
  const transmittingDevice = sourceDevices.find(isTransmittingDevice) ?? null;
  React.useEffect(() => {
    if (!transmittingDevice) {
      setTransmittingDotOn(false);
      return;
    }

    setTransmittingDotOn(true);
    let timeoutId: any = null;
    let cancelled = false;

    const scheduleNextToggle = () => {
      const delay = 100 + Math.random() * 100;
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setTransmittingDotOn((value) => !value);
        scheduleNextToggle();
      }, delay);
    };

    scheduleNextToggle();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [transmittingDevice?.id]);

  const selectedDevice =
    sourceDevices.find((device) => device.id === selectedDeviceId) ?? null;
  const handleDeviceSelection = (deviceId: string) => {
    if (selectionMode !== "multi") {
      onSelectedDeviceChange?.(deviceId);
      return;
    }
    const nextIds = selectedDeviceIds.includes(deviceId)
      ? selectedDeviceIds.filter((id) => id !== deviceId)
      : selectedDeviceIds.length < maxSelectedDevices
        ? [...selectedDeviceIds, deviceId]
        : [...selectedDeviceIds.slice(1), deviceId];
    onSelectedDevicesChange?.(nextIds);
  };

  // While the source pills are dimmed in file-selection mode, switching to a
  // live source requires a double-click. The first click only arms the switch;
  // a second click within the window performs it. When the pills are at full
  // transparency (out of file mode), a single click switches as before.
  const handleDevicePillClick = (deviceId: string) => {
    if (!sourcePillsDimmed) {
      handleDeviceSelection(deviceId);
      return;
    }
    const now = Date.now();
    const previous = lastPillClickRef.current;
    lastPillClickRef.current = { id: deviceId, at: now };
    if (previous && previous.id === deviceId && now - previous.at <= 500) {
      lastPillClickRef.current = null;
      handleDeviceSelection(deviceId);
    }
  };
  const spaceBoundDevice =
    sourceDevices.find((device) => device.id === spaceBoundDeviceId) ?? null;
  const connectedDevice =
    sourceDevices.find((device) => isDeviceConnected(device)) ?? null;
  const stickyDevice =
    spaceBoundDevice ??
    transmittingDevice ??
    (sourceMode === "live"
      ? selectedDevice && isDeviceConnected(selectedDevice)
        ? selectedDevice
        : (connectedDevice ?? sourceDevices[0] ?? null)
      : null);
  const visibleDevices =
    compactActiveOnly && stickyDevice
      ? [stickyDevice]
      : compactActiveOnly
        ? []
        : sourceDevices;
  const showFilePill =
    !compactActiveOnly || (sourceMode === "file" && !transmittingDevice);
  const transmittingDeviceId = transmittingDevice?.id ?? null;
  const activeDeviceId =
    spaceBoundDevice?.id ??
    transmittingDeviceId ??
    (sourceMode === "live"
      ? selectedDevice && isDeviceConnected(selectedDevice)
        ? selectedDevice.id
        : (connectedDevice?.id ?? selectedDevice?.id ?? null)
      : null);
  const fileSelectionActiveDisplay =
    fileSelectionActive && !transmittingDeviceId;
  const fileModeOpacity =
    sourceMode === "file"
      ? livePreviewStage <= 0
        ? 0.25
        : livePreviewStage === 1
          ? 0.5
          : 1
      : 1;
  // When the source pills are dimmed (file selection mode), their action
  // buttons are locked out so they can't be triggered accidentally. They are
  // only re-enabled once the source is at full transparency (out of file mode).
  const sourcePillsDimmed =
    sourceMode === "file" && fileModeOpacity < 1 && !transmittingDeviceId;
  // In file mode, switching to a live source is an explicit double-click on
  // the source pill. A single click while dimmed is ignored so it doesn't yank
  // the user out of the file-selection flow by accident.
  const lastPillClickRef = useRef<{ id: string; at: number } | null>(null);
  return (
    <SourceInputWrapper>
      <HiddenFileInput
        ref={fileInputRef}
        type="file"
        accept=".napt,.iq,.wav"
        multiple
        onChange={(event) => {
          const files = event.target.files
            ? Array.from(event.target.files)
            : [];
          if (files.length > 0) {
            onFilesSelected?.(files);
          }
          event.target.value = "";
        }}
      />
      <DevicePicker>
        {selectionMode === "multi" && (
          <SelectionModeHint>
            Multi-source · select up to {maxSelectedDevices}
          </SelectionModeHint>
        )}
        <DevicePills>
          {visibleDevices.map((device) => {
            const isOnscreenStreaming = device.id === activeDeviceId;
            const isSelectedDevice = isSourceDeviceSelected(
              sourceMode,
              device.id,
              selectionMode === "multi"
                ? selectedDeviceIds.includes(device.id)
                  ? device.id
                  : undefined
                : selectedDeviceId,
            );
            const isTxCapable =
              device.capability?.toLowerCase().includes("tx") ?? false;
            const isHalfDuplex = isHalfDuplexDevice(device);
            const isTransmittingDevice = device.id === transmittingDeviceId;
            const isTxPreviewingDevice =
              device.status?.label?.toLowerCase() === "standby" &&
              device.status?.paused === true;
            const isTxPreview =
              !isTransmittingDevice &&
              !isTxPreviewingDevice &&
              !isTxModeDevice(device) &&
              isHalfDuplex &&
              isTxCapable &&
              !!onPreviewDeviceTx;
            const txActionLabel = isTxPreview
              ? "Preview Tx"
              : isTxPreviewingDevice
                ? "Start Tx"
                : isTransmittingDevice
                  ? "Stop Tx"
                  : "Start Tx";
            const actionLabel = isTxCapable
              ? txActionLabel
              : (device.status?.actionLabel ??
                (device.status?.paused === false ? "Pause" : "Resume"));
            const showDeviceSpaceHint =
              isOnscreenStreaming &&
              (actionLabel === "Resume" || actionLabel === "Pause");

            return (
              <DevicePill
                key={device.id}
                role="button"
                tabIndex={0}
                $selected={isSelectedDevice}
                $opacity={fileModeOpacity}
                onClick={() => handleDevicePillClick(device.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleDevicePillClick(device.id);
                  }
                }}
                title={`Switch to ${device.name}`}
              >
                <DeviceStatusDot
                  $active={isOnscreenStreaming}
                  $loading={device.status?.loading}
                  $blink={
                    device.id === transmittingDeviceId
                      ? transmittingDotOn
                      : true
                  }
                  style={
                    device.status?.color
                      ? { backgroundColor: device.status.color }
                      : undefined
                  }
                  aria-hidden="true"
                />
                <DevicePillMain $opacity={fileModeOpacity}>
                  <DevicePillName>{device.name}</DevicePillName>
                  <DevicePillMeta>
                    {formatRxTxLabel(
                      device.capability,
                      device.duplex_mode,
                      device.status?.label,
                    )}{" "}
                    ·{" "}
                    {formatStatusLabel(
                      getStatusLabel(device.status),
                      isMockDeviceLocal(device),
                    ) ?? "Connected"}
                    {device.duplex_mode
                      ? ` · ${formatDuplexMode(device.duplex_mode)}`
                      : ""}
                  </DevicePillMeta>
                </DevicePillMain>
                <DeviceActions>
                  {device.status?.loading ? (
                    <DeviceLoadingState
                      role="status"
                      aria-label={
                        device.status.loadingLabel ?? "Loading device"
                      }
                      title={device.status.loadingLabel ?? "Loading…"}
                    >
                      <Loader2
                        size={16}
                        className="animate-spin"
                        aria-hidden="true"
                      />
                      <DeviceLoadingHint>
                        {device.status.restarting ? "Restarting…" : "Loading…"}
                      </DeviceLoadingHint>
                    </DeviceLoadingState>
                  ) : device.status?.canRestart || device.status?.restarting ? (
                    <DeviceRestartButton
                      type="button"
                      aria-label={
                        device.status?.restarting
                          ? "Restarting device"
                          : "Restart device"
                      }
                      $active={isSelectedDevice}
                      $muted={!device.status?.restarting && !isSelectedDevice}
                      $opacity={fileModeOpacity}
                      disabled={!!device.status?.restarting}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!device.status?.restarting) {
                          device.status?.onRestart?.();
                        }
                      }}
                      title={
                        device.status?.restarting
                          ? "Restarting the stale source..."
                          : "Restart this source and reconnect its stream."
                      }
                    >
                      {device.status?.restarting ? (
                        <Loader2
                          size={13}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      <ActionLabel>
                        {device.status?.restarting ? "Restarting…" : "Restart"}
                      </ActionLabel>
                    </DeviceRestartButton>
                  ) : isHalfDuplex && onToggleDeviceRxPause ? (
                    <DeviceActionButton
                      type="button"
                      $active={isSelectedDevice}
                      $muted={
                        isTransmittingDevice ||
                        isTxPreviewingDevice ||
                        isTxModeDevice(device) ||
                        !!device.status?.loading
                      }
                      $opacity={fileModeOpacity}
                      disabled={sourcePillsDimmed || !!device.status?.loading}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleDeviceRxPause(device.id);
                      }}
                      title={
                        isHalfDuplexRxActive(device)
                          ? "Pause Rx"
                          : "Resume Rx"
                      }
                    >
                      {isHalfDuplexRxActive(device)
                        ? "Pause Rx"
                        : "Resume Rx"}
                      {isOnscreenStreaming && <ActionHint>[Space]</ActionHint>}
                    </DeviceActionButton>
                  ) : !isHalfDuplex &&
                    (device.status?.onAction ||
                      device.status?.actionLabel ||
                      device.status?.canPause) &&
                    (!isTxCapable || deviceTxActionsEnabled) ? (
                    isTxCapable ? (
                      <TxModeActionButton
                        type="button"
                        aria-label={actionLabel}
                        $active={isSelectedDevice}
                        $danger={isTransmittingDevice}
                        $opacity={fileModeOpacity}
                        disabled={sourcePillsDimmed}
                        onClick={(event) => {
                          event.stopPropagation();
                          device.status?.onAction?.();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            device.status?.onAction?.();
                          }
                        }}
                        onKeyUp={(event) => {
                          if (event.key === " " || event.key === "Spacebar") {
                            event.preventDefault();
                            event.stopPropagation();
                            device.status?.onAction?.();
                          }
                        }}
                        title={device.status.actionTitle}
                      >
                        <ActionLabel>{actionLabel}</ActionLabel>
                        <ActionHint>[Space]</ActionHint>
                      </TxModeActionButton>
                    ) : (
                      <DeviceActionButton
                        type="button"
                        $active={isSelectedDevice}
                        $danger={isTransmittingDevice}
                        $opacity={fileModeOpacity}
                        disabled={sourcePillsDimmed}
                        onClick={(event) => {
                          event.stopPropagation();
                          device.status?.onAction?.();
                        }}
                        title={device.status.actionTitle}
                      >
                        {actionLabel}
                        {showDeviceSpaceHint && (
                          <ActionHint>[Space]</ActionHint>
                        )}
                      </DeviceActionButton>
                    )
                  ) : null}
                  {isHalfDuplex &&
                  onToggleDeviceTxMode ? (
                    <TxModeActionButton
                      type="button"
                      aria-label={txActionLabel}
                      $active={isSelectedDevice || isTxPreviewingDevice}
                      $danger={isTransmittingDevice}
                      $muted={
                        !isTransmittingDevice &&
                        !isTxPreviewingDevice &&
                        !isTxModeDevice(device)
                      }
                      $opacity={fileModeOpacity}
                      disabled={sourcePillsDimmed}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isTxPreview) {
                          onPreviewDeviceTx?.(device.id);
                        } else {
                          onToggleDeviceTxMode(device.id);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (isTxPreview) {
                            onPreviewDeviceTx?.(device.id);
                          } else {
                            onToggleDeviceTxMode(device.id);
                          }
                        }
                      }}
                      onKeyUp={(event) => {
                        if (event.key === " " || event.key === "Spacebar") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (isTxPreview) {
                            onPreviewDeviceTx?.(device.id);
                          } else {
                            onToggleDeviceTxMode(device.id);
                          }
                        }
                      }}
                      title={txActionLabel}
                    >
                      <ActionLabel>{txActionLabel}</ActionLabel>
                    </TxModeActionButton>
                  ) : null}
                </DeviceActions>
              </DevicePill>
            );
          })}
          {showFilePill ? (
            <FilePill
              $active={fileSelectionActiveDisplay}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (sourceMode !== "file") {
                  onSourceModeChange("file");
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (sourceMode !== "file") {
                    onSourceModeChange("file");
                  }
                }
              }}
              title={
                fileActionTitle ||
                (sourceMode === "file"
                  ? "Browse / Process / Play / Pause"
                  : "Switch to File Selection")
              }
            >
              <FilePillMain>
                <FilePillName>File Selection</FilePillName>
                {fileSelectionActive && selectedFilesCount > 0 ? (
                  <FilePillSecondaryRow>
                    <FileBrowseLink
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Browse...
                    </FileBrowseLink>
                    {!isFileLoading && <VaultStatus compact />}
                  </FilePillSecondaryRow>
                ) : (
                  <FilePillMeta>Playback I/Q captures</FilePillMeta>
                )}
              </FilePillMain>
              <FileActionButton
                type="button"
                $active={fileSelectionActiveDisplay}
                onClick={(event) => {
                  event.stopPropagation();
                  if (sourceMode !== "file") {
                    onSourceModeChange("file");
                    return;
                  }
                  if (selectedFilesCount === 0) {
                    fileInputRef.current?.click();
                    return;
                  }
                  onFileAction?.();
                }}
              >
                {fileButtonLabel}
                {showFileSpaceHint && <ActionHint>[Space]</ActionHint>}
              </FileActionButton>
            </FilePill>
          ) : null}
        </DevicePills>
      </DevicePicker>
    </SourceInputWrapper>
  );
};

export default SourceInput;
