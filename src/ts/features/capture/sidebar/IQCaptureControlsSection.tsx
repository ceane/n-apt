import React from "react";
import styled from "styled-components";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { useGeolocation } from "@n-apt/maps/public/useGeolocation";
import { useDispatch } from "react-redux";
import type {
  CaptureStatus,
  CaptureFileType,
  DeviceState,
} from "@n-apt/consts/schemas/websocket";
import {
  addNotification,
  updateNotification,
} from "@n-apt/redux/slices/notificationsSlice";
import { useAppSelector } from "@n-apt/redux/store";
import { formatDurationMs, formatFileSize } from "@n-apt/math/formatters";
import { BYTES_PER_IQ_SAMPLE } from "@n-apt/math/signalData";
import { formatChannelFreq, formatFrequency } from "@n-apt/math/frequency";
import { isValidNaptRange } from "@n-apt/math/signals";
import {
  AlertTriangle,
  Clock,
  File as FileIcon,
  FileSignal,
  LockKeyhole,
  MapPin,
  PanelLeftDashed,
  Scan,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  Row,
  Collapsible,
  Range,
  ChannelsSelector,
} from "@n-apt/ui";
import { RadioTabs } from "@n-apt/ui/RadioTabs";
import { buildSafeDownloadUrl } from "@n-apt/ui/downloadUrl";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
`;

// Channel descriptor used to trim a multi-channel capture header end-to-end
export interface ChannelDescriptor {
  center_freq_hz: number;
  size_hz: number;
  offset_bytes?: number;
  iq_length_bytes?: number;
  label?: string;
}

const SettingValue = styled.span`
  font-size: 14px;
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

