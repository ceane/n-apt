import React, { useRef, useEffect, useCallback, useState } from 'react';
import { PretextCanvasText, type PretextCanvasTextRef } from '@n-apt/components/pretext/PretextCanvasText';
import { PretextVFOText } from '@n-apt/components/pretext/PretextVFOText';
import { PretextStatsBox, type PretextStatsBoxRef } from '@n-apt/components/pretext/PretextStatsBox';

export const PretextDemo: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frequency, setFrequency] = useState(101500000); // 101.5 MHz
  const textRef = useRef<PretextCanvasTextRef>(null);
  const vfoRef = useRef<PretextCanvasTextRef>(null);
  const statsRef = useRef<PretextStatsBoxRef>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // Draw text components
    if (textRef.current) textRef.current.draw(ctx);
    if (vfoRef.current) vfoRef.current.draw(ctx);
    if (statsRef.current) statsRef.current.draw(ctx);
  }, []);

  useEffect(() => {
    draw();
  }, [draw, frequency]);

  // Simulate frequency changes
  useEffect(() => {
    const interval = setInterval(() => {
      setFrequency(prev => prev + 1000000); // +1 MHz
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '20px', backgroundColor: '#000', color: '#fff' }}>
      <h2>Pretext Canvas Text Demo</h2>
      <canvas
        ref={canvasRef}
        width={800}
        height={400}
        style={{ border: '1px solid #444', backgroundColor: '#1a1a1a' }}
      />

      {/* Hidden text components that render to canvas */}
      <PretextCanvasText
        ref={textRef}
        text="Hello from Pretext! This is a multiline text example that demonstrates precise layout without DOM measurements."
        fontSize={16}
        color="#00ff00"
        x={50}
        y={50}
        maxWidth={300}
      />

      <PretextVFOText
        frequency={frequency}
        fontSize={20}
        color="#ffff00"
        x={50}
        y={150}
      />

      <PretextStatsBox
        ref={statsRef}
        x={400}
        y={50}
        width={200}
        height={120}
        title="Signal Stats"
        stats={[
          { label: 'Frequency', value: `${(frequency / 1e6).toFixed(2)} MHz` },
          { label: 'Signal', value: '-45.2 dBm', color: '#00ff00' },
          { label: 'SNR', value: '23.4 dB', color: '#ffff00' },
          { label: 'Sample Rate', value: '2.4 MS/s' },
        ]}
      />

      <div style={{ marginTop: '20px', fontSize: '14px' }}>
        <p>Frequency updates automatically every 2 seconds</p>
        <p>Current: {(frequency / 1e6).toFixed(2)} MHz</p>
      </div>
    </div>
  );
};
