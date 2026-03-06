import React, { useRef } from "react";
import styled from "styled-components";
import { Tooltip } from "@n-apt/components/ui";
import { Activity, Download, Trash2, CheckCircle2 } from "lucide-react";

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
  color: ${(props) => (props.$fileMode ? props.theme.fileMode : props.theme.metadataLabel)};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 20px;
  margin-bottom: 0;
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
  background-color: ${(props) => props.theme.surface || "#141414"};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.border || "#1a1a1a"};
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
  color: ${(props) => props.theme.textSecondary || "#777"};
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary || "#ccc"};
  font-weight: 500;
  justify-self: end;
`;

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  height: 100%;
  padding: 12px 8px;
  background-color: ${(props) => (props.$paused ? props.theme.primaryAnchor : "#1a1a1a")};
  border: 1px solid ${(props) => (props.$paused ? props.theme.primary : "#2a2a2a")};
  border-radius: 8px;
  color: ${(props) => (props.$paused ? props.theme.primary : "#ccc")};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover:not(:disabled) {
    background-color: ${(props) => props.theme.primary}0d;
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
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
  white-space: normal;
  word-wrap: break-word;
  line-height: 1.3;
`;

const FileActionsValue = styled(SettingValue)`
  display: grid;
  grid-auto-flow: column;
  gap: 8px;
  align-items: center;
  justify-content: end;
`;

const DownloadLink = styled.a`
  color: ${(props) => props.theme.primary};
  font-size: 11px;
`;

const LoadedLabel = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary || "#888"};
  display: flex;
  align-items: center;
  gap: 4px;
`;

const RemoveButton = styled.button`
  background: none;
  color: ${(props) => props.theme.danger};
  border: none;
  cursor: pointer;
  font-size: 11px;
  text-decoration: underline;
  padding: 2px 4px;
  
  &:hover {
    filter: brightness(1.2);
  }
`;

const ClearAllLink = styled.button`
  background: none;
  border: none;
  color: ${(props) => props.theme.primary};
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  padding: 2px 4px;
  margin-top: 8px;
  
  &:hover {
    filter: brightness(1.2);
  }
`;

const ClearButton = styled(PauseButton)`
  width: 100%;
  background: transparent;
`;

const UnifiedActionButton = styled(PauseButton) <{ $state: string }>`
  width: 100%;
  grid-column: 1 / -1;
  height: auto;
  background-color: ${(props) => props.theme.surface || "#1a1a1a"};
  border: 1px solid ${(props) => {
    if (props.$state === "error") return props.theme.danger;
    if (props.$state === "play") return props.theme.primary;
    return props.theme.borderHover || "#2a2a2a";
  }};
  border-radius: 12px;
  color: ${(props) => {
    if (props.$state === "error") return props.theme.danger;
    if (props.$state === "play") return props.theme.primary;
    return props.theme.textPrimary || "#ccc";
  }};
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 14px;
  font-family: inherit;
  padding: 10px;
  transition: all 0.2s ease;
  box-sizing: border-box;

  &:hover:not(:disabled) {
    background-color: ${(props) => {
    if (props.$state === "error") return "rgba(255, 107, 107, 0.1)";
    if (props.$state === "play") return "rgba(0, 212, 255, 0.1)";
    if (props.$state === "pause") return "rgba(163, 230, 53, 0.1)";
    return "rgba(0, 212, 255, 0.1)";
  }};
    border-color: ${(props) => {
    if (props.$state === "error") return props.theme.danger;
    if (props.$state === "play") return props.theme.primary;
    return props.theme.primary;
  }};
    color: #fff;
    box-shadow: 0 0 20px ${(props) => {
    if (props.$state === "error") return "rgba(255, 107, 107, 0.15)";
    if (props.$state === "play") return "rgba(0, 212, 255, 0.15)";
    if (props.$state === "pause") return "rgba(163, 230, 53, 0.15)";
    return "rgba(0, 212, 255, 0.15)";
  }};
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.3;
    background-color: #0d0d0d;
    border-color: #1a1a1a;
    cursor: default;
  }
`;

const FileCard = styled.div`
  background-color: #0d0d0d;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border || "#1a1a1a"};
  margin-bottom: 12px;
  display: grid;
  gap: 12px;
  grid-column: 1 / -1;
`;

const FileInfoRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`;

const FileItemHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const FileIcon = styled.div`
  width: 24px;
  height: 24px;
  background-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.primary};
`;

const FileTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #eee;
  white-space: normal;
  word-break: break-all;
  line-height: 1.3;
  flex: 1;

  .extension {
    display: inline-block;
    white-space: nowrap;
  }
`;

const StitchStatusMessage = styled.div<{ $isError: boolean }>`
  grid-column: 1 / -1;
  margin-bottom: 8px;
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: ${(props) => (props.$isError ? props.theme.danger : props.theme.success)};
  background-color: ${(props) =>
    props.$isError ? `${props.theme.danger}0d` : `${props.theme.success}0d`};
  border: 1px solid
    ${(props) => (props.$isError ? `${props.theme.danger}33` : `${props.theme.success}33`)};
  text-align: center;
`;

const WrappedSettingValue = styled(SettingValue)`
  white-space: normal;
  word-break: break-all;
  line-height: 1.4;
  padding: 4px 0;
  text-align: left;
  justify-self: start;
  max-width: 100%;

  .extension {
    display: inline-block;
    white-space: nowrap;
  }
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
  background-color: ${(props) => props.theme.surface || "#141414"};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.border || "#1a1a1a"};
  box-sizing: border-box;
  width: 100%;
