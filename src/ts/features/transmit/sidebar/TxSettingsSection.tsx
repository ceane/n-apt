import React from "react";
import styled from "styled-components";
import { Row, ChannelsGrid, Tooltip } from "@n-apt/ui";
import { FrequencyInput } from "@n-apt/ui/FrequencyInput";
import { Toggle } from "@n-apt/ui/Toggle";
import { useAppSelector } from "@n-apt/redux/store";
import {
  buildCenteredFrequencyRange,
  formatFrequency,
} from "@n-apt/math/frequency";
import {
  Radio,
  ShieldAlert,
  GitFork,
} from "lucide-react";
import {
  calculateRoomPowerLimitJS,
  getMaxSafeVgaAndAmpJS,
  calculateRoomReachJS,
  getQuantizedIqPowerFloorDbmJS,
  getRecommendedFftSizeForIqPowerDbmJS,
} from "@n-apt/app/infrastructure/services/safetyWasm";

import { useChannelTuner } from "@n-apt/spectrum/public/useChannelManagement";
import { nextPowerOfTwo } from "@n-apt/math/signalData";

const MAX_TX_IFFT_BIN_WIDTH_HZ = 10_000;

function getMinimumTxIfftSize(bandwidthHz: number): number {
  if (!Number.isFinite(bandwidthHz) || bandwidthHz <= 0) return 1;
  return Math.max(1, Math.ceil(bandwidthHz / MAX_TX_IFFT_BIN_WIDTH_HZ));
}

export function getTxFrequencyRangeForBandwidth(
  centerFrequencyHz: number,
  bandwidthHz: number,
): { min: number; max: number } | null {
  if (
    !Number.isFinite(centerFrequencyHz) ||
    !Number.isFinite(bandwidthHz) ||
    bandwidthHz <= 0
  ) {
    return null;
  }
  return buildCenteredFrequencyRange(centerFrequencyHz, bandwidthHz);
}

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

const NumericInput = styled.input`
  background-color: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  padding: 4px 6px;
  width: 92px;
  text-align: right;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    color: ${(props) => props.theme.textSecondary};
    border-color: ${(props) => props.theme.border};
    background-color: ${(props) =>
      props.theme.mode === "light"
        ? "rgba(255, 255, 255, 0.65)"
        : "rgba(255, 255, 255, 0.03)"};
  }
`;

const Select = styled.select`
  background-color: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  padding: 4px 6px;
  width: 100%;
`;

const InlineField = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const UnitSuffix = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: ${(props) => props.theme.textSecondary};
  white-space: nowrap;
  font-family: ${(props) => props.theme.typography.mono};
`;

const InlineWarning = styled.div`
  grid-column: 1 / -1;
  border: 1px solid ${({ theme }) => theme.colors.warning ?? "#d97706"};
  border-radius: 4px;
  color: ${({ theme }) => theme.textPrimary};
  background: ${({ theme }) =>
    theme.mode === "light"
      ? "rgba(245, 158, 11, 0.12)"
      : "rgba(245, 158, 11, 0.18)"};
  font-size: 11px;
  line-height: 1.4;
  padding: 8px 10px;
`;

const HopSectionContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  width: 100%;
  grid-column: 1 / -1;
  padding: 14px;
  box-sizing: border-box;
  background-color: ${(props) =>
    props.theme.mode === "light"
      ? props.theme.primaryAnchor
      : props.theme.surface};
  border-radius: 6px;
  border: 1px solid
    ${(props) =>
      props.theme.mode === "light"
        ? props.theme.borderHover
        : props.theme.border};
`;

const HopHeaderRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

const HopHeaderLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  font-weight: 500;
  color: ${(props) => props.theme.textSecondary};

  svg {
    width: 14px;
    height: 14px;
    color: ${(props) => props.theme.textSecondary};
    opacity: 0.5;
  }
`;

const HopOptionsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  border-top: 1px solid ${(props) => props.theme.border};
  padding-top: 12px;
`;

const HopFieldRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
`;

const HopFieldLabel = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 8px;

  svg {
    width: 14px;
    height: 14px;
    color: ${(props) => props.theme.textSecondary};
    opacity: 0.5;
  }
`;

const HopFieldControl = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  gap: 8px;
`;

const HopValueText = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  white-space: nowrap;
`;

const IconLabel = ({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ size?: number }>;
  text: string;
}) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <Icon size={14} />
    {text}
  </span>
);

const TxButton = styled.button<{ $isTransmitting?: boolean }>`
  margin-top: 8px;
  padding: 6px 12px;
  background: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.danger + "33" : theme.colors.primary + "26"};
  border: 1px solid
    ${({ theme, $isTransmitting }) =>
      $isTransmitting
        ? theme.colors.danger + "80"
        : theme.colors.primary + "80"};
  border-radius: 4px;
  color: ${({ theme, $isTransmitting }) =>
    $isTransmitting ? theme.colors.danger : theme.colors.primary};
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme, $isTransmitting }) =>
      $isTransmitting
        ? theme.colors.danger + "4d"
        : theme.colors.primary + "40"};
  }
`;

export interface TxSettingsSectionProps {
  signal: string;
  bandwidthHz?: number;
  sampleRateHz?: number;
  rxSampleRateHz?: number;
  maxBandwidthHz?: number | null;
  maxSampleRateHz?: number | null;
  fftSize?: number;
  ifftSize?: number;
  ifftSizeOptions?: number[];
  centerFrequencyHz: number;
  powerDbm?: number;
  vgaGainDb?: number;
  ampEnabled?: boolean;
  onSignalChange: (value: string) => void;
  onBandwidthChange?: (value: number) => void;
  onSampleRateChange?: (value: number) => void;
  onIfftSizeChange?: (value: number) => void;
  onCenterFrequencyChange: (value: number) => void;
  onPowerDbmChange: (value: number) => void;
  onVgaGainChange: (value: number) => void;
  onAmpEnabledChange?: (value: boolean) => void;
  isTransmitting?: boolean;
  onToggleTransmit?: () => void;

  // Safety & Hop props
  safetyEnabled: boolean;
  onSafetyEnabledChange: (value: boolean) => void;
  safetyLimit: "person" | "room" | "min";
  onSafetyLimitChange: (value: "person" | "room" | "min") => void;
  hopEnabled: boolean;
  onHopEnabledChange: (value: boolean) => void;
  hopType: "range" | "channels";
  onHopTypeChange: (value: "range" | "channels") => void;
  hopStartFrequencyHz: number;
  onHopStartFrequencyHzChange: (value: number) => void;
  hopEndFrequencyHz: number;
  onHopEndFrequencyHzChange: (value: number) => void;
  hopChannels: string[];
  onHopChannelsChange: (value: string[]) => void;
  hopRateHz: number;
  onHopRateHzChange: (value: number) => void;
  signalOptions?: Array<{ value: string; label: string }>;
}

