import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { usePretextText } from '@n-apt/hooks/usePretextText';
import { setupCanvasForDPI } from '@n-apt/utils/canvasDPIScaling';
import {
  FFT_GRID_COLOR,
  FFT_TEXT_COLOR,
  FFT_AREA_MIN,
  findBestFrequencyRange,
} from '@n-apt/consts';
import { formatFrequency, formatFrequencyHighRes } from '@n-apt/consts';

export interface PretextGridOverlayProps {
  width: number;
  height: number;
  frequencyRange: { min: number; max: number };
  fftMin: number;
  fftMax: number;
  powerScale?: "dB" | "dBm";
  hardwareSampleRateHz?: number;
  fullCaptureRange?: { min: number; max: number };
  isIqRecordingActive?: boolean;
}

// Maximum number of hooks we'll need (conservative estimate)
const MAX_HORIZONTAL_LABELS = 50;

export const PretextGridOverlay: React.FC<PretextGridOverlayProps> = ({
  width,
  height,
  frequencyRange,
  fftMin: _fftMin,
  fftMax: _fftMax,
  powerScale: _powerScale = "dB",
  hardwareSampleRateHz: _hardwareSampleRateHz,
  fullCaptureRange,
  isIqRecordingActive: _isIqRecordingActive,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate all text labels upfront to avoid hook calls in loops
  const labelData = useMemo(() => {
    if (!frequencyRange) return { horizontalLabels: [] };

    const minFreq = frequencyRange.min;
    const maxFreq = frequencyRange.max;
    const viewBandwidth2 = maxFreq - minFreq;

    const fullSpan = fullCaptureRange ? (fullCaptureRange.max - fullCaptureRange.min) : 0;
    const zoom = fullSpan > 0 ? fullSpan / viewBandwidth2 : 1;
    const useHighRes = zoom >= 100;
    const formatFreq = (f: number) => useHighRes ? formatFrequencyHighRes(f) : formatFrequency(f);

    // Generate horizontal labels only - vertical labels handled by PretextDBScale
    const step = findBestFrequencyRange(viewBandwidth2, 10);
    const formatTickLabel = (freq: number) => {
      if (maxFreq < 1) return `${Math.round(freq * 1000)}kHz`;
      if (step >= 0.5) return freq.toFixed(1);
      if (step >= 0.01) return freq.toFixed(2);
      return freq.toFixed(3);
    };

    const lowerFreq2 = Math.ceil((minFreq + 0.000001) / step) * step;
    const upperFreq2 = maxFreq;
    const visualCenterFreq = (minFreq + maxFreq) / 2;

    const horizontalLabels = [];
    for (let freq = lowerFreq2; freq < upperFreq2 - 0.0001; freq += step) {
      horizontalLabels.push({ freq, label: formatTickLabel(freq) });
    }

    return {
      horizontalLabels: [
        { freq: minFreq, label: formatFreq(minFreq), type: 'start' },
        { freq: maxFreq, label: formatFreq(maxFreq), type: 'end' },
        { freq: visualCenterFreq, label: formatFreq(visualCenterFreq), type: 'center' },
        ...horizontalLabels.map(h => ({ ...h, type: 'tick' as const }))
      ]
    };
  }, [frequencyRange, fullCaptureRange]);

  // Create hooks for horizontal labels only
  const horizontalTextHooks = Array.from({ length: MAX_HORIZONTAL_LABELS }, (_, index) => {
    const item = labelData.horizontalLabels[index];
    return usePretextText({
      text: item ? (item.type === 'center' ? `✋  ${item.label}` : item.label) : '',
      font: '12px JetBrains Mono',
      fontSize: 12,
      color: FFT_TEXT_COLOR,
    });
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frequencyRange) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Setup DPI scaling
    const { ctx: scaledCtx, devicePixelRatio } = setupCanvasForDPI(canvas, width, height);

    const dpr = devicePixelRatio;
    const fftAreaMax = { x: width - 40, y: height - 40 };
    const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

    const minFreq = frequencyRange.min;
    const maxFreq = frequencyRange.max;
    const viewBandwidth2 = maxFreq - minFreq;

    // Clear canvas
    scaledCtx.clearRect(0, 0, width, height);

    // Grid styling
    scaledCtx.strokeStyle = FFT_GRID_COLOR;
    scaledCtx.fillStyle = FFT_TEXT_COLOR;
    scaledCtx.lineWidth = 1 / dpr;
    scaledCtx.font = `${12 * dpr}px JetBrains Mono`;

    const freqToX2 = (freq: number) =>
      FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth2) * plotWidth;

    // Draw frequency lines
    const channelStartX = freqToX2(minFreq);
    scaledCtx.beginPath();
    scaledCtx.moveTo(Math.round(channelStartX), FFT_AREA_MIN.y);
    scaledCtx.lineTo(Math.round(channelStartX), fftAreaMax.y + 7);
    scaledCtx.stroke();

    const channelEndX = freqToX2(maxFreq);
    scaledCtx.beginPath();
    scaledCtx.moveTo(Math.round(channelEndX), FFT_AREA_MIN.y);
    scaledCtx.lineTo(Math.round(channelEndX), fftAreaMax.y + 7);
    scaledCtx.stroke();

    // Draw horizontal labels using pre-calculated hooks
    labelData.horizontalLabels.forEach((item, index) => {
      if (index >= MAX_HORIZONTAL_LABELS) return;

      const { metrics } = horizontalTextHooks[index];
      if (!metrics) return;

      const xPos = freqToX2(item.freq);

      if (item.type === 'start') {
        scaledCtx.textAlign = "left";
        scaledCtx.fillText(item.label, FFT_AREA_MIN.x * dpr, (fftAreaMax.y + 25) * dpr);
      } else if (item.type === 'end') {
        scaledCtx.textAlign = "right";
        scaledCtx.fillText(item.label, fftAreaMax.x * dpr, (fftAreaMax.y + 25) * dpr);
      } else if (item.type === 'center') {
        scaledCtx.textAlign = "center";
        scaledCtx.fillText(`✋  ${item.label}`, (width / 2) * dpr, (fftAreaMax.y + 25) * dpr);
      } else if (item.type === 'tick') {
        // Draw tick mark
        scaledCtx.strokeStyle = FFT_TEXT_COLOR;
        scaledCtx.beginPath();
        scaledCtx.moveTo(Math.round(xPos), fftAreaMax.y);
        scaledCtx.lineTo(Math.round(xPos), fftAreaMax.y + 7);
        scaledCtx.stroke();

        // Draw grid line
        scaledCtx.strokeStyle = FFT_GRID_COLOR;
        scaledCtx.beginPath();
        scaledCtx.moveTo(Math.round(xPos), FFT_AREA_MIN.y);
        scaledCtx.lineTo(Math.round(xPos), fftAreaMax.y);
        scaledCtx.stroke();

        // Draw tick label
        scaledCtx.textAlign = "center";
        scaledCtx.fillText(item.label, xPos * dpr, (fftAreaMax.y + 25) * dpr);
      }
    });

  }, [width, height, frequencyRange, labelData, horizontalTextHooks]);

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
        zIndex: 5,
      }}
    />
  );
};
