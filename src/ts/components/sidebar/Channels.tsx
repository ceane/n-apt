import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { ChevronsLeftRightEllipsis } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setSignalAreaAndRange } from "@n-apt/redux";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useSpectrumTransport } from "@n-apt/hooks/useSpectrumTransport";
import { formatFrequency, formatChannelFreq } from "@n-apt/utils/frequency";
import ReduxFrequencyRangeSlider from "@n-apt/components/sidebar/ReduxFrequencyRangeSlider";
import { Collapsible, Tooltip } from "@n-apt/components/ui";
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";
import { calculateCenterFrequency } from "@n-apt/utils/centerFrequency";
import {
  clampFrequencyRangeToBounds,
  findRangeContainingFrequency,
  normalizeFrequencyRangeToHz,
} from "@n-apt/utils/frequency";
import { isRtlSdrDevice } from "@n-apt/utils/sdrSampleRateGuards";
import { useChannelTuner } from "@n-apt/hooks/useChannelManagement";

/** Matches sidebar `Section`: participates in parent subgrid so nested `ReduxFrequencyRangeSlider` subgrid works. */
const ChannelsSection = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
`;

const ChannelsSectionTitle = styled.div<{ $fileMode?: boolean }>`
  font-size: 11px;
  color: ${(props) =>
    props.$fileMode ? props.theme.fileMode : props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SectionText = styled.span`
  display: flex;
  align-items: center;
`;

/** Same as the former Spectrum inline grid wrapper — must be `display: grid` (not flex) for slider subgrid + drag. */
const ChannelsSpectrumGrid = styled.div`
  display: grid;
  gap: 16px;
  width: 100%;
  grid-column: 1 / -1;
  box-sizing: border-box;
  min-width: 0;
`;

/** Grid (not flex) so nested `ReduxFrequencyRangeSlider` subgrid matches spectrum sidebar behavior. */
const ChannelsDemodBody = styled.div`
  display: grid;
  gap: 16px;
  grid-column: 1 / -1;
  padding: 8px 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
`;

const ChannelBlock = styled.button<{ $isActive: boolean }>`
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 20px;
  text-align: left;
  transition: opacity 0.2s ease;
  user-select: none;
  align-items: center;

  &:hover {
    opacity: 0.8;
  }
`;

const ChannelLetter = styled.span<{ $isActive: boolean }>`
  font-size: 36px;
  font-weight: 800;
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textDisabled};
  line-height: 1;
`;

const ChannelFreq = styled.span<{ $isActive: boolean }>`
  font-size: 18px;
  font-weight: 700;
  font-family: ${(props) => props.theme.typography.mono};
  color: ${(props) =>
    props.$isActive ? props.theme.primary : props.theme.textDisabled};
`;

const SampleRateLabel = styled.p`
  grid-column: 1 / -1;
  font-size: 11px;
  color: ${(props) => props.theme.textMuted};
  line-height: 1.5;
  margin: 16px 0 0 0;
  font-family: ${(props) => props.theme.typography.mono};
  font-weight: 500;
`;

const SampleRateValue = styled.span`
  color: ${(props) => props.theme.primary};
`;

// Box to describe the currently active channel and show bandwidth stats
const ActiveChannelInfoBox = styled.div`
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0 16px 16px;
  margin-right: 20px;
  grid-column: 1 / -1;
  font-family: sans-serif;
  font-size: 12px;
`;

const ActiveChannelInfoTitle = styled.div`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-weight: 600;
  font-family: sans-serif;
  margin-bottom: 8px;
`;

const ActiveChannelDescription = styled.p`
  margin: 0 0 8px 0;
  color: ${(props) => props.theme.textSecondary};
  font-size: 12px;
  line-height: 1.5;
`;

const ActiveChannelBandwidthList = styled.div`
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.8;
`;

// Mono value span for JetBrains Mono after '='
const MonoValue = styled.span`
  display: inline-block;
  font-family: "JetBrains Mono", monospace;
  font-weight: bold;
  background: ${(props) => props.theme.surface};
  padding: 0.1rem 0.25rem;
  margin: 0.1rem 0;
  border-radius: 8px;
`;

const FrequencyInputContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
  grid-column: 1 / -1;
`;

const FrequencyInput = styled.input`
  background-color: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 14px;
  padding: 6px 8px;
  width: 100px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }
