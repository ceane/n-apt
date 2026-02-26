import { useState, useEffect } from "react";
import styled from "styled-components";
import { WebGPULineChart } from "@n-apt/components/WebGPULineChart";
import {
  DEFAULT_SPIKE_COUNT,
  DEFAULT_SPIKE_WIDTH,
  DEFAULT_CENTER_SPIKE_BOOST,
  DEFAULT_FLOOR_AMPLITUDE,
  DEFAULT_DECAY_RATE,
  DEFAULT_BASELINE_MODULATION,
  DEFAULT_ENVELOPE_WIDTH,
  COLORS,
} from "@n-apt/consts";

const Container = styled.div`
  padding: 20px;
  background-color: ${COLORS.background};
  color: ${COLORS.textSecondary};
  min-height: 100vh;
`;

const Title = styled.h2`
  color: ${COLORS.primary};
  margin-bottom: 30px;
`;

const ChartContainer = styled.div`
  background-color: ${COLORS.surface};
  padding: 20px;
  border-radius: 8px;
  border: 1px solid ${COLORS.border};
`;

const ControlsContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-top: 30px;
`;

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 5px;
  font-size: 12px;
  color: ${COLORS.textMuted};
`;

const Slider = styled.input`
  width: 100%;
`;

const InfoContainer = styled.div`
  margin-top: 30px;
  padding: 15px;
  background-color: ${COLORS.surface};
  border-radius: 8px;
  border: 1px solid ${COLORS.border};
`;

const InfoTitle = styled.h3`
  color: ${COLORS.primary};
  margin-bottom: 10px;
  font-size: 14px;
`;

const InfoText = styled.div`
  font-size: 12px;
  color: ${COLORS.textMuted};
  line-height: 1.6;
`;

const InfoParagraph = styled.p`
  margin-bottom: 8px;
  
  strong {
    color: ${COLORS.textSecondary};
  }
`;

