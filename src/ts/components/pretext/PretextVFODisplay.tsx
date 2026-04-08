import React, { useRef, useEffect, useCallback } from 'react';
import { usePretextText } from '@n-apt/hooks/usePretextText';
import { formatFrequency } from '@n-apt/consts';

export interface PretextVFODisplayProps {
  frequency: number;
  x?: number;
  y?: number;
  fontSize?: number;
  color?: string;
  showBackground?: boolean;
  backgroundColor?: string;
  padding?: number;
  borderRadius?: number;
}

export const PretextVFODisplay: React.FC<PretextVFODisplayProps> = ({
  frequency,
  x = 0,
  y = 0,
  fontSize = 14,
  color = '#ffff00',
  showBackground = true,
  backgroundColor = 'rgba(0, 0, 0, 0.8)',
  padding = 6,
  borderRadius = 4,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { metrics, isReady, getDPIScaledMetrics } = usePretextText({
    text: formatFrequency(frequency),
    font: 'bold JetBrains Mono, monospace',
    fontSize,
    color,
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isReady || !metrics) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Set canvas size for DPI
    canvas.width = (metrics.width + padding * 2) * dpr;
    canvas.height = (metrics.height + padding * 2) * dpr;
    canvas.style.width = `${metrics.width + padding * 2}px`;
    canvas.style.height = `${metrics.height + padding * 2}px`;

    // Scale context for DPI
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background if enabled
    if (showBackground) {
      ctx.fillStyle = backgroundColor;
      ctx.beginPath();
      ctx.roundRect(0, 0, metrics.width + padding * 2, metrics.height + padding * 2, borderRadius);
      ctx.fill();
    }

    // Draw text using DPI-scaled measurements
    ctx.font = `bold ${fontSize * dpr}px JetBrains Mono, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(formatFrequency(frequency), padding, padding);

  }, [frequency, fontSize, color, showBackground, backgroundColor, padding, borderRadius, isReady, metrics, getDPIScaledMetrics]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
};
