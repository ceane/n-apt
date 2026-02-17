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

interface FileProcessingSectionProps {
  selectedFiles: { name: string; file: File }[];
  stitchStatus: string;
  isStitchPaused: boolean;
  selectedNaptFile: { name: string; file: File } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  onSelectedFilesChange: (files: { name: string; file: File }[]) => void;
  onStitch: () => void;
  onClear: () => void;
  onStitchPauseToggle: () => void;
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="file"
              accept=".c64,.napt"
              multiple
              style={{
                display: "none",
              }}
              id="fileInput"
              onChange={handleFileChange}
            />
            <PauseButton
              $paused={false}
              onClick={() => document.getElementById("fileInput")?.click()}
              style={{
                flex: "none",
                fontSize: "11px",
                padding: "8px 12px",
              }}
            >
              Browse
            </PauseButton>
          </div>
        </SettingRow>
      </Section>

      {selectedFiles.length > 0 && (
        <>
          <Section>
            <SectionTitle $fileMode>Selected files ({selectedFiles.length})</SectionTitle>
            {selectedFiles.map((file, index) => (
              <SettingRow key={index}>
                <SettingLabelContainer>
                  <SettingLabel
                    style={{
                      fontSize: "11px",
                      maxWidth: "240px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </SettingLabel>
                </SettingLabelContainer>
                <PauseButton
                  $paused={false}
                  onClick={() => removeFile(index)}
                  style={{
                    flex: "none",
                    fontSize: "10px",
                    padding: "4px 8px",
                    background: "transparent",
                  }}
                >
                  Remove
                </PauseButton>
              </SettingRow>
            ))}
          </Section>

          <Section>
            {stitchStatus && (
              <div
                style={{
                  marginBottom: "8px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  color: stitchStatus.startsWith("Stitching failed")
                    ? "#f87171"
                    : "#a3e635",
                  backgroundColor: stitchStatus.startsWith("Stitching failed")
                    ? "rgba(248,113,113,0.08)"
                    : "rgba(163,230,53,0.08)",
                  border: `1px solid ${stitchStatus.startsWith("Stitching failed") ? "rgba(248,113,113,0.2)" : "rgba(163,230,53,0.2)"}`,
                }}
              >
                {stitchStatus}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <PauseButton
                  $paused={false}
                  ref={stitchButtonRef}
                  onClick={onStitch}
                  style={{ flex: 1 }}
                >
                  Stitch spectrum
                </PauseButton>
                <PauseButton
                  $paused={false}
                  onClick={onClear}
                  style={{ flex: 1, background: "transparent" }}
                >
                  Clear
                </PauseButton>
              </div>
              <PauseButton
                $paused={isStitchPaused}
                onClick={onStitchPauseToggle}
                style={{ width: "100%" }}
              >
                {isStitchPaused ? "Play" : "Pause"}
              </PauseButton>
            </div>
          </Section>

          {selectedNaptFile && (
            <Section>
              <SectionTitle $fileMode>NAPT metadata</SectionTitle>
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>File</SettingLabel>
                </SettingLabelContainer>
                <SettingValue>{selectedNaptFile.name}</SettingValue>
              </SettingRow>
              <SettingRow>
                <SettingLabelContainer>
                  <SettingLabel>Status</SettingLabel>
                </SettingLabelContainer>
                <SettingValue>
                  {naptMetadata
                    ? "Unlocked"
                    : naptMetadataError
                      ? naptMetadataError
                      : "Loading..."}
                </SettingValue>
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
                      {naptMetadata.fft?.size ? naptMetadata.fft.size : "—"}
                      {naptMetadata.fft?.window ? ` / ${naptMetadata.fft.window}` : ""}
                    </SettingValue>
                  </SettingRow>
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