export const TxSettingsSection: React.FC<TxSettingsSectionProps> = ({
  signal,
  bandwidthHz,
  sampleRateHz,
  rxSampleRateHz,
  maxBandwidthHz,
  maxSampleRateHz = 20_000_000,
  fftSize = 2048,
  ifftSize = fftSize,
  ifftSizeOptions = [],
  centerFrequencyHz,
  powerDbm = 0,
  vgaGainDb = 0,
  ampEnabled = false,
  onSignalChange,
  onBandwidthChange,
  onSampleRateChange,
  onIfftSizeChange,
  onCenterFrequencyChange,
  onPowerDbmChange,
  onVgaGainChange,
  onAmpEnabledChange,
  isTransmitting,
  onToggleTransmit,
  safetyEnabled,
  onSafetyEnabledChange,
  safetyLimit,
  onSafetyLimitChange,
  hopEnabled = false,
  onHopEnabledChange,
  hopType = "range",
  onHopTypeChange,
  hopStartFrequencyHz = 10_000_000,
  onHopStartFrequencyHzChange: _onHopStartFrequencyHzChange,
  hopEndFrequencyHz = 20_000_000,
  onHopEndFrequencyHzChange: _onHopEndFrequencyHzChange,
  hopChannels = [],
  onHopChannelsChange,
  hopRateHz = 10,
  onHopRateHzChange,
  signalOptions,
}) => {
  const widthBandwidthHz =
    typeof bandwidthHz === "number" && Number.isFinite(bandwidthHz)
      ? bandwidthHz
      : (sampleRateHz ?? 2_400_000);
  const maxWidthBandwidthHz = maxBandwidthHz ?? 30_000_000_000;
  const handleBandwidthChange =
    onBandwidthChange ?? onSampleRateChange ?? (() => {});

  const [localPower, setLocalPower] = React.useState(
    Number.isFinite(powerDbm) ? powerDbm.toString() : "0",
  );
  const [localVgaGain, setLocalVgaGain] = React.useState(
    Number.isFinite(vgaGainDb) ? vgaGainDb.toString() : "0",
  );
  const [localHopRate, setLocalHopRate] = React.useState(
    Number.isFinite(hopRateHz) ? hopRateHz.toString() : "10",
  );

  const powerInputRef = React.useRef<HTMLInputElement>(null);
  const vgaGainInputRef = React.useRef<HTMLInputElement>(null);

  const websocketChannels = useAppSelector((s) => s.websocket.channels);
  const backendTxSafety = useAppSelector((s) => s.spectrum.txSafetyResult);

  const channelsList = React.useMemo(() => {
    const defaultChannels = [
      { label: "A", min: 18_000, max: 4_390_000 },
      { label: "B", min: 24_100_000, max: 30_370_000 },
      { label: "C", min: 4_750_000, max: 23_000_000 },
    ];
    if (websocketChannels && websocketChannels.length > 0) {
      return websocketChannels.map((ch) => ({
        label: ch.label,
        min: ch.min_hz,
        max: ch.max_hz,
      }));
    }
    return defaultChannels;
  }, [websocketChannels]);

  const selectedLabels = React.useMemo(() => {
    return (hopChannels || []).map((ch) => ch.toUpperCase());
  }, [hopChannels]);

  const effectiveRxSampleRateHz =
    typeof rxSampleRateHz === "number" && Number.isFinite(rxSampleRateHz)
      ? rxSampleRateHz
      : typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
        ? sampleRateHz
        : typeof maxSampleRateHz === "number" &&
            Number.isFinite(maxSampleRateHz)
          ? maxSampleRateHz
          : null;
  const hopBandwidthHz =
    hopType === "range"
      ? Math.max(0, hopEndFrequencyHz - hopStartFrequencyHz)
      : selectedLabels.reduce((total, label) => {
          const channel = channelsList.find(
            (ch) => ch.label.toUpperCase() === label,
          );
          return total + Math.max(0, (channel?.max ?? 0) - (channel?.min ?? 0));
        }, 0);
  const isHopRateDisabled =
    typeof effectiveRxSampleRateHz === "number" &&
    Number.isFinite(effectiveRxSampleRateHz) &&
    hopBandwidthHz > 0 &&
    hopBandwidthHz <= effectiveRxSampleRateHz;
  const autoHopRequired =
    hopType === "channels" && selectedLabels.length > 1;
  const effectiveHopEnabled = hopEnabled || autoHopRequired;

  const { tuneChannels } = useChannelTuner();

  const handleChannelsChange = (nextLabels: string[]) => {
    const lowercaseLabels = nextLabels.map((l) => l.toLowerCase());
    onHopChannelsChange(lowercaseLabels);

    const uppercaseLabels = lowercaseLabels.map((l) => l.toUpperCase());
    const selectedChannels = uppercaseLabels
      .map((l) => channelsList.find((ch) => ch.label.toUpperCase() === l))
      .filter((ch): ch is { label: string; min: number; max: number } => !!ch);

    if (selectedChannels.length > 0) {
      tuneChannels(selectedChannels, lowercaseLabels);
      const primary = selectedChannels[0];
      const primaryBw = Math.max(1, primary.max - primary.min);
      const primaryCenter = Math.round((primary.min + primary.max) / 2);

      handleBandwidthChange(primaryBw);
      if (Number.isFinite(primaryCenter) && primaryCenter > 0) {
        onCenterFrequencyChange(primaryCenter);
      }
    }
  };

  const handleHopTypeSelect = (nextType: "range" | "channels") => {
    onHopTypeChange(nextType);
    if (nextType === "channels" && channelsList.length > 0) {
      const firstChannel = channelsList[0];
      const firstLabel = firstChannel.label.toLowerCase();
      onHopChannelsChange([firstLabel]);
      tuneChannels([firstChannel], [firstLabel]);
      const bw = Math.max(0, firstChannel.max - firstChannel.min);
      const centerFreq = Math.round((firstChannel.min + firstChannel.max) / 2);
      if (bw > 0) {
        handleBandwidthChange(bw);
      }
      if (Number.isFinite(centerFreq) && centerFreq > 0) {
        onCenterFrequencyChange(centerFreq);
      }
    }
  };

  React.useEffect(() => {
    if (
      hopType === "channels" &&
      (!hopChannels || hopChannels.length === 0) &&
      channelsList.length > 0
    ) {
      const firstChannel = channelsList[0];
      const firstLabel = firstChannel.label.toLowerCase();
      onHopChannelsChange([firstLabel]);
      tuneChannels([firstChannel], [firstLabel]);
      const bw = Math.max(0, firstChannel.max - firstChannel.min);
      const centerFreq = Math.round((firstChannel.min + firstChannel.max) / 2);
      if (bw > 0) {
        handleBandwidthChange(bw);
      }
      if (Number.isFinite(centerFreq) && centerFreq > 0) {
        onCenterFrequencyChange(centerFreq);
      }
    }
  }, [
    hopType,
    hopChannels,
    channelsList,
    onHopChannelsChange,
    handleBandwidthChange,
    onCenterFrequencyChange,
    tuneChannels,
  ]);

  React.useEffect(() => {
    if (document.activeElement !== powerInputRef.current) {
      setLocalPower(Number.isFinite(powerDbm) ? powerDbm.toString() : "0");
    }
  }, [powerDbm]);

  React.useEffect(() => {
    if (document.activeElement !== vgaGainInputRef.current) {
      setLocalVgaGain(Number.isFinite(vgaGainDb) ? vgaGainDb.toString() : "0");
    }
  }, [vgaGainDb]);

  React.useEffect(() => {
    setLocalHopRate(Number.isFinite(hopRateHz) ? hopRateHz.toString() : "10");
  }, [hopRateHz]);

  const limitDbm = React.useMemo(() => {
    if (backendTxSafety && Number.isFinite(backendTxSafety.maximumSafePowerDbm)) {
      return backendTxSafety.maximumSafePowerDbm;
    }
    if (safetyLimit === "min") return -70.0;
    return calculateRoomPowerLimitJS(
      centerFrequencyHz,
      safetyLimit === "person" ? 1.0 : 3.0,
    );
  }, [backendTxSafety, safetyLimit, centerFrequencyHz]);

  const safeGains = React.useMemo(() => {
    return getMaxSafeVgaAndAmpJS(limitDbm);
  }, [limitDbm]);

  const minReach = React.useMemo(() => {
    return calculateRoomReachJS(centerFrequencyHz, -70.0);
  }, [centerFrequencyHz]);

  const iqPowerFloorDbm = React.useMemo(
    () => getQuantizedIqPowerFloorDbmJS(8, ifftSize, 30),
    [ifftSize],
  );
  const enforcedIqPowerFloorDbm = React.useMemo(
    () =>
      Math.ceil(
        backendTxSafety?.minimumIqPowerFloorDbm ?? iqPowerFloorDbm,
      ),
    [backendTxSafety?.minimumIqPowerFloorDbm, iqPowerFloorDbm],
  );
  const isBelowIqPowerFloor =
    Number.isFinite(powerDbm) && powerDbm <= enforcedIqPowerFloorDbm;
  const recommendedFftSize = React.useMemo(
    () =>
      backendTxSafety?.recommendedIfftSize ??
      getRecommendedFftSizeForIqPowerDbmJS(powerDbm, 8, 30),
    [backendTxSafety?.recommendedIfftSize, powerDbm],
  );
  const minimumIfftSize = React.useMemo(
    () => getMinimumTxIfftSize(widthBandwidthHz),
    [widthBandwidthHz],
  );
  const effectiveIfftSizeOptions = React.useMemo(() => {
    const options = (ifftSizeOptions.length ? ifftSizeOptions : [ifftSize])
      .filter(
        (size) =>
          Number.isFinite(size) &&
          size > 0 &&
          Math.trunc(size) >= minimumIfftSize,
      )
      .map((size) => Math.trunc(size));
    const fallbackValue = nextPowerOfTwo(minimumIfftSize);
    const fallback = Number.isFinite(fallbackValue) ? fallbackValue : 1;
    return Array.from(new Set(options.length ? options : [fallback])).sort(
      (a, b) => a - b,
    );
  }, [ifftSize, ifftSizeOptions, minimumIfftSize]);
  const guardedIfftSize = React.useMemo(
    () =>
      effectiveIfftSizeOptions.includes(Math.trunc(ifftSize))
        ? Math.trunc(ifftSize)
        : effectiveIfftSizeOptions[0],
    [effectiveIfftSizeOptions, ifftSize],
  );
  const isIfftSizeBelowBandwidthGuard =
    Number.isFinite(ifftSize) && Math.trunc(ifftSize) < minimumIfftSize;
  const txIfftBinWidthHz =
    Number.isFinite(widthBandwidthHz) && guardedIfftSize > 0
      ? widthBandwidthHz / guardedIfftSize
      : 0;
  const formatReach = (meters: number): string => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)}km`;
    }
    if (meters < 0.1) {
      return `${(meters * 1000).toFixed(0)}mm`;
    }
    return `${meters.toFixed(2)}m`;
  };

  React.useEffect(() => {
    if (
      onIfftSizeChange &&
      Number.isFinite(guardedIfftSize) &&
      Math.trunc(ifftSize) !== guardedIfftSize
    ) {
      onIfftSizeChange(guardedIfftSize);
    }
  }, [guardedIfftSize, ifftSize, onIfftSizeChange]);

  const handlePowerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setLocalPower(val);
    const num = Number(val);
    if (Number.isFinite(num) && val !== "" && val !== "-") {
      onPowerDbmChange(num);
    }
  };

  const handlePowerBlur = () => {
    const num = Number(localPower);
    if (Number.isFinite(num) && localPower !== "" && localPower !== "-") {
      onPowerDbmChange(num);
      setLocalPower(num.toString());
    } else {
      setLocalPower(Number.isFinite(powerDbm) ? powerDbm.toString() : "0");
    }
  };

  const handleVgaGainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setLocalVgaGain(val);
    const num = Number(val);
    if (Number.isFinite(num) && val !== "" && val !== "-") {
      onVgaGainChange(num);
    }
  };

  const handleVgaGainBlur = () => {
    const num = Number(localVgaGain);
    if (Number.isFinite(num) && localVgaGain !== "" && localVgaGain !== "-") {
      onVgaGainChange(num);
      setLocalVgaGain(num.toString());
    } else {
      setLocalVgaGain(Number.isFinite(vgaGainDb) ? vgaGainDb.toString() : "0");
    }
  };

  const handleAmpToggle = (newAmp: boolean) => {
    if (onAmpEnabledChange) {
      onAmpEnabledChange(newAmp);
    }
  };

  const handleHopRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isHopRateDisabled) return;
    const val = e.target.value.trim();
    setLocalHopRate(val);
    const num = Number(val);
    if (Number.isFinite(num) && val !== "") {
      onHopRateHzChange(Math.max(1, Math.min(1000, num)));
    }
  };

  const handleHopRateBlur = () => {
    if (isHopRateDisabled) {
      setLocalHopRate(hopRateHz.toString());
      return;
    }
    const num = Number(localHopRate);
    if (Number.isFinite(num) && localHopRate !== "") {
      const clamped = Math.max(1, Math.min(1000, num));
      onHopRateHzChange(clamped);
      setLocalHopRate(clamped.toString());
    } else {
      setLocalHopRate(hopRateHz.toString());
    }
  };

  const handlePowerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.key === "ArrowUp" ? 1 : -1;
    const current = Number(localPower);
    if (Number.isFinite(current)) {
      const nextPower = Math.round((current + delta) * 10) / 10;
      onPowerDbmChange(nextPower);
      setLocalPower(nextPower.toString());
    }
  };

  const handleVgaGainKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.key === "ArrowUp" ? 1 : -1;
    const current = Number(localVgaGain);
    if (Number.isFinite(current)) {
      let nextVga = current + delta;
      nextVga = Math.max(0, nextVga);
      onVgaGainChange(nextVga);
      setLocalVgaGain(nextVga.toString());
    }
  };

  const handleHopRateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isHopRateDisabled) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.key === "ArrowUp" ? 1 : -1;
    const current = Number(localHopRate);
    if (Number.isFinite(current)) {
      const clamped = Math.max(1, Math.min(1000, current + delta));
      onHopRateHzChange(clamped);
      setLocalHopRate(clamped.toString());
    }
  };

  const isAmpDisabledBySafety = safetyEnabled && !safeGains.amp;

  return (
    <Section>
      <Row
        label={<IconLabel icon={Radio} text="Signal" />}
        tooltip="Select the transmission signal type: D, D#, Mock WiFi, or Mock 5G."
        tooltipTitle="Signal Type"
      >
        <Select value={signal} onChange={(e) => onSignalChange(e.target.value)}>
          {signalOptions ? (
            signalOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          ) : (
            <>
              <option value="d">D</option>
              <option value="d_sharp">D#</option>
              <option value="wifi">Mock WiFi</option>
              <option value="5g">Mock 5G</option>
            </>
          )}
        </Select>
      </Row>

      <HopSectionContainer>
        <HopHeaderRow>
          <HopHeaderLabel>
            <GitFork size={14} />
            Range
            <Tooltip
              title="Range"
              content="Tx I/Q range."
            />
          </HopHeaderLabel>
        </HopHeaderRow>

        <HopOptionsContainer>
          <HopFieldRow>
            <HopFieldLabel>
              Range type
              <Tooltip
                title="Range Type"
                content="Choose Channels or a continuous bandwidth and center frequency range."
              />
            </HopFieldLabel>
            <HopFieldControl>
              <Select
                value={hopType}
                onChange={(e) =>
                  handleHopTypeSelect(e.target.value as "range" | "channels")
                }
                style={{ width: "auto", minWidth: "120px" }}
              >
                <option value="range">Bandwidth + center</option>
                <option value="channels">Channels</option>
              </Select>
            </HopFieldControl>
          </HopFieldRow>

          {hopType === "range" ? (
            <>
              <HopFieldRow style={{ display: "grid", gridTemplateColumns: "120px 1fr" }}>
                <HopFieldLabel>
                  Tx Bandwidth
                </HopFieldLabel>
                <HopFieldControl>
                  <FrequencyInput valueHz={widthBandwidthHz} onChangeHz={handleBandwidthChange} minHz={1} maxHz={maxWidthBandwidthHz} />
                </HopFieldControl>
              </HopFieldRow>
              <HopFieldRow style={{ display: "grid", gridTemplateColumns: "120px 1fr" }}>
                <HopFieldLabel>Center frequency</HopFieldLabel>
                <HopFieldControl>
                  <FrequencyInput valueHz={centerFrequencyHz} onChangeHz={onCenterFrequencyChange} minHz={0} maxHz={30_000_000_000} />
                </HopFieldControl>
              </HopFieldRow>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              <HopFieldLabel>Channels</HopFieldLabel>
              <ChannelsGrid channels={channelsList} selectedLabels={selectedLabels} onChange={handleChannelsChange} />
            </div>
          )}

          <>
            <HopFieldRow>
              <HopFieldLabel>
                Rx Sample Rate
                <Tooltip
                  title="Rx Sample Rate"
                  content="The receive sample rate available to the hopping transmitter. When the hop span fills the sample rate, hopping is disabled."
                />
              </HopFieldLabel>
              <HopFieldControl>
                <HopValueText>
                  {effectiveRxSampleRateHz !== null
                    ? formatFrequency(effectiveRxSampleRateHz, {
                        precisionMHz: 3,
                        trimTrailingZeros: true,
                      })
                    : "N/A"}
                </HopValueText>
              </HopFieldControl>
            </HopFieldRow>

            <HopFieldRow>
              <HopFieldLabel>
                Hop
                <Tooltip
                  title="Frequency Hopping"
                  content="Enable hopping within the selected range or channels."
                />
              </HopFieldLabel>
              <Toggle
                $active={effectiveHopEnabled}
                onClick={() => {
                  if (!autoHopRequired) onHopEnabledChange(!hopEnabled);
                }}
                activeLabel="On"
                inactiveLabel="Off"
              />
            </HopFieldRow>

            {effectiveHopEnabled && (
            <HopFieldRow>
              <HopFieldLabel>
                Hop rate
                <Tooltip
                  title="Hop Rate"
                  content="The rate (in Hz) at which the transmitter hops from one frequency to the next."
                />
              </HopFieldLabel>
              <HopFieldControl>
                <InlineField>
                  <NumericInput
                    type="text"
                    value={localHopRate}
                    onChange={handleHopRateChange}
                    onBlur={handleHopRateBlur}
                    onKeyDown={handleHopRateKeyDown}
                    disabled={isHopRateDisabled}
                    aria-disabled={isHopRateDisabled}
                    title={
                      isHopRateDisabled
                        ? "Disabled because the hop bandwidth is within the current Rx sample rate"
                        : undefined
                    }
                  />
                  <UnitSuffix>Hz</UnitSuffix>
                </InlineField>
              </HopFieldControl>
            </HopFieldRow>
            )}
          </>
        </HopOptionsContainer>
      </HopSectionContainer>

      <Row
        label="IFFT Size"
        tooltip="Tx synthesis size. This controls the generated I/Q resolution before the signal is viewed by the receive FFT. Larger IFFT sizes can represent lower quantized RMS powers but increase generation cost."
        tooltipTitle="Tx IFFT Size"
      >
        <Select
          value={guardedIfftSize}
          onChange={(e) => onIfftSizeChange?.(Number(e.target.value))}
        >
          {effectiveIfftSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </Row>
      {isIfftSizeBelowBandwidthGuard && (
        <InlineWarning role="status">
          Bandwidth bin width guard: {ifftSize.toLocaleString()} at{" "}
          {formatFrequency(widthBandwidthHz)} would exceed{" "}
          {formatFrequency(MAX_TX_IFFT_BIN_WIDTH_HZ)} per bin, so Tx IFFT is
          advanced to {guardedIfftSize.toLocaleString()} (
          {formatFrequency(txIfftBinWidthHz)} per bin).
        </InlineWarning>
      )}
      <Row
        label="Power (Absolute)"
        tooltip="The target transmission power in dBm. 8-bit I/Q has a quantized RMS floor determined by the active FFT size and the one-LSB sample step. Requests below that floor are rounded up to the next whole dBm; increase FFT size to represent lower powers."
        tooltipTitle="Output Power"
      >
        <InlineField>
          <NumericInput
            ref={powerInputRef}
            type="text"
            value={localPower}
            onChange={handlePowerChange}
            onBlur={handlePowerBlur}
            onKeyDown={handlePowerKeyDown}
          />
          <UnitSuffix>dBm</UnitSuffix>
        </InlineField>
      </Row>
      {isBelowIqPowerFloor && (
        <InlineWarning role="status">
          IQ floor: {iqPowerFloorDbm.toFixed(1)} dBm at Tx IFFT{" "}
          {ifftSize.toLocaleString()}. The current request is below the 8-bit
          I/Q RMS/LSB floor, so Tx power is stepped up to{" "}
          {enforcedIqPowerFloorDbm} dBm. To represent lower power, increase FFT
          size; {recommendedFftSize.toLocaleString()} is recommended for this
          target.
        </InlineWarning>
      )}
      <Row
        label={<IconLabel icon={ShieldAlert} text="Safety" />}
        tooltip="Output power safety limit configuration. Restricts the maximum VGA gain and amplifier to protect personnel (1m reach), room (3m reach), or forces the hardware minimum (-70 dBm)."
        tooltipTitle="Tx Safety Clamp"
      >
        <Toggle
          $active={safetyEnabled}
          onClick={() => {
            const nextActive = !safetyEnabled;
            onSafetyEnabledChange(nextActive);
            if (nextActive) {
              onPowerDbmChange(-70);
              onVgaGainChange(0);
              if (onAmpEnabledChange) {
                onAmpEnabledChange(false);
              }
              setLocalPower("-70");
              setLocalVgaGain("0");
            }
          }}
          activeLabel="On"
          inactiveLabel="Off"
        />
        {safetyEnabled && (
          <Select
            value={safetyLimit}
            onChange={(e) =>
              onSafetyLimitChange(e.target.value as "person" | "room" | "min")
            }
            style={{ width: "auto", minWidth: "120px", marginLeft: "8px" }}
          >
            <option value="person">Person (1m reach)</option>
            <option value="room">Room (3m reach)</option>
            <option value="min">Minimum ({formatReach(minReach)})</option>
          </Select>
        )}
      </Row>
      <Row
        label="VGA gain"
        tooltip="The Variable Gain Amplifier gain (in dB) on the HackRF transmitter path. Ranges from 0 to 47 dB in steps of 1."
        tooltipTitle="VGA Gain"
      >
        <InlineField>
          <NumericInput
            ref={vgaGainInputRef}
            type="text"
            value={localVgaGain}
            onChange={handleVgaGainChange}
            onBlur={handleVgaGainBlur}
            onKeyDown={handleVgaGainKeyDown}
          />
          <UnitSuffix>dB</UnitSuffix>
        </InlineField>
      </Row>
      <Row
        label="TX Amp (Booster)"
        tooltip="Enable or disable the transmitter's RF amplifier (AMP) booster, which adds approximately 14 dB of gain."
        tooltipTitle="TX Amplifier Booster"
      >
        <Toggle
          $active={ampEnabled}
          onClick={() => handleAmpToggle(!ampEnabled)}
          activeLabel="On"
          inactiveLabel="Off"
          disabled={isAmpDisabledBySafety}
        />
      </Row>

      {onToggleTransmit && (
        <TxButton
          type="button"
          onClick={onToggleTransmit}
          $isTransmitting={isTransmitting}
        >
          {isTransmitting ? "Stop Tx" : "Start Tx"}
        </TxButton>
      )}
    </Section>
  );
};

export default TxSettingsSection;
