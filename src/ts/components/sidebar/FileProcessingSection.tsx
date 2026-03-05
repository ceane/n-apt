import React, { useRef } from "react";
import styled from "styled-components";

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
  // New fields
  acquisition_mode?: string;
  source_device?: string;
  fft_window?: string;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
};

const Section = styled.div<{ $marginTop?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: ${(props) => props.$marginTop || "0"};
`;

const SectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? "#d9aa34" : "#555")};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
`;

const SettingRow = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  border: 1px solid #1a1a1a;
  user-select: none;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

const SettingLabelContainer = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 8px;
  justify-content: start;
`;

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
  justify-self: end;
`;

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) => (props.$paused ? "#2a2a2a" : "#1a1a1a")};
  border: 1px solid ${(props) => (props.$paused ? "#00d4ff" : "#2a2a2a")};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? "#00d4ff" : "#ccc")};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover:not(:disabled) {
    background-color: #2a2a2a;
    border-color: #00d4ff;
    color: #00d4ff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const FileInputActions = styled.div`
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: 8px;
  justify-content: end;
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const BrowseButton = styled(PauseButton)`
  flex: none;
  font-size: 11px;
  padding: 8px 12px;
`;

const FileNameLabel = styled(SettingLabel)`
  max-width: 200px;
`;

const FileActionsValue = styled(SettingValue)`
  display: grid;
  grid-auto-flow: column;
  gap: 8px;
  align-items: center;
  justify-content: end;
`;

const DownloadLink = styled.a`
  color: #00d4ff;
  font-size: 11px;
`;

const LoadedLabel = styled.span`
  font-size: 11px;
  color: #888;
`;

const RemoveButton = styled.button`
  background: none;
  color: #ff6b6b;
  border: 1px solid #ff6b6b;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 11px;
`;

const StitchStatusMessage = styled.div<{ $isError: boolean }>`
  margin-bottom: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11px;
  color: ${(props) => (props.$isError ? "#f87171" : "#a3e635")};
  background-color: ${(props) =>
    props.$isError ? "rgba(248, 113, 113, 0.08)" : "rgba(163, 230, 53, 0.08)"};
  border: 1px solid
    ${(props) => (props.$isError ? "rgba(248, 113, 113, 0.2)" : "rgba(163, 230, 53, 0.2)")};
`;

const ButtonColumn = styled.div`
  display: grid;
  grid-column: 1 / -1;
  gap: 8px;
`;

const ButtonRow = styled.div`
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 8px;
`;

const FlexPauseButton = styled(PauseButton)`
  width: 100%;
`;

const ClearButton = styled(PauseButton)`
  width: 100%;
  background: transparent;
`;

const FullWidthPauseButton = styled(PauseButton)`
  width: 100%;
`;

const TruncatedSettingValue = styled(SettingValue)`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
`;

const MetadataGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-column: 1 / -1;
  gap: 8px;
`;

const MetadataItem = styled.div`
  display: grid;
  gap: 4px;
  padding: 8px;
  background-color: #141414;
  border-radius: 6px;
  border: 1px solid #1a1a1a;
  box-sizing: border-box;
  width: 100%;
`;

const MetadataLabel = styled.span`
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const MetadataValue = styled.span`
  font-size: 11px;
  color: #ccc;
  font-family: "JetBrains Mono", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

interface FileProcessingSectionProps {
  selectedFiles: { name: string; file: File; downloadUrl?: string }[];
  stitchStatus: string;
  isStitchPaused: boolean;
  selectedNaptFile: { name: string; file: File; downloadUrl?: string } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  onSelectedFilesChange: (
    files: { name: string; file: File; downloadUrl?: string }[],
  ) => void;
  onStitch: () => void;
  onClear: () => void;
  onStitchPauseToggle: () => void;
  sessionToken?: string | null;
}

export const FileProcessingSection: React.FC<FileProcessingSectionProps> = ({
  selectedFiles,
  stitchStatus,
  isStitchPaused,
  selectedNaptFile,
  naptMetadata,
  naptMetadataError,
  onSelectedFilesChange,
  onStitch,
  onClear,
  onStitchPauseToggle,
  sessionToken,
}) => {
  const stitchButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    onSelectedFilesChange(
      Array.from(e.target.files).map((file) => ({
        name: file.name,
        file,
      })),
    );

    setTimeout(() => {
      const btn = stitchButtonRef.current;
      if (btn) {
        btn.focus();
        if (window.focus) window.focus();
        btn.style.transform = "translateZ(0)";
        void btn.offsetWidth;
        btn.style.transform = "";
      }
    }, 50);

    // Reset value so selection of same file triggers onChange again
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    onSelectedFilesChange(selectedFiles.filter((_, i) => i !== index));
  };

  const stitchingActive =
    stitchStatus?.includes("Loading") ||
    stitchStatus?.includes("Processing") ||
    stitchStatus?.includes("computing");
  const hasProcessedData = stitchStatus?.includes("Successfully");

  return (
    <>
      <Section>
        <SectionTitle $fileMode>File selection</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Choose files...</SettingLabel>
          </SettingLabelContainer>
          <FileInputActions>
            <HiddenFileInput
              type="file"
              accept=".c64,.napt,.wav"
              multiple
              id="fileInput"
              onChange={handleFileChange}
            />
            <BrowseButton
              $paused={false}
              onClick={() => document.getElementById("fileInput")?.click()}
            >
              Browse
            </BrowseButton>
          </FileInputActions>
        </SettingRow>
      </Section>

      {selectedFiles.length > 0 && (
        <>
          <Section>
            <SectionTitle $fileMode>
              Selected files ({selectedFiles.length})
            </SectionTitle>
            {selectedFiles.map((file, index) => (
              <SettingRow key={`${file.name}-${index}`}>
                <SettingLabelContainer>
                  <FileNameLabel title={file.name}>{file.name}</FileNameLabel>
                </SettingLabelContainer>
                <FileActionsValue>
                  {file.downloadUrl ? (
                    <DownloadLink
                      href={
                        sessionToken
                          ? `${file.downloadUrl}&token=${encodeURIComponent(sessionToken)}`
                          : file.downloadUrl
                      }
                      download={file.name || "download"}
                      rel="noopener noreferrer"
                    >
                      Download
                    </DownloadLink>
                  ) : (
                    <LoadedLabel>Loaded</LoadedLabel>
                  )}
                  <RemoveButton onClick={() => removeFile(index)}>
                    Remove
                  </RemoveButton>
                </FileActionsValue>
              </SettingRow>
            ))}
          </Section>

          <Section>
            {stitchStatus && (
              <StitchStatusMessage
                $isError={stitchStatus.startsWith("Stitching failed")}
              >
                {stitchStatus}
              </StitchStatusMessage>
            )}
            <ButtonColumn>
              <ButtonRow>
                <FlexPauseButton
                  $paused={false}
                  ref={stitchButtonRef}
                  onClick={onStitch}
                  disabled={stitchingActive || hasProcessedData}
                >
                  {stitchingActive
                    ? "Processing..."
                    : selectedFiles.length > 1
                      ? "Stitch spectrum"
                      : "Process file"}
                </FlexPauseButton>
                <ClearButton $paused={false} onClick={onClear}>
                  Clear
                </ClearButton>
              </ButtonRow>
              <FullWidthPauseButton
                $paused={isStitchPaused}
                onClick={onStitchPauseToggle}
                disabled={selectedFiles.length === 0 || !hasProcessedData}
              >
                {isStitchPaused ? "Play" : "Pause"}
              </FullWidthPauseButton>
            </ButtonColumn>
          </Section>
        </>
      )}

      {selectedFiles.length > 0 && (
        <Section>
          <SectionTitle $fileMode>Metadata</SectionTitle>
          {selectedNaptFile && (
            <SettingRow>
              <SettingLabelContainer>
                <SettingLabel>File</SettingLabel>
              </SettingLabelContainer>
              <TruncatedSettingValue title={selectedNaptFile.name}>
                {selectedNaptFile.name}
              </TruncatedSettingValue>
            </SettingRow>
          )}

          {naptMetadataError ? (
            <div
              style={{
                color: "#ff4444",
                fontSize: "11px",
                fontFamily: "JetBrains Mono",
                padding: "10px",
                backgroundColor: "#1a1313",
                borderRadius: "6px",
                border: "1px solid #2a1a1a",
              }}
            >
              {naptMetadataError}
            </div>
          ) : naptMetadata ? (
            <MetadataGrid>
              <MetadataItem>
                <MetadataLabel>Center Freq</MetadataLabel>
                <MetadataValue>
                  {naptMetadata.center_frequency_hz
                    ? (naptMetadata.center_frequency_hz / 1000000).toFixed(3)
                    : naptMetadata.center_frequency
                      ? naptMetadata.center_frequency.toFixed(3)
                      : "0.000"}{" "}
                  MHz
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Capture Rate</MetadataLabel>
                <MetadataValue>
                  {(naptMetadata.capture_sample_rate_hz ||
                    naptMetadata.sample_rate_hz ||
                    naptMetadata.sample_rate ||
                    0) / 1000000}{" "}
                  MHz
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Hardware Rate</MetadataLabel>
                <MetadataValue>
                  {(naptMetadata.hardware_sample_rate_hz || 0) / 1000000} MHz
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Mode</MetadataLabel>
                <MetadataValue style={{ textTransform: "capitalize" }}>
                  {naptMetadata.acquisition_mode || "Normal"}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Source</MetadataLabel>
                <MetadataValue>
                  {naptMetadata.source_device || naptMetadata.hardware || "N/A"}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>FFT Size/Win</MetadataLabel>
                <MetadataValue>
                  {naptMetadata.fft_size || naptMetadata.fft?.size || "N/A"} / {naptMetadata.fft_window || "Blackman"}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Actual FPS</MetadataLabel>
                <MetadataValue>
                  {naptMetadata.frame_rate?.toFixed(1) || "N/A"}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Duration</MetadataLabel>
                <MetadataValue>
                  {naptMetadata.duration_s?.toFixed(2) || "0.00"} s
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Gain / PPM</MetadataLabel>
                <MetadataValue>
                  {naptMetadata.gain?.toFixed(1) || "N/A"} dB / {naptMetadata.ppm || 0}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>AGC</MetadataLabel>
                <MetadataValue>
                  T:{naptMetadata.tuner_agc ? "On" : "Off"} R:{naptMetadata.rtl_agc ? "On" : "Off"}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Format</MetadataLabel>
                <MetadataValue>
                  {naptMetadata.data_format || naptMetadata.format || "N/A"}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Timestamp</MetadataLabel>
                <MetadataValue title={naptMetadata.timestamp_utc}>
                  {naptMetadata.timestamp_utc
                    ? new Date(naptMetadata.timestamp_utc).toLocaleTimeString()
                    : "N/A"}
                </MetadataValue>
              </MetadataItem>
            </MetadataGrid>
          ) : (
            <div
              style={{
                color: "#777",
                fontSize: "11px",
                fontFamily: "JetBrains Mono",
                padding: "12px",
                backgroundColor: "#141414",
                borderRadius: "6px",
                border: "1px solid #1a1a1a",
                textAlign: "center",
              }}
            >
              {selectedFiles.length === 1
                ? "No extended metadata available for this file type."
                : "Multiple files selected. Stitch/Process to visualize combined spectrum."}
            </div>
          )}
        </Section>
      )}
    </>
  );
};

export default FileProcessingSection;
