import React, { useState, useCallback } from 'react';
import { PretextVFODisplay } from '@n-apt/components/pretext/PretextVFODisplay';
import { PretextGridOverlay } from '@n-apt/components/pretext/PretextGridOverlay';
import { PretextDBScale } from '@n-apt/components/pretext/PretextDBScale';

export const VFOGridDemo: React.FC = () => {
  const [frequency, setFrequency] = useState(101.5); // MHz
  const [frequencyRange, setFrequencyRange] = useState({ min: 100, max: 103 });
  const [fftMin, setFftMin] = useState(-100);
  const [fftMax, setFftMax] = useState(0);
  const [powerScale, setPowerScale] = useState<"dB" | "dBm">("dB");
  const [showDBScale, setShowDBScale] = useState(true);
  const [showGridLines, setShowGridLines] = useState(true);

  // Simulate frequency changes
  const handleFrequencyChange = useCallback((newFreq: number) => {
    setFrequency(newFreq);
    // Update range to center around new frequency
    const bandwidth = frequencyRange.max - frequencyRange.min;
    setFrequencyRange({
      min: newFreq - bandwidth / 2,
      max: newFreq + bandwidth / 2,
    });
  }, [frequencyRange]);

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      backgroundColor: '#1a1a1a',
      color: '#fff',
      padding: '20px',
      position: 'relative'
    }}>
      <h2>VFO, Grid & dB Scale Demo with Pretext</h2>

      <div style={{
        position: 'relative',
        width: '800px',
        height: '400px',
        backgroundColor: '#0a0a0a',
        border: '1px solid #333',
        margin: '20px 0'
      }}>
        {/* dB Scale (left side) */}
        {showDBScale && (
          <PretextDBScale
            width={800}
            height={400}
            fftMin={fftMin}
            fftMax={fftMax}
            powerScale={powerScale}
            showGridLines={showGridLines}
            fontSize={12}
            padding={10}
          />
        )}

        {/* Grid overlay */}
        <PretextGridOverlay
          width={800}
          height={400}
          frequencyRange={frequencyRange}
          fftMin={fftMin}
          fftMax={fftMax}
          powerScale={powerScale}
        />

        {/* VFO frequency display */}
        <PretextVFODisplay
          frequency={frequency}
          x={350}
          y={20}
          fontSize={16}
          color="#ffff00"
          showBackground={true}
          backgroundColor="rgba(0, 0, 0, 0.8)"
          padding={8}
          borderRadius={4}
        />

        {/* Additional VFO displays for testing */}
        <PretextVFODisplay
          frequency={frequency - 0.5}
          x={50}
          y={100}
          fontSize={12}
          color="#00ff00"
          showBackground={true}
          backgroundColor="rgba(0, 255, 0, 0.1)"
          padding={4}
          borderRadius={2}
        />

        <PretextVFODisplay
          frequency={frequency + 0.5}
          x={650}
          y={100}
          fontSize={12}
          color="#ff6b6b"
          showBackground={true}
          backgroundColor="rgba(255, 107, 107, 0.1)"
          padding={4}
          borderRadius={2}
        />

        {/* dB scale info display */}
        <PretextVFODisplay
          frequency={0} // Use as text display
          x={620}
          y={350}
          fontSize={10}
          color="#888"
          showBackground={true}
          backgroundColor="rgba(0, 0, 0, 0.6)"
          padding={4}
          borderRadius={2}
        />
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        gap: '20px',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: '15px',
        borderRadius: '8px',
        flexWrap: 'wrap'
      }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>Frequency (MHz):</label>
          <input
            type="range"
            min={100}
            max={103}
            step={0.01}
            value={frequency}
            onChange={(e) => handleFrequencyChange(parseFloat(e.target.value))}
            style={{ width: '200px' }}
          />
          <span style={{ marginLeft: '10px', fontFamily: 'monospace' }}>
            {frequency.toFixed(2)} MHz
          </span>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>Bandwidth (MHz):</label>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={frequencyRange.max - frequencyRange.min}
            onChange={(e) => {
              const bandwidth = parseFloat(e.target.value);
              setFrequencyRange({
                min: frequency - bandwidth / 2,
                max: frequency + bandwidth / 2,
              });
            }}
            style={{ width: '200px' }}
          />
          <span style={{ marginLeft: '10px', fontFamily: 'monospace' }}>
            {(frequencyRange.max - frequencyRange.min).toFixed(1)} MHz
          </span>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>Power Scale:</label>
          <select
            value={powerScale}
            onChange={(e) => setPowerScale(e.target.value as "dB" | "dBm")}
            style={{ padding: '4px', borderRadius: '4px' }}
          >
            <option value="dB">dB</option>
            <option value="dBm">dBm</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>dB Range:</label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              value={fftMin}
              onChange={(e) => setFftMin(parseFloat(e.target.value))}
              style={{ width: '60px', padding: '4px' }}
            />
            <span>to</span>
            <input
              type="number"
              value={fftMax}
              onChange={(e) => setFftMax(parseFloat(e.target.value))}
              style={{ width: '60px', padding: '4px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <label>
            <input
              type="checkbox"
              checked={showDBScale}
              onChange={(e) => setShowDBScale(e.target.checked)}
              style={{ marginRight: '5px' }}
            />
            Show dB Scale
          </label>

          <label>
            <input
              type="checkbox"
              checked={showGridLines}
              onChange={(e) => setShowGridLines(e.target.checked)}
              style={{ marginRight: '5px' }}
            />
            Show Grid Lines
          </label>
        </div>

        <button
          onClick={() => {
            // Simulate frequency sweep
            let currentFreq = frequency;
            const interval = setInterval(() => {
              currentFreq += 0.1;
              if (currentFreq > 103) {
                clearInterval(interval);
                return;
              }
              handleFrequencyChange(currentFreq);
            }, 100);
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#007acc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Sweep Frequency
        </button>
      </div>

      <div style={{ marginTop: '20px', fontSize: '14px', opacity: 0.8 }}>
        <p>• Grid uses pretext for precise text measurement and DPI scaling</p>
        <p>• dB scale shows vertical amplitude labels with proper units</p>
        <p>• VFO displays show crisp text on high-DPI displays</p>
        <p>• Real-time frequency and scale updates with optimal performance</p>
        <p>• Device Pixel Ratio: {window.devicePixelRatio || 1}x</p>
        <p>• Current range: {fftMin} to {fftMax} {powerScale}</p>
      </div>
    </div>
  );
};
