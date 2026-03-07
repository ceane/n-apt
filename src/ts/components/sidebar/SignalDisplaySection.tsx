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

const SettingValue = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
  justify-self: end;
`;

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
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
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primary}0d;
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: "JetBrains Mono", monospace;
  }
`;

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
  color: #ccc;
  font-weight: 500;
`;

const WideSettingSelect = styled(SettingSelect)`
  min-width: 120px;
`;

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
  onFftFrameRateChange: (value: number) => void;
  onFftSizeChange: (value: number) => void;
  onFftWindowChange: (value: string) => void;
  onTemporalResolutionChange: (value: "low" | "medium" | "high") => void;
  scheduleCoupledAdjustment: (
    trigger: "fftSize" | "frameRate",
    fftSize: number,
    frameRate: number,
  ) => void;
}

export const SignalDisplaySection: React.FC<SignalDisplaySectionProps> = ({
  sourceMode,
  maxSampleRate,
  fileCapturedRange,
  fftFrameRate,
  maxFrameRate,
  fftSize,
  fftSizeOptions,
  fftWindow,
  temporalResolution,
  autoFftOptions,
  onFftFrameRateChange,
  onFftSizeChange,
  onFftWindowChange,
  onTemporalResolutionChange,
  scheduleCoupledAdjustment,
}) => {
  const manualFftOptions = fftSizeOptions.length ? fftSizeOptions : [fftSize];

  return (
    <Section>
      <SectionTitle>Signal display</SectionTitle>
      <Row label="Sample Size" tooltipTitle="Sample Size (Bandwidth)" tooltip="Radio signal bandwidth capacity. Determines the range of frequencies that can be intercepted and processed from transmissions.">
        <SettingValue>
          {sourceMode === "file"
            ? fileCapturedRange
              ? `${(fileCapturedRange.max - fileCapturedRange.min).toFixed(2)}MHz`
              : "No files"
            : `${(maxSampleRate / 1000000).toFixed(1)}MHz`}
        </SettingValue>
      </Row>
      {sourceMode === "file" && fileCapturedRange && (
        <Row label="Captured Range" tooltipTitle="Captured Frequency Range" tooltip="The frequency range covered by the selected I/Q capture files, derived from the center frequencies encoded in the filenames.">
          <SettingValue>
            {fileCapturedRange.min.toFixed(2)}MHz to{" "}
            {fileCapturedRange.max.toFixed(2)}MHz
          </SettingValue>
        </Row>
      )}
      {sourceMode === "live" ? (
        <Row label="Frame rate (logical)" tooltipTitle="Frame Rate" tooltip={`Signal processing speed. Higher rates provide more real-time analysis of transmissions. Current maximum theoretical rate: ${maxFrameRate} fps based on current FFT size and bandwidth capacity.`}>
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
      ) : (
        <Row label="Frame rate (logical)">
          <SettingValue>4 fps</SettingValue>
        </Row>
      )}
      {sourceMode === "live" ? (
        <Row label="FFT Size" tooltipTitle="FFT Size" tooltip="Frequency resolution. Larger sizes provide better detection of specific signal patterns in transmissions but reduce processing speed.">
          <SettingSelect
            value={fftSize}
            onChange={(e) => {
              const val = Number(e.target.value);
              onFftSizeChange(val);
              scheduleCoupledAdjustment("fftSize", val, fftFrameRate);
            }}
          >
            {autoFftOptions ? (
              <>
                {autoFftOptions.autoSizes.map((size) => (
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
      ) : (
        <Row label="FFT Size">
          <SettingValue>1024</SettingValue>
        </Row>
      )}
      <Row label="FFT Window" tooltipTitle="FFT Window" tooltip="Signal filtering. Different windows optimize for detecting specific types of patterns and interactions in transmissions.">
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
      <Row label="Temporal Resolution" tooltipTitle="Display Temporal Resolution" tooltip="Signal visualization precision. Low blends signal patterns, medium shows averaged activity, high displays exact signal interactions with sharp transitions, with the ability to see patterns (like dots) in the waterfall as the signal rises and falls sharply.">
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
    </Section>
  );
};
