import React from "react";
import styled from "styled-components";
import InfoPopover from "@n-apt/components/InfoPopover";

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #1a1a1a;
  user-select: none;
`;

const SettingLabelContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
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

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
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

interface SignalDisplaySectionProps {
  sourceMode: "live" | "file";
  maxSampleRate: number;
  fileCapturedRange: { min: number; max: number } | null;
  fftFrameRate: number;
  maxFrameRate: number;
  fftSize: number;
  fftWindow: string;
  temporalResolution: "low" | "medium" | "high";
  onFftFrameRateChange: (value: number) => void;
  onFftSizeChange: (value: number) => void;
  onFftWindowChange: (value: string) => void;
  onTemporalResolutionChange: (value: "low" | "medium" | "high") => void;
  scheduleCoupledAdjustment: (trigger: "fftSize" | "frameRate", fftSize: number, frameRate: number) => void;
}

export const SignalDisplaySection: React.FC<SignalDisplaySectionProps> = ({
  sourceMode,
  maxSampleRate,
  fileCapturedRange,
  fftFrameRate,
  maxFrameRate,
  fftSize,
  fftWindow,
  temporalResolution,
  onFftFrameRateChange,
  onFftSizeChange,
  onFftWindowChange,
  onTemporalResolutionChange,
  scheduleCoupledAdjustment,
}) => {
  return (
    <Section>
      <SectionTitle>Signal display</SectionTitle>
      <SettingRow>
        <SettingLabelContainer>
          <SettingLabel>Sample Size</SettingLabel>
          <InfoPopover
            title="Sample Size (Bandwidth)"
            content="Radio signal bandwidth capacity. Determines the range of frequencies that can be intercepted and processed from transmissions."
          />
        </SettingLabelContainer>
        <SettingValue>
          {sourceMode === "file"
            ? fileCapturedRange
              ? `${(fileCapturedRange.max - fileCapturedRange.min).toFixed(2)}MHz`
              : "No files"
            : `${(maxSampleRate / 1000000).toFixed(1)}MHz`}
        </SettingValue>
      </SettingRow>
      {sourceMode === "file" && fileCapturedRange && (
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Captured Range</SettingLabel>
            <InfoPopover
              title="Captured Frequency Range"
              content="The frequency range covered by the selected I/Q capture files, derived from the center frequencies encoded in the filenames."
            />
          </SettingLabelContainer>
          <SettingValue>
            {fileCapturedRange.min.toFixed(2)}MHz to {fileCapturedRange.max.toFixed(2)}MHz
          </SettingValue>
        </SettingRow>
      )}
      {sourceMode === "live" ? (
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Frame Rate</SettingLabel>
            <InfoPopover
              title="Frame Rate"
              content={`Signal processing speed. Higher rates provide more real-time analysis of transmissions. Current maximum theoretical rate: ${maxFrameRate} fps based on current FFT size and bandwidth capacity.`}
            />
          </SettingLabelContainer>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <SettingInput
              type="number"
              value={fftFrameRate}
              onChange={(e) => {
                const val = Math.max(
                  1,
                  Math.min(maxFrameRate, Math.floor(Number(e.target.value) || 1)),
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
                  Math.min(maxFrameRate, Math.floor((fftFrameRate || 0) + delta)),
                );
                onFftFrameRateChange(next);
                scheduleCoupledAdjustment("frameRate", fftSize, next);
              }}
              min="1"
              max={maxFrameRate}
            />
            <span style={{ fontSize: "12px", color: "#ccc", fontWeight: "500" }}>fps</span>
          </div>
        </SettingRow>
      ) : (
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Frame Rate</SettingLabel>
          </SettingLabelContainer>
          <SettingValue>4 fps</SettingValue>
        </SettingRow>
      )}
      {sourceMode === "live" ? (
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>FFT Size</SettingLabel>
            <InfoPopover
              title="FFT Size"
              content="Frequency resolution. Larger sizes provide better detection of specific signal patterns in transmissions but reduce processing speed."
            />
          </SettingLabelContainer>
          <SettingSelect
            value={fftSize}
            onChange={(e) => {
              const val = Number(e.target.value);
              onFftSizeChange(val);
              scheduleCoupledAdjustment("fftSize", val, fftFrameRate);
            }}
          >
            <option value={8192}>8192</option>
            <option value={16384}>16384</option>
            <option value={32768}>32768</option>
            <option value={65536}>65536</option>
            <option value={131072}>131072</option>
            <option value={262144}>262144</option>
          </SettingSelect>
        </SettingRow>
      ) : (
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>FFT Size</SettingLabel>
          </SettingLabelContainer>
          <SettingValue>1024</SettingValue>
        </SettingRow>
      )}
      <SettingRow>
        <SettingLabelContainer>
          <SettingLabel>FFT Window</SettingLabel>
          <InfoPopover
            title="FFT Window"
            content="Signal filtering. Different windows optimize for detecting specific types of patterns and interactions in transmissions."
          />
        </SettingLabelContainer>
        <SettingSelect
          value={fftWindow}
          onChange={(e) => {
            const val = e.target.value;
            onFftWindowChange(val);
          }}
        >
          <option value="Rectangular">Rectangular</option>
          <option value="Hanning">Hanning</option>
          <option value="Hamming">Hamming</option>
          <option value="Blackman">Blackman</option>
          <option value="Nuttall">Nuttall</option>
        </SettingSelect>
      </SettingRow>
      <SettingRow>
        <SettingLabelContainer>
          <SettingLabel>Temporal Resolution</SettingLabel>
          <InfoPopover
            title="Display Temporal Resolution"
            content="Signal visualization precision. Low blends signal patterns, medium shows averaged activity, high displays exact signal interactions with sharp transitions, with the ability to see patterns (like dots) in the waterfall as the signal rises and falls sharply."
          />
        </SettingLabelContainer>
        <SettingSelect
          value={temporalResolution}
          onChange={(e) => {
            onTemporalResolutionChange(e.target.value as "low" | "medium" | "high");
          }}
          style={{ minWidth: "120px" }}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </SettingSelect>
      </SettingRow>
    </Section>
  );
};
