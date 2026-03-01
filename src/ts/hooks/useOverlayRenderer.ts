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
  const formatFrequencyHighRes = (freqMHz: number): string => {
    const fixed = freqMHz.toFixed(6);
    const [whole, decimals = ""] = fixed.split(".");
    const left = decimals.slice(0, 3).padEnd(3, "0");
    const right = decimals.slice(3, 6).padEnd(3, "0");
    return `${whole}.${left}.${right}MHz`;
  };

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

      const clampLabelX = (x: number, text: string) => {
        const tw = ctx.measureText(text).width;
        const leftBound = FFT_AREA_MIN.x + tw / 2 + 2;
        const rightBound = fftAreaMax.x - tw / 2 - 2;
        return Math.max(leftBound, Math.min(rightBound, x));
      };

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

      const visualCenterFreq = (minFreq + maxFreq) / 2;
      const centerTicksMHz: number[] = [];
      if (viewBandwidth2 <= 5.0) centerTicksMHz.push(0.5);
      if (viewBandwidth2 <= 1.0) centerTicksMHz.push(0.1);
      if (viewBandwidth2 <= 0.5) centerTicksMHz.push(0.05);
      if (viewBandwidth2 <= 0.25) centerTicksMHz.push(0.025);
      if (viewBandwidth2 <= 0.2) centerTicksMHz.push(0.005);
      if (viewBandwidth2 <= 0.1) centerTicksMHz.push(0.01);
      if (viewBandwidth2 <= 0.01) centerTicksMHz.push(0.001);
      if (viewBandwidth2 <= 0.001) centerTicksMHz.push(0.0001);
      if (viewBandwidth2 <= 0.0005) centerTicksMHz.push(0.00005);
      if (viewBandwidth2 <= 0.00025) centerTicksMHz.push(0.000025);

      const formatOffset = (mhz: number) => {
        const abs = Math.abs(mhz);
        if (abs >= 1) return `${mhz.toFixed(1)}MHz`;
        if (abs >= 0.001) return `${Math.round(mhz * 1000)}kHz`;
        return `${Math.round(mhz * 1_000_000)}Hz`;
      };

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
      const useHighResLabels = viewBandwidth2 * 1_000_000 < 10_000;
      const displayFreq = useHighResLabels ? formatFrequencyHighRes(minFreq) : formatFrequency(minFreq);
      ctx.fillText(displayFreq, clampLabelX(Math.round(channelStartX), displayFreq), fftAreaMax.y + 25);

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
        const displayFreq = useHighResLabels ? formatFrequencyHighRes(freq) : formatFrequency(freq);
        ctx.fillText(displayFreq, clampLabelX(Math.round(xPos), displayFreq), fftAreaMax.y + 25);
      }

      if (centerTicksMHz.length > 0 && Number.isFinite(visualCenterFreq)) {
        ctx.save();
        ctx.strokeStyle = "rgba(120, 120, 120, 0.55)";
        ctx.fillStyle = "rgba(160, 160, 160, 0.85)";
        ctx.font = "10px JetBrains Mono";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        for (const step of centerTicksMHz) {
          const leftFreq = visualCenterFreq - step;
          const rightFreq = visualCenterFreq + step;
          if (leftFreq <= minFreq || rightFreq >= maxFreq) continue;

          const lx = Math.round(freqToX2(leftFreq));
          const rx = Math.round(freqToX2(rightFreq));

          ctx.beginPath();
          ctx.moveTo(lx, FFT_AREA_MIN.y);
          ctx.lineTo(lx, fftAreaMax.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(rx, FFT_AREA_MIN.y);
          ctx.lineTo(rx, fftAreaMax.y);
          ctx.stroke();

          const label = formatOffset(step);
          ctx.fillText(label, clampLabelX(lx, label), FFT_AREA_MIN.y + 2);
          ctx.fillText(label, clampLabelX(rx, label), FFT_AREA_MIN.y + 2);
        }

        ctx.restore();
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
        
        const displayFreq = useHighResLabels ? formatFrequencyHighRes(maxFreq) : formatFrequency(maxFreq);
        ctx.fillText(displayFreq, clampLabelX(Math.round(xPos), displayFreq), fftAreaMax.y + 25);
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
    [formatFrequencyHighRes],
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
        Number.isFinite(centerFrequencyMHz)
      ) {
        // Always draw center line at the exact middle of the plot area
        // Using freqToX(centerFrequencyMHz) causes drift when zoomed
        const cx = Math.round((FFT_AREA_MIN.x + fftAreaMax.x) / 2) + 0.5;
        ctx.save();
        ctx.strokeStyle = "rgba(220, 255, 0, 0.7)";
        ctx.lineWidth = 1 / dpr;
        ctx.beginPath();
        ctx.moveTo(cx, FFT_AREA_MIN.y);
        ctx.lineTo(cx, fftAreaMax.y);
        ctx.stroke();
        ctx.restore();
      }

      const visualCenterFreq = (minFreq + maxFreq) / 2;
      const useHighResLabels = viewBandwidth * 1_000_000 < 10_000;
      const centerLabel =
        Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
          ? "✋  -- MHz"
          : `✋  ${useHighResLabels ? formatFrequencyHighRes(visualCenterFreq) : formatFrequency(visualCenterFreq)}`;

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
    [formatFrequencyHighRes],
  );

  return {
    drawGridOnContext,
    drawMarkersOnContext,
  };
}
