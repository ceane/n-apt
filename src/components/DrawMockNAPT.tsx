import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { 
  DEFAULT_SPIKE_COUNT, 
  DEFAULT_SPIKE_WIDTH, 
  DEFAULT_CENTER_SPIKE_BOOST, 
  DEFAULT_FLOOR_AMPLITUDE, 
  DEFAULT_DECAY_RATE, 
  DEFAULT_BASELINE_MODULATION, 
  DEFAULT_ENVELOPE_WIDTH, 
  DEFAULT_NUM_POINTS,
  NAPT_FREQUENCY_RANGE,
  COLORS
} from '../consts';

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
    t,
    {
      spikeCount,
      spikeWidth,
      centerSpikeBoost,
      floorAmplitude,
      decayRate,
      baselineModulation,
      envelopeWidth
    }
  ) => {
    // Frequency comb with sine wave spikes and exponential height decay
    // over t ∈ [-1, 1], modulated by Gaussian envelope

    const N = spikeCount;
    const half = Math.floor((N - 1) / 2);

    // Uniform tooth spacing
    const spacing = 2 / (N - 1);

    // Tooth half-width as fraction of spacing
    const halfWidth = spikeWidth * spacing / 2;

    let y = 0;

    for (let k = -half; k <= half; k++) {
      const centerPos = k * spacing;
      const dx = t - centerPos;

      // Finite support guarantees baseline = 0
      if (Math.abs(dx) > halfWidth) continue;

      // Sine wave tooth
      const sineArg = (Math.PI * dx) / halfWidth;
      const tooth = Math.sin(sineArg);

      // Exponential height decay from center
      const decay = Math.exp(-decayRate * Math.abs(k));

      // Center boost
      const boost = k === 0 ? centerSpikeBoost : 1;

      // Add contribution
      y += boost * floorAmplitude * decay * tooth;
    }

    // Gaussian envelope
    const envelope = Math.exp(-envelopeWidth * t * t);

    // Baseline modulation
    const baseline = baselineModulation * Math.cos(2 * Math.PI * t);

    return envelope * y + baseline;
  };

  // Generate data points
  const generateData = () => {
    const points = [];
    
    for (let i = 0; i < DEFAULT_NUM_POINTS; i++) {
      const t = -1 + (2 * i) / (DEFAULT_NUM_POINTS - 1);
      const x = calculateX(t, {
        spikeCount,
        spikeWidth,
        centerSpikeBoost,
        floorAmplitude,
        decayRate,
        baselineModulation,
        envelopeWidth
      });
      
      points.push({
        t: t.toFixed(4),
        x: x.toFixed(6),
        frequency: ((t + 1) * NAPT_FREQUENCY_RANGE / 2).toFixed(3), // Map to 0-3.2 MHz range
        amplitude: x.toFixed(6)
      });
    }
    
    return points;
  };

  const [data, setData] = useState(generateData());

  useEffect(() => {
    setData(generateData());
  }, [spikeCount, spikeWidth, centerSpikeBoost, floorAmplitude, decayRate, baselineModulation, envelopeWidth]);

  return (
    <div style={{ padding: '20px', backgroundColor: COLORS.background, color: COLORS.textSecondary, minHeight: '100vh' }}>
      <h2 style={{ color: COLORS.primary, marginBottom: '30px' }}>N-APT Signal Generator</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: COLORS.textMuted }}>
            Spike Count: {spikeCount}
          </label>
          <input
            type="range"
            min="10"
            max="300"
            value={spikeCount}
            onChange={(e) => setSpikeCount(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: COLORS.textMuted }}>
            Spike Width: {spikeWidth.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.1"
            value={spikeWidth}
            onChange={(e) => setSpikeWidth(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: COLORS.textMuted }}>
            Center Spike Boost: {centerSpikeBoost.toFixed(1)}
          </label>
          <input
            type="range"
            min="1.0"
            max="5.0"
            step="0.1"
            value={centerSpikeBoost}
            onChange={(e) => setCenterSpikeBoost(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: COLORS.textMuted }}>
            Floor Amplitude: {floorAmplitude.toFixed(1)}
          </label>
          <input
            type="range"
            min="0.1"
            max="3.0"
            step="0.1"
            value={floorAmplitude}
            onChange={(e) => setFloorAmplitude(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: COLORS.textMuted }}>
            Decay Rate: {decayRate.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.0"
            max="2.0"
            step="0.1"
            value={decayRate}
            onChange={(e) => setDecayRate(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: COLORS.textMuted }}>
            Baseline Modulation: {baselineModulation.toFixed(2)}
          </label>
          <input
            type="range"
            min="-1.0"
            max="1.0"
            step="0.1"
            value={baselineModulation}
            onChange={(e) => setBaselineModulation(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: COLORS.textMuted }}>
            Envelope Width: {envelopeWidth.toFixed(1)}
          </label>
          <input
            type="range"
            min="1.0"
            max="20.0"
            step="0.5"
            value={envelopeWidth}
            onChange={(e) => setEnvelopeWidth(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ backgroundColor: COLORS.surface, padding: '20px', borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis 
              dataKey="t" 
              stroke={COLORS.textMuted}
              tick={{ fill: COLORS.textDisabled, fontSize: '10px' }}
              label={{ value: 'Time (normalized)', position: 'insideBottom', offset: -5, fill: COLORS.textDisabled }}
            />
            <YAxis 
              stroke={COLORS.textMuted}
              tick={{ fill: COLORS.textDisabled, fontSize: '10px' }}
              label={{ value: 'Amplitude', angle: -90, position: 'insideLeft', fill: COLORS.textDisabled }}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: '4px' }}
              labelStyle={{ color: COLORS.textSecondary }}
              itemStyle={{ color: COLORS.primary }}
            />
            <Legend wrapperStyle={{ color: COLORS.textSecondary }} />
            <Line 
              type="monotone" 
              dataKey="x" 
              stroke={COLORS.primary} 
              strokeWidth={2}
              dot={false}
              name="Signal"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginTop: '30px', padding: '15px', backgroundColor: COLORS.surface, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
        <h3 style={{ color: COLORS.primary, marginBottom: '10px', fontSize: '14px' }}>Signal Parameters</h3>
        <div style={{ fontSize: '12px', color: COLORS.textMuted, lineHeight: '1.6' }}>
          <p><strong>Frequency Range:</strong> 0 - 3.2 MHz (N-APT APT frequency range)</p>
          <p><strong>Signal Type:</strong> Frequency comb with Gaussian envelope</p>
          <p><strong>Modulation:</strong> Sine wave spikes with exponential decay</p>
          <p><strong>Center Boost:</strong> Enhanced center frequency at 1.6 MHz</p>
        </div>
      </div>
    </div>
  );
};

export default DrawMockNAPT;
