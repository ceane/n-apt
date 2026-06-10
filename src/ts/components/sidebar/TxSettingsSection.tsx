import React from "react";
import styled from "styled-components";
import { Row } from "@n-apt/components/ui";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";
import { Toggle } from "@n-apt/components/ui/Toggle";
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

const ChannelContainer = styled.div`
  display: flex;
  gap: 6px;
`;

const ChannelButton = styled.button<{ $selected: boolean }>`
  background: ${(props) =>
    props.$selected ? props.theme.primary + "26" : "transparent"};
  border: 1px solid
    ${(props) =>
      props.$selected ? props.theme.primary : props.theme.borderHover};
  color: ${(props) =>
    props.$selected ? props.theme.primary : props.theme.textSecondary};
  border-radius: 4px;
  padding: 4px 10px;
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  &:hover {
    border-color: ${(props) => props.theme.primary};
  }
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
  safetyLimit: "person" | "room";
  onSafetyLimitChange: (value: "person" | "room") => void;
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
  hopType,
  onHopTypeChange,
  hopStartFrequencyHz,
  onHopStartFrequencyHzChange,
  hopEndFrequencyHz,
  onHopEndFrequencyHzChange,
  hopChannels,
  onHopChannelsChange,
  hopRateHz,
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

  // Enforce safety limits
  React.useEffect(() => {
    if (safetyEnabled) {
      const limitDbm = calculateRoomPowerLimitJS(
        centerFrequencyHz,
        safetyLimit === "person" ? 1.0 : 3.0,
      );
      const safeGains = getMaxSafeVgaAndAmpJS(limitDbm);

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
    safetyLimit,
    centerFrequencyHz,
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
        const limitDbm = calculateRoomPowerLimitJS(
          centerFrequencyHz,
          safetyLimit === "person" ? 1.0 : 3.0,
        );
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
        const limitDbm = calculateRoomPowerLimitJS(
          centerFrequencyHz,
          safetyLimit === "person" ? 1.0 : 3.0,
        );
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
        const limitDbm = calculateRoomPowerLimitJS(
          centerFrequencyHz,
          safetyLimit === "person" ? 1.0 : 3.0,
        );
        const safeGains = getMaxSafeVgaAndAmpJS(limitDbm);
        targetVga = Math.min(safeGains.vga, targetVga);
      }
      onVgaGainChange(targetVga);
      const targetPower = getApproxOutputPowerJS(targetVga, !!ampEnabled);
      onPowerDbmChange(targetPower);
    }
  };

  const handleVgaGainBlur = () => {
    const num = Number(localVgaGain);
    if (Number.isFinite(num) && localVgaGain !== "" && localVgaGain !== "-") {
      let targetVga = num;
      if (safetyEnabled) {
        const limitDbm = calculateRoomPowerLimitJS(
          centerFrequencyHz,
          safetyLimit === "person" ? 1.0 : 3.0,
        );
        const safeGains = getMaxSafeVgaAndAmpJS(limitDbm);
        targetVga = Math.min(safeGains.vga, targetVga);
      }
      onVgaGainChange(targetVga);
      setLocalVgaGain(targetVga.toString());
      const targetPower = getApproxOutputPowerJS(targetVga, !!ampEnabled);
      onPowerDbmChange(targetPower);
    } else {
      setLocalVgaGain(Number.isFinite(vgaGainDb) ? vgaGainDb.toString() : "0");
    }
  };

  const handleAmpToggle = (newAmp: boolean) => {
    if (onAmpEnabledChange) {
      onAmpEnabledChange(newAmp);
      const targetPower = getApproxOutputPowerJS(vgaGainDb, newAmp);
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

  const limitDbm = calculateRoomPowerLimitJS(
    centerFrequencyHz,
    safetyLimit === "person" ? 1.0 : 3.0,
  );
  const safeGains = getMaxSafeVgaAndAmpJS(limitDbm);
  const isAmpDisabledBySafety = safetyEnabled && !safeGains.amp;

  return (
    <Section>
      <Row label={<IconLabel icon={Radio} text="Signal" />}>
        <Select value={signal} onChange={(e) => onSignalChange(e.target.value)}>
          <option value="apt">APT</option>
          <option value="tone">Tone</option>
          <option value="noise">Noise</option>
          <option value="hop">Hop</option>
          <option value="custom">Custom I/Q</option>
        </Select>
      </Row>

      {signal === "hop" && (
        <>
          <Row label={<IconLabel icon={GitFork} text="Hop type" />}>
            <Select
              value={hopType}
              onChange={(e) =>
                onHopTypeChange(e.target.value as "range" | "channels")
              }
            >
              <option value="range">Range</option>
              <option value="channels">Channels</option>
            </Select>
          </Row>

          {hopType === "range" ? (
            <>
              <Row label="Hop start">
                <FrequencyInput
                  valueHz={hopStartFrequencyHz}
                  onChangeHz={onHopStartFrequencyHzChange}
                  minHz={0}
                  maxHz={30_000_000_000}
                />
              </Row>
              <Row label="Hop end">
                <FrequencyInput
                  valueHz={hopEndFrequencyHz}
                  onChangeHz={onHopEndFrequencyHzChange}
                  minHz={0}
                  maxHz={30_000_000_000}
                />
              </Row>
            </>
          ) : (
            <Row label="Channels">
              <ChannelContainer>
                {["a", "b", "c"].map((ch) => {
                  const isSelected = hopChannels.includes(ch);
                  const handleToggle = () => {
                    const nextChs = isSelected
                      ? hopChannels.filter((c) => c !== ch)
                      : [...hopChannels, ch];
                    onHopChannelsChange(nextChs);
                  };
                  return (
                    <ChannelButton
                      key={ch}
                      type="button"
                      $selected={isSelected}
                      onClick={handleToggle}
                    >
                      {ch.toUpperCase()}
                    </ChannelButton>
                  );
                })}
              </ChannelContainer>
            </Row>
          )}

          <Row label="Hop rate">
            <InlineField>
              <NumericInput
                type="text"
                value={localHopRate}
                onChange={handleHopRateChange}
                onBlur={handleHopRateBlur}
              />
              <UnitSuffix>Hz</UnitSuffix>
            </InlineField>
          </Row>
        </>
      )}

      <Row label={<IconLabel icon={SlidersHorizontal} text="Sample rate" />}>
        <FrequencyInput
          valueHz={sampleRateHz}
          onChangeHz={onSampleRateChange}
          minHz={1}
          maxHz={maxSampleRateHz ?? 20_000_000}
        />
      </Row>
      <Row label={<IconLabel icon={Waves} text="Center frequency" />}>
        <FrequencyInput
          valueHz={centerFrequencyHz}
          onChangeHz={onCenterFrequencyChange}
          minHz={0}
          maxHz={30_000_000_000}
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
          onClick={() => onSafetyEnabledChange(!safetyEnabled)}
          activeLabel="On"
          inactiveLabel="Off"
        />
      </Row>

      {safetyEnabled && (
        <Row label="Safety limit">
          <Select
            value={safetyLimit}
            onChange={(e) =>
              onSafetyLimitChange(e.target.value as "person" | "room")
            }
          >
            <option value="person">Person (1m reach)</option>
            <option value="room">Room (3m reach)</option>
          </Select>
        </Row>
      )}

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
