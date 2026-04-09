import React from "react";
import styled from "styled-components";
import { Slider, Row } from "@n-apt/components/ui";
import { DecryptionFallback } from "@n-apt/components/ui/DecryptionFallback";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 0;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
  }

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background-color: ${(props) => props.theme.primaryAlpha};
  }

  option {
    background-color: ${(props) => props.theme.background};
    color: ${(props) => props.theme.textPrimary};
    font-family: ${(props) => props.theme.typography.mono};
  }
`;

interface BeatParams {
  offsetHz: number;
}

interface DrawParams {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  spikesAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
  centerOffset: number;
  peakAmplitude: number;
  simulatedNoise: number;
  beats: BeatParams[];
}

const DrawContainer = styled.div`
  display: grid;
  gap: 16px;
  padding: 0 24px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
`;

const ControlsContainer = styled.div`
  display: grid;
  gap: 16px;
`;

const InfoContainer = styled.div`
  background: ${(props) => props.theme.primaryAnchor};
  padding: 16px;
  border-radius: 8px;
  border: 1px solid ${(props) => props.theme.primaryAlpha};
`;

const InfoTitle = styled.h3`
  color: ${(props) => props.theme.primary};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const InfoText = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 11px;
  line-height: 1.5;
`;

const InfoParagraph = styled.p`
  margin-bottom: 8px;
  color: ${(props) => props.theme.textSecondary};
`;

const ClumpSelector = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  overflow-x: auto;
  padding-bottom: 4px;
  
  &::-webkit-scrollbar {
    height: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${(props) => props.theme.borderHover};
    border-radius: 2px;
  }
`;

const ClumpTab = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? props.theme.primary : props.theme.surface)};
  color: ${(props) => (props.$active ? props.theme.background : props.theme.textSecondary)};
  border: 1px solid ${(props) => (props.$active ? props.theme.primary : props.theme.border)};
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;

  &:hover {
    background: ${(props) => (props.$active ? props.theme.primary : props.theme.surfaceHover)};
  }
`;

const BeatsSection = styled.div`
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid ${(props) => props.theme.border};
`;

const BeatsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const BeatsTitle = styled.h3`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
`;

const AddBeatButton = styled.button`
  background: transparent;
  border: 1px solid ${(props) => props.theme.primary};
  color: ${(props) => props.theme.primary};
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background: ${(props) => props.theme.primaryAlpha};
  }

  &:disabled {
    opacity: 0.2;
    cursor: default;
    border-color: ${(props) => props.theme.textDisabled};
    color: ${(props) => props.theme.textDisabled};
  }
`;

const ResetButton = styled.button`
  background: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  color: ${(props) => props.theme.textSecondary};
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  &:hover {
    background: ${(props) => props.theme.surfaceHover};
    color: ${(props) => props.theme.textPrimary};
    border-color: ${(props) => props.theme.primary};
  }
`;

const BeatItem = styled.div`
  background: ${(props) => props.theme.surface};
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  border: 1px solid ${(props) => props.theme.border};
`;

const BeatRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
`;

const RemoveBeatButton = styled.button`
  background: transparent;
  border: none;
  color: ${(props) => props.theme.textMuted};
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;

  &:hover {
    color: ${(props) => props.theme.danger};
  }
`;

const SectionHeader = styled.div`
  margin-bottom: 8px;
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SectionHeading = styled.h2`
  font-size: 11px;
  color: ${(props) => props.theme.textMuted};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0;
`;

const Divider = styled.div`
  border-top: 1px solid ${(props) => props.theme.border};
  margin: 8px 0;
  padding-bottom: 8px;
`;

const LoadingFallback = styled.div`
  opacity: 0.5;
  font-size: 10px;
  text-align: center;
  color: ${(props) => props.theme.textSecondary};
`;

const BeatLabel = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  font-weight: 600;
`;

const BEAT_SNAP_RANGES = [
  { label: "Delta", min: 0.5, max: 4, color: "rgba(255, 100, 100, 0.1)" },
  { label: "Theta", min: 4, max: 8, color: "rgba(100, 255, 100, 0.1)" },
  { label: "Alpha", min: 8, max: 12, color: "rgba(100, 100, 255, 0.1)" },
  { label: "Beta", min: 12, max: 30, color: "rgba(255, 255, 100, 0.1)" },
  { label: "Gamma", min: 30, max: 100, color: "rgba(255, 100, 255, 0.1)" },
  { label: "Voice", min: 120, max: 180, color: "rgba(100, 255, 255, 0.1)" },
];

