import React from "react";
import styled from "styled-components";
import { ScrollText } from "lucide-react";
import { Collapsible } from "@n-apt/components/ui/Collapsible";
import { Tooltip } from "@n-apt/components/ui";
import { formatFrequency } from "@n-apt/utils/frequency";
import { formatDuration, formatFileSize } from "@n-apt/utils/formatters";
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import { GeolocationData, AptChannelMetadata } from "@n-apt/consts/schemas/websocket";
import { useAppSelector } from "@n-apt/redux";

export type NaptMetadata = {
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
  acquisition_mode?: string;
  source_device?: string;
  fft_window?: string;
  tuner_agc?: boolean;
  rtl_agc?: boolean;
  geolocation?: GeolocationData;
};

const Section = styled.div<{ $marginTop?: string }>`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-top: ${(props) => props.$marginTop || "0"};
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

interface FileMetadataProps {
  selectedNaptFile: { id: string; name: string; downloadUrl?: string } | null;
  naptMetadata: NaptMetadata | null;
  naptMetadataError: string | null;
  sessionToken?: string | null;
  showTitle?: boolean;
  compact?: boolean;
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

export const FileMetadata: React.FC<FileMetadataProps> = ({
  selectedNaptFile,
  naptMetadata,
  naptMetadataError,
  sessionToken: _sessionToken,
  showTitle = true,
  compact: _compact = false,
}) => {
  const activePlaybackMetadata = useAppSelector(
    (state) => state.waterfall.activePlaybackMetadata,
  );

  const isFileMode = useAppSelector((state) => state.waterfall.sourceMode === "file");
  const displayedCenterFrequencyHz = (isFileMode && activePlaybackMetadata
    ? activePlaybackMetadata.center_frequency_hz
    : naptMetadata?.center_frequency_hz ??
    (naptMetadata?.center_frequency
      ? naptMetadata.center_frequency * 1_000_000
      : 0)) ?? 0;

  const displayedCaptureRateHz = (isFileMode && activePlaybackMetadata
    ? activePlaybackMetadata.capture_sample_rate_hz
    : (naptMetadata?.channels?.length === 1 &&
      typeof naptMetadata.channels[0]?.sample_rate_hz === "number"
      ? naptMetadata.channels[0].sample_rate_hz
      : naptMetadata?.capture_sample_rate_hz ??
      naptMetadata?.sample_rate_hz ??
      naptMetadata?.sample_rate ??
      0)) ?? 0;

  const displayedFrameRate = (isFileMode && activePlaybackMetadata)
    ? activePlaybackMetadata.frame_rate
    : naptMetadata?.frame_rate;
  const displayedFrequencyRange =
    activePlaybackMetadata?.frequency_range ?? naptMetadata?.frequency_range ?? null;
  const selectedFileSize = selectedNaptFile ? fileRegistry.get(selectedNaptFile.id)?.size : undefined;

  const captureStatus = useAppSelector((state) => state.websocket.captureStatus);
  const fileRowDurationSeconds =
    selectedNaptFile &&
    captureStatus?.status === "done" &&
    captureStatus.filename === selectedNaptFile.name &&
    typeof captureStatus.duration === "number"
      ? captureStatus.duration
      : typeof naptMetadata?.duration_s === "number"
        ? naptMetadata.duration_s
        : undefined;

return (
    <Section>
      {showTitle && (
        <Collapsible
          icon={<ScrollText size={14} />}
          label="Metadata"
          defaultOpen={true}
        >
          {selectedNaptFile && (
            <SettingRow style={{ height: 'auto', padding: '12px' }}>
              <SettingLabelContainer style={{ alignSelf: 'start', paddingTop: '4px' }}>
                <SettingLabel>File</SettingLabel>
              </SettingLabelContainer>
              <div style={{ display: "grid", gap: 4, justifySelf: "end", textAlign: "right", minWidth: 0 }}>
                <WrappedSettingValue title={selectedNaptFile.name}>
                  {renderFileName(selectedNaptFile.name)}
                </WrappedSettingValue>

                <SettingValue style={{ opacity: 0.75 }}>
                  {typeof selectedFileSize === "number" && (
                    formatFileSize(selectedFileSize)
                  )}
                  { "  /  " }
                  {typeof fileRowDurationSeconds === "number" &&
                    Number.isFinite(fileRowDurationSeconds) && (
                    formatDuration(fileRowDurationSeconds)
                  )}
                </SettingValue>
              </div>
            </SettingRow>
          )}

          {naptMetadataError ? (
            <MetadataErrorBox>
              {naptMetadataError}
            </MetadataErrorBox>
          ) : naptMetadata ? (
            <MetadataGrid>
              {activePlaybackMetadata && (activePlaybackMetadata.channelCount ?? 0) > 1 && (
                <MetadataItem style={{ gridColumn: '1 / -1' }}>
                  <MetadataLabel>Active Channel</MetadataLabel>
                  <MetadataValue style={{ fontWeight: 600 }}>
                    {activePlaybackMetadata.channelLabel || `Channel ${activePlaybackMetadata.activeChannel + 1}`}
                    {' '}/ {activePlaybackMetadata.channelCount}
                  </MetadataValue>
                </MetadataItem>
              )}
              <MetadataItem>
                <MetadataLabel>
                  Center Freq
                  <Tooltip
                    title="Center Frequency"
                    content="The center frequency of the SDR tuning in MHz. This is the frequency the radio was tuned to during capture."
                  />
                </MetadataLabel>
                <MetadataValue>
                  {formatFrequency(displayedCenterFrequencyHz / 1000000, {
                    trimTrailingZeros: true,
                  })}
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
                  {formatFrequency(displayedCaptureRateHz / 1000000, {
                    trimTrailingZeros: true,
                  })}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>Start Freq</MetadataLabel>
                <MetadataValue>
                  {displayedFrequencyRange
                    ? formatFrequency(displayedFrequencyRange[0], {
                        trimTrailingZeros: true,
                      })
                    : "N/A"}
                </MetadataValue>
              </MetadataItem>
              <MetadataItem>
                <MetadataLabel>End Freq</MetadataLabel>
                <MetadataValue>
                  {displayedFrequencyRange
                    ? formatFrequency(displayedFrequencyRange[1], {
                        trimTrailingZeros: true,
                      })
                    : "N/A"}
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
                  {formatFrequency(
                    (naptMetadata.hardware_sample_rate_hz || 0) / 1000000,
                    { trimTrailingZeros: true },
                  )}
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
                  {formatDuration(naptMetadata.duration_s ?? 0)}
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
              No extended metadata available for this file type.
            </MetadataEmptyBox>
          )}
        </Collapsible>
      )}
    </Section>
  );
};

export default FileMetadata;
