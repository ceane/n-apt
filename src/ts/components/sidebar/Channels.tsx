import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { ChevronsLeftRightEllipsis } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setSignalAreaAndRange } from "@n-apt/redux";
import { requestNextLiveFrame } from "@n-apt/redux/thunks/websocketThunks";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { formatFrequency } from "@n-apt/utils/frequency";
import ReduxFrequencyRangeSlider from "@n-apt/components/sidebar/ReduxFrequencyRangeSlider";
import { Collapsible, Tooltip } from "@n-apt/components/ui"
import type { FrequencyRange } from "@n-apt/hooks/useWebSocket";

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
  color: ${(props) => (props.$isActive ? props.theme.primary : props.theme.textDisabled)};
  line-height: 1;
`;

const ChannelFreq = styled.span<{ $isActive: boolean }>`
  font-size: 18px;
  font-weight: 700;
  font-family: ${(props) => props.theme.typography.mono};
  color: ${(props) => (props.$isActive ? props.theme.primary : props.theme.textDisabled)};
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
  padding: .1rem .25rem;
  margin: .1rem 0;
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
  color: ${(props) => props.$active ? props.theme.background : props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: ${(props) => props.$active ? props.theme.primary : 'transparent'};

  &:hover {
    background-color: ${(props) => props.$active ? `${props.theme.primary}cc` : `${props.theme.borderHover}33`};
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
  /** When true, hides the Channels section header. Useful for embedding in constrained areas. */
  hideTitle?: boolean;
}

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
  hideTitle = false,
}) => {
  const reduxDispatch = useAppDispatch();
  const isPaused = useAppSelector((s) => s.websocket.isPaused);
  const spectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
  const activeSignalArea = useAppSelector((s) => s.spectrum.activeSignalArea);
  const {
    state,
    dispatch: storeDispatch,
    effectiveFrames,
    sampleRateHzEffective: sampleRateHz,
    wsConnection,
  } = useSpectrumStore();

  const liveFramesToUse = useMemo(
    () => (effectiveFrames.length > 0 ? effectiveFrames : spectrumFrames),
    [effectiveFrames, spectrumFrames],
  );

  const [manualFrequency, setManualFrequency] = useState<string>("137_100_000"); // Default to APT frequency in Hz
  const [isManualMode, setIsManualMode] = useState<boolean>(false);
  const lastRequestedSignalAreaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isPaused) {
      lastRequestedSignalAreaRef.current = null;
      return;
    }

    if (!activeSignalArea) {
      return;
    }

    if (lastRequestedSignalAreaRef.current === activeSignalArea) {
      return;
    }

    lastRequestedSignalAreaRef.current = activeSignalArea;
    reduxDispatch(requestNextLiveFrame());
  }, [activeSignalArea, isPaused, reduxDispatch]);

  const channels = useMemo(() => {
    if (!Array.isArray(effectiveFrames)) return [];
    return effectiveFrames.filter(f => ["A", "B"].includes(f.label));
  }, [effectiveFrames]);

  // Compute information for the active channel box
  // Resolve the active frame robustly from both sources
  const activeFrame = Array.isArray(effectiveFrames)
    ? (effectiveFrames.find((f: any) => f.label === activeSignalArea)
      || channels.find((f: any) => f.label === activeSignalArea))
    : undefined;
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

  const IQExplainerTooltip = () =>
    <Tooltip 
      title=""
      content="I/Q data makes up the signal (what comes out of the antenna and is in the air) <br /><br /> I and Q are pairs of bytes, both from 0-255 that represent one point that make up points of a signal.<br ><br />Example: I = 2, Q = 100 at 4kHz <br /><br /> I = In-phase component (the “main” wave direction) <br /> Q = Quadrature component (the part shifted by 90° — like a “sideways” version of the wave)<br />" />

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
              const span = maxFreq - minFreq;

              return (
                <ReduxFrequencyRangeSlider
                  key={frame.id}
                  label={label}
                  minFreq={minFreq}
                  maxFreq={maxFreq}
                  sampleRateHz={sampleRateHz}
                  limitMarkers={limitMarkers}
                  onActivate={() => {
                    const rememberedRange =
                      state.lastKnownRanges[label] ??
                      state.lastKnownRanges[label.toLowerCase()];
                    const nextRange =
                      rememberedRange ?? {
                        min: minFreq,
                        max:
                          minFreq +
                          (typeof sampleRateHz === "number"
                            ? Math.min(sampleRateHz, span)
                            : span),
                      };
                    reduxDispatch(setSignalAreaAndRange({ area: label, range: nextRange }));
                    storeDispatch({
                      type: "SET_SIGNAL_AREA_AND_RANGE",
                      area: label,
                      range: nextRange,
                    });
                  }}
                />
              );
            })
          ) : (
            <EmptyStateText>No active signal areas</EmptyStateText>
          )}
        </ChannelsSpectrumGrid>

        {/* Active Channel Description & Stats Box */}
        {activeFrame && (
          <ActiveChannelInfoBox>
            <Collapsible
              title="Channel Description">
                {activeDescription ? (
                  <>
                    <br />
                    <ActiveChannelInfoTitle>Channel {activeFrame.label}</ActiveChannelInfoTitle>
                    <ActiveChannelDescription>{activeDescription}</ActiveChannelDescription>
                    <Divider />
                  </>
                ) : null}
                
                <Collapsible
                  title="More...">
                  <ActiveChannelBandwidthList>
                    <IQExplainerTooltip /> Naive Signal Bandwidth (I/Q) = <MonoValue>{iqDataRateMBps}</MonoValue> <br />
                    Naive Data Bandwidth = <MonoValue>{formattedDataBandwidth}</MonoValue> of <MonoValue>{formattedSignalBandwidth} MHz</MonoValue><br />
                    5 mins = <MonoValue>{formatMBValue(minutes5MB)}</MonoValue><br />
                    1 hour = <MonoValue>{formatMBValue(hourMB)}</MonoValue><br />
                    24 hours = <MonoValue>{formatMBValue(dayMB)}</MonoValue>
                  </ActiveChannelBandwidthList>     
                </Collapsible>
            </Collapsible>
          </ActiveChannelInfoBox>
        )}
      </ChannelsSection>
    );
  }

  const handleTune = (frame: any) => {
    const range = {
      min: frame.min_hz,
      max: sampleRateHz ? Math.min(frame.max_hz, frame.min_hz + sampleRateHz) : frame.max_hz
    };

    storeDispatch({
      type: "SET_SIGNAL_AREA_AND_RANGE",
      area: frame.label,
      range
    });

    wsConnection.sendFrequencyRange(range);
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
      max: freqHz + windowSizeHz / 2
    };

    storeDispatch({
      type: "SET_SIGNAL_AREA_AND_RANGE",
      area: "manual",
      range
    });

    wsConnection.sendFrequencyRange(range);
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
      <ChannelsSectionTitle>
        <ChevronsLeftRightEllipsis size={14} />
        <SectionText>Channels</SectionText>
      </ChannelsSectionTitle>
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
        {!isManualMode && channels.map(ch => {
          const isActive = state.activeSignalArea === ch.label;
          const isChannelScanning = isScanning && scanRange &&
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
                  {formatFrequency(ch.min_hz)} - {formatFrequency(ch.max_hz)}
                </ChannelFreq>
              </ChannelBlock>

              {/* Show FrequencyRangeSlider only for the active channel */}
              {isActive && (
                <ReduxFrequencyRangeSlider
                  label=""
                  signalAreaKey={ch.label}
                  minFreq={ch.min_hz}
                  maxFreq={ch.max_hz}
                  sampleRateHz={sampleRateHz}
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
          Hardware sample rate: <SampleRateValue>{sampleRateHz ? formatFrequency(sampleRateHz) : "X.X MHz"}</SampleRateValue>
        </SampleRateLabel>
      </ChannelsDemodBody>
    </ChannelsSection>
  );
};
