import React from "react";
import styled from "styled-components";
import type { CaptureStatus, CaptureFileType } from "@n-apt/hooks/useWebSocket";

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitleCollapsible = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0 0 16px 0;
  cursor: pointer;
  text-align: left;
`;

const SectionTitleLabel = styled.span`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const SectionTitleToggle = styled.span`
  font-size: 12px;
  color: #555;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
`;

const CollapsibleBody = styled.div`
  margin-top: 8px;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #1a1a1a;
  user-select: none;
`;

const SettingLabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
`;

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 80px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
  }
`;

const SettingInput = styled.input`
  background-color: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 6px;
  width: 70px;
  text-align: right;
  
  /* Hide number input spinners */
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  
  &[type="number"] {
    -moz-appearance: textfield;
  }
`;

const ToggleSwitch = styled.label<{ $disabled?: boolean }>`
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.4 : 1)};
`;

const ToggleSwitchInput = styled.input`
  opacity: 0;
  width: 44px;
  height: 24px;
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 0;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};

  &:checked + span {
    background-color: #00d4ff;
  }

  &:checked + span:before {
    transform: translateX(20px);
  }

  &:disabled + span {
    cursor: not-allowed;
  }
`;

const ToggleSwitchSlider = styled.span<{ $disabled?: boolean }>`
  position: absolute;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #444;
  transition: 0.2s;
  border-radius: 24px;

  &:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
  }
`;

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
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

interface CaptureRange {
  min: number;
  max: number;
  segments: Array<{ label: string; min: number; max: number }>;
}

interface IQCaptureControlsSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  captureOnscreen: boolean;
  captureAreaA: boolean;
  captureAreaB: boolean;
  captureDurationS: number;
  captureFileType: CaptureFileType;
  captureEncrypted: boolean;
  capturePlayback: boolean;
  captureRange: CaptureRange;
  maxSampleRate: number;
  captureStatus: CaptureStatus;
  isConnected: boolean;
  deviceState: string;
  isAuthenticated: boolean;
  sessionToken: string | null;
  onCaptureOnscreenChange: (value: boolean) => void;
  onCaptureAreaAChange: (value: boolean) => void;
  onCaptureAreaBChange: (value: boolean) => void;
  onCaptureDurationSChange: (value: number) => void;
  onCaptureFileTypeChange: (value: CaptureFileType) => void;
  onCaptureEncryptedChange: (value: boolean) => void;
  onCapturePlaybackChange: (value: boolean) => void;
  onCapture: () => void;
}

