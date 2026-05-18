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
`;

const Wrap = styled.div`
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
  box-sizing: border-box;
  display: grid;
  gap: 16px;
`;

const ClumpSelector = styled.div`
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
`;

const ClumpTab = styled.button<{ $active: boolean }>`
  background: ${(props) =>
    props.$active ? props.theme.primary : props.theme.surface};
  color: ${(props) =>
    props.$active ? props.theme.background : props.theme.textSecondary};
  border: 1px solid
    ${(props) => (props.$active ? props.theme.primary : props.theme.border)};
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
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

const BeatBox = styled.div`
  background: ${(props) => props.theme.surface};
  border-radius: 6px;
  padding: 10px;
  border: 1px solid ${(props) => props.theme.border};
`;

const BeatsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const AddBeatButton = styled.button`
  background: transparent;
  border: 1px solid ${(props) => props.theme.primary};
  color: ${(props) => props.theme.primary};
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
`;

const ResetButton = styled.button`
  background: transparent;
  border: 1px solid ${(props) => props.theme.borderHover};
  color: ${(props) => props.theme.textSecondary};
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 9px;
  font-weight: 700;
`;

const LoadingFallback = styled.div`
  opacity: 0.5;
  font-size: 10px;
  text-align: center;
  color: ${(props) => props.theme.textSecondary};
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

export const DrawSignalOptionsSidebar: React.FC = () => {
  const { state, dispatch } = useSpectrumStore();
  const { drawParams, activeClumpIndex, globalNoiseFloor } = state;
  const activeParams = drawParams[activeClumpIndex] || drawParams[0];

  const handleParamChange = (key: keyof DrawParams, value: number) => {
    const newParams = [...drawParams];
    newParams[activeClumpIndex] = { ...activeParams, [key]: value };
    dispatch({ type: "SET_DRAW_PARAMS", params: newParams });
  };

  const handleClumpCountChange = (count: number) => {
    let newParams = [...drawParams];
    if (count > drawParams.length) {
      for (let i = drawParams.length; i < count; i++) {
        newParams.push({ ...drawParams[0], centerOffset: i * 0.4 - 0.2 });
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
    handleParamChange("beats", [...activeParams.beats, { offsetHz: 30 }] as any);
  };

  const handleRemoveBeat = (index: number) => {
    handleParamChange(
      "beats",
      activeParams.beats.filter((_, i) => i !== index) as any,
    );
  };

  return (
    <Wrap>
      <React.Suspense fallback={<LoadingFallback>Loading Math…</LoadingFallback>}>
        <DrawMath />
      </React.Suspense>
      <ResetButton onClick={() => dispatch({ type: "RESET_DRAW_PARAMS" })}>
        Reset Defaults
      </ResetButton>
      <BeatsHeader>
        <div />
        <AddBeatButton onClick={handleAddBeat}>+ ADD BEAT</AddBeatButton>
      </BeatsHeader>
      {activeParams.beats.map((beat, i) => (
        <BeatBox key={i}>
          <Slider
            value={beat.offsetHz}
            min={0.5}
            max={500}
            step={0.1}
            logarithmic={true}
            snapRanges={BEAT_SNAP_RANGES}
            onChange={(v) =>
              handleParamChange(
                "beats",
                activeParams.beats.map((b, index) =>
                  index === i ? { ...b, offsetHz: v < 0.75 ? 0.5 : Math.round(v) } : b,
                ) as any,
              )
            }
            formatValue={(v) => `${v % 1 === 0 ? v : v.toFixed(1)} Hz`}
            orientation="horizontal"
          />
          <button onClick={() => handleRemoveBeat(i)}>Remove</button>
        </BeatBox>
      ))}
      <Row label="Clumps">
        <SettingSelect
          value={drawParams.length}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            handleClumpCountChange(parseInt(e.target.value))
          }
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} Clump{n > 1 ? "s" : ""}
            </option>
          ))}
        </SettingSelect>
      </Row>
      <ClumpSelector>
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
      <Slider
        label="Peak Amplitude"
        value={activeParams.peakAmplitude}
        min={-60}
        max={0}
        step={1}
        onChange={(v) => handleParamChange("peakAmplitude", v)}
      />
      <Slider
        label="Spikes Amplitude"
        value={activeParams.spikesAmplitude}
        min={-60}
        max={0}
        step={1}
        onChange={(v) => handleParamChange("spikesAmplitude", v)}
      />
      <Slider
        label="Global Noise Floor"
        value={globalNoiseFloor}
        min={-140}
        max={-40}
        step={1}
        onChange={(noise) => dispatch({ type: "SET_GLOBAL_NOISE_FLOOR", noise })}
      />
      <Slider
        label="Simulated Noise (Data)"
        value={activeParams.simulatedNoise}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={(v) => handleParamChange("simulatedNoise", v)}
      />
      <Slider
        label="Spike Width"
        value={activeParams.spikeWidth}
        min={0.01}
        max={0.5}
        step={0.001}
        logarithmic={true}
        onChange={(v) => handleParamChange("spikeWidth", v)}
      />
      <Slider
        label="Spikes -> Number of Spikes"
        value={activeParams.spikeCount}
        min={10}
        max={300}
        step={10}
        onChange={(v) => handleParamChange("spikeCount", v)}
      />
      <Slider
        label="Center Offset"
        value={activeParams.centerOffset}
        min={0.0}
        max={3.0}
        step={0.01}
        onChange={(v) => handleParamChange("centerOffset", v)}
      />
      <Slider
        label="Boost"
        value={activeParams.centerSpikeBoost}
        min={1.0}
        max={5.0}
        step={0.1}
        onChange={(v) => handleParamChange("centerSpikeBoost", v)}
      />
      <Slider
        label="Decay"
        value={activeParams.decayRate}
        min={0.1}
        max={2.0}
        step={0.1}
        onChange={(v) => handleParamChange("decayRate", v)}
      />
      <Slider
        label="Envelope Width"
        value={activeParams.envelopeWidth}
        min={1.0}
        max={20.0}
        step={0.5}
        onChange={(v) => handleParamChange("envelopeWidth", v)}
      />
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
    </Wrap>
  );
};

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
      default: () => (
        <DecryptionFallback moduleName="Draw Math" errorType="latex" />
      ),
    };
  }
});