`;

const FrequencyLabel = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
`;

const TuneButton = styled.button`
  padding: 6px 12px;
  background-color: ${(props) => props.theme.primary};
  border: 1px solid ${(props) => props.theme.primary};
  border-radius: 4px;
  color: ${(props) => props.theme.background};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: ${(props) => `${props.theme.primary}cc`};
  }

  &:disabled {
    background-color: ${(props) => props.theme.borderHover};
    border-color: ${(props) => props.theme.borderHover};
    color: ${(props) => props.theme.textMuted};
    cursor: not-allowed;
  }
`;

const ModeToggle = styled.div`
  display: flex;
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 6px;
  padding: 2px;
  margin: 12px 0;
  grid-column: 1 / -1;
`;

const ModeButton = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: ${(props) =>
    props.$active ? props.theme.background : props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: ${(props) =>
    props.$active ? props.theme.primary : "transparent"};

  &:hover {
    background-color: ${(props) =>
      props.$active
        ? `${props.theme.primary}cc`
        : `${props.theme.borderHover}33`};
  }
`;

const EmptyStateText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 12px;
  font-style: italic;
`;

const Divider = styled.hr`
  border: 0;
  height: 1px;
  background: ${(props) => props.theme.borderHover};
  margin: 8px 0 12px;
`;

const OtherChannelInfoBox = styled(ActiveChannelInfoBox)`
  margin-top: 8px;
`;

export type ChannelsVariant = "demod" | "spectrum";

interface ChannelsProps {
  /** `spectrum`: compact Redux sliders (spectrum sidebar). `demod`: channel/manual controls (demod sidebar). */
  variant?: ChannelsVariant;
  /** Spectrum sidebar only: use file-mode title color when viewing captures. */
  fileMode?: boolean;
  limitMarkers?: Array<{ freq: number; label: string }>;
  isScanning?: boolean;
  scanProgress?: number;
  scanCurrentFreq?: number;
  scanRange?: FrequencyRange;
  onScanStart?: () => void;
  onScanStop?: () => void;
  /** Disables the range sliders while the live stream is not ready. */
  rangeSlidersDisabled?: boolean;
  /** When true, hides the Channels section header. Useful for embedding in constrained areas. */
  hideTitle?: boolean;
}

const IQExplainerTooltip = () => (
  <Tooltip
    title=""
    content="I/Q data makes up the signal (what comes out of the antenna and is in the air) <br /><br /> I and Q are pairs of bytes, both from 0-255 that represent one point that make up points of a signal.<br ><br />Example: I = 2, Q = 100 at 4kHz <br /><br /> I = In-phase component (the “main” wave direction) <br /> Q = Quadrature component (the part shifted by 90° — like a “sideways” version of the wave)<br />"
  />
);

export const Channels: React.FC<ChannelsProps> = ({
  variant = "demod",
  fileMode = false,
  limitMarkers,
  isScanning = false,
  scanProgress = 0,
  scanCurrentFreq,
  scanRange,
  onScanStart: _onScanStart,
  onScanStop: _onScanStop,
  rangeSlidersDisabled = false,
  hideTitle = false,
}) => {
  const reduxDispatch = useAppDispatch();
  const spectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
  const websocketChannels = useAppSelector((s) => s.websocket.channels);
  const websocketSampleRateHz = useAppSelector((s) => s.websocket.sampleRateHz);
  const websocketSdrSampleRateHz = useAppSelector(
    (s) => s.websocket.sdrSettings?.sample_rate,
  );
  const websocketMaxSampleRateHz = useAppSelector(
    (s) => s.websocket.maxSampleRateHz,
  );
  const websocketDeviceProfile = useAppSelector(
    (s) => s.websocket.deviceProfile,
  );
  const websocketBackend = useAppSelector((s) => s.websocket.backend);
  const reduxActiveSignalArea = useAppSelector(
    (s) => s.spectrum.activeSignalArea,
  );
  const hardwareSpectrumBounds = useAppSelector((s) => s.demod.hardwareRange);
  const {
    state,
    effectiveFrames,
    sampleRateHzEffective: sampleRateHz,
    selectedSourceDerived,
    wsConnection,
  } = useSpectrumStore();
  const spectrumTransport = useSpectrumTransport();
  const { tuneChannels } = useChannelTuner();
  const isRtlSdr = isRtlSdrDevice({
    deviceKind:
      websocketDeviceProfile?.kind ??
      selectedSourceDerived?.deviceProfile?.kind ??
      wsConnection?.deviceProfile?.kind,
    backend:
      websocketBackend ??
      selectedSourceDerived?.backend ??
      wsConnection?.backend,
    deviceName:
      selectedSourceDerived?.deviceName ??
      wsConnection?.deviceName ??
      undefined,
    isRtlSdr:
      websocketDeviceProfile?.is_rtl_sdr ??
      selectedSourceDerived?.deviceProfile?.is_rtl_sdr ??
      wsConnection?.deviceProfile?.is_rtl_sdr,
  });
  const sourceKind = (
    websocketDeviceProfile?.kind ??
    selectedSourceDerived?.deviceProfile?.kind ??
    selectedSourceDerived?.backend ??
    wsConnection?.deviceProfile?.kind ??
    wsConnection?.backend ??
    ""
  ).toLowerCase();
  const sourceName = (
    selectedSourceDerived?.deviceName ??
    wsConnection?.deviceName ??
    ""
  ).toLowerCase();
  const supportsWholeChannelDisplay =
    !isRtlSdr &&
    (sourceKind.includes("hackrf") ||
      sourceKind.includes("mock") ||
      sourceName.includes("mock"));
  const rtlHardwareSampleRateHz =
    typeof websocketSdrSampleRateHz === "number" &&
    Number.isFinite(websocketSdrSampleRateHz) &&
    websocketSdrSampleRateHz > 0
      ? websocketSdrSampleRateHz
      : typeof selectedSourceDerived?.sdrSettings?.sample_rate === "number" &&
          Number.isFinite(selectedSourceDerived.sdrSettings.sample_rate) &&
          selectedSourceDerived.sdrSettings.sample_rate > 0
        ? selectedSourceDerived.sdrSettings.sample_rate
        : typeof wsConnection?.sdrSettings?.sample_rate === "number" &&
            Number.isFinite(wsConnection.sdrSettings.sample_rate) &&
            wsConnection.sdrSettings.sample_rate > 0
          ? wsConnection.sdrSettings.sample_rate
          : 3_200_000;
  const channelSampleRateHz = isRtlSdr
    ? rtlHardwareSampleRateHz
    : typeof state.sampleRateHz === "number" &&
        Number.isFinite(state.sampleRateHz) &&
        state.sampleRateHz > 0
      ? state.sampleRateHz
      : typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz)
        ? sampleRateHz
        : typeof websocketSampleRateHz === "number" &&
            Number.isFinite(websocketSampleRateHz)
          ? websocketSampleRateHz
          : typeof websocketSdrSampleRateHz === "number" &&
              Number.isFinite(websocketSdrSampleRateHz)
            ? websocketSdrSampleRateHz
            : typeof websocketMaxSampleRateHz === "number" &&
                Number.isFinite(websocketMaxSampleRateHz)
              ? websocketMaxSampleRateHz
              : null;

  const liveFramesToUse = useMemo(() => {
    if (effectiveFrames.length > 0) {
      return effectiveFrames;
    }
    if (Array.isArray(websocketChannels) && websocketChannels.length > 0) {
      return websocketChannels;
    }
    return spectrumFrames;
  }, [effectiveFrames, spectrumFrames, websocketChannels]);

  const [manualFrequency, setManualFrequency] = useState<string>("137_100_000"); // Default to APT frequency in Hz
  const [isManualMode, setIsManualMode] = useState<boolean>(false);

  const channels = useMemo(() => {
    const frames =
      effectiveFrames.length > 0 ? effectiveFrames : websocketChannels;
    if (!Array.isArray(frames)) return [];
    return frames.filter((f) => ["A", "B", "C"].includes(f.label));
  }, [effectiveFrames, websocketChannels]);
  const currentFrequencyRange = state.frequencyRange;
  const currentCenterFrequencyHz = calculateCenterFrequency(
    currentFrequencyRange,
  );
  const channelRanges = useMemo(
    () => channels.map((ch) => ({ min: ch.min_hz, max: ch.max_hz })),
    [channels],
  );
  const channelForCurrentCenter = findRangeContainingFrequency(
    currentCenterFrequencyHz ?? Number.NaN,
    channelRanges,
  );

  // Source/channel state can hydrate through the live store and Redux on
  // separate ticks. When that happens, the restored frequency range is the
  // strongest indication of which channel Whole Channel belongs to. Keeping
  // this resolution here makes the mode and all channel sliders agree during
  // the initial render instead of applying B's span to C.
  const activeSignalArea = useMemo(() => {
    const candidates = [state.activeSignalArea, reduxActiveSignalArea].filter(
      (label, index, all): label is string =>
        typeof label === "string" &&
        label.length > 0 &&
        all.indexOf(label) === index,
    );
    const center = currentCenterFrequencyHz;
    if (typeof center === "number" && Number.isFinite(center)) {
      // The VFO range is authoritative while scrolling. The stored active
      // label can lag behind it by a render (or remain stale after a free
      // scroll), so derive the active channel directly from the center.
      const matchingChannel = channels.find(
        (channel) => center >= channel.min_hz && center <= channel.max_hz,
      );
      return matchingChannel?.label ?? "";
    }
    return candidates[0] ?? "A";
  }, [
    channels,
    currentCenterFrequencyHz,
    reduxActiveSignalArea,
    state.activeSignalArea,
  ]);

  // Compute information for the active channel box
  // Resolve the active frame robustly from both sources
  const activeFrame =
    effectiveFrames.length > 0
      ? effectiveFrames.find(
          (f: any) =>
            String(f.label).toLowerCase() ===
            String(activeSignalArea).toLowerCase(),
        ) ||
        channels.find(
          (f: any) =>
            String(f.label).toLowerCase() ===
            String(activeSignalArea).toLowerCase(),
        )
      : Array.isArray(websocketChannels)
        ? websocketChannels.find(
            (f: any) =>
              String(f.label).toLowerCase() ===
              String(activeSignalArea).toLowerCase(),
          ) ||
          channels.find(
            (f: any) =>
              String(f.label).toLowerCase() ===
              String(activeSignalArea).toLowerCase(),
          )
        : undefined;
  const isWholeChannelMode =
    supportsWholeChannelDisplay &&
    typeof channelSampleRateHz === "number" &&
    Number.isFinite(channelSampleRateHz) &&
    liveFramesToUse.some(
      (frame) =>
        Number.isFinite(frame.min_hz) &&
        Number.isFinite(frame.max_hz) &&
        Math.round(channelSampleRateHz) ===
          Math.round(Math.max(0, frame.max_hz - frame.min_hz)),
    );
  const shouldUseWholeChannelRange = (frame: {
    min_hz: number;
    max_hz: number;
  }) =>
    supportsWholeChannelDisplay &&
    typeof channelSampleRateHz === "number" &&
    Number.isFinite(channelSampleRateHz) &&
    Math.round(channelSampleRateHz) ===
      Math.round(Math.max(0, frame.max_hz - frame.min_hz));
  const activeDescription: string = activeFrame?.description ?? "";
  // Bandwidth estimation: 1 byte per Hz, width in Hz -> B/s -> MB/s
  const widthHz = activeFrame
    ? Math.max(0, Number(activeFrame.max_hz) - Number(activeFrame.min_hz))
    : 0;
  const bandwidthMBps = Math.max(0, widthHz) / 1_000_000;
  const minutes5MB = bandwidthMBps * 300; // 5 minutes
  const hourMB = bandwidthMBps * 3600; // 1 hour
  const dayMB = bandwidthMBps * 86400; // 24 hours

  // Helpers to format bandwidth values with human-friendly units
  const formatBWperSec = (mbPerSec: number) => {
    const bps = mbPerSec * 1_000_000; // convert MB/s to B/s
    const tb = mbPerSec / 1024;
    if (tb >= 0.8) {
      // Show near-next-TB values with a single decimal (e.g., 0.9 TB)
      return `${tb.toFixed(1)} TB/s`;
    }
    if (bps >= 1_000_000_000_000) {
      return `${(bps / 1_000_000_000_000).toFixed(2)} TB/s`;
    }
    if (bps >= 1_000_000_000) {
      return `${(bps / 1_000_000_000).toFixed(2)} GB/s`;
    }
    if (bps >= 1_000_000) {
      return `${(bps / 1_000_000).toFixed(2)} MB/s`;
    }
    if (bps >= 1_000) {
      return `${(bps / 1_000).toFixed(2)} KB/s`;
    }
    return `${bps.toFixed(0)} B/s`;
  };
  const formatMBValue = (mb: number) => {
    // MB -> GB/TB when large
    const gb = mb / 1024;
    const tb = gb / 1024;
    if (tb >= 1) return `${tb.toFixed(2)} TB`;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    return `${mb.toFixed(0)} MB`;
  };

  const iqSize = 2; // I, Q = u8 + u8 = 2 bytes
  const iqDataRateMBps = formatBWperSec(bandwidthMBps * iqSize);
  const formattedDataBandwidth = formatBWperSec(bandwidthMBps);
  const formattedSignalBandwidth = (widthHz / 1_000_000).toFixed(2);
  const shouldShowOtherChannel =
    typeof currentCenterFrequencyHz === "number" &&
    Number.isFinite(currentCenterFrequencyHz) &&
    !channelForCurrentCenter;
  const otherChannelFrequencyLabel =
    typeof currentCenterFrequencyHz === "number" &&
    Number.isFinite(currentCenterFrequencyHz)
      ? formatFrequency(currentCenterFrequencyHz)
      : "X.X MHz";
  const otherChannelRangeLabel =
    currentFrequencyRange &&
    Number.isFinite(currentFrequencyRange.min) &&
    Number.isFinite(currentFrequencyRange.max)
      ? `${formatFrequency(currentFrequencyRange.min)} - ${formatFrequency(currentFrequencyRange.max)}`
      : "Outside known channel ranges";

  if (variant === "spectrum") {
    return (
      <ChannelsSection>
        {!hideTitle && (
          <ChannelsSectionTitle $fileMode={fileMode}>
            <ChevronsLeftRightEllipsis size={14} />
            <SectionText>Channels</SectionText>
          </ChannelsSectionTitle>
        )}
        <ChannelsSpectrumGrid>
          {Array.isArray(liveFramesToUse) && liveFramesToUse.length > 0 ? (
            liveFramesToUse.map((frame) => {
              const label = frame.label;
              const minFreq = frame.min_hz;
              const maxFreq = frame.max_hz;
              const channelSpan = maxFreq - minFreq;
              const sliderSampleRateHz =
                !supportsWholeChannelDisplay &&
                typeof channelSampleRateHz === "number" &&
                Number.isFinite(channelSampleRateHz) &&
                channelSampleRateHz >= channelSpan
                  ? Math.min(3_200_000, channelSpan)
                  : channelSampleRateHz;
              const isFrameActive =
                String(activeSignalArea).toLowerCase() ===
                String(label).toLowerCase();

              return (
                <ReduxFrequencyRangeSlider
                  key={frame.id}
                  label={label}
                  minFreq={minFreq}
                  maxFreq={maxFreq}
                  disabled={rangeSlidersDisabled}
                  sampleRateHz={sliderSampleRateHz}
                  isActive={isFrameActive}
                  isWholeChannelMode={shouldUseWholeChannelRange(frame)}
                  forceFullWidth={isWholeChannelMode}
                  allowWideSampleRateOverscan
                  limitMarkers={limitMarkers}
                  onActivate={() => {
                    const sampleRateCoversChannel =
                      supportsWholeChannelDisplay &&
                      typeof sliderSampleRateHz === "number" &&
                      Number.isFinite(sliderSampleRateHz) &&
                      sliderSampleRateHz >= channelSpan;
                    const shouldUseWholeChannelRange =
                      isWholeChannelMode || sampleRateCoversChannel;
                    const rememberedRange = shouldUseWholeChannelRange
                      ? null
                      : (state.lastKnownRanges?.[label] ??
                        state.lastKnownRanges?.[label.toLowerCase()]);
                    const nextRange = rememberedRange ?? {
                      min: minFreq,
                      max: shouldUseWholeChannelRange
                        ? maxFreq
                        : minFreq +
                          (typeof sliderSampleRateHz === "number"
                            ? Math.min(sliderSampleRateHz, channelSpan)
                            : channelSpan),
                    };
                    const clampedRange =
                      typeof sliderSampleRateHz === "number" &&
                      sliderSampleRateHz > channelSpan
                        ? normalizeFrequencyRangeToHz(nextRange)
                        : normalizeFrequencyRangeToHz(
                            clampFrequencyRangeToBounds(
                              clampFrequencyRangeToBounds(nextRange, {
                                min: minFreq,
                                max: maxFreq,
                              }),
                              isRtlSdr
                                ? { min: minFreq, max: maxFreq }
                                : hardwareSpectrumBounds,
                            ),
                          );
                    tuneChannels(
                      [{ label, min: minFreq, max: maxFreq }],
                      undefined,
                      clampedRange,
                    );
                  }}
                />
              );
            })
          ) : (
            <EmptyStateText>No active signal areas</EmptyStateText>
          )}
        </ChannelsSpectrumGrid>

        {/* Active Channel Description & Stats Box */}
        {activeFrame && !shouldShowOtherChannel && (
          <ActiveChannelInfoBox>
            <Collapsible title="Channel Description">
              {activeDescription ? (
                <>
                  <br />
                  <ActiveChannelInfoTitle>
                    Channel {activeFrame.label}
                  </ActiveChannelInfoTitle>
                  <ActiveChannelDescription>
                    {activeDescription}
                  </ActiveChannelDescription>
                  <Divider />
                </>
              ) : null}

              <Collapsible title="More...">
                <ActiveChannelBandwidthList>
                  <IQExplainerTooltip /> Naive Signal Bandwidth (I/Q) ={" "}
                  <MonoValue>{iqDataRateMBps}</MonoValue> <br />
                  Naive Data Bandwidth ={" "}
                  <MonoValue>{formattedDataBandwidth}</MonoValue> of{" "}
                  <MonoValue>{formattedSignalBandwidth} MHz</MonoValue>
                  <br />5 mins ={" "}
                  <MonoValue>{formatMBValue(minutes5MB)}</MonoValue>
                  <br />1 hour = <MonoValue>{formatMBValue(hourMB)}</MonoValue>
                  <br />
                  24 hours = <MonoValue>{formatMBValue(dayMB)}</MonoValue>
                </ActiveChannelBandwidthList>
              </Collapsible>
            </Collapsible>
          </ActiveChannelInfoBox>
        )}
        {shouldShowOtherChannel && (
          <OtherChannelInfoBox>
            <Collapsible title="Channel Description">
              <br />
              <ActiveChannelInfoTitle>Other...</ActiveChannelInfoTitle>
              <ActiveChannelDescription>
                {otherChannelRangeLabel}
              </ActiveChannelDescription>
              <Divider />
              <ActiveChannelBandwidthList>
                Center Frequency ={" "}
                <MonoValue>{otherChannelFrequencyLabel}</MonoValue>
                <br />
                Sample Rate ={" "}
                <MonoValue>
                  {channelSampleRateHz
                    ? formatFrequency(channelSampleRateHz)
                    : "X.X MHz"}
                </MonoValue>
              </ActiveChannelBandwidthList>
            </Collapsible>
          </OtherChannelInfoBox>
        )}
      </ChannelsSection>
    );
  }

  const handleTune = (frame: any) => {
    tuneChannels([
      {
        label: frame.label,
        min: frame.min_hz,
        max: frame.max_hz,
      },
    ]);
    setIsManualMode(false);
  };

  const handleManualTune = () => {
    const freq = parseFloat(manualFrequency);
    if (isNaN(freq) || freq <= 0) return;

    // Use window size from demod context (default 25kHz if not available)
    const windowSizeHz = 25_000; // 25kHz in Hz
    const freqHz = freq; // Raw Hz now
    const range = {
      min: Math.max(0, freqHz - windowSizeHz / 2),
      max: freqHz + windowSizeHz / 2,
    };

    reduxDispatch(setSignalAreaAndRange({ area: "manual", range }));

    spectrumTransport.sendFrequencyRange(range);
    setIsManualMode(true);
  };

  const handleModeToggle = (manual: boolean) => {
    setIsManualMode(manual);
    if (!manual) {
      // When switching to channel mode, tune to first available channel
      if (channels.length > 0) {
        handleTune(channels[0]);
      }
    }
  };

  return (
    <ChannelsSection>
      {!hideTitle && (
        <ChannelsSectionTitle>
          <ChevronsLeftRightEllipsis size={14} />
          <SectionText>Channels</SectionText>
        </ChannelsSectionTitle>
      )}
      <ChannelsDemodBody>
        {/* Channel/Manual Toggle */}
        <ModeToggle>
          <ModeButton
            $active={!isManualMode}
            onClick={() => handleModeToggle(false)}
          >
            Channel(s)
          </ModeButton>
          <ModeButton
            $active={isManualMode}
            onClick={() => handleModeToggle(true)}
          >
            Manual
          </ModeButton>
        </ModeToggle>

        {/* Manual Frequency Input - Only show when Manual is selected */}
        {isManualMode && (
          <FrequencyInputContainer>
            <FrequencyLabel>Manual Freq (Hz):</FrequencyLabel>
            <FrequencyInput
              type="number"
              value={manualFrequency}
              onChange={(e) => setManualFrequency(e.target.value)}
              step="1000"
              min="0"
              max="20_000_000_000"
              placeholder="137_100_000"
            />
            <TuneButton onClick={handleManualTune} disabled={isScanning}>
              Tune
            </TuneButton>
          </FrequencyInputContainer>
        )}

        {/* Channel Buttons - Only show when Channel(s) is selected */}
        {!isManualMode &&
          channels.map((ch) => {
            const isActive =
              String(activeSignalArea).toLowerCase() ===
              String(ch.label).toLowerCase();
            const isChannelScanning =
              isScanning &&
              scanRange &&
              ch.min_hz <= (scanRange.max || 0) &&
              ch.max_hz >= (scanRange.min || 0);

            return (
              <React.Fragment key={ch.id}>
                <ChannelBlock
                  $isActive={isActive}
                  onClick={() => handleTune(ch)}
                >
                  <ChannelLetter $isActive={isActive}>{ch.label}</ChannelLetter>
                  <ChannelFreq $isActive={isActive}>
                    {formatChannelFreq(ch.min_hz)} -{" "}
                    {formatChannelFreq(ch.max_hz)}
                  </ChannelFreq>
                </ChannelBlock>

                {/* Show FrequencyRangeSlider only for the active channel */}
                {isActive && (
                  <ReduxFrequencyRangeSlider
                    label=""
                    signalAreaKey={ch.label}
                    minFreq={ch.min_hz}
                    maxFreq={ch.max_hz}
                    disabled={rangeSlidersDisabled}
                    sampleRateHz={channelSampleRateHz}
                    isWholeChannelMode={shouldUseWholeChannelRange(ch)}
                    forceFullWidth={isWholeChannelMode}
                    allowWideSampleRateOverscan
                    onActivate={() => handleTune(ch)}
                    readOnly={isChannelScanning}
                    scanProgress={isChannelScanning ? scanProgress : 0}
                    scanCurrentFreq={
                      isChannelScanning && scanCurrentFreq !== undefined
                        ? scanCurrentFreq
                        : undefined
                    }
                  />
                )}
              </React.Fragment>
            );
          })}

        <SampleRateLabel>
          Hardware sample rate:{" "}
          <SampleRateValue>
            {channelSampleRateHz
              ? formatFrequency(channelSampleRateHz)
              : "X.X MHz"}
          </SampleRateValue>
        </SampleRateLabel>
        {shouldShowOtherChannel && (
          <OtherChannelInfoBox>
            <ActiveChannelInfoTitle>Other...</ActiveChannelInfoTitle>
            <ActiveChannelDescription>
              {otherChannelRangeLabel}
            </ActiveChannelDescription>
            <ActiveChannelBandwidthList>
              Center Frequency ={" "}
              <MonoValue>{otherChannelFrequencyLabel}</MonoValue>
              <br />
              Sample Rate ={" "}
              <MonoValue>
                {channelSampleRateHz
                  ? formatFrequency(channelSampleRateHz)
                  : "X.X MHz"}
              </MonoValue>
            </ActiveChannelBandwidthList>
          </OtherChannelInfoBox>
        )}
      </ChannelsDemodBody>
    </ChannelsSection>
  );
};