const DrawMath = React.lazy(async () => {
  try {
    const modulePath = [
      "@n-apt",
      "encrypted-modules",
      "tmp",
      "ts",
      "components",
      "math",
      "DrawMath",
    ].join("/");

    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return {
      default: () => <DecryptionFallback moduleName="Draw Math" />,
    };
  }
});

export const DrawSignalSidebar: React.FC = () => {
  const { state, dispatch } = useSpectrumStore();
  const { drawParams, activeClumpIndex, globalNoiseFloor } = state;
  const activeParams = drawParams[activeClumpIndex] || drawParams[0];

  const handleParamChange = (key: keyof DrawParams, value: number) => {
    const newParams = [...drawParams];
    newParams[activeClumpIndex] = {
      ...activeParams,
      [key]: value,
    };
    dispatch({ type: "SET_DRAW_PARAMS", params: newParams });
  };

  const handleClumpCountChange = (count: number) => {
    let newParams = [...drawParams];
    if (count > drawParams.length) {
      for (let i = drawParams.length; i < count; i++) {
        newParams.push({ ...drawParams[0], centerOffset: (i * 0.4) - 0.2 });
      }
    } else {
      newParams = drawParams.slice(0, count);
    }
    dispatch({ type: "SET_DRAW_PARAMS", params: newParams });
    if (activeClumpIndex >= count) {
      dispatch({ type: "SET_ACTIVE_CLUMP_INDEX", index: count - 1 });
    }
  };

  const handleAddBeat = () => {
    if (activeParams.beats.length >= 2) return;
    const newBeats = [...activeParams.beats, { offsetHz: 30 }];
    handleParamChange("beats", newBeats as any);
  };

  const handleRemoveBeat = (index: number) => {
    const newBeats = activeParams.beats.filter((_, i) => i !== index);
    handleParamChange("beats", newBeats as any);
  };

  const handleBeatOffsetChange = (index: number, offset: number) => {
    let finalOffset = offset < 0.75 ? 0.5 : Math.round(offset);
    const newBeats = [...activeParams.beats];
    newBeats[index] = { ...newBeats[index], offsetHz: finalOffset };
    handleParamChange("beats", newBeats as any);
  };

  return (
    <DrawContainer>
      <React.Suspense fallback={<LoadingFallback>Loading Math...</LoadingFallback>}>
        <DrawMath />
      </React.Suspense>

      <SectionHeader>
        <SectionHeading>
          Simulation Controls
        </SectionHeading>
        <ResetButton onClick={() => dispatch({ type: "RESET_DRAW_PARAMS" })}>
          Reset Defaults
        </ResetButton>
      </SectionHeader>

      <ControlsContainer>
        <BeatsSection style={{ borderTop: 'none', paddingTop: 0, marginTop: 4 }}>
          <BeatsHeader>
            <BeatsTitle>Add Beats (Heterodyne)</BeatsTitle>
            <AddBeatButton
              disabled={activeParams.beats.length >= 2}
              onClick={handleAddBeat}
            >
              + ADD BEAT
            </AddBeatButton>
          </BeatsHeader>

          {activeParams.beats.map((beat, i) => (
            <BeatItem key={i}>
              <BeatRow>
                <BeatLabel>Beat {i + 1}</BeatLabel>
                <RemoveBeatButton onClick={() => handleRemoveBeat(i)}>×</RemoveBeatButton>
              </BeatRow>
              <Slider
                value={beat.offsetHz}
                min={0.5}
                max={500}
                step={0.1}
                logarithmic={true}
                snapRanges={BEAT_SNAP_RANGES}
                onChange={(v) => handleBeatOffsetChange(i, v)}
                formatValue={(v) => `${v % 1 === 0 ? v : v.toFixed(1)} Hz`}
                orientation="horizontal"
              />
            </BeatItem>
          ))}
        </BeatsSection>

        <Divider />

        <Row label="Clumps">
          <SettingSelect
            value={drawParams.length}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleClumpCountChange(parseInt(e.target.value))}
            style={{ width: '100%' }}
          >
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} Clump{n > 1 ? 's' : ''}</option>)}
          </SettingSelect>
        </Row>

        <Row label="Clump config">
          <ClumpSelector style={{ margin: 0 }}>
            {drawParams.map((_, i) => (
              <ClumpTab
                key={i}
                $active={activeClumpIndex === i}
                onClick={() => dispatch({ type: "SET_ACTIVE_CLUMP_INDEX", index: i })}
              >
                Clump {i + 1}
              </ClumpTab>
            ))}
          </ClumpSelector>
        </Row>

        <Divider />

        <Slider
          label="Peak Amplitude"
          value={activeParams.peakAmplitude}
          min={-60}
          max={0}
          step={1}
          onChange={(v) => handleParamChange("peakAmplitude", v)}
          formatValue={(v) => `${v} dB`}
          orientation="horizontal"
        />

        <Slider
          label="Spikes Amplitude"
          value={activeParams.spikesAmplitude}
          min={-60}
          max={0}
          step={1}
          onChange={(v) => handleParamChange("spikesAmplitude", v)}
          formatValue={(v) => `${v} dB`}
          orientation="horizontal"
        />

        <Slider
          label="Global Noise Floor"
          value={globalNoiseFloor}
          min={-140}
          max={-40}
          step={1}
          onChange={(noise) => dispatch({ type: "SET_GLOBAL_NOISE_FLOOR", noise })}
          formatValue={(v) => `${v} dB`}
          orientation="horizontal"
        />

        <Slider
          label="Simulated Noise (Data)"
          value={activeParams.simulatedNoise}
          min={0.0}
          max={1.0}
          step={0.01}
          onChange={(v) => handleParamChange("simulatedNoise", v)}
          formatValue={(v) => v.toFixed(2)}
          orientation="horizontal"
        />

        <Slider
          label="Spike Width"
          value={activeParams.spikeWidth}
          min={0.01}
          max={0.5}
          step={0.001}
          logarithmic={true}
          onChange={(v) => handleParamChange("spikeWidth", v)}
          formatValue={(v) => v.toFixed(3)}
          orientation="horizontal"
        />

        <Slider
          label="Spikes -> Number of Spikes"
          value={activeParams.spikeCount}
          min={10}
          max={300}
          step={10}
          onChange={(v) => handleParamChange("spikeCount", v)}
          formatValue={(v) => v.toString()}
          orientation="horizontal"
        />

        <Slider
          label="Center Offset"
          value={activeParams.centerOffset}
          min={0.0}
          max={3.0}
          step={0.01}
          onChange={(v) => handleParamChange("centerOffset", v)}
          formatValue={(v) => `${v.toFixed(2)} MHz`}
          orientation="horizontal"
        />

        <Divider />

        <Slider
          label="Boost"
          value={activeParams.centerSpikeBoost}
          min={1.0}
          max={5.0}
          step={0.1}
          onChange={(v) => handleParamChange("centerSpikeBoost", v)}
          formatValue={(v) => v.toFixed(1)}
          orientation="horizontal"
        />

        <Slider
          label="Decay"
          value={activeParams.decayRate}
          min={0.1}
          max={2.0}
          step={0.1}
          onChange={(v) => handleParamChange("decayRate", v)}
          formatValue={(v) => v.toFixed(2)}
          orientation="horizontal"
        />

        <Slider
          label="Envelope Width"
          value={activeParams.envelopeWidth}
          min={1.0}
          max={20.0}
          step={0.5}
          onChange={(v) => handleParamChange("envelopeWidth", v)}
          formatValue={(v) => v.toFixed(1)}
          orientation="horizontal"
        />

      </ControlsContainer>

      <InfoContainer>
        <InfoTitle>Signal Parameters</InfoTitle>
        <InfoText>
          <InfoParagraph>
            <strong>Frequency Range:</strong> 0 - 3 MHz (N-APT APT frequency
            range)
          </InfoParagraph>
          <InfoParagraph>
            <strong>Signal Features:</strong> Frequency comb with Gaussian
            envelope
          </InfoParagraph>
          <InfoParagraph>
            <strong>Modulation:</strong> Sine wave spikes with exponential decay
          </InfoParagraph>
          <InfoParagraph>
            <strong>Center Boost:</strong> Enhanced center frequency at 1.5 MHz
          </InfoParagraph>
        </InfoText>
      </InfoContainer>
    </DrawContainer>
  );
};

export default DrawSignalSidebar;