const IconLabel: React.FC<{ icon: LucideIcon; text: string }> = ({
  icon: IconComponent,
  text,
}) => (
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

const DurationUnit = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  margin-left: 6px;
  display: inline-flex;
  align-items: baseline;
`;

// Fixed-height container for duration controls to prevent layout thrash
const DurationBlock = styled.div`
  height: 6rem;
  display: grid;
  grid-template-columns: 1fr;
  align-items: center;
`;

const DurationInputOrTextRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  height: 3.5rem;
`;

const DurationManualCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
`;

const DurationInputBox = styled.input`
  width: 3.5rem;
  height: 2rem;
  background: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 6px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 14px;
  text-align: right;
  padding: 0;
  outline: none;

  &:hover {
    border-color: ${(props) => props.theme.primary};
  }
`;

const DurationEstimate = styled.div`
  margin-top: 4px;
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
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
  background-color: ${(props) =>
    props.$paused ? props.theme.primaryAnchor : props.theme.surface};
  border: 1px solid
    ${(props) =>
      props.$paused ? props.theme.primary : props.theme.borderHover};
  border-radius: 8px;
  color: ${(props) =>
    props.$paused ? props.theme.primary : props.theme.textPrimary};
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

const CaptureButton = styled(PauseButton)<{ $disabled: boolean }>`
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
  margin-top: 7px;
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

const StatusValue = styled.div<{
  $tone: "warning" | "success" | "error" | "muted";
}>`
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

const ValidationWarning = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background-color: ${(props) => props.theme.warning}15;
  border-left: 3px solid ${(props) => props.theme.warning};
  border-radius: 4px;
  margin-top: 8px;
  grid-column: 1 / -1;
`;

const WarningText = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.warning};
  line-height: 1.4;
  font-weight: 500;
`;

const WarningIcon = styled(AlertTriangle)`
  color: ${(props) => props.theme.warning};
  flex-shrink: 0;
  margin-top: 1px;
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

const SectionBody = styled.div`
  display: grid;
  gap: 12px;
  min-width: 0;
  width: 100%;
`;

interface CaptureRange {
  min: number;
  max: number;
  segments: Array<{ label: string; min: number; max: number }>;
}

interface IQCaptureControlsSectionProps {
  variant?: "sidebar" | "node";
  defaultOpen?: boolean;
  open?: boolean;
  activeCaptureAreas: string[];
  availableCaptureAreas: Array<{
    label: string;
    min: number;
    max: number;
    extra?: React.ReactNode;
  }>;
  rangeExtras?: React.ReactNode;
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
  onAcquisitionModeChange: (
    mode: "stepwise" | "interleaved" | "whole_sample",
  ) => void;
  onCaptureEncryptedChange: (value: boolean) => void;
  onCapturePlaybackChange: (value: boolean) => void;
  onCaptureGeolocationChange: (value: boolean) => void;
  onCapture: () => void;
  onStopCapture?: () => void;
  onClearStatus: () => void;
  channels?: ChannelDescriptor[];
  onCaptureWithChannels?: (channels: ChannelDescriptor[]) => void;
}

export const IQCaptureControlsSection: React.FC<
  IQCaptureControlsSectionProps
> = ({
  variant = "sidebar",
  defaultOpen = false,
  open,
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
  rangeExtras,
  channels,
  onCaptureWithChannels,
}) => {
  // Build derived channels from the capture range segments when channels aren't provided
  const derivedChannels: ChannelDescriptor[] = React.useMemo(() => {
    if (!captureRange?.segments) return [];
    return captureRange.segments.map((seg, idx) => {
      const minHz = seg.min;
      const maxHz = seg.max;
      const centerHz = Math.round((minHz + maxHz) / 2);
      const widthHz = Math.round(maxHz - minHz);
      return {
        center_freq_hz: centerHz,
        size_hz: widthHz,
        label: seg.label ?? `Ch${idx + 1}`,
      } as ChannelDescriptor;
    });
  }, [captureRange?.segments]);

  // Final channels payload to pass to backend (UI-chosen or derived)
  const channelsPayload: ChannelDescriptor[] =
    typeof channels !== "undefined" && channels && channels.length > 0
      ? channels
      : derivedChannels;

  const triggerWithChannels = () => {
    onCapture();
    if (typeof onCaptureWithChannels === "function") {
      onCaptureWithChannels(channelsPayload);
    }
  };
  const { isAuthenticated, sessionToken } = useAuthentication();
  const dispatch = useDispatch();

  // Access live SDR settings from store for validation
  const gain = useAppSelector((s) => s.spectrum.gain);
  const ppm = useAppSelector((s) => s.spectrum.ppm);

  const {
    isSupported,
    requestPermission,
    error: geoError,
    isLoading: geoLoading,
  } = useGeolocation();

  const mappedCaptureAreas = React.useMemo(() => {
    return availableCaptureAreas.map((area) => {
      const matchingSegment = captureRange.segments.find(
        (seg) => seg.label === area.label,
      );
      return {
        label: matchingSegment?.label ?? area.label,
        min: matchingSegment?.min ?? area.min,
        max: matchingSegment?.max ?? area.max,
        extra: area.extra,
        totalLabel: formatChannelFreq(
          (matchingSegment?.max ?? area.max) - (matchingSegment?.min ?? area.min),
        ),
      };
    });
  }, [availableCaptureAreas, captureRange.max, captureRange.min, captureRange.segments]);

  const handleActiveCaptureAreasChange = (nextAreas: string[]) => {
    const hwHz = maxSampleRate;
    const nextOnscreenOnly =
      nextAreas.includes("Onscreen") && nextAreas.length === 1;
    const nextHasChannel = nextAreas.some((a) => a !== "Onscreen");

    const nextSelectedSegments = mappedCaptureAreas.filter((a) =>
      nextAreas.includes(a.label),
    );
    const nextMin =
      nextSelectedSegments.length > 0
        ? Math.min(...nextSelectedSegments.map((s) => s.min))
        : 0;
    const nextMax =
      nextSelectedSegments.length > 0
        ? Math.max(...nextSelectedSegments.map((s) => s.max))
        : 0;
    const nextSpan = nextMax - nextMin;

    if (nextAreas.includes("Onscreen")) {
      if (acquisitionMode !== "whole_sample") {
        onAcquisitionModeChange("whole_sample");
      }
    } else if (nextHasChannel && nextSpan > hwHz) {
      if (acquisitionMode === "whole_sample") {
        onAcquisitionModeChange("stepwise");
      }
    }

    onActiveCaptureAreasChange(nextAreas);
  };

  const hasOnscreenSelected = activeCaptureAreas.includes("Onscreen");
  const hasChannelSelected = activeCaptureAreas.some((a) => a !== "Onscreen");
  const onscreenOnly = hasOnscreenSelected && !hasChannelSelected;

  /**
   * .napt Validation Logic
   *
   * Requirements:
   * 1. Frequency: Selected range must be within signals.channels (A, B, C)
   * 2. Gain: >= 20dB
   * 3. PPM: >= 1
   *
   * Future: Integrate Spike Detection here.
   */
  const naptValidation = React.useMemo(() => {
    const isGainValid = gain >= 20;
    const isPpmValid = ppm >= 1;

    // Check frequency range validity
    // availableCaptureAreas is populated from the channel definitions in signals.yaml.
    const segments = captureRange?.segments || [];
    const selectedSegments = segments.filter((seg) =>
      activeCaptureAreas.includes(seg.label),
    );

    let isFreqValid = selectedSegments.length > 0;
    const invalidSegments: string[] = [];

    for (const seg of selectedSegments) {
      if (!isValidNaptRange(seg, availableCaptureAreas)) {
        isFreqValid = false;
        invalidSegments.push(seg.label);
      }
    }

    // TODO: Spike Detection validation hook
    // One day we will check for the presence of stable APT-like spikes before allowing .napt
    const isSpikeDetectionValid = true;

    const isValid =
      isGainValid && isPpmValid && isFreqValid && isSpikeDetectionValid;

    const reasons: string[] = [];
    if (!isGainValid) reasons.push(`Gain too low (${gain}dB < 20dB)`);
    if (!isPpmValid) reasons.push(`PPM too low (${ppm} < 1)`);
    if (!isFreqValid) {
      if (selectedSegments.length === 0) {
        reasons.push("No capture areas selected");
      } else {
        reasons.push(
          `Range outside N-APT channels: ${invalidSegments.join(", ")}`,
        );
      }
    }

    return { isValid, reasons, isGainValid, isPpmValid, isFreqValid };
  }, [gain, ppm, captureRange, activeCaptureAreas, availableCaptureAreas]);

  // Raw .iq is the lossless default fallback when .napt eligibility is lost.
  React.useEffect(() => {
    if (
      captureFileType === ".napt" &&
      !naptValidation.isValid &&
      activeCaptureAreas.length > 0
    ) {
      onCaptureFileTypeChange(".iq");
    }
  }, [
    naptValidation.isValid,
    captureFileType,
    onCaptureFileTypeChange,
    activeCaptureAreas.length,
  ]);

  const selectedCaptureSpanHz =
    activeCaptureAreas.length > 0
      ? Math.max(0, captureRange.max - captureRange.min)
      : 0;
  const estimatedTimedDataBytes =
    Math.max(0, captureDurationS) *
    selectedCaptureSpanHz *
    BYTES_PER_IQ_SAMPLE.u8;

  // Notification effect for capture status changes
  React.useEffect(() => {
    const captureNotificationId = `capture-${captureStatus?.jobId || "unknown"}`;

    if (captureStatus?.status === "started") {
      dispatch(
        addNotification({
          id: captureNotificationId,
          type: "info",
          title: "Capturing...",
          message: captureStatus.message || "I/Q capture in progress",
          duration: 0, // Don't auto-dismiss while capturing
        }),
      );
    } else if (captureStatus?.status === "progress") {
      // Update notification with progress if available
      dispatch(
        updateNotification({
          id: captureNotificationId,
          updates: {
            message: captureStatus.message || "Processing...",
          },
        }),
      );
    } else if (captureStatus?.status === "done") {
      dispatch(
        updateNotification({
          id: captureNotificationId,
          updates: {
            type: "success",
            title: "Capture Complete",
            message: captureStatus.filename
              ? `New capture ready for download\n${captureStatus.fileSize ? formatFileSize(captureStatus.fileSize) : ""}`
              : "I/Q capture completed successfully",
            duration: 5000, // Auto-dismiss after 5 seconds
          },
        }),
      );
    } else if (captureStatus?.status === "failed") {
      dispatch(
        updateNotification({
          id: captureNotificationId,
          updates: {
            type: "error",
            title: "Capture Failed",
            message:
              captureStatus.error ||
              captureStatus.message ||
              "I/Q capture failed",
            duration: 8000, // Keep error notification longer
          },
        }),
      );
    }
  }, [captureStatus, dispatch]);

  // Calculate capture range span to determine appropriate mode
  const captureRangeSpan = captureRange.max - captureRange.min;
  const hardwareSampleRateHz = maxSampleRate;
  const hasOnscreenCaptureArea = activeCaptureAreas.includes("Onscreen");

  const captureCoversChannel =
    hasOnscreenCaptureArea ||
    (hardwareSampleRateHz > 0 &&
      captureRangeSpan > 0 &&
      hardwareSampleRateHz >= captureRangeSpan);
  const isOnscreenExactMatch =
    onscreenOnly &&
    hardwareSampleRateHz > 0 &&
    Math.abs(captureRangeSpan - hardwareSampleRateHz) < 10_000;
  const isWiderThanHardware =
    !hasOnscreenCaptureArea &&
    captureRangeSpan > hardwareSampleRateHz;

  // GUARDS: Determine appropriate capture mode based on capture type
  let effectiveAcquisitionMode = acquisitionMode;

  if (captureCoversChannel) {
    // Hardware sample rate covers the selected channel span → force whole_sample
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
        : captureStatus?.status === "started" ||
            captureStatus?.status === "progress"
          ? "warning"
          : "muted";
  const statusText =
    captureStatus?.status === "done"
      ? "Complete"
      : captureStatus?.status === "failed"
        ? `Failed: ${captureStatus.error || "Unknown error"}`
        : captureStatus?.status === "started" ||
            captureStatus?.status === "progress"
          ? "In progress..."
          : "Idle";
  const hasSelectedCaptureAreas = activeCaptureAreas.length > 0;
  const isCaptureActive = captureStatus?.status === "started";
  const isCaptureDisabled =
    !isConnected ||
    deviceState === "loading" ||
    !isAuthenticated ||
    (!isCaptureActive && !hasSelectedCaptureAreas);

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
  const capturePhaseMessage = captureStatus?.message;
  const captureButtonLabel = isCaptureActive ? "Stop" : "Capture";
  const handleCaptureClick = isCaptureActive
    ? (onStopCapture ?? triggerWithChannels)
    : triggerWithChannels;
  const handleDurationModeChange =
    onCaptureDurationModeChange ?? (() => undefined);

  const captureContent = (
    <>
      <ChannelsSelector
        label="Ranges"
        icon={Scan}
        channels={mappedCaptureAreas}
        selectedLabels={activeCaptureAreas}
        onChange={handleActiveCaptureAreasChange}
        rangeExtras={rangeExtras}
      />

      <Row label={<IconLabel icon={Clock} text="Duration" />}>
        <DurationBlock>
          <RadioTabs
            value={captureDurationMode}
            onChange={(v) => handleDurationModeChange(v as "timed" | "manual")}
            options={[
              { value: "timed", label: "Timed" },
              { value: "manual", label: "Manual" },
            ]}
          />

          <DurationInputOrTextRow>
            {captureDurationMode === "timed" ? (
              <div style={{}}>
                <DurationInputBox
                  type="number"
                  min="1"
                  step="1"
                  value={Math.round(captureDurationS)}
                  name="iq-capture-duration"
                  onChange={(e) =>
                    onCaptureDurationSChange(parseInt(e.target.value) || 1)
                  }
                />
                <DurationUnit>s</DurationUnit>
                {activeCaptureAreas.length > 0 && (
                  <DurationEstimate>
                    Estimated data: {formatFileSize(estimatedTimedDataBytes)}
                  </DurationEstimate>
                )}
              </div>
            ) : (
              <DurationManualCenter>
                <SettingValue>
                  I/Q Capture runs until <br /> you press Stop.
                </SettingValue>
              </DurationManualCenter>
            )}
          </DurationInputOrTextRow>
        </DurationBlock>
      </Row>

      <Row label={<IconLabel icon={FileIcon} text="File type" />}>
        <div
          style={{ display: "flex", flexDirection: "column", width: "100%" }}
        >
          <SettingSelect
            value={captureFileType}
            onChange={(e) =>
              onCaptureFileTypeChange(e.target.value as CaptureFileType)
            }
          >
            <option value=".napt" disabled={!naptValidation.isValid}>
              .napt {!naptValidation.isValid ? "(Invalid)" : ""}
            </option>
            <option value=".iq">.iq</option>
            <option value=".wav">.wav</option>
          </SettingSelect>

          {!naptValidation.isValid && (
            <ValidationWarning>
              <WarningIcon size={14} />
              <WarningText>
                .napt format requires: gain ≥ 20dB, ppm ≥ 1, and frequency
                within N-APT channels.
                <br />
                <strong>Issues:</strong> {naptValidation.reasons.join(", ")}
              </WarningText>
            </ValidationWarning>
          )}
        </div>
      </Row>

      <Row
        label={<IconLabel icon={PanelLeftDashed} text="Acquisition Mode" />}
        tooltipTitle="Capture Mode Selection"
        tooltip="Stepwise: Captures frequency ranges sequentially. Interleaved: Rapidly sweeps and interleaves results. Whole Sample: Captures exact hardware sample rate without movement."
      >
        <SettingSelect
          value={effectiveAcquisitionMode}
          onChange={(e) =>
            onAcquisitionModeChange(
              e.target.value as "stepwise" | "interleaved" | "whole_sample",
            )
          }
          disabled={captureCoversChannel}
        >
          {(!isWiderThanHardware || captureCoversChannel) && (
            <option value="whole_sample">Whole Sample</option>
          )}
          {!captureCoversChannel && (
            <>
              <option value="stepwise">Stepwise</option>
              <option value="interleaved">Interleaved (TDMS)</option>
            </>
          )}
        </SettingSelect>
      </Row>

      <Row
        label={<IconLabel icon={LockKeyhole} text="Encrypted (AES-256-GCM)" />}
      >
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
        <ToggleSwitch
          $disabled={captureFileType !== ".napt" || !isSupported || geoLoading}
        >
          <ToggleSwitchInput
            type="checkbox"
            checked={captureFileType === ".napt" ? captureGeolocation : false}
            disabled={captureFileType !== ".napt" || !isSupported || geoLoading}
            onChange={(e) => handleGeolocationToggle(e.target.checked)}
          />
          <ToggleSwitchSlider
            $disabled={
              captureFileType !== ".napt" || !isSupported || geoLoading
            }
          />
        </ToggleSwitch>
      </Row>

      {geoError && captureFileType === ".napt" && (
        <Row label="">
          <ErrorSettingValue>{geoError}</ErrorSettingValue>
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
                  href={buildSafeDownloadUrl(
                    captureStatus.downloadUrl,
                    sessionToken,
                  )}
                  download={captureStatus.filename || "capture"}
                  rel="noopener noreferrer"
                  title={captureStatus.filename || "Download"}
                >
                  {captureStatus.filename || "Download"}
                </DownloadLink>
                <DownloadMeta>
                  {typeof captureStatus.fileSize === "number" &&
                    formatFileSize(captureStatus.fileSize)}
                  {" / "}
                  {typeof captureStatus.duration === "number" &&
                    formatDurationMs(captureStatus.duration)}
                </DownloadMeta>
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
              {capturePhaseMessage ||
                (captureStatus?.status === "started" ||
                captureStatus?.status === "progress"
                  ? "Capturing now..."
                  : "No downloads yet")}
            </InfoLabel>
            <StatusValue $tone={statusTone}>{statusText}</StatusValue>
          </InfoRow>
        )}
      </StatusDownloadsCard>
    </>
  );

  return (
    <Section data-sidebar-scroll-root="iq-capture">
      {variant === "sidebar" ? (
        <Collapsible
          icon={<FileSignal size={14} />}
          label="Take an I/Q Capture"
          defaultOpen={defaultOpen}
          open={open}
          sectionId="iq-capture"
        >
          <SectionBody>{captureContent}</SectionBody>
        </Collapsible>
      ) : (
        <SectionBody>{captureContent}</SectionBody>
      )}
    </Section>
  );
};
