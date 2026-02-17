import React from "react";
import styled from "styled-components";
import type { DeviceState, DeviceLoadingReason } from "@n-apt/hooks/useWebSocket";

const ConnectionStatusContainer = styled.div`
  display: flex;
  align-items: stretch;
  gap: 0 1cqw;
  margin-bottom: 24px;
`;

const ConnectionStatus = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 70%;
  padding: 12px 16px;
  background-color: #141414;
  border-radius: 8px;
  border: 1px solid #1f1f1f;
`;

const StatusDot = styled.div<{ $connected: boolean; $loading?: boolean; $color?: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$color
      ? props.$color
      : props.$loading
        ? "#ffaa00"
        : props.$connected
          ? "#00d4ff"
          : "#ff4444"};
  box-shadow: ${(props) => {
    const c = props.$color
      ? props.$color
      : props.$loading
        ? "#ffaa00"
        : props.$connected
          ? "#00d4ff"
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

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 1;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) => (props.$paused ? "#2a2a2a" : "#1a1a1a")};
  border: 1px solid ${(props) => (props.$paused ? "#00d4ff" : "#2a2a2a")};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? "#00d4ff" : "#ccc")};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #2a2a2a;
    border-color: #00d4ff;
    color: #00d4ff;
  }
`;

interface ConnectionStatusSectionProps {
  isConnected: boolean;
  deviceState: DeviceState;
  deviceLoadingReason: DeviceLoadingReason;
  isPaused: boolean;
  onPauseToggle: () => void;
  onRestartDevice?: () => void;
}

export const ConnectionStatusSection: React.FC<ConnectionStatusSectionProps> = ({
  isConnected,
  deviceState,
  deviceLoadingReason,
  isPaused,
  onPauseToggle,
  onRestartDevice,
}) => {
  return (
    <ConnectionStatusContainer>
      <ConnectionStatus>
        <StatusDot
          $connected={isConnected && deviceState === "connected"}
          $loading={deviceState === "loading" || deviceState === "stale"}
          $color={isConnected && deviceState === "disconnected" ? "#ff8800" : undefined}
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

      {isConnected &&
        (deviceState === "stale" ? (
          <PauseButton
            $paused={false}
            onClick={() => onRestartDevice?.()}
            title="Restart the SDR device connection"
            style={{
              flex: "0 0 25%",
              borderColor: "#ffaa00",
              color: "#ffaa00",
            }}
          >
            Restart
          </PauseButton>
        ) : deviceState === "loading" && deviceLoadingReason === "restart" ? (
          <PauseButton
            $paused={false}
            onClick={() => { }}
            disabled={true}
            title="Device is restarting..."
            style={{
              flex: "0 0 25%",
              opacity: 0.6,
              cursor: "not-allowed",
              borderColor: "#ffaa00",
              color: "#ffaa00",
            }}
          >
            Restarting...
          </PauseButton>
        ) : deviceState === "loading" ? (
          <PauseButton
            $paused={false}
            onClick={() => { }}
            disabled={true}
            title="Device is being initialized..."
            style={{
              opacity: 0.6,
              cursor: "not-allowed",
              borderColor: "#ffaa00",
              color: "#ffaa00",
            }}
          >
            Loading...
          </PauseButton>
        ) : (
          <PauseButton $paused={isPaused} onClick={onPauseToggle}>
            {isPaused ? "Resume" : "Pause"}
          </PauseButton>
        ))}
    </ConnectionStatusContainer>
  );
};
