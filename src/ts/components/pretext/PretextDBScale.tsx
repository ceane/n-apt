import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { usePretextText } from '@n-apt/hooks/usePretextText';
import { setupCanvasForDPI } from '@n-apt/utils/canvasDPIScaling';
import {
  FFT_TEXT_COLOR,
  FFT_GRID_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
} from '@n-apt/consts';

export interface PretextDBScaleProps {
  width: number;
  height: number;
  fftMin: number;
  fftMax: number;
  powerScale?: "dB" | "dBm";
  showGridLines?: boolean;
  gridColor?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: string;
  padding?: number;
}

// Maximum number of dB labels we might need
const MAX_DB_LABELS = 25;

export const PretextDBScale: React.FC<PretextDBScaleProps> = ({
  width,
  height,
  fftMin,
  fftMax,
  powerScale = "dB",
  showGridLines = true,
  gridColor = FFT_GRID_COLOR,
  textColor = FFT_TEXT_COLOR,
  fontSize = 12,
  fontFamily = "JetBrains Mono",
  padding = 10,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate dB labels using the same logic as the original grid
  const dbLabels = useMemo(() => {
    const labels = [];

    // Ensure we start labeling from a clean multiple of VERTICAL_RANGE
    const labelStart = Math.floor((fftMax + 0.1) / VERTICAL_RANGE) * VERTICAL_RANGE;

    // Always include the actual fftMax as the top label, even if it's not on a VERTICAL_RANGE boundary
    if (Math.abs(fftMax - labelStart) > 0.1) {
      labels.push(fftMax);
    }

    // Add the regular grid labels
    for (let line = labelStart; line >= fftMin - 1; line -= VERTICAL_RANGE) {
      labels.push(line);
    }

    return labels;
  }, [fftMin, fftMax]);

  // Create fixed number of hooks for consistent order
  const dbTextHooks = Array.from({ length: MAX_DB_LABELS }, (_, index) => {
    const value = dbLabels[index];
    const labelText = value ? `${Math.round(value)}${value === dbLabels[0] ? (powerScale === "dBm" ? " dBm" : " dB") : ""}` : '';

    return usePretextText({
      text: labelText,
      font: `${fontSize}px ${fontFamily}`,
      fontSize,
      color: textColor,
    });
  });

  // Create hook for scale title at top level
  const { metrics: titleMetrics } = usePretextText({
    text: powerScale,
    font: `bold ${fontSize}px ${fontFamily}`,
    fontSize: fontSize,
    color: textColor,
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Setup DPI scaling
    const { ctx: scaledCtx, devicePixelRatio } = setupCanvasForDPI(canvas, width, height);
    const dpr = devicePixelRatio;

    // Calculate drawing area - use full canvas for grid lines
    const fftAreaMax = { x: width - padding, y: height - padding };
    const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
    const vertRange = fftMax - fftMin;
    const scaleFactor = fftHeight / vertRange;

    // Clear canvas
    scaledCtx.clearRect(0, 0, width, height);

    // Set styles
    scaledCtx.strokeStyle = gridColor;
    scaledCtx.fillStyle = textColor;
    scaledCtx.lineWidth = 1 / dpr;
    scaledCtx.font = `${fontSize * dpr}px ${fontFamily}`;

    // Draw dB scale labels and grid lines
    dbLabels.forEach((value, index) => {
      if (index >= MAX_DB_LABELS) return;

      const yPos = fftAreaMax.y - (value - fftMin) * scaleFactor;

      // Bounds check with small padding
      if (yPos < FFT_AREA_MIN.y - 2 || yPos > fftAreaMax.y + 2) return;

      // Draw grid line if enabled - extend full width from left edge to right edge
      if (showGridLines) {
        scaledCtx.beginPath();
        scaledCtx.moveTo(0, Math.round(yPos)); // Start from very left edge
        scaledCtx.lineTo(width, Math.round(yPos)); // Extend to very right edge
        scaledCtx.stroke();
      }

      // Draw label using pre-calculated hook
      const { metrics } = dbTextHooks[index];
      if (metrics) {
        // Right-align the labels at the left edge of the plot area
        const labelX = padding - 5; // Position in the padding area
        const labelY = yPos + 3; // Small offset for better alignment

        scaledCtx.textAlign = "right";
        scaledCtx.textBaseline = "top";
        scaledCtx.fillText(
          `${Math.round(value)}${value === dbLabels[0] ? (powerScale === "dBm" ? " dBm" : " dB") : ""}`,
          labelX * dpr,
          labelY * dpr
        );
      }
    });

    // Draw scale title using pre-calculated hook
    if (titleMetrics) {
      // Rotate text for vertical orientation
      scaledCtx.save();
      scaledCtx.translate(padding * dpr, (height / 2) * dpr);
      scaledCtx.rotate(-Math.PI / 2); // -90 degrees
      scaledCtx.textAlign = "center";
      scaledCtx.textBaseline = "middle";
      scaledCtx.font = `bold ${fontSize * dpr}px ${fontFamily}`;
      scaledCtx.fillText(powerScale, 0, 0);
      scaledCtx.restore();
    }

  }, [width, height, fftMin, fftMax, powerScale, showGridLines, gridColor, textColor, fontSize, fontFamily, padding, dbLabels, dbTextHooks, titleMetrics]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: 'none',
        zIndex: 4,
      }}
    />
  );
};
