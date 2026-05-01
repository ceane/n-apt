import { useCallback } from "react";
import { usePretextText } from "@n-apt/hooks/usePretextText";
import {
  FFT_GRID_COLOR,
  FFT_TEXT_COLOR,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  findBestFrequencyRange,
  SNAP_HW_RATE_LINE,
  SNAP_HW_RATE_TEXT,
  OFFSET_TICK_LINE_COLOR,
  OFFSET_TICK_TEXT_COLOR,
  CENTER_LINE_COLOR,
} from "@n-apt/consts";
import { formatFrequency, formatFrequencyHighRes } from "@n-apt/consts";
import type { SdrLimitMarker } from "@n-apt/utils/sdrLimitMarkers";
import type { SpectrumSpikeMarker } from "@n-apt/hooks/useWasmSimdMath";

const readCssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const getCanvasThemeColors = () => ({
  gridColor: readCssColor("--color-fft-grid", FFT_GRID_COLOR),
  textColor: readCssColor("--color-fft-text", FFT_TEXT_COLOR),
  centerLineColor: readCssColor("--color-fft-center-line", CENTER_LINE_COLOR),
  offsetTickLine: readCssColor("--color-fft-offset-tick-line", OFFSET_TICK_LINE_COLOR),
  offsetTickText: readCssColor("--color-fft-offset-tick-text", OFFSET_TICK_TEXT_COLOR),
  snapHwRateLine: readCssColor("--color-snap-hw-rate-line", SNAP_HW_RATE_LINE),
  snapHwRateText: readCssColor("--color-snap-hw-rate-text", SNAP_HW_RATE_TEXT),
  centerLabelText: readCssColor("--color-snap-center-label-text", "#666"),
});

/**
 * Pretext-enhanced overlay renderer for crisp text on high-DPI displays
 */
