import React from "react";
import styled from "styled-components";
import type {
  DeviceState,
  DeviceLoadingReason,
} from "@n-apt/consts/schemas/websocket";
import { CheckCircle2, Loader2, Pause, Play } from "lucide-react";

const ConnectionStatusContainer = styled.div`
  display: grid;
  grid-template-columns: 2fr minmax(0, 1fr);
  grid-column: 1 / -1;
  gap: 12px;
  align-items: center;
  background-color: ${(props) => props.theme.surface};
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border};
  padding: 12px;
  box-sizing: border-box;
  width: 100%;
  position: sticky;
  top: 15px;
  z-index: 100;
  margin-bottom: 12px;
  box-shadow: none;
`;

const ExtraActionsContainer = styled.div`
  grid-column: 1 / -1;
  width: 100%;
`;

const CryptoErrorContainer = styled.div`
  grid-column: 1 / -1;
  margin-top: 8px;
`;

const ConnectionStatus = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-content: start;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  max-width: 100%;
`;

const StatusDot = styled.div<{
  $connected: boolean;
  $loading?: boolean;
  $color?: string;
}>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$color
      ? props.$color
      : props.$loading
        ? props.theme.warning
        : props.$connected
          ? props.theme.primary
          : props.theme.danger};
  box-shadow: none;
  flex-shrink: 0;
  ${(props) =>
    props.$loading &&
    `
    animation: pulse 1.5s ease-in-out infinite alternate;
  `}

  @keyframes pulse {
    from {
      opacity: 1;
    }
    to {
      opacity: 0.4;
    }
  }
`;

const StatusText = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  font-weight: 500;
`;

export const PauseButton = styled.button<{ $paused: boolean }>`
  max-width: 100%;
  box-sizing: border-box;
  padding: 12px 8px;
  background-color: ${(props) =>
    props.$paused ? props.theme.primaryAnchor : props.theme.surface};
  border: 1px solid
    ${(props) =>
      props.$paused ? props.theme.primary : props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) =>
    props.$paused ? props.theme.primary : props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;

  &:hover {
    background-color: ${(props) => props.theme.primary}0d;
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
  }
`;

const SpaceHint = styled.span`
  font-size: 9px;
  color: ${(props) => props.theme.textSecondary};
  opacity: 0.6;
  line-height: 1;
  margin-top: 3px;
`;

export const WarningButton = styled(PauseButton)<{
  $narrow?: boolean;
  $isDisabled?: boolean;
}>`
  border-color: ${(props) => props.theme.warning};
  color: ${(props) => props.theme.warning};
  ${(props) => props.$narrow && `width: 100%;`}
  ${(props) =>
    props.$isDisabled &&
    `
    opacity: 0.6;
    cursor: not-allowed;
  `}

  &:hover {
    border-color: ${(props) => props.theme.warning};
    color: ${(props) => props.theme.warning};
  }
`;

const ActionsColumn = styled.div`
  display: grid;
  gap: 8px;
  width: 100%;
`;

const LoadingState = styled.div`
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: ${(props) => props.theme.warning};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
`;

const FileActionButton = styled(PauseButton)<{
  $variant: "primary" | "secondary" | "danger" | "filePrimary";
  $isDisabled?: boolean;
}>`
  background-color: ${(props) =>
    props.$variant === "filePrimary"
      ? props.theme.primaryAnchor
      : props.$variant === "primary"
        ? props.theme.surface
        : props.$variant === "secondary"
          ? props.theme.primaryAnchor
          : `${props.theme.danger}12`};
  border-color: ${(props) =>
    props.$variant === "filePrimary"
      ? props.theme.primary
      : props.$variant === "primary"
        ? props.theme.borderHover
        : props.$variant === "secondary"
          ? props.theme.primary
          : props.theme.danger};
  color: ${(props) =>
    props.$variant === "filePrimary"
      ? props.theme.primary
      : props.$variant === "primary"
        ? props.theme.textPrimary
        : props.$variant === "secondary"
          ? props.theme.primary
          : props.theme.danger};

  ${(props) =>
    props.$isDisabled &&
    `
    opacity: 0.65;
    cursor: not-allowed;
  `}

  &:hover {
    background-color: ${(props) =>
      props.$variant === "filePrimary"
        ? `${props.theme.primary}12`
        : props.$variant === "primary"
          ? `${props.theme.primary}0d`
          : props.$variant === "secondary"
            ? `${props.theme.primary}12`
            : `${props.theme.danger}18`};
    border-color: ${(props) =>
      props.$variant === "filePrimary"
        ? props.theme.primary
        : props.$variant === "primary"
          ? props.theme.primary
          : props.$variant === "secondary"
            ? props.theme.primary
            : props.theme.danger};
    color: ${(props) =>
      props.$variant === "filePrimary"
        ? props.theme.primary
        : props.$variant === "primary"
          ? props.theme.primary
          : props.$variant === "secondary"
            ? props.theme.primary
            : props.theme.danger};
  }