const DrawMockNAPT = () => {
  // Spike and waveform parameters
  const [spikeCount, setSpikeCount] = useState(DEFAULT_SPIKE_COUNT);
  const [spikeWidth, setSpikeWidth] = useState(DEFAULT_SPIKE_WIDTH);

  // Center spike
  const [centerSpikeBoost, setCenterSpikeBoost] = useState(DEFAULT_CENTER_SPIKE_BOOST);
  const [floorAmplitude, setFloorAmplitude] = useState(DEFAULT_FLOOR_AMPLITUDE);
  const [decayRate, setDecayRate] = useState(DEFAULT_DECAY_RATE);
  const [baselineModulation, setBaselineModulation] = useState(DEFAULT_BASELINE_MODULATION);

  const [envelopeWidth, setEnvelopeWidth] = useState(DEFAULT_ENVELOPE_WIDTH);

  const calculateX = (
    t: number,
    {
      spikeCount,
      spikeWidth,
      centerSpikeBoost,
      floorAmplitude,
      decayRate,
      baselineModulation,
      envelopeWidth,
    }: {
      spikeCount: number;
      spikeWidth: number;
      centerSpikeBoost: number;
      floorAmplitude: number;
      decayRate: number;
      baselineModulation: number;
      envelopeWidth: number;
    },
  ) => {
    // Frequency comb with sine wave spikes and exponential height decay
    // over t ∈ [-1, 1], modulated by Gaussian envelope

    const N = spikeCount;
    const half = Math.floor((N - 1) / 2);

    // Uniform tooth spacing
    const spacing = 2 / (N - 1);

    // Tooth half-width as fraction of spacing
    const halfWidth = (spikeWidth * spacing) / 2;

    let y = 0;

    for (let k = -half; k <= half; k++) {
      const centerPos = k * spacing;
      const dx = t - centerPos;

      // Finite support guarantees baseline = 0
      if (Math.abs(dx) > halfWidth) continue;

      // Sine wave tooth
      const local = dx / halfWidth;
      const tooth = Math.sin((Math.PI * (local + 1)) / 2);

      let height;

      // Center tooth (absolute dominant)
      if (k === 0) {
        height = Math.max(1 * centerSpikeBoost, 1.05);
      } else {
        const centerHeight = Math.max(1 * centerSpikeBoost, 1.05);
        const effectiveFloor = Math.min(floorAmplitude, 1, centerHeight);
        const decay = Math.exp(-Math.abs(k) * decayRate);
        height = effectiveFloor + (centerHeight - effectiveFloor) * decay;
      }

      y += height * tooth;
    }

    // Gaussian envelope
    const envelope = Math.exp(-Math.pow(t / envelopeWidth, 2));
    const modulation = baselineModulation * 0.1 * Math.sin(2 * Math.PI * t * 10);
    const envelopedY = y * envelope;
    const valleyMod = envelopedY < 0.1 ? modulation : 0;
    return envelopedY + valleyMod;
  };

  // Generate data points
  const generateData = () => {
    const points = [];
    const steps = 5000; // More points like the working version

    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps;
      const freq = ((t + 1) / 2) * 3; // 0 to 3 MHz like working version
      const x = calculateX(t, {
        spikeCount,
        spikeWidth,
        centerSpikeBoost,
        floorAmplitude,
        decayRate,
        baselineModulation,
        envelopeWidth,
      });

      points.push({
        t: parseFloat(t.toFixed(4)),
        freq: parseFloat(freq.toFixed(4)),
        x: parseFloat(x.toFixed(6)),
      });
    }

    return points;
  };

  const [data, setData] = useState(generateData());

  useEffect(() => {
    setData(generateData());
  }, [
    spikeCount,
    spikeWidth,
    centerSpikeBoost,
    floorAmplitude,
    decayRate,
    baselineModulation,
    envelopeWidth,
  ]);

  return (
    <Container>
      <Title>N-APT Signal Generator</Title>

      <ChartContainer>
        <WebGPULineChart data={data} width={800} height={400} />
      </ChartContainer>

      <ControlsContainer>
        <ControlGroup>
          <Label>Spike Count: {spikeCount}</Label>
          <Slider
            type="range"
            min="10"
            max="300"
            value={spikeCount}
            onChange={(e) => setSpikeCount(Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Spike Width: {spikeWidth.toFixed(2)}</Label>
          <Slider
            type="range"
            min="0.1"
            max="1.0"
            step="0.1"
            value={spikeWidth}
            onChange={(e) => setSpikeWidth(Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Center Spike Boost: {centerSpikeBoost.toFixed(1)}</Label>
          <Slider
            type="range"
            min="1.0"
            max="5.0"
            step="0.1"
            value={centerSpikeBoost}
            onChange={(e) => setCenterSpikeBoost(Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Floor Amplitude: {floorAmplitude.toFixed(1)}</Label>
          <Slider
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={floorAmplitude}
            onChange={(e) => setFloorAmplitude(Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Decay Rate: {decayRate.toFixed(2)}</Label>
          <Slider
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={decayRate}
            onChange={(e) => setDecayRate(Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Baseline Modulation: {baselineModulation.toFixed(2)}</Label>
          <Slider
            type="range"
            min="0.0"
            max="1.0"
            step="0.1"
            value={baselineModulation}
            onChange={(e) => setBaselineModulation(Number(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Envelope Width: {envelopeWidth.toFixed(1)}</Label>
          <Slider
            type="range"
            min="1.0"
            max="20.0"
            step="0.5"
            value={envelopeWidth}
            onChange={(e) => setEnvelopeWidth(Number(e.target.value))}
          />
        </ControlGroup>
      </ControlsContainer>

      <InfoContainer>
        <InfoTitle>Signal Parameters</InfoTitle>
        <InfoText>
          <InfoParagraph>
            <strong>Frequency Range:</strong> 0 - 3 MHz (N-APT APT frequency range)
          </InfoParagraph>
          <InfoParagraph>
            <strong>Signal Features:</strong> Frequency comb with Gaussian envelope
          </InfoParagraph>
          <InfoParagraph>
            <strong>Modulation:</strong> Sine wave spikes with exponential decay
          </InfoParagraph>
          <InfoParagraph>
            <strong>Center Boost:</strong> Enhanced center frequency at 1.5 MHz
          </InfoParagraph>
        </InfoText>
      </InfoContainer>
    </Container>
  );
};

export default DrawMockNAPT;