export function usePretextOverlayRenderer() {
  const drawGridOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      fftMin: number,
      fftMax: number,
      powerScale: "dB" | "dBm" = "dB",
      _hardwareSampleRateHz?: number,
      _fullCaptureRange?: { min: number; max: number },
      _isIqRecordingActive?: boolean,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const canvasTheme = getCanvasThemeColors();
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      if (!frequencyRange) return;
      const minFreq = frequencyRange.min;
      const maxFreq = frequencyRange.max;
      const viewBandwidth2 = maxFreq - minFreq;

      const fullSpan = _fullCaptureRange ? (_fullCaptureRange.max - _fullCaptureRange.min) : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth2 : 1;
      const useHighRes = zoom >= 100;
      const formatFreq = (f: number) => useHighRes ? formatFrequencyHighRes(f) : formatFrequency(f);

      // Setup DPI scaling for crisp text
      ctx.clearRect(0, 0, width, height);
      ctx.scale(dpr, dpr);

      ctx.strokeStyle = canvasTheme.gridColor;
      ctx.fillStyle = canvasTheme.textColor;
      ctx.lineWidth = 1 / dpr;

      // Generate vertical labels using pretext for precise measurement
      const labelStart = Math.floor((fftMax + 0.1) / VERTICAL_RANGE) * VERTICAL_RANGE;
      const labels = [];
      if (Math.abs(fftMax - labelStart) > 0.1) {
        labels.push(fftMax);
      }
      
      for (let line = labelStart; line >= fftMin - 1; line -= VERTICAL_RANGE) {
        labels.push(line);
      }

      // Draw vertical grid lines and labels with pretext
      for (const line of labels) {
        const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
        
        if (yPos < FFT_AREA_MIN.y - 2 || yPos > fftAreaMax.y + 2) continue;

        ctx.beginPath();
        ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
        ctx.lineTo(fftAreaMax.x, Math.round(yPos));
        ctx.stroke();

        let labelText = `${Math.round(line)}`;
        if (line === labels[0]) {
          labelText += powerScale === "dBm" ? " dBm" : " dB";
        }

        // Use pretext for precise text measurement and positioning
        const { metrics: labelMetrics } = usePretextText({
          text: labelText,
          font: '12px JetBrains Mono',
          fontSize: 12,
          color: canvasTheme.textColor,
        });

        if (labelMetrics) {
          const scaledX = (FFT_AREA_MIN.x - 10) / dpr;
          const scaledY = (Math.round(yPos + 3)) / dpr;
          
          ctx.font = `${12 * dpr}px JetBrains Mono`;
          ctx.fillText(labelText, scaledX, scaledY);
        }
      }

      // Horizontal frequency labels
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

      // Generate frequency labels with pretext
      const startLabel = formatFreq(minFreq);
      const endLabel = formatFreq(maxFreq);
      const centerLabelText = Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
        ? "-- MHz"
        : formatFreq(visualCenterFreq);

      // Draw start/end frequency labels with pretext
      const { metrics: _startMetrics } = usePretextText({
        text: startLabel,
        font: '12px JetBrains Mono',
        fontSize: 12,
        color: canvasTheme.textColor,
      });

      const { metrics: _endMetrics } = usePretextText({
        text: endLabel,
        font: '12px JetBrains Mono',
        fontSize: 12,
        color: canvasTheme.textColor,
      });

      const { metrics: centerMetrics } = usePretextText({
        text: `✋  ${centerLabelText}`,
        font: '12px JetBrains Mono',
        fontSize: 12,
        color: canvasTheme.textColor,
      });

      // Draw frequency lines
      const freqToX2 = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth2) * plotWidth;

      const channelStartX = freqToX2(minFreq);
      ctx.beginPath();
      ctx.moveTo(Math.round(channelStartX), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(channelStartX), fftAreaMax.y + 7);
      ctx.stroke();

      const channelEndX = freqToX2(maxFreq);
      ctx.beginPath();
      ctx.moveTo(Math.round(channelEndX), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(channelEndX), fftAreaMax.y + 7);
      ctx.stroke();

      // Draw frequency labels with DPI scaling
      ctx.font = `${12 * dpr}px JetBrains Mono`;
      ctx.textAlign = "left";
      ctx.fillText(startLabel, FFT_AREA_MIN.x / dpr, (fftAreaMax.y + 25) / dpr);

      ctx.textAlign = "right";
      ctx.fillText(endLabel, fftAreaMax.x / dpr, (fftAreaMax.y + 25) / dpr);

      ctx.textAlign = "center";
      if (centerMetrics) {
        ctx.fillText(`✋  ${centerLabelText}`, width / (2 * dpr), (fftAreaMax.y + 25) / dpr);
      }

      // Draw tick marks and labels
      for (let freq = lowerFreq2; freq < upperFreq2 - 0.0001; freq += step) {
        const xPos = freqToX2(freq);
        const ix = Math.round(xPos);

        // Grid line
        ctx.strokeStyle = canvasTheme.gridColor;
        ctx.beginPath();
        ctx.moveTo(ix, FFT_AREA_MIN.y);
        ctx.lineTo(ix, fftAreaMax.y);
        ctx.stroke();

        // Tick mark
        ctx.strokeStyle = canvasTheme.textColor;
        ctx.beginPath();
        ctx.moveTo(ix, fftAreaMax.y);
        ctx.lineTo(ix, fftAreaMax.y + 7);
        ctx.stroke();

        // Tick label with pretext measurement
        const label = formatTickLabel(freq);
        const { metrics: tickMetrics } = usePretextText({
          text: label,
          font: '12px JetBrains Mono',
          fontSize: 12,
          color: canvasTheme.textColor,
        });

        if (tickMetrics) {
          ctx.fillText(label, xPos / dpr, (fftAreaMax.y + 25) / dpr);
        }
      }
    },
    []
  );

  const drawMarkersOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      _frequencyRange: { min: number; max: number },
      centerFrequencyHz: number,
      _isDeviceConnected: boolean,
      _hardwareSampleRateHz?: number,
      _fullCaptureRange?: { min: number; max: number },
      _isIqRecordingActive?: boolean,
      _limitMarkers?: SdrLimitMarker[],
    ) => {
      // Implementation for markers with pretext
      // This would include VFO frequency display, limit markers, etc.
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, width, height);
      ctx.scale(dpr, dpr);

      // VFO frequency display using pretext
      const { metrics: _vfoMetrics } = usePretextText({
        text: formatFrequency(centerFrequencyHz / 1e6),
        font: 'bold 14px JetBrains Mono',
        fontSize: 14,
        color: '#ffff00',
      });

      if (_vfoMetrics) {
        ctx.font = `${14 * dpr}px JetBrains Mono`;
        ctx.fillStyle = '#ffff00';
        ctx.textAlign = 'center';
        ctx.fillText(formatFrequency(centerFrequencyHz / 1e6), width / (2 * dpr), 30 / dpr);
      }
    },
    []
  );

  const drawSpikeMarkersOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      _spikeMarkers: SpectrumSpikeMarker[],
      _frequencyRange: { min: number; max: number },
      _fftMin: number,
      _fftMax: number,
    ) => {
      // Implementation for spike markers with pretext
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, width, height);
      ctx.scale(dpr, dpr);

      // Draw spike markers using pretext for labels
      _spikeMarkers.forEach((marker: SpectrumSpikeMarker) => {
        const { metrics: _spikeMetrics } = usePretextText({
          text: `${(marker.frequency ?? 0).toFixed(2)} MHz`,
          font: '10px JetBrains Mono',
          fontSize: 10,
          color: '#ff6b6b',
        });

        if (_spikeMetrics) {
          // Draw marker and label
          ctx.font = `${10 * dpr}px JetBrains Mono`;
          ctx.fillStyle = '#ff6b6b';
          ctx.fillText(`${(marker.frequency ?? 0).toFixed(2)} MHz`, (marker.x ?? 0) / dpr, (marker.y ?? 0) / dpr);
        }
      });
    },
    []
  );

  return {
    drawGridOnContext,
    drawMarkersOnContext,
    drawSpikeMarkersOnContext,
  };
}
