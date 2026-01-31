import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const DrawMockNAPT = () => {
  // Spike and waveform parameters
  const [spikeCount, setSpikeCount] = useState(150); // default to higher count for more spikes
  const [spikeWidth, setSpikeWidth] = useState(0.5); // adjusted default for wider spikes

  // Center spike
  const [centerSpikeBoost, setCenterSpikeBoost] = useState(2.5);
  const [floorAmplitude, setFloorAmplitude] = useState(1);
  const [decayRate, setDecayRate] = useState(0.5);
  const [baselineModulation, setBaselineModulation] = useState(0);

  const [envelopeWidth, setEnvelopeWidth] = useState(10.0);

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
      const local = dx / halfWidth;
      const tooth = Math.sin(Math.PI * (local + 1) / 2);

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

  const generateData = () => {
    const data: Array<{t: number, x: number}> = [];
    const steps = 2500;

    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps;
      const freq = ((t + 1) / 2) * 3; // 0 to 3 MHz
      data.push({
        t: parseFloat(t.toFixed(4)),
        freq: parseFloat(freq.toFixed(4)),
        x: calculateX(t, {
          spikeCount,
          spikeWidth,
          centerSpikeBoost,
          floorAmplitude,
          decayRate,
          baselineModulation,
          envelopeWidth
        })
      });
    }

    return data;
  };

  const data = React.useMemo(() => {
    const points: Array<{t: number, x: number}> = [];
    const steps = 5000;

    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps;
      const freq = ((t + 1) / 2) * 3; // 0 to 3 MHz
      points.push({
        t: parseFloat(t.toFixed(4)),
        freq: parseFloat(freq.toFixed(4)),
        x: calculateX(t, {
          spikeCount,
          spikeWidth,
          centerSpikeBoost,
          floorAmplitude,
          decayRate,
          baselineModulation,
          envelopeWidth
        })
      });
    }

    return points;
  }, [
      spikeCount,
      spikeWidth,
      centerSpikeBoost,
      floorAmplitude,
      decayRate,
      baselineModulation,
      envelopeWidth
   ]);

  const exportToSVG = () => {
    const data = generateData();
    
    const width = 1400;
    const height = 400;
    const padding = 50;
    
    const xMin = Math.min(...data.map(d => d.t));
    const xMax = Math.max(...data.map(d => d.t));
    const yMin = 0;
    const yMax = Math.max(...data.map(d => d.x)) * 1.1;
    
    const xScale = (width - 2 * padding) / (xMax - xMin);
    const yScale = (height - 2 * padding) / yMax;
    
    let pathData = '';
    data.forEach((point, index) => {
      const x = padding + (point.t - xMin) * xScale;
      const y = height - padding - point.x * yScale;
      
      if (index === 0) {
        pathData += `M ${x.toFixed(2)},${y.toFixed(2)}`;
      } else {
        pathData += ` L ${x.toFixed(2)},${y.toFixed(2)}`;
      }
    });
    
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#0a0a0a"/>
  
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a1a1a" stroke-width="0.5"/>
    </pattern>
    
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  
  <path d="${pathData}" 
        fill="none" 
        stroke="#00d4ff" 
        stroke-width="1.5" 
        stroke-linecap="round" 
        stroke-linejoin="round"
        filter="url(#glow)"/>
  
  <line x1="${padding}" y1="${height - padding}" 
        x2="${width - padding}" y2="${height - padding}" 
        stroke="#444" stroke-width="1"/>
  <line x1="${padding}" y1="${padding}" 
        x2="${padding}" y2="${height - padding}" 
        stroke="#444" stroke-width="1"/>
</svg>`;
    
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'frequency-comb-waveform.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-full p-6 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4 text-center dark:text-white">
          APT Frequency Comb
        </h2>
        
        <div className="mb-6">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="freq"
                label={{ value: 'Frequency (MHz)', position: 'insideBottom', offset: -5 }}
              />
              <YAxis 
                label={{ value: 'x(t)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="x" 
                stroke="#2563eb" 
                dot={false}
                strokeWidth={2}
                name="x(t)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">
              Spike Count: {spikeCount}
            </label>
            <input
              type="range"
              min={3}
              max={200}
              step={1}
              value={spikeCount}
              onChange={(e) => setSpikeCount(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">
              Spike Width Ratio: {spikeWidth.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.01}
              max={1.0}
              step={0.01}
              value={spikeWidth}
              onChange={(e) => setSpikeWidth(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>


          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">
              Center Spike Boost: {centerSpikeBoost.toFixed(2)}x
            </label>
            <input
              type="range"
              min={1.05}
              max={5}
              step={0.01}
              value={centerSpikeBoost}
              onChange={(e) => setCenterSpikeBoost(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">
              Floor Amplitude: {floorAmplitude.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.01}
              value={floorAmplitude}
              onChange={(e) => setFloorAmplitude(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">
              Decay Rate: {decayRate.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={decayRate}
              onChange={(e) => setDecayRate(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">
              Baseline Modulation: {baselineModulation.toFixed(2)}
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={baselineModulation}
              onChange={(e) => setBaselineModulation(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>


          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-300">
              Envelope Width: {envelopeWidth.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.01}
              value={envelopeWidth}
              onChange={(e) => setEnvelopeWidth(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

        </div>

        <button
          onClick={exportToSVG}
          className="mt-4 px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600"
        >
          Export as SVG
        </button>

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900 rounded">
          <h3 className="font-semibold mb-2 dark:text-white">About:</h3>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            APT (Automatic Picture Transmission) frequency comb with {spikeCount} spikes. Sine wave profiles with exponential height decay from center to floor, modulated by Gaussian envelope.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DrawMockNAPT;