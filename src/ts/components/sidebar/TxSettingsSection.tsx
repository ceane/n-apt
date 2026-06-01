import React from "react";
import styled from "styled-components";
import { Row } from "@n-apt/components/ui";
import { FrequencyInput } from "@n-apt/components/ui/FrequencyInput";
import { Radio, SlidersHorizontal, Waves } from "lucide-react";

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

export interface TxSettingsSectionProps {
  signal: string;
  sampleRateHz: number;
  maxSampleRateHz?: number | null;
  centerFrequencyHz: number;
  powerDbm: number;
  vgaGainDb: number;
  onSignalChange: (value: string) => void;
  onSampleRateChange: (value: number) => void;
  onCenterFrequencyChange: (value: number) => void;
  onPowerDbmChange: (value: number) => void;
  onVgaGainChange: (value: number) => void;
}

export const TxSettingsSection: React.FC<TxSettingsSectionProps> = ({
  signal,
  sampleRateHz,
  maxSampleRateHz = 20_000_000,
  centerFrequencyHz,
  powerDbm,
  vgaGainDb,
  onSignalChange,
  onSampleRateChange,
  onCenterFrequencyChange,
  onPowerDbmChange,
  onVgaGainChange,
}) => {
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
            type="number"
            value={powerDbm}
            onChange={(e) => onPowerDbmChange(Number(e.target.value))}
          />
          <UnitSuffix>dBm</UnitSuffix>
        </InlineField>
      </Row>
      <Row label="VGA gain">
        <InlineField>
          <NumericInput
            type="number"
            value={vgaGainDb}
            onChange={(e) => onVgaGainChange(Number(e.target.value))}
          />
          <UnitSuffix>dB</UnitSuffix>
        </InlineField>
      </Row>
    </Section>
  );
};

export default TxSettingsSection;
