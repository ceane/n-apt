import React from "react";
import styled from "styled-components";
import { Row } from "@n-apt/components/ui";
import {
  Activity,
  Blend,
  Frame,
  GalleryHorizontal,
  Gauge,
  Image as ImageIcon,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { DeviceProfile } from "@n-apt/consts/schemas/websocket";

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
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  justify-self: end;
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
  min-width: 100px;
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

const IconLabel: React.FC<{ icon: LucideIcon; text: string }> = ({ icon: IconComponent, text }) => (
  <LabelWithIcon>
    <IconComponent size={14} strokeWidth={1.75} aria-hidden="true" />
    {text}
  </LabelWithIcon>
);

interface SignalDisplaySectionProps {
  sourceMode: "live" | "file";
  maxSampleRate: number;
  fileCapturedRange: { min: number; max: number } | null;
  fftFrameRate: number;
  maxFrameRate: number;
  fftSize: number;
  fftSizeOptions: number[];
  fftWindow: string;
  temporalResolution: "low" | "medium" | "high";
  autoFftOptions: {
    type: "auto_fft_options";
    autoSizes: number[];
    recommended: number;
  } | null;
  backend: string | null;
  deviceProfile?: DeviceProfile | null;
  powerScale: "dB" | "dBm";
  displayMode: "fft" | "iq";
  onFftFrameRateChange: (value: number) => void;
  onFftSizeChange: (value: number) => void;
  onFftWindowChange: (value: string) => void;
  onTemporalResolutionChange: (value: "low" | "medium" | "high") => void;
  onPowerScaleChange: (value: "dB" | "dBm") => void;
  onDisplayModeChange: (value: "fft" | "iq") => void;
  scheduleCoupledAdjustment: (
    trigger: "fftSize" | "frameRate",
    fftSize: number,
    frameRate: number,
  ) => void;
}

export const SignalDisplaySection: React.FC<SignalDisplaySectionProps> = ({
  sourceMode,
  maxSampleRate,
  fftFrameRate,
  maxFrameRate,
  fftSize,
  fftSizeOptions,
  fftWindow,
  temporalResolution,
  autoFftOptions,
  backend,
  deviceProfile,
  powerScale,
  displayMode,
  onFftFrameRateChange,
  onFftSizeChange,
  onFftWindowChange,
  onTemporalResolutionChange,
  onPowerScaleChange,
  onDisplayModeChange,
  scheduleCoupledAdjustment,
}) => {
  const showsApproxDbmToggle =
    deviceProfile
      ? deviceProfile.supports_approx_dbm
      : (
        backend === "rtl_sdr" ||
        backend === "rtl-sdr" ||
        backend === "rtlsdr" ||
        backend === "rtl-tcp" ||
        backend === "rtltcp"
      );

  const manualFftOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          (fftSizeOptions.length ? fftSizeOptions : [fftSize]).filter((size) =>
            Number.isFinite(size) && size > 0,
          ),
        ),
      ).sort((a, b) => a - b),
    [fftSize, fftSizeOptions],
  );

  const autoFftSizeOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          (autoFftOptions?.autoSizes ?? []).filter((size) =>
            Number.isFinite(size) && size > 0,
          ),
        ),
      ).sort((a, b) => a - b),
    [autoFftOptions],
  );

  return (
    <Section>
      <SectionTitle>Signal display</SectionTitle>
      {sourceMode === "live" && (
        <>
          <Row
            label={<IconLabel icon={Frame} text="Sample Size" />}
            tooltipTitle="Sample Size (Bandwidth)"
            tooltip="Radio signal bandwidth capacity. Determines the range of frequencies that can be intercepted and processed from transmissions."
          >
            <SettingValue>
              {`${(maxSampleRate / 1000000).toFixed(1)}MHz`}
            </SettingValue>
          </Row>
          <Row
            label={<IconLabel icon={GalleryHorizontal} text="Frame rate (logical)" />}
            tooltipTitle="Frame Rate"
            tooltip={`Signal processing speed. Higher rates provide more real-time analysis of transmissions. Current maximum theoretical rate: ${maxFrameRate} fps based on current FFT size and bandwidth capacity.`}
          >
            <InputGroup>
              <SettingInput
                type="number"
                value={fftFrameRate}
                onChange={(e) => {
                  const val = Math.max(
                    1,
                    Math.min(
                      maxFrameRate,
                      Math.floor(Number(e.target.value) || 1),
                    ),
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
                  const next = Math.max(
                    1,
                    Math.min(
                      maxFrameRate,
                      Math.floor((fftFrameRate || 0) + delta),
                    ),
                  );
                  onFftFrameRateChange(next);
                  scheduleCoupledAdjustment("frameRate", fftSize, next);
                }}
                min="1"
                max={maxFrameRate}
              />
              <UnitLabel>fps</UnitLabel>
            </InputGroup>
          </Row>
          <Row
            label={<IconLabel icon={ImageIcon} text="FFT Size" />}
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
              {autoFftSizeOptions.length > 0 ? (
                <>
                  {autoFftSizeOptions.map((size) => (
                    <option key={`auto-${size}`} value={size}>
                      {size} (Auto)
                    </option>
                  ))}
                  {manualFftOptions.length > 0 && <option disabled>---</option>}
                  {manualFftOptions.map((size) => (
                    <option key={`manual-${size}`} value={size}>
                      {size}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  {manualFftOptions.map((size) => (
                    <option key={`manual-${size}`} value={size}>
                      {size}
                    </option>
                  ))}
                </>
              )}
            </SettingSelect>
          </Row>
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
          <Row
            label={<IconLabel icon={Gauge} text="Temporal Resolution" />}
            tooltipTitle="Display Temporal Resolution"
            tooltip="Signal visualization precision. Low blends signal patterns, medium shows averaged activity, high displays exact signal interactions with sharp transitions, with the ability to see patterns (like dots) in the waterfall as the signal rises and falls sharply."
          >
            <WideSettingSelect
              value={temporalResolution}
              onChange={(e) => {
                onTemporalResolutionChange(
                  e.target.value as "low" | "medium" | "high",
                );
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </WideSettingSelect>
          </Row>
        </>
      )}
      {/* RTL-SDR specific power scale toggle - enabled for testing and file mode */}
      {(showsApproxDbmToggle || sourceMode === "file") && (
        <Row label={<IconLabel icon={Zap} text="Power Scale" />} tooltipTitle="Power Scale Mode" tooltip="Signal power measurement: dB (relative scale) or Approximated dBm (raw RTL-SDR I/Q based estimate). RTL-SDR readings are more accurate than rlt_power and are around ±3-5dBm within accuracy of signal's measured power. Approximated dBm is useful for stable absolute-like comparisons, but it is not lab-calibrated true dBm.">
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
      {sourceMode === "file" && (
        <Row label={<IconLabel icon={Activity} text="Display Mode" />} tooltipTitle="Visualization Display Mode" tooltip="Toggle between spectral analysis (FFT) and raw time-domain waveforms (I/Q).">
          <WideSettingSelect
            value={displayMode}
            onChange={(e) => {
              onDisplayModeChange(e.target.value as "fft" | "iq");
            }}
          >
            <option value="fft">Spectral (FFT)</option>
            <option value="iq">Time Domain (I/Q)</option>
          </WideSettingSelect>
        </Row>
      )}
    </Section>
  );
};
