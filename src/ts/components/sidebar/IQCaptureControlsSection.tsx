import React from "react";
import styled from "styled-components";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import type {
  CaptureStatus,
  CaptureFileType,
  DeviceState,
} from "@n-apt/hooks/useWebSocket";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
`;

import { Row, CollapsibleTitle, CollapsibleBody } from "@n-apt/components/ui";

const SettingValue = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;

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
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;

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

const CheckboxGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
`;

const CheckboxLabel = styled.label`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #ccc;
`;

const RangeList = styled.div`
  display: grid;
  gap: 2px;
  justify-items: end;
`;

const DurationRow = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 4px;
`;

const DurationUnit = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
`;

const CaptureActions = styled.div`
  display: grid;
  grid-auto-flow: column;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
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
  color: #ccc;
  white-space: nowrap;
  margin: 0;
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

const CaptureButton = styled(PauseButton) <{ $disabled: boolean }>`
  flex: 1;
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
`;

const StatusSettingRow = styled(Row)`
  margin-top: 12px;
`;

const CaptureStatusValue = styled(SettingValue)`
  color: #ffaa00;
`;

const DownloadsContainer = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  margin-top: 16px;
`;

const DownloadsTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const DownloadCard = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  padding: 8px 12px;
  background-color: #141414;
  border-radius: 6px;
  border: 1px solid #2a2a2a;
`;

const DownloadLink = styled.a`
  color: #00d4ff;
  font-size: 12px;
  font-family: "JetBrains Mono", monospace;
  text-decoration: none;
  display: block;
  word-break: break-all;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  grid-column: 1 / -1;