export const IQCaptureControlsSection: React.FC<IQCaptureControlsSectionProps> = ({
  isOpen,
  onToggle,
  captureOnscreen,
  captureAreaA,
  captureAreaB,
  captureDurationS,
  captureFileType,
  captureEncrypted,
  capturePlayback,
  captureRange,
  maxSampleRate,
  captureStatus,
  isConnected,
  deviceState,
  isAuthenticated,
  sessionToken,
  onCaptureOnscreenChange,
  onCaptureAreaAChange,
  onCaptureAreaBChange,
  onCaptureDurationSChange,
  onCaptureFileTypeChange,
  onCaptureEncryptedChange,
  onCapturePlaybackChange,
  onCapture,
}) => {
  return (
    <Section>
      <SectionTitleCollapsible type="button" onClick={onToggle}>
        <SectionTitleLabel>I/Q Capture /</SectionTitleLabel>
        <SectionTitleToggle>{isOpen ? "-" : "+"}</SectionTitleToggle>
      </SectionTitleCollapsible>

      {isOpen && (
        <CollapsibleBody>
          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Areas</SettingLabel>
            </SettingLabelContainer>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#ccc" }}>
                <input
                  type="checkbox"
                  checked={captureOnscreen}
                  onChange={(e) => onCaptureOnscreenChange(e.target.checked)}
                />
                Onscreen
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#ccc" }}>
                <input type="checkbox" checked={captureAreaA} onChange={(e) => onCaptureAreaAChange(e.target.checked)} />
                A
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#ccc" }}>
                <input type="checkbox" checked={captureAreaB} onChange={(e) => onCaptureAreaBChange(e.target.checked)} />
                B
              </label>
            </div>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Range</SettingLabel>
            </SettingLabelContainer>
            <SettingValue style={{ whiteSpace: "normal", lineHeight: 1.25 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-end" }}>
                {captureRange.segments.map((seg) => (
                  <div key={seg.label}>
                    {seg.label}: {seg.min === 0 ? "0kHz" : `${seg.min.toFixed(2)}MHz`} - {seg.max.toFixed(2)}MHz
                  </div>
                ))}
              </div>
            </SettingValue>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Duration</SettingLabel>
            </SettingLabelContainer>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <SettingInput
                type="number"
                min="1"
                step="1"
                value={Math.round(captureDurationS)}
                onChange={(e) => onCaptureDurationSChange(parseInt(e.target.value) || 1)}
                style={{ width: "60px", MozAppearance: "textfield", WebkitAppearance: "none" } as React.CSSProperties}
              />
              <span style={{ fontSize: "12px", color: "#ccc", fontWeight: "500" }}>s</span>
            </div>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>File type</SettingLabel>
            </SettingLabelContainer>
            <SettingSelect
              value={captureFileType}
              onChange={(e) => onCaptureFileTypeChange(e.target.value as CaptureFileType)}
              style={{ minWidth: "110px" }}
            >
              <option value=".napt">.napt</option>
              <option value=".c64">.c64</option>
            </SettingSelect>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Encrypted</SettingLabel>
            </SettingLabelContainer>
            <ToggleSwitch $disabled={captureFileType === ".napt"}>
              <ToggleSwitchInput
                type="checkbox"
                checked={captureFileType === ".napt" ? true : captureEncrypted}
                disabled={captureFileType === ".napt"}
                onChange={(e) => onCaptureEncryptedChange(e.target.checked)}
              />
              <ToggleSwitchSlider $disabled={captureFileType === ".napt"} />
            </ToggleSwitch>
          </SettingRow>

          <SettingRow>
            <SettingLabelContainer>
              <SettingLabel>Sample size</SettingLabel>
            </SettingLabelContainer>
            <SettingValue>{maxSampleRate / 1000000}MHz</SettingValue>
          </SettingRow>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
            <PauseButton
              $paused={false}
              onClick={onCapture}
              disabled={(!isConnected || deviceState === "loading" || !isAuthenticated) || captureStatus?.status === "started"}
              style={{
                flex: "1",
                opacity: (!isConnected || deviceState === "loading" || !isAuthenticated) || captureStatus?.status === "started" ? 0.5 : 1,
                cursor: (!isConnected || deviceState === "loading" || !isAuthenticated) || captureStatus?.status === "started" ? "not-allowed" : "pointer",
              }}
            >
              {captureStatus?.status === "started" ? "Capturing..." : "Capture"}
            </PauseButton>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="checkbox"
                checked={capturePlayback}
                onChange={(e) => onCapturePlaybackChange(e.target.checked)}
                style={{ margin: 0 }}
              />
              <label style={{ fontSize: "11px", color: "#ccc", whiteSpace: "nowrap", margin: 0 }}>
                Playback after capture
              </label>
            </div>
          </div>

          {captureStatus?.status === "started" && (
            <SettingRow style={{ marginTop: "12px" }}>
              <SettingLabelContainer>
                <SettingLabel>Status</SettingLabel>
              </SettingLabelContainer>
              <SettingValue style={{ color: "#ffaa00" }}>
                Capturing... {captureStatus.jobId}
              </SettingValue>
            </SettingRow>
          )}

          {/* Downloads Section */}
          {captureStatus?.status === "done" && captureStatus.downloadUrl && isAuthenticated && (
            <div style={{ marginTop: "16px" }}>
              <div style={{
                fontSize: "11px",
                color: "#555",
                textTransform: "uppercase",
                letterSpacing: "1px",
                marginBottom: "8px",
                fontWeight: 600,
                fontFamily: "JetBrains Mono, monospace"
              }}>
                Downloads
              </div>
              <div style={{
                padding: "8px 12px",
                backgroundColor: "#141414",
                borderRadius: "6px",
                border: "1px solid #2a2a2a"
              }}>
                <a
                  href={`${captureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`}
                  download={captureStatus.filename || "capture"}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#00d4ff",
                    fontSize: "12px",
                    fontFamily: "JetBrains Mono, monospace",
                    textDecoration: "none",
                    display: "block",
                    wordBreak: "break-all",
                    maxWidth: "200px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                  title={captureStatus.filename || "Download"}
                >
                  {captureStatus.filename || "Download"}
                </a>
              </div>
            </div>
          )}
        </CollapsibleBody>
      )}
    </Section>
  );
};
