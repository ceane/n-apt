import React from "react";
import styled from "styled-components";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/hooks/useGeolocation";
import { useDispatch } from "react-redux";
import type {
  CaptureStatus,
  CaptureFileType,
  DeviceState,
} from "@n-apt/hooks/useWebSocket";
import { addNotification, updateNotification } from "@n-apt/redux/slices/notificationsSlice";
import { formatFileSize } from "@n-apt/utils/formatters";
import {
  Clock,
  File as FileIcon,
  FileSignal,
  LockKeyhole,
  MapPin,
  PanelLeftDashed,
  Scan,
  Trash2,
  Download,
  type LucideIcon,
} from "lucide-react";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
`;

import { Row, Collapsible, Range } from "@n-apt/components/ui";

const SettingValue = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const LabelWithIcon = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  line-height: 1.2;

  svg {
    width: 14px;
    height: 14px;
    color: ${(props) => props.theme.textSecondary};
    opacity: 0.5;
  }
`;

const IconLabel: React.FC<{ icon: LucideIcon; text: string }> = ({ icon: IconComponent, text }) => (
  <LabelWithIcon>
    <IconComponent size={14} strokeWidth={1.75} aria-hidden="true" />
    {text}
  </LabelWithIcon>
);

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
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
    border-color: ${(props) => props.theme.borderHover};
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primary}0d;
  }

  option {
    background-color: ${(props) => props.theme.surface};
    color: ${(props) => props.theme.textPrimary};
    font-family: ${(props) => props.theme.typography.mono};
  }
`;

const SettingInput = styled.input`
  background-color: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
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
  background-color: ${(props) => props.theme.borderHover};
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

const RangeRowContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  grid-column: 1 / -1;
  padding: 14px;
  box-sizing: border-box;
  background-color: ${(props) => props.theme.surface};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.border};
`;

const RangeRowLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
`;

const SampleRateBadge = styled.span`
  margin-left: auto;
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  font-family: ${(props) => props.theme.typography.mono};
  letter-spacing: 0.5px;
`;

const RangeRowBody = styled.div`
  width: 100%;
`;

const RangeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  width: 100%;
  align-items: flex-start;
`;

const DurationRow = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 4px;
`;

const DurationModeRow = styled.div`
  display: grid;
  grid-template-columns: repeat(2, max-content);
  align-items: center;
  gap: 10px;
`;

const DurationModeLabel = styled.label`
  font-size: 11px;
  color: ${(props) => props.theme.textPrimary};
  white-space: nowrap;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
`;

const DurationUnit = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
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
  color: ${(props) => props.theme.textPrimary};
  white-space: nowrap;
  margin: 0;
`;

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) => (props.$paused ? props.theme.primaryAnchor : props.theme.surface)};
  border: 1px solid ${(props) => (props.$paused ? props.theme.primary : props.theme.borderHover)};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? props.theme.primary : props.theme.textPrimary)};
  font-family: ${(props) => props.theme.typography.mono};
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
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  padding: 12px;
  min-width: 0;
  z-index: 10;
  position: relative;
`;

const InfoCardTitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 2px;
  font-family: ${(props) => props.theme.typography.mono};
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
  color: ${(props) => props.theme.textPrimary};
  min-width: 0;
`;

const DownloadMeta = styled.div`
  margin-top: 4px;
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
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
  font-family: ${(props) => props.theme.typography.mono};
  text-decoration: none;
  display: block;
  word-break: break-all;
  overflow-wrap: anywhere;
  white-space: normal;
  min-width: 0;
`;

const StatusValue = styled.div<{ $tone: "warning" | "success" | "error" | "muted" }>`
  font-size: 12px;
  font-family: ${(props) => props.theme.typography.mono};
  color: ${(props) =>
    props.$tone === "success"
      ? props.theme.success
      : props.$tone === "error"
        ? props.theme.danger
        : props.$tone === "warning"
          ? props.theme.warning
          : props.theme.textSecondary};
  text-align: right;
  white-space: nowrap;
`;

const ErrorSettingValue = styled(SettingValue)`
  color: ${(props) => props.theme.danger};
  font-size: 11px;
`;

const DownloadsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ClearStatusButton = styled.button`
  background: none;
  border: none;
  color: ${(props) => props.theme.textMuted};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  padding: 2px 4px;