`;

interface CaptureRange {
  min: number;
  max: number;
  segments: Array<{ label: string; min: number; max: number }>;
}

interface IQCaptureControlsSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  activeCaptureAreas: string[];
  availableCaptureAreas: Array<{ label: string; min: number; max: number }>;
  captureDurationS: number;
  captureFileType: CaptureFileType;
  acquisitionMode: "stepwise" | "interleaved";
  captureEncrypted: boolean;
  capturePlayback: boolean;
  captureRange: CaptureRange;
  maxSampleRate: number;
  captureStatus: CaptureStatus;
  isConnected: boolean;
  deviceState: DeviceState;
  onActiveCaptureAreasChange: (areas: string[]) => void;
  onCaptureDurationSChange: (value: number) => void;
  onCaptureFileTypeChange: (value: CaptureFileType) => void;
  onAcquisitionModeChange: (mode: "stepwise" | "interleaved") => void;
  onCaptureEncryptedChange: (value: boolean) => void;
  onCapturePlaybackChange: (value: boolean) => void;
  onCapture: () => void;
}

export const IQCaptureControlsSection: React.FC<
  IQCaptureControlsSectionProps
> = ({
  isOpen,
  onToggle,
  activeCaptureAreas,
  availableCaptureAreas,
  captureDurationS,
  captureFileType,
  acquisitionMode,
  captureEncrypted,
  capturePlayback,
  captureRange,
  maxSampleRate,
  captureStatus,
  isConnected,
  deviceState,
  onActiveCaptureAreasChange,
  onCaptureDurationSChange,
  onCaptureFileTypeChange,
  onAcquisitionModeChange,
  onCaptureEncryptedChange,
  onCapturePlaybackChange,
  onCapture,
}) => {
    const { isAuthenticated, sessionToken } = useAuthentication();
    return (
      <Section>
        <CollapsibleTitle
          label="I/Q Capture /"
          isOpen={isOpen}
          onToggle={onToggle}
        />

        {isOpen && (
          <CollapsibleBody>
            <Row label="Areas">
              <CheckboxGroup>
                {availableCaptureAreas.map((area) => (
                  <CheckboxLabel key={area.label}>
                    <input
                      type="checkbox"
                      checked={activeCaptureAreas.includes(area.label)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onActiveCaptureAreasChange([...activeCaptureAreas, area.label]);
                        } else {
                          onActiveCaptureAreasChange(
                            activeCaptureAreas.filter((a) => a !== area.label)
                          );
                        }
                      }}
                    />
                    {area.label}
                  </CheckboxLabel>
                ))}
              </CheckboxGroup>
            </Row>

            <Row label="Range">
              <SettingValue>
                <RangeList>
                  {captureRange.segments.map((seg) => (
                    <div key={seg.label}>
                      {seg.label}:{" "}
                      {seg.min === 0 ? "0kHz" : `${seg.min.toFixed(2)}MHz`} -{" "}
                      {seg.max.toFixed(2)}MHz
                    </div>
                  ))}
                </RangeList>
              </SettingValue>
            </Row>

            <Row label="Duration">
              <DurationRow>
                <SettingInput
                  type="number"
                  min="1"
                  step="1"
                  value={Math.round(captureDurationS)}
                  onChange={(e) =>
                    onCaptureDurationSChange(parseInt(e.target.value) || 1)
                  }
                />
                <DurationUnit>s</DurationUnit>
              </DurationRow>
            </Row>

            <Row label="File type">
              <SettingSelect
                value={captureFileType}
                onChange={(e) =>
                  onCaptureFileTypeChange(e.target.value as CaptureFileType)
                }
              >
                <option value=".napt">.napt</option>
                <option value=".wav">.wav</option>
              </SettingSelect>
            </Row>

            <Row label="TDMS (Interleaved Sweep)" tooltipTitle="Time-Division Multiplexed Sampling" tooltip="Rapidly sweeps across selected channels and interleaves the results into a single wideband output file. When off (Normal), captures each channel completely before moving to the next.">
              <ToggleSwitch>
                <ToggleSwitchInput
                  type="checkbox"
                  checked={acquisitionMode === "interleaved"}
                  onChange={(e) =>
                    onAcquisitionModeChange(
                      e.target.checked ? "interleaved" : "stepwise"
                    )
                  }
                />
                <ToggleSwitchSlider />
              </ToggleSwitch>
            </Row>

            <Row label="Encrypted">
              <ToggleSwitch $disabled={captureFileType === ".napt"}>
                <ToggleSwitchInput
                  type="checkbox"
                  checked={captureFileType === ".napt" ? true : captureEncrypted}
                  disabled={captureFileType === ".napt"}
                  onChange={(e) => onCaptureEncryptedChange(e.target.checked)}
                />
                <ToggleSwitchSlider $disabled={captureFileType === ".napt"} />
              </ToggleSwitch>
            </Row>

            <Row label="Sample size">
              <SettingValue>{maxSampleRate / 1000000}MHz</SettingValue>
            </Row>

            <CaptureActions>
              <CaptureButton
                $paused={false}
                $disabled={
                  !isConnected ||
                  deviceState === "loading" ||
                  !isAuthenticated ||
                  captureStatus?.status === "started"
                }
                onClick={onCapture}
                disabled={
                  !isConnected ||
                  deviceState === "loading" ||
                  !isAuthenticated ||
                  captureStatus?.status === "started"
                }
              >
                {captureStatus?.status === "started" ? "Capturing..." : "Capture"}
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

            {captureStatus?.status === "started" && (
              <StatusSettingRow label="Status">
                <CaptureStatusValue>
                  Capturing... {captureStatus.jobId}
                </CaptureStatusValue>
              </StatusSettingRow>
            )}

            {/* Downloads Section */}
            {captureStatus?.status === "done" &&
              captureStatus.downloadUrl &&
              isAuthenticated && (
                <DownloadsContainer>
                  <DownloadsTitle>Downloads</DownloadsTitle>
                  <DownloadCard>
                    <DownloadLink
                      href={`${captureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`}
                      download={captureStatus.filename || "capture"}
                      rel="noopener noreferrer"
                      title={captureStatus.filename || "Download"}
                    >
                      {captureStatus.filename || "Download"}
                    </DownloadLink>
                  </DownloadCard>
                </DownloadsContainer>
              )}
          </CollapsibleBody>
        )}
      </Section>
    );
  };
