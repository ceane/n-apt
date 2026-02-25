import { useCallback } from "react";
import {
  FFT_GRID_COLOR,
  FFT_TEXT_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  findBestFrequencyRange,
} from "@n-apt/consts";
import { formatFrequency } from "../consts/sdr";

/**
 * Hook for rendering WebGPU overlay textures (grid and markers)
 * Provides functions to draw grid and markers onto OffscreenCanvas contexts
 */
export function useOverlayRenderer() {
  const drawGridOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      fftMin: number,
      fftMax: number,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

      const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE;
      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      if (!frequencyRange) return;
      const minFreq = frequencyRange.min;
      const maxFreq = frequencyRange.max;
      if (!Number.isFinite(minFreq) || !Number.isFinite(maxFreq)) return;

      ctx.strokeStyle = FFT_GRID_COLOR;
      ctx.fillStyle = FFT_TEXT_COLOR;
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "right";
      ctx.lineWidth = 1 / dpr;

      const zeroDbY = fftAreaMax.y - (0 - fftMin) * scaleFactor;
      ctx.fillText("0dB", FFT_AREA_MIN.x - 10, Math.round(zeroDbY + 3));

      for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
        if (line === 0) continue;
        const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
        ctx.lineTo(fftAreaMax.x, Math.round(yPos));
        ctx.stroke();
        ctx.fillText(line.toString(), FFT_AREA_MIN.x - 10, Math.round(yPos + 3));
      }

      const viewBandwidth2 = maxFreq - minFreq;
      const range2 = findBestFrequencyRange(viewBandwidth2, 10);
      // Always show a line at the exact channel start, then continue with regular grid
      const lowerFreq2 = Math.ceil(minFreq / range2) * range2;
      const upperFreq2 = maxFreq;
      const freqToX2 = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth2) * plotWidth;

      ctx.strokeStyle = FFT_GRID_COLOR;
      ctx.fillStyle = FFT_TEXT_COLOR;
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "center";

      // Always draw a line at the exact channel start
      const channelStartX = freqToX2(minFreq);
      ctx.beginPath();
      ctx.moveTo(Math.round(channelStartX), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(channelStartX), fftAreaMax.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(Math.round(channelStartX), fftAreaMax.y);
      ctx.lineTo(Math.round(channelStartX), fftAreaMax.y + 7);
      ctx.stroke();
      
      // Show channel start frequency
      const displayFreq = formatFrequency(minFreq);
      ctx.fillText(displayFreq, Math.round(channelStartX), fftAreaMax.y + 25);

      // Then draw the regular grid lines
      for (let freq = lowerFreq2; freq < upperFreq2; freq += range2) {
        // Skip if this is the same as the channel start we already drew
        if (Math.abs(freq - minFreq) < 0.001) continue;
        
        const xPos = freqToX2(freq);
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), fftAreaMax.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7);
        ctx.stroke();
        
        // Use proper frequency formatting with Hz/kHz/MHz
        const displayFreq = formatFrequency(freq);
        ctx.fillText(displayFreq, Math.round(xPos), fftAreaMax.y + 25);
      }

      const xPos = fftAreaMax.x;
      const lastGridFreq = Math.floor((upperFreq2 - 1e-6) / range2) * range2;
      const lastGridX = freqToX2(lastGridFreq);
      if (xPos - lastGridX > 50) {
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.round(xPos), fftAreaMax.y);
        ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7);
        ctx.stroke();
        
        const displayFreq = formatFrequency(maxFreq);
        ctx.fillText(displayFreq, Math.round(xPos), fftAreaMax.y + 25);
      }

      ctx.strokeStyle = FFT_TEXT_COLOR;
      ctx.lineWidth = 1.0 / dpr;
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, fftAreaMax.y);
      ctx.lineTo(fftAreaMax.x, fftAreaMax.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(FFT_AREA_MIN.x, FFT_AREA_MIN.y);
      ctx.lineTo(FFT_AREA_MIN.x, fftAreaMax.y - 1);
      ctx.stroke();
    },
    [],
  );

  const drawMarkersOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      centerFrequencyMHz?: number,
      isDeviceConnected: boolean = true,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;
      if (!frequencyRange) return;
      const minFreq = frequencyRange.min;
      const maxFreq = frequencyRange.max;
      if (!Number.isFinite(minFreq) || !Number.isFinite(maxFreq)) return;
      const viewBandwidth = maxFreq - minFreq;
      if (viewBandwidth <= 0) return;

      const freqToX = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;

      const markers: { freq: number; label: string }[] = [];

      if (isDeviceConnected) {
        for (const m of markers) {
          if (m.freq < minFreq || m.freq > maxFreq) continue;
          const x = Math.round(freqToX(m.freq)) + 0.5;
          ctx.save();
          ctx.strokeStyle = "rgba(220, 38, 38, 0.55)";
          ctx.lineWidth = 1 / dpr;
          ctx.beginPath();
          ctx.moveTo(x, FFT_AREA_MIN.y);
          ctx.lineTo(x, fftAreaMax.y);
          ctx.stroke();
          ctx.restore();

          ctx.save();
          ctx.font = "11px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const tw = ctx.measureText(m.label).width;
          const lx = Math.max(FFT_AREA_MIN.x + tw / 2 + 4, Math.min(fftAreaMax.x - tw / 2 - 4, x));
          ctx.fillStyle = "rgba(10, 10, 10, 0.75)";
          ctx.fillRect(lx - tw / 2 - 4, FFT_AREA_MIN.y + 4, tw + 8, 18);
          ctx.fillStyle = "rgba(220, 38, 38, 0.9)";
          ctx.fillText(m.label, lx, FFT_AREA_MIN.y + 6);
          ctx.restore();
        }
      }

      if (
        centerFrequencyMHz !== undefined &&
        centerFrequencyMHz >= minFreq &&
        centerFrequencyMHz <= maxFreq
      ) {
        const cx = Math.round(freqToX(centerFrequencyMHz)) + 0.5;
        ctx.save();
        ctx.strokeStyle = "rgba(234, 179, 8, 0.35)";
        ctx.lineWidth = 1 / dpr;
        ctx.beginPath();
        ctx.moveTo(cx, FFT_AREA_MIN.y);
        ctx.lineTo(cx, fftAreaMax.y);
        ctx.stroke();
        ctx.restore();
      }

      const visualCenterFreq = (minFreq + maxFreq) / 2;
      const centerLabel =
        Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
          ? "✋  -- MHz"
          : `✋  ${formatFrequency(visualCenterFreq)}`;

      ctx.save();
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const labelW = ctx.measureText(centerLabel).width;
      const labelX = width / 2;
      const labelY = fftAreaMax.y + 25;
      ctx.fillStyle = "rgba(10, 10, 10, 0.9)";
      ctx.fillRect(labelX - labelW / 2 - 6, labelY - 13, labelW + 12, 17);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(centerLabel, labelX, labelY);
      ctx.restore();
    },
    [],
  );

  return {
    drawGridOnContext,
    drawMarkersOnContext,
  };
}
