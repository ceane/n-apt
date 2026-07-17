import React from "react";
import styled from "styled-components";
import { ScrollText } from "lucide-react";
import { Collapsible } from "@n-apt/components/ui/Collapsible";
import { Tooltip } from "@n-apt/components/ui";
import {
  formatFrequency,
  type FormatFrequencyOptions,
} from "@n-apt/utils/frequency";
import {
  formatDuration,
  formatTimestampWithTimezone,
} from "@n-apt/utils/formatters";
import {
  GeolocationData,
  AptChannelMetadata,
} from "@n-apt/consts/schemas/websocket";
import { useAppSelector } from "@n-apt/redux";
import { DecryptionFallback } from "../ui/DecryptionFallback";

export type NaptMetadata = {
  sample_rate?: number;
  sample_rate_hz?: number;
  capture_sample_rate_hz?: number;
  hardware_sample_rate_hz?: number;
  channels?: Array<
    {
      center_freq_hz?: number;
      sample_rate_hz?: number;
      iq_length?: number;
      bins_per_frame?: number;
    } & AptChannelMetadata
  >;
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

const metadataFrequencyFormat: FormatFrequencyOptions = {
  precisionMHz: 3,
  precisionKHz: 3,
  trimTrailingZeros: true,
};

const formatMetadataFrequency = (freqHz: number) =>
  formatFrequency(freqHz, metadataFrequencyFormat);

export const FileMetadata: React.FC<FileMetadataProps> = ({
  selectedNaptFile: _selectedNaptFile,
  naptMetadata,
  naptMetadataError,
  sessionToken: _sessionToken,
  showTitle = true,
  compact: _compact = false,
}) => {
  const activePlaybackMetadata = useAppSelector(
    (state) => state.waterfall.activePlaybackMetadata,
  );

  const isFileMode = useAppSelector(
    (state) => state.waterfall.sourceMode === "file",
  );
  const displayedCenterFrequencyHz =
    (isFileMode && activePlaybackMetadata
      ? activePlaybackMetadata.center_frequency_hz
      : (naptMetadata?.center_frequency_hz ??
        naptMetadata?.center_frequency ??
        0)) ?? 0;

  const displayedCaptureRateHz =
    (isFileMode && activePlaybackMetadata
      ? activePlaybackMetadata.capture_sample_rate_hz
      : naptMetadata?.channels?.length === 1 &&
          typeof naptMetadata.channels[0]?.sample_rate_hz === "number"
        ? naptMetadata.channels[0].sample_rate_hz
        : (naptMetadata?.capture_sample_rate_hz ??
          naptMetadata?.sample_rate_hz ??
          naptMetadata?.sample_rate ??
          0)) ?? 0;

  const displayedFrameRate =
    isFileMode && activePlaybackMetadata
      ? activePlaybackMetadata.frame_rate
      : naptMetadata?.frame_rate;
  const displayedFrequencyRange =
    activePlaybackMetadata?.frequency_range ??
    naptMetadata?.frequency_range ??
    null;
  const content = (
    <>
      {naptMetadataError ? (
        <div className="mt-2">
          {naptMetadataError.toLowerCase().includes("decryption") ? (
            <DecryptionFallback moduleName="File Metadata" errorType="vault" />
          ) : (
            <MetadataErrorBox>{naptMetadataError}</MetadataErrorBox>
          )}
        </div>
      ) : naptMetadata ? (
        <MetadataGrid>
          {activePlaybackMetadata &&
            (activePlaybackMetadata.channelCount ?? 0) > 1 && (
              <MetadataItem style={{ gridColumn: "1 / -1" }}>
                <MetadataLabel>Active Channel</MetadataLabel>
                <MetadataValue style={{ fontWeight: 600 }}>
                  {activePlaybackMetadata.channelLabel ||
                    `Channel ${activePlaybackMetadata.activeChannel + 1}`}{" "}
                  / {activePlaybackMetadata.channelCount}
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
              {formatMetadataFrequency(displayedCenterFrequencyHz)}
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
              {formatMetadataFrequency(displayedCaptureRateHz)}
            </MetadataValue>
          </MetadataItem>
          <MetadataItem>
            <MetadataLabel>Start Freq</MetadataLabel>
            <MetadataValue>
              {displayedFrequencyRange
                ? formatMetadataFrequency(displayedFrequencyRange[0])
                : "N/A"}
            </MetadataValue>
          </MetadataItem>
          <MetadataItem>
            <MetadataLabel>End Freq</MetadataLabel>
            <MetadataValue>
              {displayedFrequencyRange
                ? formatMetadataFrequency(displayedFrequencyRange[1])
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
              {formatMetadataFrequency(
                naptMetadata.hardware_sample_rate_hz || 0,
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
              {naptMetadata.fft_size || naptMetadata.fft?.size || "N/A"} /{" "}
              {naptMetadata.fft_window || "Blackman"}
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
              {naptMetadata.gain?.toFixed(1) || "N/A"} dB /{" "}
              {naptMetadata.ppm || 0}
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
              T:{naptMetadata.tuner_agc ? "On" : "Off"} R:
              {naptMetadata.rtl_agc ? "On" : "Off"}
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
                ? formatTimestampWithTimezone(naptMetadata.timestamp_utc)
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
                {naptMetadata.geolocation.latitude},{" "}
                {naptMetadata.geolocation.longitude}
              </MetadataValue>
            </MetadataItem>
          )}
        </MetadataGrid>
      ) : (
        <MetadataEmptyBox>
          No extended metadata available for this file type.
        </MetadataEmptyBox>
      )}
    </>
  );

  return (
    <Section>
      {showTitle ? (
        <Collapsible
          icon={<ScrollText size={14} />}
          label="Metadata"
          defaultOpen={true}
        >
          {content}
        </Collapsible>
      ) : (
        content
      )}
    </Section>
  );
};

export default FileMetadata;