`;

const MetadataLabel = styled.span`
  font-size: 10px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const MetadataValue = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.metadataValue};
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

const renderFileName = (name: string) => {
  const lastDotIndex = name.lastIndexOf(".");
  if (lastDotIndex === -1) return name;

  const base = name.substring(0, lastDotIndex);
  const ext = name.substring(lastDotIndex);

  return (
    <>
      {base}
      <span className="extension">{ext}</span>
    </>
  );
};

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
              <FileCard key={`${file.name}-${index}`}>
                <FileItemHeader>
                  <FileIcon>
                    <Activity size={18} strokeWidth={2.5} />
                  </FileIcon>
                  <FileTitle>
                    {renderFileName(file.name)}
                  </FileTitle>
                </FileItemHeader>
                <FileInfoRow>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <LoadedLabel>
                      <CheckCircle2 size={12} /> Loaded
                    </LoadedLabel>
                    {file.downloadUrl && (
                      <DownloadLink
                        href={`${file.downloadUrl}${sessionToken ? `&token=${encodeURIComponent(sessionToken)}` : ''}`}
                        download={file.name}
                        style={{
                          textDecoration: 'underline',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Download size={12} /> Download
                      </DownloadLink>
                    )}
                  </div>
                  <RemoveButton onClick={() => removeFile(index)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Trash2 size={12} /> Remove?
                  </RemoveButton>
                </FileInfoRow>
              </FileCard>
            ))}
            {selectedFiles.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', gridColumn: '1 / -1' }}>
                <ClearAllLink onClick={onClear}>
                  Clear all?
                </ClearAllLink>
              </div>
            )}
          </Section>

          <Section>
            {stitchStatus && !stitchingActive && stitchStatus.startsWith("Stitching failed") && (
              <StitchStatusMessage $isError={true}>
                {stitchStatus}
              </StitchStatusMessage>
            )}

            <UnifiedActionButton
              $paused={isStitchPaused && hasProcessedData}
              $state={
                stitchingActive
                  ? "processing"
                  : stitchStatus?.startsWith("Stitching failed")
                    ? "error"
                    : hasProcessedData
                      ? (isStitchPaused ? "play" : "pause")
                      : "initial"
              }
              ref={stitchButtonRef}
              onClick={() => {
                if (stitchingActive) return;
                if (hasProcessedData) {
                  onStitchPauseToggle();
                } else {
                  onStitch();
                }
              }}
              disabled={stitchingActive}
            >
              {stitchingActive
                ? "Processing..."
                : stitchStatus?.startsWith("Stitching failed")
                  ? "Error"
                  : hasProcessedData
                    ? (isStitchPaused ? "Play" : "Pause")
                    : "Process then play"}
            </UnifiedActionButton>
          </Section>
        </>
      )}

      {selectedFiles.length > 0 && (
        <Section>
          <SectionTitle $fileMode>Metadata</SectionTitle>
          {selectedNaptFile && (
            <SettingRow style={{ height: 'auto', padding: '12px' }}>
              <SettingLabelContainer style={{ alignSelf: 'start', paddingTop: '4px' }}>
                <SettingLabel>File</SettingLabel>
              </SettingLabelContainer>
              <WrappedSettingValue title={selectedNaptFile.name}>
                {renderFileName(selectedNaptFile.name)}
              </WrappedSettingValue>
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
                <MetadataLabel>
                  Center Freq
                  <Tooltip
                    title="Center Frequency"
                    content="The center frequency of the SDR tuning in MHz. This is the frequency the radio was tuned to during capture."
                  />
                </MetadataLabel>
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
                <MetadataLabel>
                  Capture Rate
                  <Tooltip
                    title="Capture Rate"
                    content="The sample rate used during capture in MHz. Higher rates capture more bandwidth but require more storage."
                  />
                </MetadataLabel>
                <MetadataValue>
                  {(naptMetadata.capture_sample_rate_hz ||
                    naptMetadata.sample_rate_hz ||
                    naptMetadata.sample_rate ||
                    0) / 1000000}{" "}
                  MHz
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>
                  Hardware Rate
                  <Tooltip
                    title="Hardware Rate"
                    content="The maximum sample rate supported by the SDR hardware in MHz. This is the hardware's native sampling capability."
                  />
                </MetadataLabel>
                <MetadataValue>
                  {(naptMetadata.hardware_sample_rate_hz || 0) / 1000000} MHz
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>
                  Mode
                  <Tooltip
                    title="Acquisition Mode"
                    content="The capture mode used: 'stepwise' captures frequency ranges sequentially, while 'interleaved' captures them simultaneously."
                  />
                </MetadataLabel>
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
                <MetadataLabel>
                  FFT Size/Win
                  <Tooltip
                    title="FFT Size and Window"
                    content="FFT size determines frequency resolution (larger = better resolution). Window function reduces spectral leakage. Blackman is commonly used."
                  />
                </MetadataLabel>
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
                <MetadataLabel>
                  Gain / PPM
                  <Tooltip
                    title="Gain and PPM"
                    content="Gain: RF amplifier gain in dB. PPM: Frequency correction in parts per million to compensate for crystal oscillator drift."
                  />
                </MetadataLabel>
                <MetadataValue>
                  {naptMetadata.gain?.toFixed(1) || "N/A"} dB / {naptMetadata.ppm || 0}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>
                  AGC
                  <Tooltip
                    title="Automatic Gain Control"
                    content="Tuner AGC: Hardware automatic gain control. RTL AGC: Software automatic gain control. Both help optimize signal levels automatically."
                  />
                </MetadataLabel>
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