`;

interface CaptureRange {
  min: number;
  max: number;
  segments: Array<{ label: string; min: number; max: number }>;
}

interface IQCaptureControlsSectionProps {
  activeCaptureAreas: string[];
  availableCaptureAreas: Array<{ label: string; min: number; max: number }>;
  captureDurationMode: "timed" | "manual";
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
  onCaptureDurationModeChange?: (mode: "timed" | "manual") => void;
  onCaptureDurationSChange: (value: number) => void;
  onCaptureFileTypeChange: (value: CaptureFileType) => void;
  onAcquisitionModeChange: (mode: "stepwise" | "interleaved" | "whole_sample") => void;
  onCaptureEncryptedChange: (value: boolean) => void;
  onCapturePlaybackChange: (value: boolean) => void;
  onCaptureGeolocationChange: (value: boolean) => void;
  onCapture: () => void;
  onStopCapture?: () => void;
  onClearStatus: () => void;
}

export const IQCaptureControlsSection: React.FC<
  IQCaptureControlsSectionProps
> = ({
  activeCaptureAreas,
  availableCaptureAreas,
  captureDurationMode,
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
  onCaptureDurationModeChange,
  onCaptureDurationSChange,
  onCaptureFileTypeChange,
  onAcquisitionModeChange,
  onCaptureEncryptedChange,
  onCapturePlaybackChange,
  onCaptureGeolocationChange,
  onCapture,
  onStopCapture,
  onClearStatus,
}) => {
    const { isAuthenticated, sessionToken } = useAuthentication();
    const dispatch = useDispatch();
    const {
      isSupported,
      requestPermission,
      error: geoError,
      isLoading: geoLoading
    } = useGeolocation();
    const hasOnscreenSelected = activeCaptureAreas.includes("Onscreen");
    const hasChannelSelected = activeCaptureAreas.some((a) => a !== "Onscreen");
    const onscreenOnly = hasOnscreenSelected && !hasChannelSelected;

    // Helper function to format file sizes
    const formatFileSize = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const value = bytes / Math.pow(k, i);
      // Show decimal places for KB and above, but not for bytes
      if (i === 0) {
        return `${Math.round(value)} ${sizes[i]}`;
      }
      return `${value.toFixed(2)} ${sizes[i]}`;
    };

    // Notification effect for capture status changes
    React.useEffect(() => {
      const captureNotificationId = `capture-${captureStatus?.jobId || 'unknown'}`;

      if (captureStatus?.status === "started") {
        dispatch(addNotification({
          id: captureNotificationId,
          type: 'info',
          title: 'Capturing...',
          message: captureStatus.message || 'I/Q capture in progress',
          duration: 0, // Don't auto-dismiss while capturing
        }));
      } else if (captureStatus?.status === "progress") {
        // Update notification with progress if available
        dispatch(updateNotification({
          id: captureNotificationId,
          updates: {
            message: captureStatus.message || 'Processing...',
          }
        }));
      } else if (captureStatus?.status === "done") {
        dispatch(updateNotification({
          id: captureNotificationId,
          updates: {
            type: 'success',
            title: 'Capture Complete',
            message: captureStatus.filename
              ? `New capture ready for download\n${captureStatus.fileSize ? formatFileSize(captureStatus.fileSize) : ''}`
              : 'I/Q capture completed successfully',
            duration: 5000, // Auto-dismiss after 5 seconds
            icon: <Download size={16} />
          }
        }));
      } else if (captureStatus?.status === "failed") {
        dispatch(updateNotification({
          id: captureNotificationId,
          updates: {
            type: 'error',
            title: 'Capture Failed',
            message: captureStatus.error || captureStatus.message || 'I/Q capture failed',
            duration: 8000, // Keep error notification longer
          }
        }));
      }
    }, [captureStatus, dispatch]);

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
    const hasSelectedCaptureAreas = activeCaptureAreas.length > 0;
    const isCaptureActive = captureStatus?.status === "started";
    const isCaptureDisabled =
      !isConnected ||
      deviceState === "loading" ||
      !isAuthenticated ||
      (!isCaptureActive && !hasSelectedCaptureAreas);

    const formatSampleRateLabel = (hz: number) => {
      if (!hz || Number.isNaN(hz)) {
        return "0MHz";
      }
      return `${(hz / 1_000_000).toFixed(1)}MHz`;
    };

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
    const sampleRateLabel = formatSampleRateLabel(maxSampleRate);
    const capturePhaseMessage = captureStatus?.message;
    const captureButtonLabel = isCaptureActive ? "Stop" : "Capture";
    const handleCaptureClick = isCaptureActive ? (onStopCapture ?? onCapture) : onCapture;
    const handleDurationModeChange = onCaptureDurationModeChange ?? (() => undefined);

    return (
      <Section>
        <Collapsible
          icon={<FileSignal size={14} />}
          label="IQ Capture Controls"
          defaultOpen={false}
        >
          <RangeRowContainer>
            <RangeRowLabel>
              <IconLabel icon={Scan} text="Ranges" />
              <SampleRateBadge aria-label="Hardware sample rate">{sampleRateLabel}</SampleRateBadge>
            </RangeRowLabel>
            <RangeRowBody>
              <RangeGrid>
                {availableCaptureAreas.map((area, idx) => {
                  const isSelected = activeCaptureAreas.includes(area.label);
                  const variant = idx % 2 === 0 ? "primary" : "secondary";

                  const handleToggle = () => {
                    const nextAreas = isSelected
                      ? activeCaptureAreas.filter((a) => a !== area.label)
                      : [...activeCaptureAreas, area.label];

                    const nextOnscreenOnly = nextAreas.includes("Onscreen") && nextAreas.every((a) => a === "Onscreen");
                    const nextHasChannel = nextAreas.some((a) => a !== "Onscreen");
                    const nextSpan = captureRange.max - captureRange.min;
                    const hwMHz = maxSampleRate / 1000000;

                    if (nextOnscreenOnly && hwMHz > 0 && Math.abs(nextSpan - hwMHz) < 0.01) {
                      if (acquisitionMode !== "whole_sample") {
                        onAcquisitionModeChange("whole_sample");
                      }
                    } else if (nextHasChannel && nextSpan > hwMHz + 0.01) {
                      if (acquisitionMode === "whole_sample") {
                        onAcquisitionModeChange("stepwise");
                      }
                    }

                    onActiveCaptureAreasChange(nextAreas);
                  };

                  const matchingSegment = captureRange.segments.find((seg) => seg.label === area.label);
                  const label = matchingSegment?.label ?? area.label;
                  const min = matchingSegment?.min ?? area.min;
                  const max = matchingSegment?.max ?? area.max;

                  return (
                    <Range
                      key={area.label}
                      label={label}
                      min={min}
                      max={max}
                      selected={isSelected}
                      onToggle={handleToggle}
                      variant={variant}
                    />
                  );
                })}
              </RangeGrid>
            </RangeRowBody>
          </RangeRowContainer>

          <Row label={<IconLabel icon={Clock} text="Duration" />}>
            <div style={{ display: "grid", gap: 8, width: "100%" }}>
              <DurationModeRow>
                <DurationModeLabel htmlFor="iq-capture-duration-timed">
                  <input
                    id="iq-capture-duration-timed"
                    type="radio"
                    name="iq-capture-duration-mode"
                    checked={captureDurationMode === "timed"}
                    onChange={() => handleDurationModeChange("timed")}
                  />
                  Time-based
                </DurationModeLabel>
                <DurationModeLabel htmlFor="iq-capture-duration-manual">
                  <input
                    id="iq-capture-duration-manual"
                    type="radio"
                    name="iq-capture-duration-mode"
                    checked={captureDurationMode === "manual"}
                    onChange={() => handleDurationModeChange("manual")}
                  />
                  Manual
                </DurationModeLabel>
              </DurationModeRow>
              {captureDurationMode === "timed" ? (
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
              ) : (
                <SettingValue>Capture runs until you press Stop.</SettingValue>
              )}
            </div>
          </Row>

          <Row label={<IconLabel icon={FileIcon} text="File type" />}>
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

          <Row
            label={<IconLabel icon={PanelLeftDashed} text="Acquisition Mode" />}
            tooltipTitle="Capture Mode Selection"
            tooltip="Stepwise: Captures frequency ranges sequentially. Interleaved: Rapidly sweeps and interleaves results. Whole Sample: Captures exact hardware sample rate without movement."
          >
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

          <Row label={<IconLabel icon={LockKeyhole} text="Encrypted (AES-256-GCM)" />}>
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

          <Row
            label={<IconLabel icon={MapPin} text="Geolocation" />}
            tooltipTitle="Location data (lat, long, accuracy, altitude)"
            tooltip="Only available for .napt files. Requires browser permission to access location."
          >
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
              <ErrorSettingValue>
                {geoError}
              </ErrorSettingValue>
            </Row>
          )}

          <CaptureActions>
            <CaptureButton
              $paused={false}
              $disabled={isCaptureDisabled}
              onClick={handleCaptureClick}
              disabled={isCaptureDisabled}
            >
              {captureButtonLabel}
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
            <DownloadsHeader>
              <InfoCardTitle>Downloads</InfoCardTitle>
              <ClearStatusButton
                onClick={onClearStatus}
                title="Clear capture status"
              >
                <Trash2 size={12} /> Clear
              </ClearStatusButton>
            </DownloadsHeader>
            {captureStatus?.downloadUrl && isAuthenticated ? (
              <DownloadCard>
                <InfoRow>
                  <div style={{ minWidth: 0 }}>
                    <DownloadLink
                      href={`${captureStatus.downloadUrl}&token=${encodeURIComponent(sessionToken || "")}`}
                      download={captureStatus.filename || "capture"}
                      rel="noopener noreferrer"
                      title={captureStatus.filename || "Download"}
                    >
                      {captureStatus.filename || "Download"}
                    </DownloadLink>
                    {typeof captureStatus.fileSize === "number" && (
                      <DownloadMeta>{formatFileSize(captureStatus.fileSize)}</DownloadMeta>
                    )}
                  </div>
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
                  {capturePhaseMessage || (
                    captureStatus?.status === "started" || captureStatus?.status === "progress"
                      ? "Capturing now..."
                      : "No downloads yet"
                  )}
                </InfoLabel>
                <StatusValue $tone={statusTone}>{statusText}</StatusValue>
              </InfoRow>
            )}
          </StatusDownloadsCard>
        </Collapsible>
      </Section>
    );
  };
