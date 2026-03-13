import React from "react";
import styled from "styled-components";
import type {
  DeviceState,
  DeviceLoadingReason,
} from "@n-apt/hooks/useWebSocket";

const ConnectionStatusContainer = styled.div`
  display: grid;
  grid-template-columns: 2fr minmax(0, 1fr);
  grid-column: 1 / -1;
  gap: 12px;
  align-items: center;
  background-color: #141414;
  border-radius: 8px;
  border: 1px solid #1a1a1a;
  padding: 12px;
  box-sizing: border-box;
  width: 100%;
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
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$color
      ? props.$color
      : props.$loading
        ? "#ffaa00"
        : props.$connected
          ? props.theme.primary
          : "#ff4444"};
  box-shadow: ${(props) => {
    const c = props.$color
      ? props.$color
      : props.$loading
        ? "#ffaa00"
        : props.$connected
          ? props.theme.primary
          : "#ff4444";
    return `0 0 8px ${c}`;
  }};
  flex-shrink: 0;
  ${(props) =>
    props.$loading &&
    `
    animation: pulse 1.5s ease-in-out infinite alternate;
  `}
  
  @keyframes pulse {
    from { opacity: 1; }
    to { opacity: 0.4; }
  }
`;

const StatusText = styled.span`
  font-size: 12px;
  color: #888;
  font-weight: 500;
`;

export const PauseButton = styled.button<{ $paused: boolean }>`
  max-width: 100%;
  box-sizing: border-box;
  padding: 12px 8px;
  background-color: ${(props) => (props.$paused ? props.theme.primaryAnchor : "#1a1a1a")};
  border: 1px solid ${(props) => (props.$paused ? props.theme.primary : "#2a2a2a")};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? props.theme.primary : "#ccc")};
  font-family: "JetBrains Mono", monospace;
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

export const WarningButton = styled(PauseButton) <{
  $narrow?: boolean;
  $isDisabled?: boolean;
}>`
  border-color: #ffaa00;
  color: #ffaa00;
  ${(props) => props.$narrow && `width: 100%;`}
  ${(props) =>
    props.$isDisabled &&
    `
    opacity: 0.6;
    cursor: not-allowed;
  `}

  &:hover {
    border-color: #ffaa00;
    color: #ffaa00;
  }
`;

const ActionsColumn = styled.div`
  display: grid;
  gap: 8px;
  width: 100%;
`;

interface ConnectionStatusSectionProps {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  cryptoCorrupted: boolean;
  onPauseToggle: () => void;
  onRestartDevice?: () => void;
  children?: React.ReactNode;
  hidePauseButton?: boolean;
  extraActions?: React.ReactNode;
}

export const ConnectionStatusSection: React.FC<
  ConnectionStatusSectionProps
> = ({
  isConnected,
  deviceState,
  deviceLoadingReason,
  isPaused,
  cryptoCorrupted,
  onPauseToggle,
  onRestartDevice,
  hidePauseButton,
  extraActions,
}) => {
    return (
      <ConnectionStatusContainer>
        <ConnectionStatus>
          <StatusDot
            $connected={isConnected && deviceState === "connected"}
            $loading={deviceState === "loading" || deviceState === "stale"}
            $color={
              isConnected && deviceState === "disconnected"
                ? "#ff8800"
                : undefined
            }
          />
          <StatusText>
            {!isConnected
              ? "Disconnected"
              : deviceState === "loading"
                ? deviceLoadingReason === "restart"
                  ? "Restarting device..."
                  : "Loading device..."
                : deviceState === "stale"
                  ? "Device stream frozen"
                  : deviceState === "connected"
                    ? "Connected to server and device"
                    : "Connected to server but device not connected"}
          </StatusText>
        </ConnectionStatus>

        <ActionsColumn>
          {isConnected &&
            (deviceState === "stale" ? (
              <WarningButton
                $paused={false}
                $narrow
                onClick={() => onRestartDevice?.()}
                title="Restart the SDR device connection"
              >
                Restart
              </WarningButton>
            ) : deviceState === "loading" && deviceLoadingReason === "restart" ? (
              <WarningButton
                $paused={false}
                $narrow
                $isDisabled
                onClick={() => { }}
                disabled={true}
                title="Device is restarting..."
              >
                Restarting...
              </WarningButton>
            ) : deviceState === "loading" ? (
              <WarningButton
                $paused={false}
                $isDisabled
                onClick={() => { }}
                disabled={true}
                title="Device is being initialized..."
              >
                Loading...
              </WarningButton>
            ) : (
              !hidePauseButton && (
                <PauseButton $paused={isPaused} onClick={onPauseToggle}>
                  {cryptoCorrupted ? "Corrupted" : isPaused ? "Resume" : "Pause"}
                </PauseButton>
              )
            ))}
        </ActionsColumn>
        {extraActions && (
          <div style={{ gridColumn: "1 / -1", width: "100%" }}>
            {extraActions}
          </div>
        )}
      </ConnectionStatusContainer>
    );
  };
