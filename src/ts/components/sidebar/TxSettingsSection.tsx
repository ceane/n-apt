import React from "react";
import styled from "styled-components";
import { Row, ChannelsGrid } from "@n-apt/components/ui";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";
import { Toggle } from "@n-apt/components/ui/Toggle";
import { useAppSelector } from "@n-apt/redux/store";
import {
  Radio,
  SlidersHorizontal,
  Waves,
  ShieldAlert,
  GitFork,
} from "lucide-react";
import {
  calculateRoomPowerLimitJS,
  getMaxSafeVgaAndAmpJS,
  getApproxOutputPowerJS,
  calculateRoomReachJS,
} from "@n-apt/utils/safetyWasm";

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
  sampleRateHz: number;
  maxSampleRateHz?: number | null;
  centerFrequencyHz: number;
  powerDbm?: number;
  vgaGainDb?: number;
  ampEnabled?: boolean;
  onSignalChange: (value: string) => void;
  onSampleRateChange: (value: number) => void;
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
}

export const TxSettingsSection: React.FC<TxSettingsSectionProps> = ({
  signal,
  sampleRateHz,
  maxSampleRateHz = 20_000_000,
  centerFrequencyHz,
  powerDbm = 0,
  vgaGainDb = 0,
  ampEnabled = false,
  onSignalChange,
  onSampleRateChange,
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
  onHopStartFrequencyHzChange,
  hopEndFrequencyHz = 20_000_000,
  onHopEndFrequencyHzChange,
  hopChannels = [],
  onHopChannelsChange,
  hopRateHz = 10,
  onHopRateHzChange,
}) => {
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

  const handleChannelsChange = (nextLabels: string[]) => {
    onHopChannelsChange(nextLabels.map((l) => l.toLowerCase()));
  };

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
    if (safetyLimit === "min") return -70.0;
    return calculateRoomPowerLimitJS(
      centerFrequencyHz,
      safetyLimit === "person" ? 1.0 : 3.0,
    );
  }, [safetyLimit, centerFrequencyHz]);

  const safeGains = React.useMemo(() => {
    return getMaxSafeVgaAndAmpJS(limitDbm);
  }, [limitDbm]);

  const minReach = React.useMemo(() => {
    return calculateRoomReachJS(centerFrequencyHz, -70.0);
  }, [centerFrequencyHz]);

  const formatReach = (meters: number): string => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)}km`;
    }
    if (meters < 0.1) {
      return `${(meters * 1000).toFixed(0)}mm`;
    }
    return `${meters.toFixed(2)}m`;
  };

  // Enforce safety limits
  React.useEffect(() => {
    if (safetyEnabled) {
      let nextVga = vgaGainDb;
      let nextAmp = !!ampEnabled;
      let nextPower = powerDbm;
      let changed = false;

      if (powerDbm > limitDbm) {
        nextPower = limitDbm;
        changed = true;
      }
      if (vgaGainDb > safeGains.vga) {
        nextVga = safeGains.vga;
        changed = true;
      }
      if (ampEnabled && !safeGains.amp) {
        nextAmp = false;
        changed = true;
      }

      if (changed) {
        if (nextPower !== powerDbm) {
          onPowerDbmChange(nextPower);
        }
        if (nextVga !== vgaGainDb) {
          onVgaGainChange(nextVga);
        }
        if (nextAmp !== ampEnabled && onAmpEnabledChange) {
          onAmpEnabledChange(nextAmp);
        }
      }
    }
  }, [
    safetyEnabled,
    limitDbm,
    safeGains,
    vgaGainDb,
    powerDbm,
    ampEnabled,
    onPowerDbmChange,
    onVgaGainChange,
    onAmpEnabledChange,
  ]);

  const handlePowerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setLocalPower(val);
    const num = Number(val);
    if (Number.isFinite(num) && val !== "" && val !== "-") {
      let targetPower = num;
      if (safetyEnabled) {
        targetPower = Math.min(limitDbm, targetPower);
      }
      onPowerDbmChange(targetPower);
      const res = getMaxSafeVgaAndAmpJS(targetPower);
      onVgaGainChange(res.vga);
      if (onAmpEnabledChange) {
        onAmpEnabledChange(res.amp);
      }
    }
  };

  const handlePowerBlur = () => {
    const num = Number(localPower);
    if (Number.isFinite(num) && localPower !== "" && localPower !== "-") {
      let targetPower = num;
      if (safetyEnabled) {
        targetPower = Math.min(limitDbm, targetPower);
      }
      onPowerDbmChange(targetPower);
      setLocalPower(targetPower.toString());
      const res = getMaxSafeVgaAndAmpJS(targetPower);
      onVgaGainChange(res.vga);
      if (onAmpEnabledChange) {
        onAmpEnabledChange(res.amp);
      }
    } else {
      setLocalPower(Number.isFinite(powerDbm) ? powerDbm.toString() : "0");
    }
  };

  const handleVgaGainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setLocalVgaGain(val);
    const num = Number(val);
    if (Number.isFinite(num) && val !== "" && val !== "-") {
      let targetVga = num;
      if (safetyEnabled) {
        targetVga = Math.min(safeGains.vga, targetVga);
      }
      onVgaGainChange(targetVga);
      const targetPower =
        safetyLimit === "min"
          ? -70.0
          : getApproxOutputPowerJS(targetVga, !!ampEnabled);
      onPowerDbmChange(targetPower);
    }
  };

  const handleVgaGainBlur = () => {
    const num = Number(localVgaGain);
    if (Number.isFinite(num) && localVgaGain !== "" && localVgaGain !== "-") {
      let targetVga = num;
      if (safetyEnabled) {
        targetVga = Math.min(safeGains.vga, targetVga);
      }
      onVgaGainChange(targetVga);
      setLocalVgaGain(targetVga.toString());
      const targetPower =
        safetyLimit === "min"
          ? -70.0
          : getApproxOutputPowerJS(targetVga, !!ampEnabled);
      onPowerDbmChange(targetPower);
    } else {
      setLocalVgaGain(Number.isFinite(vgaGainDb) ? vgaGainDb.toString() : "0");
    }
  };

  const handleAmpToggle = (newAmp: boolean) => {
    if (onAmpEnabledChange) {
      onAmpEnabledChange(newAmp);
      const targetPower =
        safetyLimit === "min"
          ? -70.0
          : getApproxOutputPowerJS(vgaGainDb, newAmp);
      onPowerDbmChange(targetPower);
    }
  };

  const handleHopRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setLocalHopRate(val);
    const num = Number(val);
    if (Number.isFinite(num) && val !== "") {
      onHopRateHzChange(Math.max(1, Math.min(1000, num)));
    }
  };

  const handleHopRateBlur = () => {
    const num = Number(localHopRate);
    if (Number.isFinite(num) && localHopRate !== "") {
      const clamped = Math.max(1, Math.min(1000, num));
      onHopRateHzChange(clamped);
      setLocalHopRate(clamped.toString());
    } else {
      setLocalHopRate(hopRateHz.toString());
    }
  };

  const isAmpDisabledBySafety = safetyEnabled && !safeGains.amp;

  return (
    <Section>
      <Row label={<IconLabel icon={Radio} text="Signal" />}>
        <Select value={signal} onChange={(e) => onSignalChange(e.target.value)}>
          <option value="apt">APT</option>
          <option value="tone">Tone</option>
          <option value="noise">Noise</option>
          <option value="custom">Custom I/Q</option>
        </Select>
      </Row>

      <HopSectionContainer>
        <HopHeaderRow>
          <HopHeaderLabel>
            <GitFork size={14} />
            Hop
          </HopHeaderLabel>
          <Toggle
            $active={hopEnabled}
            onClick={() => onHopEnabledChange(!hopEnabled)}
            activeLabel="On"
            inactiveLabel="Off"
          />
        </HopHeaderRow>

        {hopEnabled && (
          <HopOptionsContainer>
            <HopFieldRow>
              <HopFieldLabel>Hop type</HopFieldLabel>
              <HopFieldControl>
                <Select
                  value={hopType}
                  onChange={(e) =>
                    onHopTypeChange(e.target.value as "range" | "channels")
                  }
                  style={{ width: "auto", minWidth: "120px" }}
                >
                  <option value="range">Range</option>
                  <option value="channels">Channels</option>
                </Select>
              </HopFieldControl>
            </HopFieldRow>

            {hopType === "range" ? (
              <>
                <HopFieldRow
                  style={{ display: "grid", gridTemplateColumns: "120px 1fr" }}
                >
                  <HopFieldLabel>Hop start</HopFieldLabel>
                  <HopFieldControl>
                    <FrequencyInput
                      valueHz={hopStartFrequencyHz}
                      onChangeHz={onHopStartFrequencyHzChange}
                      minHz={0}
                      maxHz={30_000_000_000}
                    />
                  </HopFieldControl>
                </HopFieldRow>
                <HopFieldRow
                  style={{ display: "grid", gridTemplateColumns: "120px 1fr" }}
                >
                  <HopFieldLabel>Hop end</HopFieldLabel>
                  <HopFieldControl>
                    <FrequencyInput
                      valueHz={hopEndFrequencyHz}
                      onChangeHz={onHopEndFrequencyHzChange}
                      minHz={0}
                      maxHz={30_000_000_000}
                    />
                  </HopFieldControl>
                </HopFieldRow>
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  width: "100%",
                }}
              >
                <HopFieldLabel
                  style={{ borderBottom: "none", paddingBottom: 0 }}
                >
                  Channels
                </HopFieldLabel>
                <ChannelsGrid
                  channels={channelsList}
                  selectedLabels={selectedLabels}
                  onChange={handleChannelsChange}
                />
              </div>
            )}

            <HopFieldRow>
              <HopFieldLabel>Hop rate</HopFieldLabel>
              <HopFieldControl>
                <InlineField>
                  <NumericInput
                    type="text"
                    value={localHopRate}
                    onChange={handleHopRateChange}
                    onBlur={handleHopRateBlur}
                  />
                  <UnitSuffix>Hz</UnitSuffix>
                </InlineField>
              </HopFieldControl>
            </HopFieldRow>
          </HopOptionsContainer>
        )}
      </HopSectionContainer>

      <Row label={<IconLabel icon={SlidersHorizontal} text="Sample rate" />}>
        <FrequencyInput
          valueHz={sampleRateHz}
          onChangeHz={onSampleRateChange}
          minHz={1}
          maxHz={maxSampleRateHz ?? 20_000_000}
          disabled={hopEnabled}
        />
      </Row>
      <Row label={<IconLabel icon={Waves} text="Center frequency" />}>
        <FrequencyInput
          valueHz={centerFrequencyHz}
          onChangeHz={onCenterFrequencyChange}
          minHz={0}
          maxHz={30_000_000_000}
          disabled={hopEnabled}
        />
      </Row>
      <Row label="Power">
        <InlineField>
          <NumericInput
            ref={powerInputRef}
            type="text"
            value={localPower}
            onChange={handlePowerChange}
            onBlur={handlePowerBlur}
          />
          <UnitSuffix>dBm</UnitSuffix>
        </InlineField>
      </Row>
      <Row label="VGA gain">
        <InlineField>
          <NumericInput
            ref={vgaGainInputRef}
            type="text"
            value={localVgaGain}
            onChange={handleVgaGainChange}
            onBlur={handleVgaGainBlur}
          />
          <UnitSuffix>dB</UnitSuffix>
        </InlineField>
      </Row>
      <Row label="TX Amp (Booster)">
        <Toggle
          $active={ampEnabled}
          onClick={() => handleAmpToggle(!ampEnabled)}
          activeLabel="On"
          inactiveLabel="Off"
          disabled={isAmpDisabledBySafety}
        />
      </Row>

      <Row label={<IconLabel icon={ShieldAlert} text="Safety" />}>
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
