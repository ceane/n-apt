import React from "react";
import styled from "styled-components";
import { Row } from "@n-apt/ui";
import { FrequencyInput } from "@n-apt/ui/FrequencyInput";
import { Tooltip } from "@n-apt/ui/Tooltip";
import {
  ArrowBigUp,
  Pipette,
  SlidersVertical,
  TriangleAlert,
} from "lucide-react";
import {
  SectionGrid as Section,
  CheckboxSwitch as ToggleSwitch,
  CheckboxSwitchInput as ToggleSwitchInput,
  CheckboxSwitchSlider as ToggleSwitchSlider,
  IconLabel,
} from "@n-apt/ui/SidebarPrimitives";

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

const NarrowSettingInput = styled(SettingInput)`
  width: 60px;
`;

const CompactFrequencyInput = styled(FrequencyInput)`
  width: 95px;
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

const GainWarningIcon = styled(TriangleAlert)`
  width: 13px !important;
  height: 13px !important;
  color: #f59e0b !important;
  opacity: 1 !important;
  flex-shrink: 0;
`;

const GAIN_WARNING_CONTENT =
  "Warning: Excessive gain will amplify out-of-band noise, cause ADC clipping, " +
  "and generate false signals (aliasing)." +
  "<br/><br/>" +
  "It is recommended to keep the gain beneath 30\u202fdB for signals under 10\u202fMHz." +
  "<br/><br/>" +
  "<strong>LNA</strong> \u2014 Max gain 40\u202fdB<br/>" +
  "<strong>VGA</strong> \u2014 Max gain 62\u202fdB<br/>" +
  "<strong>AMP</strong> \u2014 Gain 11\u202fdB";

const GainWarning: React.FC = () => (
  <Tooltip
    title="Gain Warning"
    content={GAIN_WARNING_CONTENT}
    trigger={<GainWarningIcon />}
  />
);

const BasebandWarningIcon = styled(TriangleAlert)`
  width: 13px !important;
  height: 13px !important;
  color: #f59e0b !important;
  opacity: 1 !important;
  flex-shrink: 0;
