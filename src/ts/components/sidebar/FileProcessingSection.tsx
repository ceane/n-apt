import React, { useRef } from "react";
import styled from "styled-components";
import { Tooltip, Button } from "@n-apt/components/ui";
import { Activity, Download, Trash2, CheckCircle2, Play, Pause, Loader2 } from "lucide-react";
import { GeolocationData, AptChannelMetadata } from "@n-apt/consts/schemas/websocket";
import { useAppSelector } from "@n-apt/redux";

import { fileRegistry } from "../../utils/fileRegistry";

type NaptMetadata = {
  sample_rate?: number;
  sample_rate_hz?: number;
  capture_sample_rate_hz?: number;
  hardware_sample_rate_hz?: number;
  channels?: Array<{
    center_freq_hz?: number;
    sample_rate_hz?: number;
    bins_per_frame?: number;
  } & AptChannelMetadata>;
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
  // Geolocation data
  geolocation?: GeolocationData;
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
  color: ${(props) => (props.$fileMode ? props.theme.primary : props.theme.metadataLabel)};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 20px;
  margin-bottom: 0;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  grid-column: 1 / -1;
`;

const SettingRow = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  padding: 10px 12px;
  background-color: ${(props) => props.theme.surface};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.border};
  user-select: none;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
  position: relative;
  z-index: 1;
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
  color: ${(props) => props.theme.textPrimary};
  opacity: 0.8;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const SettingValue = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  justify-self: end;
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

const DownloadLink = styled.a`
  color: ${(props) => props.theme.primary};
  font-size: 11px;
`;

const LoadedLabel = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.success};
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
  opacity: 0.8;
  
  &:hover {
    opacity: 1;
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

const ActionsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  grid-column: 1 / -1;
  margin-top: 8px;
`;

const DropZone = styled.div<{ $isDragging: boolean }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  position: relative;
  border: 2px dashed ${(props) => (props.$isDragging ? props.theme.primary : "transparent")};
  border-radius: 8px;
  background-color: ${(props) => (props.$isDragging ? `${props.theme.primary}1a` : "transparent")};
  transition: all 0.2s ease;
  min-height: 40px;
  z-index: 5;
`;

const DropOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: ${(props) => props.theme.mode === "light" ? "rgba(255, 255, 255, 0.7)" : `${props.theme.primary}1a`};
  border-radius: 6px;
  z-index: 10;
  pointer-events: none;
  color: ${(props) => props.theme.primary};
  font-weight: 600;
  font-size: 14px;
  backdrop-filter: blur(2px);
`;

const FileCard = styled.div`
  background-color: ${(props) => props.theme.surface};
  padding: 16px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.border};
  margin-bottom: 12px;
  display: grid;
  gap: 12px;
  grid-column: 1 / -1;
  position: relative;
  z-index: 1;
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
  color: ${(props) => props.theme.textPrimary};
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
  background-color: ${(props) => props.theme.surface};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.border};
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
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.4;
  min-width: 0;
`;

const FileInfoActions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`;

const DownloadActionLink = styled(DownloadLink)`
  text-decoration: underline;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const RemoveActionButton = styled(RemoveButton)`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const ClearAllContainer = styled.div`
  display: flex;
  justify-content: flex-start;
  grid-column: 1 / -1;
`;

const MetadataErrorBox = styled.div`
  color: ${(props) => props.theme.danger};
  font-size: 11px;
  font-family: ${(props) => props.theme.typography.mono};
  padding: 10px;
  background-color: ${(props) => `${props.theme.danger}12`};
  border-radius: 6px;
  border: 1px solid ${(props) => `${props.theme.danger}2a`};
`;

const MetadataEmptyBox = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 11px;
  font-family: ${(props) => props.theme.typography.mono};
  padding: 12px;
  background-color: ${(props) => props.theme.surface};
  border-radius: 6px;
  border: 1px solid ${(props) => props.theme.border};
  text-align: center;
`;

interface FileProcessingSectionProps {
  selectedFiles: { id: string; name: string; downloadUrl?: string }[];
  stitchStatus: string;
  isStitchPaused: boolean;
  selectedNaptFile: { id: string; name: string; downloadUrl?: string } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  onSelectedFilesChange: (
    files: { id: string; name: string; downloadUrl?: string }[],
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
  const activePlaybackMetadata = useAppSelector(
    (state) => state.waterfall.activePlaybackMetadata,
  );
  const displayedCenterFrequencyHz =
    activePlaybackMetadata?.center_frequency_hz ||
    naptMetadata?.center_frequency_hz ||
    (naptMetadata?.center_frequency
      ? naptMetadata.center_frequency * 1_000_000
      : 0);
  const displayedCaptureRateHz =
    activePlaybackMetadata?.capture_sample_rate_hz ||
    (naptMetadata?.channels?.length === 1 &&
      typeof naptMetadata.channels[0]?.sample_rate_hz === "number"
      ? naptMetadata.channels[0].sample_rate_hz
      : naptMetadata?.capture_sample_rate_hz ||
      naptMetadata?.sample_rate_hz ||
      naptMetadata?.sample_rate ||
      0);
  const displayedFrameRate = activePlaybackMetadata?.frame_rate ?? naptMetadata?.frame_rate;

  const stitchButtonRef = useRef<HTMLButtonElement | null>(null);

  const [isDragging, setIsDragging] = React.useState(false);

  const processFiles = (files: File[]) => {
    if (files.length === 0) return;

    // Register files in the non-serializable registry
    const registeredFiles = files.map(file => ({
      id: fileRegistry.register(file),
      name: file.name
    }));

    onSelectedFilesChange(registeredFiles);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    processFiles(Array.from(e.target.files));
    // Reset value so selection of same file triggers onChange again
    e.target.value = "";
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeFile = (index: number) => {
    const fileToRemove = selectedFiles[index];
    if (fileToRemove) {
      fileRegistry.remove(fileToRemove.id);
    }
    onSelectedFilesChange(selectedFiles.filter((_, i) => i !== index));
  };

  const stitchingActive =
    stitchStatus?.includes("Loading") ||
    stitchStatus?.includes("Processing") ||
    stitchStatus?.includes("computing");
  const hasProcessedData = stitchStatus?.includes("Successfully");

  return (
    <DropZone
      $isDragging={isDragging}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && <DropOverlay>Drop files here</DropOverlay>}
      <Section>
        <SectionTitle $fileMode>File selection</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Choose or drag files...</SettingLabel>
          </SettingLabelContainer>
          <FileInputActions>
            <HiddenFileInput
              type="file"
              accept=".napt,.wav,.c64"
              multiple
              id="fileInput"
              onChange={handleFileChange}
            />
            <Button
              $variant="secondary"
              onClick={() => document.getElementById("fileInput")?.click()}
            >
              Browse
            </Button>
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
                  <FileInfoActions>
                    <LoadedLabel>
                      <CheckCircle2 size={12} /> Loaded
                    </LoadedLabel>
                    {file.downloadUrl && (
                      <DownloadActionLink
                        href={`${file.downloadUrl}${sessionToken ? `&token=${encodeURIComponent(sessionToken)}` : ''}`}
                        download={file.name}
                      >
                        <Download size={12} /> Download
                      </DownloadActionLink>
                    )}
                  </FileInfoActions>
                  <RemoveActionButton onClick={() => removeFile(index)}>
                    <Trash2 size={12} /> Remove?
                  </RemoveActionButton>
                </FileInfoRow>
              </FileCard>
            ))}
            {selectedFiles.length > 0 && (
              <ClearAllContainer>
                <ClearAllLink onClick={onClear}>
                  Clear all?
                </ClearAllLink>
              </ClearAllContainer>
            )}
          </Section>

          <ActionsContainer>
            {stitchStatus && !stitchingActive && stitchStatus.startsWith("Stitching failed") && (
              <StitchStatusMessage $isError={true}>
                {stitchStatus}
              </StitchStatusMessage>
            )}

            <Button
              $variant={
                stitchingActive
                  ? "secondary"
                  : stitchStatus?.startsWith("Stitching failed")
                    ? "danger"
                    : "primary"
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
              style={{ width: '100%', padding: '12px' }}
            >
              {stitchingActive ? (
                <><Loader2 size={16} className="animate-spin" /> Processing...</>
              ) : stitchStatus?.startsWith("Stitching failed") ? (
                "Error"
              ) : hasProcessedData ? (
                isStitchPaused ? (
                  <><Play size={16} fill="currentColor" /> Play</>
                ) : (
                  <><Pause size={16} fill="currentColor" /> Pause</>
                )
              ) : (
                <><CheckCircle2 size={16} /> Process then play</>
              )}
            </Button>
          </ActionsContainer>
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
            <MetadataErrorBox>
              {naptMetadataError}
            </MetadataErrorBox>
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
                  {(displayedCenterFrequencyHz / 1000000).toFixed(3)}{" "}
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
                  {displayedCaptureRateHz / 1000000}{" "}
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
                  {typeof displayedFrameRate === "number"
                    ? displayedFrameRate.toFixed(1)
                    : "N/A"}
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
              {naptMetadata.geolocation && (
                <MetadataItem>
                  <MetadataLabel>
                    Geolocation
                    <Tooltip
                      title="Geolocation"
                      content="GPS coordinates where the capture was recorded. Format: Latitude, Longitude in decimal degrees."
                    />
                  </MetadataLabel>
                  <MetadataValue>
                    {naptMetadata.geolocation.latitude}, {naptMetadata.geolocation.longitude}
                  </MetadataValue>
                </MetadataItem>
              )}
            </MetadataGrid>
          ) : (
            <MetadataEmptyBox>
              {selectedFiles.length === 1
                ? "No extended metadata available for this file type."
                : "Multiple files selected. Stitch/Process to visualize combined spectrum."}
            </MetadataEmptyBox>
          )}
        </Section>
      )}
    </DropZone>
  );
};

export default FileProcessingSection;
