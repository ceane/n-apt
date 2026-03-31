import React, { useRef, useEffect, useCallback, useState } from 'react';
import { usePretextText } from '@n-apt/hooks/usePretextText';
import { setupCanvasForDPI, isHighDPI, getOptimalTextRenderingSettings } from '@n-apt/utils/canvasDPIScaling';

export const SimplePretextDemo: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frequency, setFrequency] = useState(101500000); // 101.5 MHz

  // Use the pretext hook for text measurement
  const { metrics, isReady, getDPIScaledMetrics } = usePretextText({
    text: `Frequency: ${(frequency / 1e6).toFixed(2)} MHz`,
    font: '"JetBrains Mono", monospace',
    fontSize: 16,
    color: '#ffff00',
  });

  const canvasSetupRef = useRef<{ devicePixelRatio: number; scale: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isReady || !metrics) return;

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

    // Draw text using canvas context (simulating what pretext would measure)
    ctx.font = '16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ffff00';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Frequency: ${(frequency / 1e6).toFixed(2)} MHz`, 50, 50);

    // Draw stats box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(400, 50, 200, 120);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(400, 50, 200, 120);

    // Stats text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "Inter", sans-serif';
    ctx.fillText('Signal Stats', 410, 60);

    ctx.font = '12px "Inter", sans-serif';
    ctx.fillStyle = '#cccccc';
    ctx.fillText('Frequency:', 410, 85);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${(frequency / 1e6).toFixed(2)} MHz`, 590, 85, { align: 'right' } as any);

    ctx.fillStyle = '#00ff00';
    ctx.fillText('Signal:', 410, 105);
    ctx.fillText('-45.2 dBm', 590, 105, { align: 'right' } as any);

    ctx.fillStyle = '#ffff00';
    ctx.fillText('SNR:', 410, 125);
    ctx.fillText('23.4 dB', 590, 125, { align: 'right' } as any);

    // Show metrics and DPI info
    const dpiMetrics = getDPIScaledMetrics();
    const devicePixelRatio = window.devicePixelRatio || 1;

    ctx.fillStyle = '#00ff00';
    ctx.font = '12px "Inter", sans-serif';
    ctx.fillText(`Text width: ${metrics.width.toFixed(2)}px`, 50, 100);
    ctx.fillText(`Text height: ${metrics.height.toFixed(2)}px`, 50, 120);
    ctx.fillText(`Pretext ready: ${isReady}`, 50, 140);
    ctx.fillText(`Device DPI: ${devicePixelRatio}x`, 50, 160);
    ctx.fillText(`High DPI: ${isHighDPI() ? 'Yes' : 'No'}`, 50, 180);

    if (dpiMetrics) {
      ctx.fillText(`Scaled width: ${dpiMetrics.width.toFixed(2)}px`, 50, 200);
      ctx.fillText(`Scaled height: ${dpiMetrics.height.toFixed(2)}px`, 50, 220);
    }

  }, [frequency, isReady, metrics]);

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
      <h2>Simple Pretext Demo</h2>
      <canvas
        ref={canvasRef}
        width={800}
        height={400}
        style={{ border: '1px solid #444', backgroundColor: '#1a1a1a' }}
      />

      <div style={{ marginTop: '20px', fontSize: '14px' }}>
        <p>Frequency updates automatically every 2 seconds</p>
        <p>Current: {(frequency / 1e6).toFixed(2)} MHz</p>
        <p>Pretext hook status: {isReady ? 'Ready' : 'Loading...'}</p>
        <p>Device DPI: {window.devicePixelRatio || 1}x ({isHighDPI() ? 'High DPI' : 'Standard'})</p>
      </div>
    </div>
  );
};
