import React from "react";
import styled from "styled-components";
import { Row } from "@n-apt/components/ui";
import {
  ArrowBigUp,
  Pipette,
  SlidersVertical,
  type LucideIcon,
} from "lucide-react";

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
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SectionText = styled.span`
  display: flex;
  align-items: center;
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
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
`;

const LabelWithIcon = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 10px;

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

interface SourceSettingsSectionProps {
  sourceMode: "live" | "file";
  deviceType?: string;
  ppm: number;
  gain: number;
  hackrfLnaGain?: number;
  hackrfVgaGain?: number;
  hackrfAmpEnabled?: boolean;
  hackrfBasebandBandwidth?: number;
  hackrfCurrentSampleRate?: number;
  tunerAGC: boolean;
  rtlAGC: boolean;
  stitchSourceSettings: { gain: number; ppm: number };
  isConnected: boolean;
  disableAgcControls?: boolean;
  maxGain?: number;
  onPpmChange: (value: number) => void;
  onGainChange: (value: number) => void;
  onHackrfLnaGainChange?: (value: number) => void;
  onHackrfVgaGainChange?: (value: number) => void;
  onHackrfAmpEnabledChange?: (value: boolean) => void;
  onHackrfBasebandBandwidthChange?: (value: number) => void;
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
  deviceType,
  ppm,
  gain,
  hackrfLnaGain = 49.6,
  hackrfVgaGain = 62,
  hackrfAmpEnabled = false,
  hackrfBasebandBandwidth = 0,
  hackrfCurrentSampleRate = 0,
  tunerAGC,
  rtlAGC,
  stitchSourceSettings,
  isConnected,
  disableAgcControls = false,
  maxGain = 49.6,
  onPpmChange,
  onGainChange,
  onHackrfLnaGainChange,
  onHackrfVgaGainChange,
  onHackrfAmpEnabledChange,
  onHackrfBasebandBandwidthChange,
  onTunerAGCChange,
  onRtlAGCChange,
  onStitchSourceSettingsChange,
  onAgcModeChange,
}) => {
  const isHackrfLive = sourceMode === "live" && deviceType === "hackrf_one";
  const isRtlSdrLive =
    sourceMode === "live" &&
    (deviceType === "rtl-sdr" || deviceType === "rtl_sdr");
  const isHackrfBasebandEnabled = hackrfBasebandBandwidth > 0;

  const clampGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(maxGain, val));
  };

  const clampHackrfLnaGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(49.6, val));
  };

  const clampHackrfVgaGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(62, val));
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

  const handleHackrfLnaChange = (raw: string) => {
    const val = raw === "" ? 0 : Number(raw);
    onHackrfLnaGainChange?.(clampHackrfLnaGain(val));
  };

  const handleHackrfLnaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.key === "ArrowUp" ? 0.1 : -0.1;
    onHackrfLnaGainChange?.(clampHackrfLnaGain((hackrfLnaGain || 0) + delta));
  };

  const handleHackrfVgaChange = (raw: string) => {
    const val = raw === "" ? 0 : Number(raw);
    onHackrfVgaGainChange?.(clampHackrfVgaGain(val));
  };

  const handleHackrfVgaKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.key === "ArrowUp" ? 1 : -1;
    onHackrfVgaGainChange?.(clampHackrfVgaGain((hackrfVgaGain || 0) + delta));
  };

  const handleHackrfAmpChange = (enabled: boolean) => {
    onHackrfAmpEnabledChange?.(enabled);
  };

  const handleHackrfBasebandBandwidthChange = (raw: string) => {
    const val = raw === "" ? 0 : Number(raw);
    onHackrfBasebandBandwidthChange?.(
      Math.max(0, Number.isFinite(val) ? Math.round(val) : 0),
    );
  };

  const handleHackrfBasebandToggle = (enabled: boolean) => {
    if (!onHackrfBasebandBandwidthChange) return;
    onHackrfBasebandBandwidthChange(
      enabled ? Math.max(0, Math.round(hackrfCurrentSampleRate || 0)) : 0,
    );
  };

  const handleTunerAGCChange = (enabled: boolean) => {
    if (disableAgcControls) return;
    onTunerAGCChange(enabled);
    if (enabled) {
      onRtlAGCChange(false);
      onAgcModeChange(true, false);
    } else {
      onAgcModeChange(false, rtlAGC);
    }
  };

  const handleRtlAGCChange = (enabled: boolean) => {
    if (disableAgcControls) return;
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
      <SectionTitle>
        <SlidersVertical size={14} />
        <SectionText>Source Settings</SectionText>
      </SectionTitle>
      <Row
        label={<IconLabel icon={Pipette} text="PPM" />}
        tooltipTitle="PPM Correction"
        tooltip="Frequency alignment. Parts per million correction for precise tuning to signal frequencies."
      >
        <NarrowSettingInput
          type="number"
          value={sourceMode === "file" ? stitchSourceSettings.ppm : ppm}
          onChange={(e) => handlePpmChange(e.target.value)}
          onKeyDown={handlePpmKeyDown}
          step="1"
        />
      </Row>
      {!isHackrfLive && (
        <Row
          label={<IconLabel icon={ArrowBigUp} text="Gain" />}
          tooltipTitle="Gain Setting"
          tooltip="Signal amplification. Increases sensitivity to weak transmissions but may introduce interference from other signals."
        >
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
      )}
      {isHackrfLive && (
        <>
          <Row
            label={<IconLabel icon={ArrowBigUp} text="LNA gain" />}
            tooltipTitle="HackRF LNA Gain"
            tooltip="HackRF One low-noise amplifier gain in dB."
          >
            <InputGroup>
              <NarrowSettingInput
                type="number"
                step="0.1"
                value={hackrfLnaGain}
                onChange={(e) => handleHackrfLnaChange(e.target.value)}
                onKeyDown={handleHackrfLnaKeyDown}
                min="0"
                max="49.6"
              />
              <UnitLabel>dB</UnitLabel>
            </InputGroup>
          </Row>
          <Row
            label={<IconLabel icon={ArrowBigUp} text="VGA gain" />}
            tooltipTitle="HackRF VGA Gain"
            tooltip="HackRF One variable gain amplifier gain in dB."
          >
            <InputGroup>
              <NarrowSettingInput
                type="number"
                step="1"
                value={hackrfVgaGain}
                onChange={(e) => handleHackrfVgaChange(e.target.value)}
                onKeyDown={handleHackrfVgaKeyDown}
                min="0"
                max="62"
              />
              <UnitLabel>dB</UnitLabel>
            </InputGroup>
          </Row>
          <Row
            label="AMP enabled"
            tooltipTitle="HackRF AMP"
            tooltip="HackRF One RF amplifier enable toggle."
          >
            <ToggleSwitch $disabled={!isConnected}>
              <ToggleSwitchInput
                type="checkbox"
                checked={hackrfAmpEnabled}
                onChange={(e) => handleHackrfAmpChange(e.target.checked)}
                disabled={!isConnected}
              />
              <ToggleSwitchSlider $disabled={!isConnected} />
            </ToggleSwitch>
          </Row>
          <Row
            label="Baseband filter"
            tooltipTitle="HackRF baseband filter bandwidth"
            tooltip="HackRF One baseband filter bandwidth. When enabled, it should follow the active sample rate for the current channel."
          >
            <InputGroup>
              <ToggleSwitch $disabled={!isConnected}>
                <ToggleSwitchInput
                  type="checkbox"
                  checked={isHackrfBasebandEnabled}
                  onChange={(e) =>
                    handleHackrfBasebandToggle(e.target.checked)
                  }
                  disabled={!isConnected}
                />
                <ToggleSwitchSlider $disabled={!isConnected} />
              </ToggleSwitch>
              {isHackrfBasebandEnabled && (
                <>
                  <NarrowSettingInput
                    type="number"
                    step="1"
                    value={hackrfBasebandBandwidth}
                    onChange={(e) =>
                      handleHackrfBasebandBandwidthChange(e.target.value)
                    }
                    min="0"
                    max="20000000"
                  />
                  <UnitLabel>Hz</UnitLabel>
                </>
              )}
            </InputGroup>
          </Row>
        </>
      )}
      {isRtlSdrLive && (
        <>
          <Row
            label="Tuner AGC"
            tooltipTitle="Tuner AGC"
            tooltip="Tuner Automatic Gain Control. Automatically adjusts the tuner gain for optimal signal reception. Works alongside manual gain setting. Only one AGC mode can be active at a time."
          >
            <ToggleSwitch $disabled={!isConnected || disableAgcControls}>
              <ToggleSwitchInput
                type="checkbox"
                checked={tunerAGC}
                onChange={(e) => handleTunerAGCChange(e.target.checked)}
                disabled={!isConnected || disableAgcControls}
              />
              <ToggleSwitchSlider
                $disabled={!isConnected || disableAgcControls}
              />
            </ToggleSwitch>
          </Row>
          <Row
            label="RTL AGC"
            tooltipTitle="RTL AGC"
            tooltip="RTL Automatic Gain Control. Automatically adjusts the RTL2832 gain for optimal signal reception. Works alongside manual gain setting. Only one AGC mode can be active at a time."
          >
            <ToggleSwitch $disabled={!isConnected || disableAgcControls}>
              <ToggleSwitchInput
                type="checkbox"
                checked={rtlAGC}
                onChange={(e) => handleRtlAGCChange(e.target.checked)}
                disabled={!isConnected || disableAgcControls}
              />
              <ToggleSwitchSlider
                $disabled={!isConnected || disableAgcControls}
              />
            </ToggleSwitch>
          </Row>
        </>
      )}
    </Section>
  );
};
