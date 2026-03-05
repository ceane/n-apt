import React from "react";
import styled from "styled-components";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
`;

import { Row } from "@n-apt/components/ui";

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

const NarrowSettingInput = styled(SettingInput)`
  width: 60px;
`;

const InputGroup = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 4px;
`;

const UnitLabel = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
`;

interface SourceSettingsSectionProps {
  sourceMode: "live" | "file";
  ppm: number;
  gain: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  stitchSourceSettings: { gain: number; ppm: number };
  isConnected: boolean;
  maxGain?: number;
  onPpmChange: (value: number) => void;
  onGainChange: (value: number) => void;
  onTunerAGCChange: (value: boolean) => void;
  onRtlAGCChange: (value: boolean) => void;
  onStitchSourceSettingsChange: (settings: {
    gain: number;
    ppm: number;
  }) => void;
  onAgcModeChange: (tunerAGC: boolean, rtlAGC: boolean) => void;
}

export const SourceSettingsSection: React.FC<SourceSettingsSectionProps> = ({
  sourceMode,
  ppm,
  gain,
  tunerAGC,
  rtlAGC,
  stitchSourceSettings,
  isConnected,
  maxGain = 49.6,
  onPpmChange,
  onGainChange,
  onTunerAGCChange,
  onRtlAGCChange,
  onStitchSourceSettingsChange,
  onAgcModeChange,
}) => {
  const clampGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(maxGain, val));
  };

  const handlePpmChange = (raw: string) => {
    const val = raw === "" ? 0 : parseInt(raw, 10) || 0;
    if (sourceMode === "file") {
      onStitchSourceSettingsChange({ ...stitchSourceSettings, ppm: val });
    } else {
      onPpmChange(val);
    }
  };

  const handlePpmKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.key === "ArrowUp" ? 1 : -1;
    if (sourceMode === "file") {
      onStitchSourceSettingsChange({
        ...stitchSourceSettings,
        ppm: (stitchSourceSettings.ppm || 0) + delta,
      });
    } else {
      const next = (ppm || 0) + delta;
      onPpmChange(next);
    }
  };

  const handleGainChange = (raw: number) => {
    if (sourceMode === "file") {
      onStitchSourceSettingsChange({ ...stitchSourceSettings, gain: raw || 0 });
    } else {
      const val = clampGain(Number.isFinite(raw) ? raw : 0);
      onGainChange(val);
    }
  };

  const handleGainKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.key === "ArrowUp" ? 1 : -1;
    if (sourceMode === "file") {
      onStitchSourceSettingsChange({
        ...stitchSourceSettings,
        gain: (stitchSourceSettings.gain || 0) + delta,
      });
    } else {
      const next = clampGain((gain || 0) + delta);
      onGainChange(next);
    }
  };

  const handleTunerAGCChange = (enabled: boolean) => {
    onTunerAGCChange(enabled);
    if (enabled) {
      onRtlAGCChange(false);
      onAgcModeChange(true, false);
    } else {
      onAgcModeChange(false, rtlAGC);
    }
  };

  const handleRtlAGCChange = (enabled: boolean) => {
    onRtlAGCChange(enabled);
    if (enabled) {
      onTunerAGCChange(false);
      onAgcModeChange(false, true);
    } else {
      onAgcModeChange(tunerAGC, false);
    }
  };

  return (
    <Section>
      <SectionTitle>Source Settings</SectionTitle>
      <Row label="PPM" tooltipTitle="PPM Correction" tooltip="Frequency alignment. Parts per million correction for precise tuning to signal frequencies.">
        <NarrowSettingInput
          type="number"
          value={sourceMode === "file" ? stitchSourceSettings.ppm : ppm}
          onChange={(e) => handlePpmChange(e.target.value)}
          onKeyDown={handlePpmKeyDown}
          step="1"
        />
      </Row>
      <Row label="Gain" tooltipTitle="Gain Setting" tooltip="Signal amplification. Increases sensitivity to weak transmissions but may introduce interference from other signals.">
        <InputGroup>
          <NarrowSettingInput
            type="number"
            step="1"
            value={sourceMode === "file" ? stitchSourceSettings.gain : gain}
            onChange={(e) =>
              handleGainChange(Math.round(Number(e.target.value)))
            }
            onKeyDown={handleGainKeyDown}
            min="0"
            max={sourceMode === "file" ? undefined : maxGain.toString()}
          />
          <UnitLabel>dB</UnitLabel>
        </InputGroup>
      </Row>
      {sourceMode === "live" && (
        <>
          <Row label="Tuner AGC" tooltipTitle="Tuner AGC" tooltip="Tuner Automatic Gain Control. Automatically adjusts the tuner gain for optimal signal reception. Works alongside manual gain setting. Only one AGC mode can be active at a time.">
            <ToggleSwitch $disabled={!isConnected}>
              <ToggleSwitchInput
                type="checkbox"
                checked={tunerAGC}
                onChange={(e) => handleTunerAGCChange(e.target.checked)}
                disabled={!isConnected}
              />
              <ToggleSwitchSlider $disabled={!isConnected} />
            </ToggleSwitch>
          </Row>
          <Row label="RTL AGC" tooltipTitle="RTL AGC" tooltip="RTL Automatic Gain Control. Automatically adjusts the RTL2832 gain for optimal signal reception. Works alongside manual gain setting. Only one AGC mode can be active at a time.">
            <ToggleSwitch $disabled={!isConnected}>
              <ToggleSwitchInput
                type="checkbox"
                checked={rtlAGC}
                onChange={(e) => handleRtlAGCChange(e.target.checked)}
                disabled={!isConnected}
              />
              <ToggleSwitchSlider $disabled={!isConnected} />
            </ToggleSwitch>
          </Row>
        </>
      )}
    </Section>
  );
};