`;

const BASEBAND_WARNING_CONTENT =
  "When the Baseband Filter is narrower than the sample rate, the usable " +
  "spectrum appears 'scrunched' into a center mound.<br/><br/>" +
  "This happens because the hardware filter physically turns down the power " +
  "(amplitude) of frequencies at the edges of the display, leaving only the " +
  "center at full strength";

const BasebandWarning: React.FC = () => (
  <Tooltip
    title="Baseband Filter Warning"
    content={BASEBAND_WARNING_CONTENT}
    trigger={<BasebandWarningIcon />}
  />
);

export interface GainLimits {
  min?: number | null;
  max?: number | null;
  step?: number | null;
  lna_min?: number | null;
  lna_max?: number | null;
  lna_step?: number | null;
  vga_min?: number | null;
  vga_max?: number | null;
  vga_step?: number | null;
}

interface SourceSettingsSectionProps {
  sourceMode: "live" | "file";
  deviceType?: string;
  disabled?: boolean;
  ppm: number;
  gain: number;
  hackrfLnaGain?: number;
  hackrfVgaGain?: number;
  hackrfAmpEnabled?: boolean;
  hackrfBasebandBandwidth?: number | null;
  hackrfCurrentSampleRate?: number;
  /** Source capability flag: the device exposes a hardware baseband filter. */
  supportsBasebandFilter?: boolean;
  /** True once the user pinned a custom baseband-filter value. */
  basebandFilterPinned?: boolean;
  onBasebandFilterPinnedChange?: (pinned: boolean) => void;
  tunerAGC: boolean;
  rtlAGC: boolean;
  stitchSourceSettings: { gain: number; ppm: number };
  isConnected: boolean;
  disableAgcControls?: boolean;
  maxGain?: number;
  gainLimits?: GainLimits;
  /** Minimum frequency of the current spectrum view in Hz, used for gain warnings */
  frequencyRangeMin?: number;
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
  disabled = false,
  ppm,
  gain,
  hackrfLnaGain = 0.0,
  hackrfVgaGain = 30,
  hackrfAmpEnabled = false,
  hackrfBasebandBandwidth,
  hackrfCurrentSampleRate = 0,
  supportsBasebandFilter = false,
  basebandFilterPinned = false,
  onBasebandFilterPinnedChange,
  tunerAGC,
  rtlAGC,
  stitchSourceSettings,
  isConnected,
  disableAgcControls = false,
  maxGain = 46.9,
  gainLimits,
  frequencyRangeMin,
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
  /** True when the source declares a hardware analog baseband filter. */
  const hasBasebandFilter =
    sourceMode === "live" && (supportsBasebandFilter || isHackrfLive);

  // Silently keep the hardware baseband filter in step with the active sample
  // rate unless the user has pinned a custom value. The pin clears when the
  // field is emptied (0) and blurred, resuming automatic tracking.
  React.useEffect(() => {
    if (!hasBasebandFilter || basebandFilterPinned) return;
    const nextBandwidth = Math.round(hackrfCurrentSampleRate || 0);
    if (
      nextBandwidth > 0 &&
      onHackrfBasebandBandwidthChange &&
      hackrfBasebandBandwidth !== nextBandwidth
    ) {
      onHackrfBasebandBandwidthChange(nextBandwidth);
    }
  }, [
    hasBasebandFilter,
    basebandFilterPinned,
    hackrfCurrentSampleRate,
    hackrfBasebandBandwidth,
    onHackrfBasebandBandwidthChange,
  ]);
  /** True when the spectrum view includes sub-10 MHz frequencies */
  const isLowFrequency =
    typeof frequencyRangeMin === "number" && frequencyRangeMin < 10_000_000;

  // Combined gain: each non-zero source contributes; AMP = 11 dB fixed
  const lnaContrib = hackrfLnaGain > 0 ? hackrfLnaGain : 0;
  const vgaContrib = hackrfVgaGain > 0 ? hackrfVgaGain : 0;
  const ampContrib = hackrfAmpEnabled ? 11 : 0;
  const totalGainDb = lnaContrib + vgaContrib + ampContrib;
  const gainOverLimit = isHackrfLive && isLowFrequency && totalGainDb > 30;
  /** Show warning on LNA row if LNA is a non-zero contributor to the over-limit total */
  const showLnaWarning = gainOverLimit && lnaContrib > 0;
  /** Show warning on VGA row if VGA is a non-zero contributor */
  const showVgaWarning = gainOverLimit && vgaContrib > 0;
  /** Show warning on AMP row if AMP is enabled and contributing */
  const showAmpWarning = gainOverLimit && hackrfAmpEnabled;
  const isRtlSdrLive =
    sourceMode === "live" &&
    (deviceType === "rtl-sdr" || deviceType === "rtl_sdr");
  const basebandBandwidthVal = hackrfBasebandBandwidth ?? 0;
  const isHackrfBasebandEnabled = basebandBandwidthVal > 0;
  const autoBasebandBandwidth = Math.max(
    0,
    Math.round(hackrfCurrentSampleRate || 0),
  );
  // While the filter is enabled and not pinned, the sample rate is the value —
  // derive it instead of trusting the published prop. Publishing the same rate
  // again does not change the prop, so the field would otherwise keep whatever
  // the user last typed (e.g. a cleared "0").
  const displayedBasebandBandwidth =
    isHackrfBasebandEnabled && !basebandFilterPinned
      ? autoBasebandBandwidth
      : basebandBandwidthVal;
  // Remount the input on blur so an in-progress edit that resolves back to the
  // automatic value (cleared to zero) repopulates instead of sticking at 0.
  const [basebandInputRevision, setBasebandInputRevision] = React.useState(0);
  const showBasebandWarning =
    isHackrfLive &&
    isHackrfBasebandEnabled &&
    hackrfCurrentSampleRate > 0 &&
    basebandBandwidthVal < hackrfCurrentSampleRate;

  const clampGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    const minVal = gainLimits?.min ?? 0;
    const maxVal = gainLimits?.max ?? maxGain;
    return Math.max(minVal, Math.min(maxVal, val));
  };

  const clampHackrfLnaGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    const minVal = gainLimits?.lna_min ?? 0.0;
    const maxVal = gainLimits?.lna_max ?? 40.0;
    return Math.max(minVal, Math.min(maxVal, val));
  };

  const clampHackrfVgaGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    const minVal = gainLimits?.vga_min ?? 0.0;
    const maxVal = gainLimits?.vga_max ?? 62.0;
    return Math.max(minVal, Math.min(maxVal, val));
  };

  const handlePpmChange = (raw: string) => {
    const val = raw === "" ? 0 : Math.max(0, parseInt(raw, 10) || 0);
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
        ppm: Math.max(0, (stitchSourceSettings.ppm || 0) + delta),
      });
    } else {
      const next = Math.max(0, (ppm || 0) + delta);
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
    const stepVal = gainLimits?.step ?? 1.0;
    const delta = e.key === "ArrowUp" ? stepVal : -stepVal;
    if (sourceMode === "file") {
      const next = (stitchSourceSettings.gain || 0) + delta;
      const rounded =
        stepVal === 0.1
          ? Math.round(next * 10) / 10
          : Math.round(next / stepVal) * stepVal;
      onStitchSourceSettingsChange({
        ...stitchSourceSettings,
        gain: rounded,
      });
    } else {
      const next = (gain || 0) + delta;
      const rounded =
        stepVal === 0.1
          ? Math.round(next * 10) / 10
          : Math.round(next / stepVal) * stepVal;
      onGainChange(clampGain(rounded));
    }
  };

  const handleHackrfLnaChange = (raw: string) => {
    const val = raw === "" ? 0 : Number(raw);
    const stepVal = gainLimits?.lna_step ?? 8.0;
    const rounded = Math.round(val / stepVal) * stepVal;
    onHackrfLnaGainChange?.(clampHackrfLnaGain(rounded));
  };

  const handleHackrfLnaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const stepVal = gainLimits?.lna_step ?? 8.0;
    const delta = e.key === "ArrowUp" ? stepVal : -stepVal;
    const next = (hackrfLnaGain || 0) + delta;
    const rounded = Math.round(next / stepVal) * stepVal;
    onHackrfLnaGainChange?.(clampHackrfLnaGain(rounded));
  };

  const handleHackrfVgaChange = (raw: string) => {
    const val = raw === "" ? 0 : Number(raw);
    const stepVal = gainLimits?.vga_step ?? 2.0;
    const rounded = Math.round(val / stepVal) * stepVal;
    onHackrfVgaGainChange?.(clampHackrfVgaGain(rounded));
  };

  const handleHackrfVgaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const stepVal = gainLimits?.vga_step ?? 2.0;
    const delta = e.key === "ArrowUp" ? stepVal : -stepVal;
    const next = (hackrfVgaGain || 0) + delta;
    const rounded = Math.round(next / stepVal) * stepVal;
    onHackrfVgaGainChange?.(clampHackrfVgaGain(rounded));
  };

  const handleHackrfAmpChange = (enabled: boolean) => {
    onHackrfAmpEnabledChange?.(enabled);
  };

  const handleHackrfBasebandToggle = (enabled: boolean) => {
    if (!onHackrfBasebandBandwidthChange) return;

    if (enabled) {
      // Switching it back on resumes automatic tracking from the current rate.
      onBasebandFilterPinnedChange?.(false);
      onHackrfBasebandBandwidthChange(
        Math.max(0, Math.round(hackrfCurrentSampleRate || 0)),
      );
      return;
    }

    // Switching it off must HOLD the disabled state: pin it, otherwise the
    // auto-tracking effect sees `0 !== sampleRate` and immediately switches the
    // filter back on, which made the toggle look dead. Zero is only the UI
    // sentinel here — the settings hook never publishes it to the device.
    onBasebandFilterPinnedChange?.(true);
    onHackrfBasebandBandwidthChange(0);
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
    <Section
      style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}
    >
      <SectionTitle>
        <SlidersVertical size={14} />
        <SectionText>Source Settings</SectionText>
      </SectionTitle>
      <Row
        label={<IconLabel $inheritLineHeight icon={Pipette} text="PPM" />}
        tooltipTitle="PPM Correction"
        tooltip="Frequency alignment. Parts per million correction for precise tuning to signal frequencies."
      >
        <NarrowSettingInput
          type="number"
          value={sourceMode === "file" ? stitchSourceSettings.ppm : ppm}
          onChange={(e) => handlePpmChange(e.target.value)}
          onKeyDown={handlePpmKeyDown}
          step="1"
          min="0"
        />
      </Row>
      {!isHackrfLive && (
        <Row
          label={<IconLabel $inheritLineHeight icon={ArrowBigUp} text="Gain" />}
          tooltipTitle="Gain Setting"
          tooltip="Signal amplification. Increases sensitivity to weak transmissions but may introduce interference from other signals."
        >
          <InputGroup>
            <NarrowSettingInput
              type="number"
              step={(gainLimits?.step ?? 1.0).toString()}
              value={
                sourceMode === "file"
                  ? stitchSourceSettings.gain
                  : gainLimits?.step === 0.1
                    ? Number((gain ?? 0).toFixed(1))
                    : (gain ?? 0)
              }
              onChange={(e) => {
                const stepVal = gainLimits?.step ?? 1.0;
                const val = Number(e.target.value);
                const rounded = Math.round(val / stepVal) * stepVal;
                const finalVal =
                  stepVal === 0.1 ? Math.round(rounded * 10) / 10 : rounded;
                handleGainChange(finalVal);
              }}
              onKeyDown={handleGainKeyDown}
              min={(gainLimits?.min ?? 0.0).toString()}
              max={
                sourceMode === "file"
                  ? undefined
                  : (gainLimits?.max ?? maxGain).toString()
              }
            />
            <UnitLabel>dB</UnitLabel>
          </InputGroup>
        </Row>
      )}
      {isHackrfLive && (
        <>
          <Row
            label={
              <>
                <IconLabel $inheritLineHeight icon={ArrowBigUp} text="LNA gain" />
                {showLnaWarning && <GainWarning />}
              </>
            }
            tooltipTitle="HackRF LNA Gain"
            tooltip={
              "Low-Noise Amplifier (LNA) gain stage.<br/><br/>" +
              "This is the intermediate-frequency (IF) amplifier located in the MAX2837 transceiver chip, after the mixer.<br/><br/>" +
              "<strong>Effect on signal:</strong><br/>" +
              "• Primary stage for boosting weak signals without adding significant noise.<br/>" +
              "• Controls mixer input level to prevent early clipping/intermodulation.<br/>" +
              `• Adjustable in <strong>${gainLimits?.lna_step ?? 8} dB steps</strong> (0 to ${gainLimits?.lna_max ?? 40} dB).`
            }
          >
            <InputGroup>
              <NarrowSettingInput
                type="number"
                step={(gainLimits?.lna_step ?? 8.0).toString()}
                value={hackrfLnaGain}
                onChange={(e) => handleHackrfLnaChange(e.target.value)}
                onKeyDown={handleHackrfLnaKeyDown}
                min={(gainLimits?.lna_min ?? 0.0).toString()}
                max={(gainLimits?.lna_max ?? 40.0).toString()}
              />
              <UnitLabel>dB</UnitLabel>
            </InputGroup>
          </Row>
          <Row
            label={
              <>
                <IconLabel $inheritLineHeight icon={ArrowBigUp} text="VGA gain" />
                {showVgaWarning && <GainWarning />}
              </>
            }
            tooltipTitle="HackRF VGA Gain"
            tooltip={
              "Variable-Gain Amplifier (VGA) gain stage.<br/><br/>" +
              "This is the baseband amplifier located after the low-pass filter and directly before the Analog-to-Digital Converter (ADC).<br/><br/>" +
              "<strong>Effect on signal:</strong><br/>" +
              "• Scales the analog baseband signal to fully utilize the ADC's dynamic range.<br/>" +
              "• Too low: signal is weak and buried in ADC quantization noise.<br/>" +
              "• Too high: causes ADC clipping/saturation, resulting in ghost signals (aliasing).<br/>" +
              `• Adjustable in <strong>${gainLimits?.vga_step ?? 2} dB steps</strong> (0 to ${gainLimits?.vga_max ?? 62} dB).`
            }
          >
            <InputGroup>
              <NarrowSettingInput
                type="number"
                step={(gainLimits?.vga_step ?? 2.0).toString()}
                value={hackrfVgaGain}
                onChange={(e) => handleHackrfVgaChange(e.target.value)}
                onKeyDown={handleHackrfVgaKeyDown}
                min={(gainLimits?.vga_min ?? 0.0).toString()}
                max={(gainLimits?.vga_max ?? 62.0).toString()}
              />
              <UnitLabel>dB</UnitLabel>
            </InputGroup>
          </Row>
          <Row
            label={
              <>
                AMP enabled
                {showAmpWarning && <GainWarning />}
              </>
            }
            tooltipTitle="HackRF RF Amplifier"
            tooltip={
              "RF Frontend Amplifier (AMP) toggle.<br/><br/>" +
              "This controls the bypassable MGA-86563 amplifier at the very front of the RX signal path, directly after the antenna input.<br/><br/>" +
              "<strong>Effect on signal:</strong><br/>" +
              "• Adds a <strong>fixed 11 dB gain</strong> (up to 14 dB depending on RF frequency) to the input signal.<br/>" +
              "• Helps capture extremely weak, distant transmissions.<br/>" +
              "• <strong>Caution:</strong> Easily overloaded by strong nearby signals, which will saturate the mixer and introduce unwanted intermodulation distortion/ghost signals."
            }
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
        </>
      )}
      {hasBasebandFilter && (
        <Row
          label={
            <>
              Baseband filter
              {showBasebandWarning && <BasebandWarning />}
            </>
          }
          tooltipTitle="HackRF Baseband Filter"
          tooltip={
            "Analog Low-Pass Baseband Filter.<br/><br/>" +
            "Controls the internal hardware low-pass filter (LPF) of the MAX2837 transceiver before the signal is digitized.<br/><br/>" +
            "<strong>Effect on signal:</strong><br/>" +
            "• Limits the frequency spectrum width reaching the ADC, filtering out out-of-band signals.<br/>" +
            "• Prevents strong out-of-band noise or signals from aliasing into your view or saturating the receiver.<br/>" +
            "• <strong>Note:</strong> By default it automatically scales with the active sample rate. Once you type a custom value it stays fixed until you clear it; clearing the field and leaving it resumes automatic tracking."
          }
        >
          <InputGroup>
            <ToggleSwitch $disabled={!isConnected}>
              <ToggleSwitchInput
                type="checkbox"
                checked={isHackrfBasebandEnabled}
                onChange={(e) => handleHackrfBasebandToggle(e.target.checked)}
                disabled={!isConnected}
              />
              <ToggleSwitchSlider $disabled={!isConnected} />
            </ToggleSwitch>
            {isHackrfBasebandEnabled && (
              <CompactFrequencyInput
                key={basebandInputRevision}
                valueHz={displayedBasebandBandwidth}
                onChangeHz={(val) => {
                  // Typing a custom value pins the filter. Clearing the field to
                  // zero resumes automatic tracking: unpinning lets the derived
                  // sample-rate value take over (and repopulate on blur). Zero is
                  // never published — it is not a valid MAX2837 width and asking
                  // the hardware for it tears the stream down.
                  if (val === 0) {
                    onBasebandFilterPinnedChange?.(false);
                    return;
                  }
                  onBasebandFilterPinnedChange?.(true);
                  onHackrfBasebandBandwidthChange?.(val);
                }}
                onBlur={(draftHz) => {
                  // An emptied — or zeroed — field means "resume automatic
                  // tracking". An empty field emits no change event at all, so
                  // the pin has to be released here; the remount below then
                  // shows the current sample rate instead of the previous value.
                  if (draftHz === null || draftHz === 0) {
                    onBasebandFilterPinnedChange?.(false);
                  }
                  setBasebandInputRevision((n) => n + 1);
                }}
                disabled={!isConnected}
                minHz={0}
                maxHz={20000000}
              />
            )}
          </InputGroup>
        </Row>
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
