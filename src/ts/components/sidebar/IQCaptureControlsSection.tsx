import React from "react";
import styled from "styled-components";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/hooks/useGeolocation";
import { formatFrequency } from "@n-apt/utils/frequency";
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
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primary}0d;
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
    background-color: ${(props) => props.theme.primary};
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

const CaptureButton = styled(PauseButton) <{ $disabled: boolean }>`
  flex: 1;
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};
`;

const StatusDownloadsCard = styled.div`
  display: grid;
  gap: 12px;
  grid-column: 1 / -1;
  margin-top: 12px;
  background: #101010;
  border: 1px solid #222;
  border-radius: 8px;
  padding: 12px;
  min-width: 0;
`;

const InfoCardTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-family: "JetBrains Mono", monospace;
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
  color: #ccc;
  min-width: 0;
`;

const DownloadCard = styled.div`
  display: grid;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  min-width: 0;
`;

const DownloadLink = styled.a`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-family: "JetBrains Mono", monospace;
  text-decoration: none;
  display: block;
  word-break: break-all;
  overflow-wrap: anywhere;
  white-space: normal;
  min-width: 0;
`;

const StatusValue = styled.div<{ $tone: "warning" | "success" | "error" | "muted" }>`
  font-size: 12px;
  font-family: "JetBrains Mono", monospace;
  color: ${(props) =>
    props.$tone === "success"
      ? "#00ff66"
      : props.$tone === "error"
        ? "#ff6666"
        : props.$tone === "warning"
          ? "#ffcc33"
          : "#999"};
  text-align: right;
  white-space: nowrap;
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
  onCaptureDurationSChange: (value: number) => void;
  onCaptureFileTypeChange: (value: CaptureFileType) => void;
  onAcquisitionModeChange: (mode: "stepwise" | "interleaved" | "whole_sample") => void;
  onCaptureEncryptedChange: (value: boolean) => void;
  onCapturePlaybackChange: (value: boolean) => void;
  onCaptureGeolocationChange: (value: boolean) => void;
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
  captureGeolocation,
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
  onCaptureGeolocationChange,
  onCapture,
}) => {
    const { isAuthenticated, sessionToken } = useAuthentication();
    const {
      isSupported,
      requestPermission,
      error: geoError,
      isLoading: geoLoading
    } = useGeolocation();
    const hasOnscreenSelected = activeCaptureAreas.includes("Onscreen");
    const hasChannelSelected = activeCaptureAreas.some((a) => a !== "Onscreen");
    const onscreenOnly = hasOnscreenSelected && !hasChannelSelected;

    // Calculate capture range span to determine appropriate mode
    const captureRangeSpan = captureRange.max - captureRange.min;
    const hardwareSampleRateMHz = maxSampleRate / 1000000;

    // Determine which modes are available
    const isOnscreenExactMatch = onscreenOnly && hardwareSampleRateMHz > 0 && Math.abs(captureRangeSpan - hardwareSampleRateMHz) < 0.01;
    const isWiderThanHardware = captureRangeSpan > hardwareSampleRateMHz + 0.01;

    // GUARDS: Determine appropriate capture mode based on capture type
    let effectiveAcquisitionMode = acquisitionMode;

    if (isOnscreenExactMatch) {
      // Onscreen only + span matches hardware → force whole_sample
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
          : captureStatus?.status === "started" || captureStatus?.status === "progress"
            ? "warning"
            : "muted";
    const statusText =
      captureStatus?.status === "done"
        ? "Complete"
        : captureStatus?.status === "failed"
          ? `Failed: ${captureStatus.error || "Unknown error"}`
          : captureStatus?.status === "started" || captureStatus?.status === "progress"
            ? "In progress..."
            : "Idle";

    const handleGeolocationToggle = async (enabled: boolean) => {
      if (enabled && captureFileType === ".napt") {
        const hasPermission = await requestPermission();
        if (!hasPermission) {
          // If permission denied, keep toggle off
          onCaptureGeolocationChange(false);
          return;
        }
      }
      onCaptureGeolocationChange(enabled);
    };
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
                        const nextAreas = e.target.checked
                          ? [...activeCaptureAreas, area.label]
                          : activeCaptureAreas.filter((a) => a !== area.label);

                        // Apply guards: auto-switch acquisition mode based on selection
                        const nextOnscreenOnly = nextAreas.includes("Onscreen") && nextAreas.every((a) => a === "Onscreen");
                        const nextHasChannel = nextAreas.some((a) => a !== "Onscreen");
                        const nextSpan = captureRange.max - captureRange.min;
                        const hwMHz = maxSampleRate / 1000000;

                        if (nextOnscreenOnly && hwMHz > 0 && Math.abs(nextSpan - hwMHz) < 0.01) {
                          // Onscreen only, exact match → whole_sample
                          if (acquisitionMode !== "whole_sample") {
                            onAcquisitionModeChange("whole_sample");
                          }
                        } else if (nextHasChannel && nextSpan > hwMHz + 0.01) {
                          // Wider than hardware → no whole_sample allowed
                          if (acquisitionMode === "whole_sample") {
                            onAcquisitionModeChange("stepwise");
                          }
                        }

                        onActiveCaptureAreasChange(nextAreas);
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
                      {formatFrequency(seg.min)} - {formatFrequency(seg.max)}
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

            <Row label="Acquisition Mode" tooltipTitle="Capture Mode Selection" tooltip="Stepwise: Captures frequency ranges sequentially. Interleaved: Rapidly sweeps and interleaves results. Whole Sample: Captures exact hardware sample rate without movement.">
              <SettingSelect
                value={effectiveAcquisitionMode}
                onChange={(e) => onAcquisitionModeChange(e.target.value as "stepwise" | "interleaved" | "whole_sample")}
                disabled={isOnscreenExactMatch}
              >
                {!isWiderThanHardware && (
                  <option value="whole_sample">Whole Sample</option>
                )}
                {!isOnscreenExactMatch && (
                  <>
                    <option value="stepwise">Stepwise</option>
                    <option value="interleaved">Interleaved (TDMS)</option>
                  </>
                )}
              </SettingSelect>
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

            <Row label="Geolocation" tooltipTitle="Location data (lat, long, accuracy, altitude)" tooltip="Only available for .napt files. Requires browser permission to access location.">
              <ToggleSwitch $disabled={captureFileType !== ".napt" || !isSupported || geoLoading}>
                <ToggleSwitchInput
                  type="checkbox"
                  checked={captureFileType === ".napt" ? captureGeolocation : false}
                  disabled={captureFileType !== ".napt" || !isSupported || geoLoading}
                  onChange={(e) => handleGeolocationToggle(e.target.checked)}
                />
                <ToggleSwitchSlider $disabled={captureFileType !== ".napt" || !isSupported || geoLoading} />
              </ToggleSwitch>
            </Row>

            {geoError && captureFileType === ".napt" && (
              <Row label="">
                <SettingValue style={{ color: "#ff6666", fontSize: "11px" }}>
                  {geoError}
                </SettingValue>
              </Row>
            )}

            <Row label="Sample size">
              <SettingValue>{maxSampleRate / 1000000}MHz</SettingValue>
            </Row>

            {hasOnscreenSelected && (
              <Row label="Capture mode">
                <SettingValue style={{ textTransform: "capitalize" }}>
                  {effectiveAcquisitionMode === "whole_sample" ? "Whole Sample" : effectiveAcquisitionMode}
                  {hasOnscreenSelected && (
                    <span style={{ fontSize: "10px", color: "#888", marginLeft: "5px" }}>
                      {Math.abs(captureRangeSpan - hardwareSampleRateMHz) < 0.01
                        ? "(Exact Match)"
                        : captureRangeSpan > hardwareSampleRateMHz
                          ? "(User Choice)"
                          : "(TDMS)"}
                    </span>
                  )}
                </SettingValue>
              </Row>
            )}

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

            <StatusDownloadsCard>
              <InfoCardTitle>Downloads</InfoCardTitle>
              {captureStatus?.downloadUrl && isAuthenticated ? (
                <DownloadCard>
                  <InfoRow>
                    <DownloadLink
                      href={`${captureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`}
                      download={captureStatus.filename || "capture"}
                      rel="noopener noreferrer"
                      title={captureStatus.filename || "Download"}
                    >
                      {captureStatus.filename || "Download"}
                    </DownloadLink>
                    <StatusValue
                      $tone={
                        captureStatus?.status === "done"
                          ? "success"
                          : captureStatus?.status === "failed"
                            ? "error"
                            : "warning"
                      }
                    >
                      {captureStatus?.status === "done"
                        ? "Complete"
                        : captureStatus?.status === "failed"
                          ? "Failed"
                          : "In progress..."}
                    </StatusValue>
                  </InfoRow>
                </DownloadCard>
              ) : (
                <InfoRow>
                  <InfoLabel>
                    {captureStatus?.status === "started" || captureStatus?.status === "progress"
                      ? "Capturing now..."
                      : "No downloads yet"}
                  </InfoLabel>
                  <StatusValue $tone={statusTone}>{statusText}</StatusValue>
                </InfoRow>
              )}
            </StatusDownloadsCard>
          </CollapsibleBody>
        )}
      </Section>
    );
  };
