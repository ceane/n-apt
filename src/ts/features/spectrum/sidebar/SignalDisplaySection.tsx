import React from "react";
import styled from "styled-components";
import { Row } from "@n-apt/ui";
import { Toggle } from "@n-apt/ui/Toggle";
import {
  Blend,
  Columns3Cog,
  Frame,
  GalleryHorizontal,
  Gauge,
  Grip,
  CircleOff,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { DeviceProfile } from "@n-apt/consts/schemas/websocket";
import { formatFrequency } from "@n-apt/math/frequency";
import { getTemporalResolutionLabel } from "@n-apt/math/temporalResolution";
import type { TemporalResolution } from "@n-apt/math/temporalResolution";
import {
  clampFrameRateToLogicalMax,
  computeMaxFrameRate,
} from "@n-apt/math/signals";
import {
  isMockBackend,
  showsApproxDbmToggle,
} from "@n-apt/app/infrastructure/services/deviceCapabilities";

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
  width: 100%;
  max-width: 80px;
  text-align: right;
  box-sizing: border-box;
  max-width: 100%;

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

const WideSettingSelect = styled(SettingSelect)`
  min-width: 120px;
  width: 100%;
  text-align-last: right;
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

interface SignalDisplaySectionProps {
  variant?: "default" | "diagnostic";
  sourceMode: "live" | "file";
  maxSampleRate: number;
  minReceiveSampleRate?: number;
  sampleRate: number;
  sampleRateLabel?: string;
  sampleRateOptions: number[];
  sampleRateOptionsOverride?: number[];
  wholeChannelSampleRate?: number | null;
  isWholeChannelMode?: boolean;
  wholeChannelLabel?: string | null;
  fileCapturedRange: { min: number; max: number } | null;
  fftFrameRate: number;
  maxFrameRate: number;
  fftSize: number;
  fftSizeOptions: number[];
  fftWindow: string;
  temporalResolution: TemporalResolution;
  backend: string | null;
  deviceProfile?: DeviceProfile | null;
  powerScale: "dB" | "dBm";
  removeDcSpike?: boolean;
  displayMode?: "fft" | "iq";
  onFftFrameRateChange: (value: number) => void;
  onFftSizeChange: (value: number) => void;
  onSampleRateChange: (value: number, mode?: "whole" | "manual") => void;
  onFftWindowChange: (value: string) => void;
  onTemporalResolutionChange: (value: TemporalResolution) => void;
  onPowerScaleChange: (value: "dB" | "dBm") => void;
  onRemoveDcSpikeChange?: (value: boolean) => void;
  onDisplayModeChange?: (value: "fft" | "iq") => void;
  scheduleCoupledAdjustment: (
    trigger: "fftSize" | "frameRate",
    fftSize: number,
    frameRate: number,
  ) => void;
}

export const SignalDisplaySection: React.FC<SignalDisplaySectionProps> = ({
  variant = "default",
  sourceMode,
  maxSampleRate: _maxSampleRate,
  minReceiveSampleRate: _minReceiveSampleRate,
  sampleRate,
  sampleRateLabel = "Sample Rate",
  sampleRateOptions,
  sampleRateOptionsOverride,
  wholeChannelSampleRate = null,
  isWholeChannelMode,
  wholeChannelLabel = null,
  fftFrameRate,
  maxFrameRate,
  fftSize,
  fftSizeOptions,
  fftWindow,
  temporalResolution,
  backend,
  deviceProfile,
  powerScale,
  removeDcSpike = false,
  displayMode: _displayMode,
  onFftFrameRateChange,
  onFftSizeChange,
  onSampleRateChange,
  onFftWindowChange,
  onTemporalResolutionChange,
  onPowerScaleChange,
  onRemoveDcSpikeChange,
  onDisplayModeChange: _onDisplayModeChange,
  scheduleCoupledAdjustment,
}) => {
  const showsApproxDbmToggleVal = showsApproxDbmToggle({
    deviceProfile,
    backend,
  });
  const isMockSource =
    isMockBackend(backend) ||
    deviceProfile?.kind?.toLowerCase().includes("mock") === true;
  const isRtlSdrDevice =
    !isMockSource &&
    (deviceProfile?.kind === "rtl_sdr" ||
      backend === "rtl_sdr" ||
      backend === "rtl-sdr" ||
      backend === "rtlsdr");

  const manualFftOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          (fftSizeOptions.length ? fftSizeOptions : [fftSize]).filter(
            (size) => Number.isFinite(size) && size > 0,
          ),
        ),
      ).sort((a, b) => a - b),
    [fftSize, fftSizeOptions],
  );

  const logicalMaxFrameRate =
    Number.isFinite(sampleRate) && sampleRate > 0 && fftSize > 0
      ? computeMaxFrameRate(sampleRate, fftSize, maxFrameRate)
      : maxFrameRate;
  const wholeChannelValue = React.useMemo(() => {
    if (
      typeof wholeChannelSampleRate !== "number" ||
      !Number.isFinite(wholeChannelSampleRate) ||
      wholeChannelSampleRate <= 0
    ) {
      return null;
    }
    return Math.round(wholeChannelSampleRate);
  }, [wholeChannelSampleRate]);
  const showWholeChannelOption =
    !isRtlSdrDevice &&
    typeof wholeChannelValue === "number" &&
    Number.isFinite(wholeChannelValue) &&
    wholeChannelValue > 0;
  const sampleRateOptionList = React.useMemo(() => {
    const rates = new Set(sampleRateOptionsOverride ?? sampleRateOptions);
    return Array.from(rates).sort((a, b) => a - b);
  }, [sampleRateOptions, sampleRateOptionsOverride]);
  const isWholeChannelSelected =
    isWholeChannelMode !== undefined
      ? isWholeChannelMode
      : showWholeChannelOption && Math.round(sampleRate) === wholeChannelValue;
  const sampleRateSelectValue = isWholeChannelSelected
    ? "whole-channel"
    : String(sampleRate);
  const SampleRateSelect = showWholeChannelOption
    ? WideSettingSelect
    : SettingSelect;

  return (
    <Section>
      <SectionTitle>
        <Columns3Cog size={14} />
        <SectionText>Signal display</SectionText>
      </SectionTitle>
      {sourceMode === "live" && (
        <>
          {variant !== "diagnostic" && (
            <Row
              label={<IconLabel icon={Frame} text={sampleRateLabel} />}
              tooltipTitle={sampleRateLabel}
              tooltip={
                sampleRateLabel === "Sample Rate"
                  ? "Hardware receive sample rate. Higher rates capture more bandwidth and must stay above the device-specific receive floor."
                  : "FFT viewer sample rate. This controls the displayed frequency span and is independent of the generated Tx signal bandwidth."
              }
            >
              <SampleRateSelect
                value={sampleRateSelectValue}
                style={
                  showWholeChannelOption ? { minWidth: "170px" } : undefined
                }
                onChange={(e) => {
                  if (
                    e.target.value === "whole-channel" &&
                    wholeChannelValue !== null
                  ) {
                    onSampleRateChange(wholeChannelValue, "whole");
                    return;
                  }
                  onSampleRateChange(Number(e.target.value), "manual");
                }}
              >
                {showWholeChannelOption && (
                  <option key="whole-channel" value="whole-channel">
                    {wholeChannelLabel
                      ? `Whole Channel (${wholeChannelLabel})`
                      : `Whole Channel${wholeChannelValue !== null ? ` (${formatFrequency(wholeChannelValue, { precisionMHz: 3, trimTrailingZeros: true })})` : ""}`}
                  </option>
                )}
                {sampleRateOptionList.map((rate) => (
                  <option key={rate} value={rate}>
                    {formatFrequency(rate)}
                  </option>
                ))}
              </SampleRateSelect>
            </Row>
          )}
          <Row
            label={<IconLabel icon={Grip} text="FFT Size" />}
            tooltipTitle="FFT Size"
            tooltip="Frequency resolution. Larger sizes provide better detection of specific signal patterns in transmissions but reduce processing speed."
          >
            <SettingSelect
              value={fftSize}
              onChange={(e) => {
                const val = Number(e.target.value);
                onFftSizeChange(val);
                scheduleCoupledAdjustment("fftSize", val, fftFrameRate);
              }}
            >
              <>
                {manualFftOptions.map((size) => (
                  <option key={`manual-${size}`} value={size}>
                    {size}
                  </option>
                ))}
              </>
            </SettingSelect>
          </Row>
          {variant !== "diagnostic" && (
            <Row
              label={
                <IconLabel
                  icon={GalleryHorizontal}
                  text="Frame rate (logical)"
                />
              }
              tooltipTitle="Frame Rate"
              tooltip={`Signal processing speed. Higher rates provide more real-time analysis of transmissions. Current maximum theoretical rate: ${logicalMaxFrameRate} fps based on current FFT size and bandwidth capacity.`}
            >
              <InputGroup>
                <SettingInput
                  type="number"
                  value={fftFrameRate}
                  onChange={(e) => {
                    const val = clampFrameRateToLogicalMax(
                      Number(e.target.value),
                      logicalMaxFrameRate,
                    );
                    onFftFrameRateChange(val);
                    scheduleCoupledAdjustment("frameRate", fftSize, val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    e.stopPropagation();
                    const step = 1; // Always use 1-frame rate steps for precision
                    const delta = e.key === "ArrowUp" ? step : -step;
                    const next = clampFrameRateToLogicalMax(
                      (fftFrameRate || 0) + delta,
                      logicalMaxFrameRate,
                    );
                    onFftFrameRateChange(next);
                    scheduleCoupledAdjustment("frameRate", fftSize, next);
                  }}
                  min="1"
                  max={logicalMaxFrameRate}
                />
                <UnitLabel>fps</UnitLabel>
              </InputGroup>
            </Row>
          )}
          {variant !== "diagnostic" && (
            <Row
              label={<IconLabel icon={Blend} text="FFT Window" />}
              tooltipTitle="FFT Window"
              tooltip="Signal filtering. Different windows optimize for detecting specific types of patterns and interactions in transmissions."
            >
              <WideSettingSelect
                value={fftWindow}
                onChange={(e) => {
                  const val = e.target.value;
                  onFftWindowChange(val);
                }}
              >
                <option value="Rectangular">Rectangular</option>
                <option value="Nuttall">Nuttall</option>
                <option value="Hamming">Hamming</option>
                <option value="Hanning">Hanning</option>
                <option value="Blackman">Blackman</option>
              </WideSettingSelect>
            </Row>
          )}
        </>
      )}
      {variant !== "diagnostic" && (
        <Row
          label={<IconLabel icon={Gauge} text="Temporal Resolution" />}
          tooltipTitle="Display Temporal Resolution"
          tooltip="Signal visualization precision. Low blends signal patterns, medium shows averaged activity, and lossless displays exact signal interactions with sharp transitions, with the ability to see patterns (like dots) in the waterfall as the signal rises and falls sharply."
        >
          <WideSettingSelect
            value={temporalResolution}
            onChange={(e) => {
              onTemporalResolutionChange(
                e.target.value as TemporalResolution,
              );
            }}
          >
            <option value="slow">{getTemporalResolutionLabel("slow")}</option>
            <option value="reduced">
              {getTemporalResolutionLabel("reduced")}
            </option>
            <option value="lossless">
              {getTemporalResolutionLabel("lossless")}
            </option>
          </WideSettingSelect>
        </Row>
      )}
      {variant !== "diagnostic" && onRemoveDcSpikeChange ? (
        <Row
          label={<IconLabel icon={CircleOff} text="Remove DC Spike" />}
          tooltipTitle="Remove DC Spike"
          tooltip="Replace the centered DC bin with its adjacent noise-floor values before rendering and snapshot export."
        >
          <Toggle
            $active={removeDcSpike}
            aria-label="Remove DC Spike"
            title="Replace the centered DC bin before rendering and snapshot export"
            onClick={() => onRemoveDcSpikeChange(!removeDcSpike)}
          />
        </Row>
      ) : null}
      {/* Device-specific power scale toggle - enabled when approximate dBm is supported */}
      {(showsApproxDbmToggleVal || sourceMode === "file") &&
        variant !== "diagnostic" && (
          <Row
            label={<IconLabel icon={Zap} text="Power Scale" />}
            tooltipTitle="Power Scale Mode"
            tooltip="Signal power measurement: dB (relative scale) or approximate dBm from the device calibration model. The reading is hardware-specific and useful for stable comparisons, but it is not lab-calibrated true dBm."
          >
            <WideSettingSelect
              value={powerScale}
              onChange={(e) => {
                onPowerScaleChange(e.target.value as "dB" | "dBm");
              }}
            >
              <option value="dB">dB (relative)</option>
              <option value="dBm">dBm (approximate)</option>
            </WideSettingSelect>
          </Row>
        )}
    </Section>
  );
};
