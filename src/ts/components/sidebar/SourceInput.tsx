import React from "react";
import styled from "styled-components";
import { Row } from "@n-apt/components/ui";
import type { SourceMode } from "@n-apt/hooks/useSpectrumStore";

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 0;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primaryAlpha};
  }

  option {
    background-color: ${(props) => props.theme.fftBackground || props.theme.background};
    color: ${(props) => props.theme.textPrimary};
    font-family: ${(props) => props.theme.typography.mono};
  }
`;

interface SourceInputProps {
  sourceMode: SourceMode;
  backend: string | null;
  deviceName?: string | null;
  fileModeColor?: string;
  onSourceModeChange: (mode: SourceMode) => void;
}

const getLiveInputLabel = (
  backend: string | null,
  deviceName?: string | null,
) => {
  // Use device_name directly if available
  if (deviceName && deviceName.trim().length > 0) {
    return deviceName.trim();
  }

  // Fallback to backend-specific names
  if (
    backend === "rtl-sdr" ||
    backend === "rtlsdr" ||
    backend === "rtltcp" ||
    backend === "rtl-tcp"
  ) {
    return "RTL-SDR";
  }

  if (backend?.includes("mock")) return "Mock APT SDR";

  return backend || "Mock APT SDR";
};

export const SourceInput: React.FC<SourceInputProps> = ({
  sourceMode,
  backend,
  deviceName,
  fileModeColor,
  onSourceModeChange,
}) => {
  return (
    <Row label="Input" tooltip="Select the signal source.">
      <SettingSelect
        value={sourceMode}
        onChange={(e) => onSourceModeChange(e.target.value as SourceMode)}
        style={{ minWidth: "130px" }}
      >
        <option value="live">{getLiveInputLabel(backend, deviceName)}</option>
        <option value="file" style={fileModeColor ? { color: fileModeColor } : undefined}>
          File Selection
        </option>
      </SettingSelect>
    </Row>
  );
};

export default SourceInput;
