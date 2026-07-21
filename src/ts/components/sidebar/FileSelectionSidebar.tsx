import React from "react";
import styled from "styled-components";
import SelectedFiles from "@n-apt/components/sidebar/SelectedFiles";
import FileMetadata from "@n-apt/components/sidebar/FileMetadata";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import type { GeolocationData } from "@n-apt/consts/schemas/websocket";

const Section = styled.div<{ $marginTop?: string; $marginBottom?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: ${({ $marginBottom }) => $marginBottom || "0"};
  margin-top: ${({ $marginTop }) => $marginTop || "0"};
  box-sizing: border-box;
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
  onSelectedFilesChange: (
    files: { id: string; name: string; downloadUrl?: string }[],
  ) => void;
  stitchStatus: string;
  isStitchPaused: boolean;
  onClear: () => void;
  selectedPrimaryFile: {
    id: string;
    name: string;
    downloadUrl?: string;
  } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  sessionToken?: string | null;
  showMetadata?: boolean;
  signalDisplayProps?: Omit<
    React.ComponentProps<typeof SignalDisplaySection>,
    "sourceMode"
  >;
}

export const FileSelectionSidebar: React.FC<FileSelectionSidebarProps> = ({
  showMetadata = true,
  signalDisplayProps,
  selectedFiles,
  onSelectedFilesChange,
  onClear,
  sessionToken,
  selectedPrimaryFile,
  naptMetadata,
  naptMetadataError,
  ...rest
}) => {
  return (
    <Section>
      <Section>
        <SelectedFiles
          title={selectedFiles.length > 0 ? "Selected File" : "Selected Files"}
          selectedFiles={selectedFiles}
          onRemoveFile={(index) => {
            const nextFiles = selectedFiles.filter((_, i) => i !== index);
            onSelectedFilesChange(nextFiles);
          }}
          onClear={onClear}
          sessionToken={sessionToken}
          durationSeconds={naptMetadata?.duration_s}
          status={rest.stitchStatus}
        />
      </Section>

      {showMetadata ? (
        <Section $marginTop="12px">
          <FileMetadata
            selectedNaptFile={selectedPrimaryFile}
            naptMetadata={naptMetadata}
            naptMetadataError={naptMetadataError}
            sessionToken={sessionToken}
            showTitle={true}
          />
        </Section>
      ) : null}

      {signalDisplayProps ? (
        <Section $marginTop="12px">
          <SignalDisplaySection sourceMode="file" {...signalDisplayProps} />
        </Section>
      ) : null}
    </Section>
  );
};

export default FileSelectionSidebar;
