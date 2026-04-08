import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { ChevronsLeftRightEllipsis } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setSignalAreaAndRange } from "@n-apt/redux";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { formatFrequency } from "@n-apt/utils/frequency";
import ReduxFrequencyRangeSlider from "@n-apt/components/sidebar/ReduxFrequencyRangeSlider";
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
  const spectrumFrames = useAppSelector((s) => s.websocket.spectrumFrames);
  const {
    state,
    dispatch: storeDispatch,
    effectiveFrames,
    sampleRateMHz,
    wsConnection,
  } = useSpectrumStore();

  const liveFramesToUse = useMemo(
    () => (effectiveFrames.length > 0 ? effectiveFrames : spectrumFrames),
    [effectiveFrames, spectrumFrames],
  );

  const [manualFrequency, setManualFrequency] = useState<string>("137.1"); // Default to APT frequency
  const [isManualMode, setIsManualMode] = useState<boolean>(false);

  const channels = useMemo(() => {
    return effectiveFrames.filter(f => ["A", "B"].includes(f.label));
  }, [effectiveFrames]);

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
              const min = frame.min_mhz;
              const max = frame.max_mhz;
              const span = max - min;

              return (
                <ReduxFrequencyRangeSlider
                  key={frame.id}
                  label={label}
                  minFreq={min}
                  maxFreq={max}
                  sampleRateMHz={sampleRateMHz}
                  limitMarkers={limitMarkers}
                  onActivate={() => {
                    const rememberedRange =
                      state.lastKnownRanges[label] ??
                      state.lastKnownRanges[label.toLowerCase()];
                    const nextRange =
                      rememberedRange ?? {
                        min,
                        max:
                          min +
                          (typeof sampleRateMHz === "number"
                            ? Math.min(sampleRateMHz, span)
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
      </ChannelsSection>
    );
  }

  const handleTune = (frame: any) => {
    const range = {
      min: frame.min_mhz,
      max: sampleRateMHz ? Math.min(frame.max_mhz, frame.min_mhz + sampleRateMHz) : frame.max_mhz
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
    const windowSizeHz = 0.025; // 25kHz in MHz
    const range = {
      min: Math.max(0, freq - windowSizeHz / 2),
      max: freq + windowSizeHz / 2
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
            <FrequencyLabel>Manual Freq (MHz):</FrequencyLabel>
            <FrequencyInput
              type="number"
              value={manualFrequency}
              onChange={(e) => setManualFrequency(e.target.value)}
              step="0.1"
              min="0.1"
              max="1000"
              placeholder="137.1"
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
            ch.min_mhz * 1e6 <= (scanRange.max || 0) &&
            ch.max_mhz * 1e6 >= (scanRange.min || 0);

          return (
            <React.Fragment key={ch.id}>
              <ChannelBlock
                $isActive={isActive}
                onClick={() => handleTune(ch)}
              >
                <ChannelLetter $isActive={isActive}>{ch.label}</ChannelLetter>
                <ChannelFreq $isActive={isActive}>
                  {formatFrequency(ch.min_mhz)} - {formatFrequency(ch.max_mhz)}
                </ChannelFreq>
              </ChannelBlock>

              {/* Show FrequencyRangeSlider only for the active channel */}
              {isActive && (
                <ReduxFrequencyRangeSlider
                  label=""
                  signalAreaKey={ch.label}
                  minFreq={ch.min_mhz}
                  maxFreq={ch.max_mhz}
                  sampleRateMHz={sampleRateMHz}
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
          Hardware sample rate: <SampleRateValue>{sampleRateMHz ? formatFrequency(sampleRateMHz) : "X.X MHz"}</SampleRateValue>
        </SampleRateLabel>
      </ChannelsDemodBody>
    </ChannelsSection>
  );
};
