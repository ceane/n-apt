import React, { useRef } from "react";
import styled from "styled-components";

type NaptMetadata = {
  sample_rate?: number;
  center_frequency?: number;
  frequency_range?: [number, number];
  fft?: { size?: number; window?: string };
  format?: string;
  timestamp_utc?: string;
  hardware?: string;
  gain?: number;
  ppm?: number;
  frame_rate?: number;
  fft_size?: number;
  duration_s?: number;
};

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) => (props.$fileMode ? "#d9aa34" : "#555")};
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

  &:hover {
    background-color: #2a2a2a;
    border-color: #00d4ff;
    color: #00d4ff;
  }
`;

const FileInputActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
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
  display: flex;
  gap: 8px;
  align-items: center;
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
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 8px;
`;

const FlexPauseButton = styled(PauseButton)`
  flex: 1;
`;

const ClearButton = styled(PauseButton)`
  flex: 1;
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

interface FileProcessingSectionProps {
  selectedFiles: { name: string; file: File; downloadUrl?: string }[];
  stitchStatus: string;
  isStitchPaused: boolean;
  selectedNaptFile: { name: string; file: File; downloadUrl?: string } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  onSelectedFilesChange: (files: { name: string; file: File; downloadUrl?: string }[]) => void;
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
  naptMetadataError: _naptMetadataError,
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
  };

  const removeFile = (index: number) => {
    onSelectedFilesChange(selectedFiles.filter((_, i) => i !== index));
  };

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
            <SectionTitle $fileMode>Selected files ({selectedFiles.length})</SectionTitle>
            {selectedFiles.map((file, index) => (
              <SettingRow key={`${file.name}-${index}`}>
                <SettingLabelContainer>
                  <FileNameLabel>{file.name}</FileNameLabel>
                </SettingLabelContainer>
                <FileActionsValue>
                  {file.downloadUrl ? (
                    <DownloadLink
                      href={
                        sessionToken
                          ? `${file.downloadUrl}&token=${encodeURIComponent(sessionToken)}`
                          : file.downloadUrl
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </DownloadLink>
                  ) : (
                    <LoadedLabel>Loaded</LoadedLabel>
                  )}
                  <RemoveButton onClick={() => removeFile(index)}>Remove</RemoveButton>
                </FileActionsValue>
              </SettingRow>
            ))}
          </Section>

          <Section>
            {stitchStatus && (
              <StitchStatusMessage $isError={stitchStatus.startsWith("Stitching failed")}>
                {stitchStatus}
              </StitchStatusMessage>
            )}
            <ButtonColumn>
              <ButtonRow>
                <FlexPauseButton $paused={false} ref={stitchButtonRef} onClick={onStitch}>
                  Stitch spectrum
                </FlexPauseButton>
                <ClearButton $paused={false} onClick={onClear}>
                  Clear
                </ClearButton>
              </ButtonRow>
              <FullWidthPauseButton $paused={isStitchPaused} onClick={onStitchPauseToggle}>
                {isStitchPaused ? "Play" : "Pause"}
              </FullWidthPauseButton>
            </ButtonColumn>
          </Section>

          {selectedNaptFile && (
            <Section>
              <SectionTitle $fileMode>Metadata</SectionTitle>
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>File</SettingLabel>
                </SettingLabelContainer>
                <TruncatedSettingValue>{selectedNaptFile.name}</TruncatedSettingValue>
              </SettingRow>
              {naptMetadata && (
                <>
                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Sample rate</SettingLabel>
                    </SettingLabelContainer>
                    <SettingValue>
                      {typeof naptMetadata.sample_rate === "number"
                        ? `${(naptMetadata.sample_rate / 1_000_000).toFixed(3)} MHz`
                        : "—"}
                    </SettingValue>
                  </SettingRow>
                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Center</SettingLabel>
                    </SettingLabelContainer>
                    <SettingValue>
                      {typeof naptMetadata.center_frequency === "number"
                        ? `${naptMetadata.center_frequency.toFixed(3)} MHz`
                        : "—"}
                    </SettingValue>
                  </SettingRow>
                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Range</SettingLabel>
                    </SettingLabelContainer>
                    <SettingValue>
                      {Array.isArray(naptMetadata.frequency_range)
                        ? `${naptMetadata.frequency_range[0].toFixed(3)}-${naptMetadata.frequency_range[1].toFixed(3)} MHz`
                        : "—"}
                    </SettingValue>
                  </SettingRow>
                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>FFT</SettingLabel>
                    </SettingLabelContainer>
                    <SettingValue>
                      {naptMetadata.fft?.size ?? naptMetadata.fft_size ?? "—"}
                      {naptMetadata.fft?.window ? ` / ${naptMetadata.fft.window}` : ""}
                    </SettingValue>
                  </SettingRow>
                  {typeof naptMetadata.frame_rate === "number" && (
                    <SettingRow>
                      <SettingLabelContainer>
                        <SettingLabel>Frame rate</SettingLabel>
                      </SettingLabelContainer>
                      <SettingValue>{naptMetadata.frame_rate} fps</SettingValue>
                    </SettingRow>
                  )}
                  {typeof naptMetadata.duration_s === "number" && (
                    <SettingRow>
                      <SettingLabelContainer>
                        <SettingLabel>Duration</SettingLabel>
                      </SettingLabelContainer>
                      <SettingValue>{naptMetadata.duration_s.toFixed(2)} s</SettingValue>
                    </SettingRow>
                  )}
                  <SettingRow>
                    <SettingLabelContainer>
                      <SettingLabel>Timestamp</SettingLabel>
                    </SettingLabelContainer>
                    <SettingValue>{naptMetadata.timestamp_utc || "—"}</SettingValue>
                  </SettingRow>
                </>
              )}
            </Section>
          )}
        </>
      )}
    </>
  );
};

export default FileProcessingSection;
