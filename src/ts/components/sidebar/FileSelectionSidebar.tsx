import React from "react";
import styled from "styled-components";
import FileProcessingSection from "./FileProcessingSection";
import type { GeolocationData } from "@n-apt/consts/schemas/websocket";

const Section = styled.div<{ $marginBottom?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: ${({ $marginBottom }) => $marginBottom || "0"};
  box-sizing: border-box;
  width: 100%;
`;

type NaptMetadata = {
  sample_rate?: number;
  sample_rate_hz?: number;
  capture_sample_rate_hz?: number;
  hardware_sample_rate_hz?: number;
  center_frequency?: number;
  center_frequency_hz?: number;
  frequency_range?: [number, number];
  fft?: { size?: number; window?: string };
  format?: string;
  data_format?: string;
  timestamp_utc?: string;
  hardware?: string;
  gain?: number;
  ppm?: number;
  frame_rate?: number;
  fft_size?: number;
  duration_s?: number;
  acquisition_mode?: string;
  source_device?: string;
  fft_window?: string;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  geolocation?: GeolocationData;
};

interface FileSelectionSidebarProps {
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  onSelectedFilesChange: (files: { id: string; name: string; downloadUrl?: string }[]) => void;
  stitchStatus: string;
  isStitchPaused: boolean;
  onStitch: () => void;
  onClear: () => void;
  onStitchPauseToggle: () => void;
  selectedPrimaryFile: { id: string; name: string; downloadUrl?: string } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  sessionToken?: string | null;
}

export const FileSelectionSidebar: React.FC<FileSelectionSidebarProps> = ({
  selectedPrimaryFile,
  ...rest
}) => {
  return (
    <Section>
      <FileProcessingSection
        selectedNaptFile={selectedPrimaryFile}
        {...rest}
      />
    </Section>
  );
};

export default FileSelectionSidebar;
