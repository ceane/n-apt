import React, { useEffect, useRef, useState } from "react";
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

const DevicePill = styled.div<{ $active?: boolean }>`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.primary : theme.borderHover)};
  background: ${({ theme, $active }) =>
    $active ? `${theme.primary}14` : theme.surface};
  color: ${({ theme, $active }) =>
    $active ? theme.primary : theme.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  cursor: pointer;
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

  &:hover {
    opacity: 1;
  }
`;

const HiddenFileInput = styled.input`
  display: none;
`;

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
`;

const DeviceStatusDot = styled.span<{ $active?: boolean; $loading?: boolean }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ $active, $loading }) =>
    $loading ? "#f4c542" : $active ? "#19d9ff" : "#666"};
  box-shadow: ${({ $active }) =>
    $active ? "0 0 0 2px rgba(25, 217, 255, 0.12)" : "none"};
  flex-shrink: 0;
`;

const DeviceActionButton = styled.button<{
  $active?: boolean;
  $opacity?: number;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 3px;
  min-width: 72px;
  width: 72px;
  height: 72px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.primary : theme.borderHover)};
  background: ${({ theme, $active }) =>
    $active ? theme.primaryAnchor : theme.surface};
  color: ${({ theme, $active }) =>
    $active ? theme.primary : theme.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  line-height: 1.05;
  cursor: pointer;
  box-shadow: none;
  opacity: ${({ $opacity = 1 }) => $opacity};
  transition:
    transform 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease,
    border-color 0.16s ease,
    opacity 0.18s ease;

  &:hover {
    transform: translateY(-1px);
    background: ${({ theme }) => `${theme.primary}0d`};
    border-color: ${({ theme }) => theme.primary};
    color: ${({ theme }) => theme.primary};
  }
`;

const FileActionButton = styled(DeviceActionButton)`
  width: 72px;
  min-width: 72px;
  height: 72px;
  justify-self: end;
  border-radius: 50%;
`;

const ActionHint = styled.span`
  color: ${({ theme }) => theme.textSecondary};
  font-size: 9px;
  line-height: 1;
  opacity: 0.65;
`;

interface SourceInputProps {
  sourceMode: SourceMode;
  backend?: string | null;
  deviceName?: string | null;
  fileModeColor?: string;
  livePreviewStage?: number;
  fileActionLabel?: string;
  fileActionTitle?: string;
  selectedFilesCount?: number;
  onFileAction?: () => void;
  onFilesSelected?: (files: File[]) => void;
  onSourceModeChange: (mode: SourceMode) => void;
  devices?: Array<{
    id: string;
    name: string;
    backend?: string | null;
    capability?: "rx" | "tx" | "tx_rx" | "mock" | string;
    txMode?: boolean;
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
  onToggleDeviceTxMode?: (id: string) => void;
}

export const SourceInput: React.FC<SourceInputProps> = ({
  sourceMode,
  fileModeColor,
  livePreviewStage = 0,
  fileActionLabel,
  fileActionTitle,
  selectedFilesCount = 0,
  onFileAction,
  onFilesSelected,
  onSourceModeChange,
  devices,
  selectedDeviceId,
  onSelectedDeviceChange,
  onToggleDeviceTxMode,
}) => {
  const fileSelectionActive = sourceMode === "file";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileButtonLabel =
    fileActionLabel || (fileSelectionActive ? "Process" : "File");
  const showFileSpaceHint =
    fileSelectionActive &&
    (fileButtonLabel === "Play" || fileButtonLabel === "Pause");
  const previousDeviceStateRef = useRef<Map<string, string>>(new Map());
  const highlightTimeoutsRef = useRef<number[]>([]);
  const [highlightedDeviceIds, setHighlightedDeviceIds] = useState<Set<string>>(
    () => new Set(),
  );

  const formatCapability = (capability?: string | null): string => {
    if (!capability) return "unknown";
    if (capability === "tx_rx") return "TX/RX";
    return capability.toUpperCase();
  };

  const formatStatusLabel = (status?: string | null): string | null => {
    if (!status) return null;
    if (status === "transmitting") return "Transmitting (Tx)";
    if (status === "streaming") return "Streaming";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  useEffect(() => {
    const previousDeviceState = previousDeviceStateRef.current;

    devices?.forEach((device) => {
      const signature = [
        device.backend,
        device.txMode ? "tx" : "rx",
        device.status?.color,
        device.status?.label,
        device.status?.loading ? "loading" : "idle",
      ].join("|");
      const previousSignature = previousDeviceState.get(device.id);

      if (previousSignature !== undefined && previousSignature !== signature) {
        setHighlightedDeviceIds((current) => {
          const next = new Set(current);
          next.add(device.id);
          return next;
        });

        const timeout = window.setTimeout(() => {
          setHighlightedDeviceIds((current) => {
            const next = new Set(current);
            next.delete(device.id);
            return next;
          });
        }, 3000);
        highlightTimeoutsRef.current.push(timeout);
      }

      previousDeviceState.set(device.id, signature);
    });
  }, [devices]);

  useEffect(() => {
    return () => {
      highlightTimeoutsRef.current.forEach((timeout) =>
        window.clearTimeout(timeout),
      );
    };
  }, []);

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
          {devices?.map((device) => {
            const isSelectedDevice = device.id === selectedDeviceId;
            const isActiveDevice = isSelectedDevice && sourceMode === "live";
            const actionLabel =
              device.status?.actionLabel ??
              (device.txMode ? "Pause" : "Resume");
            const showDeviceSpaceHint =
              isActiveDevice &&
              (actionLabel === "Resume" || actionLabel === "Pause");
            const fileModeOpacity =
              sourceMode === "file"
                ? livePreviewStage <= 0
                  ? 0.25
                  : livePreviewStage === 1
                    ? 0.5
                    : 1
                : 1;
            const textOpacity = highlightedDeviceIds.has(device.id)
              ? 1
              : fileModeOpacity;

            return (
              <DevicePill
                key={device.id}
                role="button"
                tabIndex={0}
                $active={isSelectedDevice}
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
                  $active={isActiveDevice}
                  $loading={device.status?.loading}
                  style={
                    device.status?.color
                      ? { backgroundColor: device.status.color }
                      : undefined
                  }
                  aria-hidden="true"
                />
                <DevicePillMain $opacity={textOpacity}>
                  <DevicePillName>{device.name}</DevicePillName>
                  <DevicePillMeta>
                    {formatCapability(device.capability)}
                    {formatStatusLabel(device.status?.label)
                      ? ` · ${formatStatusLabel(device.status?.label)}`
                      : ""}
                  </DevicePillMeta>
                </DevicePillMain>
                {device.status?.onAction ? (
                  <DeviceActionButton
                    type="button"
                    $active={isActiveDevice}
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
                ) : onToggleDeviceTxMode ? (
                  <DeviceActionButton
                    type="button"
                    $active={isActiveDevice}
                    $opacity={fileModeOpacity}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleDeviceTxMode(device.id);
                    }}
                    title={device.txMode ? "Disable Tx" : "Enable Tx"}
                  >
                    {actionLabel}
                    {showDeviceSpaceHint && <ActionHint>[Space]</ActionHint>}
                  </DeviceActionButton>
                ) : null}
              </DevicePill>
            );
          })}
          <FilePill
            $active={fileSelectionActive}
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
              $active={fileSelectionActive}
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
        </DevicePills>
      </DevicePicker>
    </SourceInputWrapper>
  );
};

export default SourceInput;