`;

interface ConnectionStatusSectionProps {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  backend?: string | null;
  isPaused: boolean;
  cryptoCorrupted: boolean;
  onPauseToggle: () => void;
  onRestartDevice?: () => void;
  children?: React.ReactNode;
  hidePauseButton?: boolean;
  extraActions?: React.ReactNode;
  fileMode?: boolean;
  fileProcessingStatus?: string;
  fileIsPaused?: boolean;
  hasFileSelected?: boolean;
  isMockFile?: boolean;
  onFileProcess?: () => void;
  onFilePauseToggle?: () => void;
  onFileClearError?: () => void;
}

import { DecryptionFallback } from "@n-apt/ui/DecryptionFallback";

const getFileStatus = (
  stitchStatus?: string | null,
  hasFileSelected = false,
) => {
  const status = stitchStatus?.trim() ?? "";
  const lower = status.toLowerCase();

  if (!status) {
    return {
      label: hasFileSelected ? "File not processed" : "Choose file",
      state: hasFileSelected
        ? ("not-processed" as const)
        : ("choose-file" as const),
      isProcessing: false,
      isProcessed: false,
      isError: false,
      isDecryptionError: false,
    };
  }

  const isDecryptionError = lower.includes("decryption");
  const isProcessed = lower.includes("successfully");
  const isExplicitError =
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("failure");
  const isProcessing =
    (lower.includes("loading") ||
      lower.includes("computing") ||
      lower.includes("loaded") ||
      lower === "processing") &&
    !isProcessed;
  const isError =
    !isProcessing &&
    !isProcessed &&
    lower !== "no files selected for stitching" &&
    (isExplicitError || !!status);

  if (isDecryptionError) {
    return {
      label: "Decryption error",
      state: "decryption-error" as const,
      isProcessing: false,
      isProcessed: false,
      isError: true,
      isDecryptionError: true,
    };
  }

  if (isProcessing) {
    return {
      label: "File processing",
      state: "processing" as const,
      isProcessing: true,
      isProcessed: false,
      isError: false,
      isDecryptionError: false,
    };
  }

  if (isProcessed) {
    return {
      label: "File processed",
      state: "processed" as const,
      isProcessing: false,
      isProcessed: true,
      isError: false,
      isDecryptionError: false,
    };
  }

  if (isError) {
    return {
      label: "File processing error",
      state: "error" as const,
      isProcessing: false,
      isProcessed: false,
      isError: true,
      isDecryptionError: false,
    };
  }

  return {
    label: "File not processed",
    state: "not-processed" as const,
    isProcessing: false,
    isProcessed: false,
    isError: false,
    isDecryptionError: false,
  };
};

export const ConnectionStatusSection: React.FC<
  ConnectionStatusSectionProps
> = ({
  isConnected,
  deviceState,
  deviceLoadingReason,
  backend,
  isPaused,
  cryptoCorrupted,
  onPauseToggle,
  onRestartDevice,
  hidePauseButton,
  extraActions,
  fileMode = false,
  fileProcessingStatus,
  fileIsPaused = false,
  hasFileSelected = false,
  isMockFile = false,
  onFileProcess,
  onFilePauseToggle,
  onFileClearError,
}) => {
  const fileStatus = fileMode
    ? getFileStatus(fileProcessingStatus, hasFileSelected)
    : null;
  const isMockBackend =
    typeof backend === "string" &&
    (backend === "mock_apt" ||
      backend === "mock_apt_metal" ||
      backend.includes("mock"));
  const isHackRfBackend =
    typeof backend === "string" &&
    backend.toLowerCase().replace(/[-\s]/g, "_").includes("hackrf_one");
  const isServerConnectedButNoDevice =
    isConnected &&
    (deviceState === "connected" || deviceState === "streaming") &&
    isMockBackend;
  const staleStateLabel =
    deviceState === "stale"
      ? "Stale…"
      : deviceState === "disconnected"
        ? "Disconnected"
        : null;
  const isInitializing = deviceState === "initializing";
  const isLoading = deviceState === "loading" || isInitializing;
  return (
    <>
      <ConnectionStatusContainer>
        <ConnectionStatus>
          <StatusDot
            $connected={
              isConnected &&
              (deviceState === "connected" || deviceState === "streaming")
            }
            $loading={isLoading}
            $color={
              cryptoCorrupted
                ? deviceState === "connected" || deviceState === "streaming"
                  ? "var(--color-danger)"
                  : "var(--color-warning)"
                : isConnected && deviceState === "disconnected"
                  ? "var(--color-secondary)"
                  : undefined
            }
          />
          <StatusText>
            {fileMode && fileStatus
              ? fileStatus.label
              : cryptoCorrupted
                ? "CRYPTO CORRUPTED"
                : !isConnected
                  ? "Disconnected"
                  : isInitializing
                    ? "Initializing device..."
                    : deviceState === "loading"
                    ? deviceLoadingReason === "restart"
                      ? "Restarting device..."
                      : "Loading device..."
                    : isServerConnectedButNoDevice
                      ? "Connected to server but not device"
                      : deviceState === "connected" ||
                          deviceState === "streaming"
                        ? "Connected to server and device"
                        : "Connected to server but device not connected"}
          </StatusText>
        </ConnectionStatus>

        <ActionsColumn>
          {fileMode ? (
            !hasFileSelected ? (
              <FileActionButton
                $paused={false}
                $variant={isMockFile ? "primary" : "filePrimary"}
                onClick={onFileProcess}
              >
                <Play size={14} fill="currentColor" /> Choose file
              </FileActionButton>
            ) : fileStatus?.isProcessing ? (
              <FileActionButton
                $paused={false}
                $variant="secondary"
                $isDisabled
                disabled
                onClick={() => {}}
                title="File is being processed..."
              >
                <Loader2 size={16} className="animate-spin" /> Processing…
              </FileActionButton>
            ) : fileStatus?.isProcessed ? (
              <FileActionButton
                $paused={fileIsPaused}
                $variant={
                  fileIsPaused
                    ? "secondary"
                    : isMockFile
                      ? "primary"
                      : "filePrimary"
                }
                onClick={onFilePauseToggle}
              >
                {fileIsPaused ? (
                  <>
                    <Play size={14} fill="currentColor" /> Play
                  </>
                ) : (
                  <>
                    <Pause size={14} fill="currentColor" /> Pause
                  </>
                )}
              </FileActionButton>
            ) : fileStatus?.isDecryptionError ? (
              <FileActionButton
                $paused={false}
                $variant="danger"
                onClick={onFileClearError ?? onFileProcess ?? (() => {})}
              >
                <CheckCircle2 size={16} /> Retry process
              </FileActionButton>
            ) : fileStatus?.isError ? (
              <FileActionButton
                $paused={false}
                $variant="danger"
                onClick={onFileClearError ?? onFileProcess ?? (() => {})}
              >
                <CheckCircle2 size={16} /> Retry process
              </FileActionButton>
            ) : (
              <FileActionButton
                $paused={false}
                $variant={isMockFile ? "primary" : "filePrimary"}
                onClick={onFileProcess}
              >
                <Play size={14} fill="currentColor" /> Process
              </FileActionButton>
            )
          ) : (
            isConnected &&
            (deviceState === "loading" && deviceLoadingReason === "restart" ? (
              <LoadingState
                role="status"
                aria-label="Restarting device"
              >
                <Loader2
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
                Restarting…
              </LoadingState>
            ) : isLoading ? (
              <LoadingState
                role="status"
                aria-label={
                  isInitializing
                    ? "Initializing device"
                    : isHackRfBackend
                    ? "Rx active, waiting for first frame"
                    : "Loading device"
                }
              >
                <Loader2
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
                {isInitializing
                  ? "Initializing…"
                  : isHackRfBackend
                  ? "Rx active · waiting for first frame…"
                  : "Loading…"}
              </LoadingState>
            ) : staleStateLabel ? (
              <WarningButton
                $paused={false}
                $isDisabled
                onClick={() => {}}
                disabled={true}
                title={
                  deviceState === "stale"
                    ? "Device is stale and waiting for a fresh frame..."
                    : "Device disconnected."
                }
              >
                {staleStateLabel}
              </WarningButton>
            ) : (
              !hidePauseButton && (
                <PauseButton $paused={isPaused} onClick={onPauseToggle}>
                  {cryptoCorrupted
                    ? "Corrupted"
                    : isPaused
                      ? "Resume"
                      : "Pause"}
                  <SpaceHint>[Space]</SpaceHint>
                </PauseButton>
              )
            ))
          )}
        </ActionsColumn>
        {extraActions && (
          <ExtraActionsContainer>{extraActions}</ExtraActionsContainer>
        )}
      </ConnectionStatusContainer>

      {cryptoCorrupted && !fileMode && (
        <CryptoErrorContainer>
          <DecryptionFallback moduleName="Live Stream" errorType="vault" />
        </CryptoErrorContainer>
      )}
    </>
  );
};
