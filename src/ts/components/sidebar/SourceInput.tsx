import React, { useRef, useCallback, type DragEvent } from "react";
import styled from "styled-components";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";

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

const DevicePill = styled.div<{
  $selected?: boolean;
  $opacity?: number;
}>`
  display: grid;
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
  display: none;
`;

const ACCEPTED_TYPES = [".napt", ".wav", ".c64"];

const isFileTypeAccepted = (file: File): boolean => {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  return ACCEPTED_TYPES.some((acceptedType) => {
    if (acceptedType.startsWith(".")) {
      return fileName.endsWith(acceptedType.toLowerCase());
    }
    if (acceptedType.endsWith("/*")) {
      const baseType = acceptedType.slice(0, -1);
      return fileType.startsWith(baseType);
    }
    return (
      fileType === acceptedType.toLowerCase() ||
      fileName.endsWith(`.${acceptedType.toLowerCase()}`)
    );
  });
};

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
    summary?: string;
    status?: {
      color?: string;
      label?: string;
      paused?: boolean;
      loading?: boolean;
      loadingLabel?: string;
      canPause?: boolean;
      canRestart?: boolean;
      hideAction?: boolean;
      actionLabel?: string;
      actionTitle?: string;
      onAction?: () => void;
    };
  }>;
  selectedDeviceId?: string;
  onSelectedDeviceChange?: (id: string) => void;
  onToggleDeviceRxPause?: (id: string) => void;
  onToggleDeviceTxMode?: (id: string) => void;
}

