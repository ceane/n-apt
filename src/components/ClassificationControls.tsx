import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #0d0d0d;
  border-bottom: 1px solid #1a1a1a;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  color: #999;
  min-height: 40px;
`;

const Label = styled.span`
  color: #666;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
`;

const CaptureButton = styled.button<{ $active: boolean; $variant: "target" | "noise" }>`
  padding: 5px 14px;
  border-radius: 4px;
  border: 1px solid ${(props) =>
    props.$active ? (props.$variant === "target" ? "#00cc66" : "#ff6644") : "#333"};
  background: ${(props) =>
    props.$active
      ? props.$variant === "target"
        ? "rgba(0, 204, 102, 0.15)"
        : "rgba(255, 102, 68, 0.15)"
      : "transparent"};
  color: ${(props) =>
    props.$active ? (props.$variant === "target" ? "#00cc66" : "#ff6644") : "#888"};
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover:not(:disabled) {
    border-color: ${(props) => (props.$variant === "target" ? "#00cc66" : "#ff6644")};
    color: ${(props) => (props.$variant === "target" ? "#00cc66" : "#ff6644")};
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  ${(props) =>
    props.$active &&
    `
    animation: pulse-border 1.5s ease-in-out infinite alternate;
    @keyframes pulse-border {
      from { box-shadow: 0 0 4px ${props.$variant === "target" ? "rgba(0, 204, 102, 0.3)" : "rgba(255, 102, 68, 0.3)"}; }
      to   { box-shadow: 0 0 8px ${props.$variant === "target" ? "rgba(0, 204, 102, 0.6)" : "rgba(255, 102, 68, 0.6)"}; }
    }
  `}
`;

const StatusBadge = styled.span<{ $capturing: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 3px;
  background: ${(props) => (props.$capturing ? "rgba(0, 212, 255, 0.1)" : "transparent")};
  border: 1px solid ${(props) => (props.$capturing ? "#00d4ff33" : "#222")};
  color: ${(props) => (props.$capturing ? "#00d4ff" : "#555")};
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
`;

const Dot = styled.span<{ $color: string }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  display: inline-block;
  flex-shrink: 0;

  animation: blink 1s ease-in-out infinite alternate;
  @keyframes blink {
    from { opacity: 0.4; }
    to   { opacity: 1; }
  }
`;

const SamplesCount = styled.span`
  color: #555;
  font-size: 10px;
  margin-left: auto;
  white-space: nowrap;
`;

interface ClassificationControlsProps {
  isDeviceConnected: boolean;
  activeSignalArea: string;
  isCapturing: boolean;
  captureLabel: "target" | "noise" | null;
  capturedSamples: number;
  onCaptureStart: (label: "target" | "noise") => void;
  onCaptureStop: () => void;
}

const ClassificationControls: React.FC<ClassificationControlsProps> = ({
  isDeviceConnected,
  activeSignalArea,
  isCapturing,
  captureLabel,
  capturedSamples,
  onCaptureStart,
  onCaptureStop,
}) => {
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isCapturing) {
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startTime), 100);

      return () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
      };
    } else {
      setElapsedMs(0);
    }
  }, [isCapturing]);

  const handleToggle = (label: "target" | "noise") => {
    if (isCapturing && captureLabel === label) {
      onCaptureStop();
    } else if (isCapturing) {
      // Switch label: stop current, start new
      onCaptureStop();
      setTimeout(() => onCaptureStart(label), 50);
    } else {
      onCaptureStart(label);
    }
  };

  const formatElapsed = (ms: number) => {
    const s = Math.trunc(ms / 1000);
    const tenths = Math.trunc((ms % 1000) / 100);
    return `${s}.${tenths}s`;
  };

  return (
    <Container>
      <Label>Train [{activeSignalArea}]</Label>

      <CaptureButton
        $active={isCapturing && captureLabel === "target"}
        $variant="target"
        disabled={!isDeviceConnected}
        onClick={() => handleToggle("target")}
        title="Capture current signal as target (the signal you are looking for)"
      >
        {isCapturing && captureLabel === "target" ? "Stop" : "Target"}
      </CaptureButton>

      <CaptureButton
        $active={isCapturing && captureLabel === "noise"}
        $variant="noise"
        disabled={!isDeviceConnected}
        onClick={() => handleToggle("noise")}
        title="Capture current signal as noise (not the signal you are looking for)"
      >
        {isCapturing && captureLabel === "noise" ? "Stop" : "Noise"}
      </CaptureButton>

      {isCapturing && captureLabel && (
        <StatusBadge $capturing={true}>
          <Dot $color={captureLabel === "target" ? "#00cc66" : "#ff6644"} />
          {captureLabel} {formatElapsed(elapsedMs)}
        </StatusBadge>
      )}

      <SamplesCount>{capturedSamples} samples</SamplesCount>
    </Container>
  );
};

export default ClassificationControls;