export const SourceInput: React.FC<SourceInputProps> = ({
  sourceMode,
  compactActiveOnly = false,
  fileModeColor,
  livePreviewStage = 0,
  fileActionLabel,
  fileActionTitle,
  selectedFilesCount = 0,
  onFileAction,
  onFilesSelected,
  onSourceModeChange,
  spaceBoundDeviceId,
  devices,
  selectedDeviceId,
  onSelectedDeviceChange,
  onToggleDeviceRxPause,
  onToggleDeviceTxMode,
}) => {
  const fileSelectionActive = sourceMode === "file";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [transmittingDotOn, setTransmittingDotOn] = React.useState(true);

  const handleFiles = useCallback(
    (files: File[]) => {
      const validFiles = files.filter(isFileTypeAccepted);
      if (validFiles.length > 0) {
        onFilesSelected?.(validFiles);
      }
    },
    [onFilesSelected],
  );

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const items = event.dataTransfer?.items;
      const droppedFiles: File[] = [];

      if (items) {
        Array.from(items).forEach((item) => {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) droppedFiles.push(file);
          }
        });
      }

      handleFiles(droppedFiles);
    },
    [handleFiles],
  );

  const fileButtonLabel =
    fileActionLabel || (fileSelectionActive ? "Browse" : "File");
  const showFileSpaceHint =
    fileSelectionActive &&
    (fileButtonLabel === "Play" || fileButtonLabel === "Pause");

  const formatCapability = (
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
    if (status === "streaming") return "Streaming";
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
    status?: string | null,
  ) => {
    const normalizedDuplex = duplexMode?.toLowerCase?.() ?? "";
    if (normalizedDuplex === "half-duplex") {
      return "Rx/Tx";
    }
    return capability?.toLowerCase().includes("tx") ? "Tx" : "Rx";
  };
  const sourceDevicesRaw = devices ?? [];
  const isMockDevice = (device: (typeof sourceDevicesRaw)[number]) =>
    device.capability === "mock" ||
    device.id === "mock-apt" ||
    device.id === "mock-tx" ||
    device.name.toLowerCase().includes("mock") ||
    device.backend?.toLowerCase().includes("mock") === true;
  const isDeviceConnected = (device: (typeof sourceDevicesRaw)[number]) => {
    const label = device.status?.label?.toLowerCase?.() ?? "";
    return (
      label !== "disconnected" &&
      label !== "offline" &&
      label !== "stale" &&
      label !== "error"
    );
  };
  const hasConnectedHardwareSource = sourceDevicesRaw.some(
    (device) => !isMockDevice(device) && isDeviceConnected(device),
  );
  const sourceDevices = hasConnectedHardwareSource
    ? sourceDevicesRaw.filter(
        (device) =>
          !isMockDevice(device) ||
          device.id === selectedDeviceId ||
          device.status?.label?.toLowerCase?.() === "transmitting",
      )
    : sourceDevicesRaw;
  const isHalfDuplexDevice = (device: (typeof sourceDevices)[number]) =>
    device.backend?.toLowerCase().includes("hackrf") === true ||
    device.name.toLowerCase().includes("hackrf") === true;
  const isHalfDuplexRxActive = (device: (typeof sourceDevices)[number]) =>
    device.duplex_mode?.toLowerCase?.() === "half-duplex" &&
    device.status?.paused === false;
  const isTransmittingDevice = (device: (typeof sourceDevices)[number]) =>
    device.status?.label?.toLowerCase?.() === "transmitting";
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
  return (
    <SourceInputWrapper>
      <HiddenFileInput
        ref={fileInputRef}
        type="file"
        accept=".napt,.wav,.c64"
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
        <DevicePills>
          {visibleDevices.map((device) => {
            const isOnscreenStreaming = device.id === activeDeviceId;
            const isSelectedDevice = device.id === selectedDeviceId;
            const isTxCapable =
              device.capability?.toLowerCase().includes("tx") ?? false;
            const isHalfDuplex = isHalfDuplexDevice(device);
            const isTransmittingDevice = device.id === transmittingDeviceId;
            const actionLabel = isTxCapable
              ? isTransmittingDevice
                ? "Stop Tx"
                : "Start Tx"
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
                onClick={() => onSelectedDeviceChange?.(device.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectedDeviceChange?.(device.id);
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
                    · Connected
                    {device.duplex_mode
                      ? ` · ${formatDuplexMode(device.duplex_mode)}`
                      : ""}
                  </DevicePillMeta>
                </DevicePillMain>
                <DeviceActions>
                  {isHalfDuplex && onToggleDeviceRxPause ? (
                    <DeviceActionButton
                      type="button"
                      $active={isSelectedDevice}
                      $muted={isTransmittingDevice}
                      $opacity={fileModeOpacity}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleDeviceRxPause(device.id);
                      }}
                      title={isHalfDuplexRxActive(device) ? "Pause Rx" : "Resume Rx"}
                    >
                      {isHalfDuplexRxActive(device) ? "Pause Rx" : "Resume Rx"}
                      {isOnscreenStreaming && <ActionHint>[Space]</ActionHint>}
                    </DeviceActionButton>
                  ) : !isHalfDuplex && device.status?.onAction ? (
                    isTxCapable ? (
                      <TxModeActionButton
                        type="button"
                        aria-label={actionLabel}
                        $active={isSelectedDevice}
                        $danger={isTransmittingDevice}
                        $opacity={fileModeOpacity}
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
                        onClick={(event) => {
                          event.stopPropagation();
                          device.status?.onAction?.();
                        }}
                        title={device.status.actionTitle}
                      >
                        {actionLabel}
                        {showDeviceSpaceHint && <ActionHint>[Space]</ActionHint>}
                      </DeviceActionButton>
                    )
                  ) : null}
                  {isHalfDuplex && onToggleDeviceTxMode ? (
                    <TxModeActionButton
                      type="button"
                      aria-label={isTransmittingDevice ? "Stop Tx" : "Start Tx"}
                      $active={isSelectedDevice}
                      $danger={isTransmittingDevice}
                      $muted={!isTransmittingDevice}
                      $opacity={fileModeOpacity}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        onToggleDeviceTxMode(device.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          onToggleDeviceTxMode(device.id);
                        }
                      }}
                      onKeyUp={(event) => {
                        if (event.key === " " || event.key === "Spacebar") {
                          event.preventDefault();
                          event.stopPropagation();
                          onToggleDeviceTxMode(device.id);
                        }
                      }}
                      title={isTransmittingDevice ? "Stop Tx" : "Start Tx"}
                    >
                      <ActionLabel>
                        {isTransmittingDevice ? "Stop Tx" : "Start Tx"}
                      </ActionLabel>
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
                  <FileBrowseLink
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Browse...
                  </FileBrowseLink>
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
