import { useCallback } from "react";
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

/**
 * Hook for rendering WebGPU overlay textures (grid and markers)
 * Provides functions to draw grid and markers onto OffscreenCanvas contexts
 */
export function useOverlayRenderer() {
  // formatFrequencyHighRes moved to shared.ts

  const drawGridOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      fftMin: number,
      fftMax: number,
      powerScale: "dB" | "dBm" = "dB",
      hardwareSampleRateHz?: number,
      fullCaptureRange?: { min: number; max: number },
      _isIqRecordingActive?: boolean,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const fftAreaMax = { x: width - 40, y: height - 40 };
      const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y;
      const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x;

      const vertRange = fftMax - fftMin;
      const scaleFactor = fftHeight / vertRange;

      if (!frequencyRange) return;
      const minFreq = frequencyRange.min;
      const maxFreq = frequencyRange.max;
      const viewBandwidth2 = maxFreq - minFreq;

      const fullSpan = fullCaptureRange ? (fullCaptureRange.max - fullCaptureRange.min) : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth2 : 1;
      const useHighRes = zoom >= 100;
      const formatFreq = (f: number) => useHighRes ? formatFrequencyHighRes(f) : formatFrequency(f);

      const clampLabelX = (x: number, text: string) => {
        const tw = ctx.measureText(text).width;
        const leftBound = FFT_AREA_MIN.x + tw / 2 + 2;
        const rightBound = fftAreaMax.x - tw / 2 - 2;
        return Math.max(leftBound, Math.min(rightBound, x));
      };

      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = FFT_GRID_COLOR;
      ctx.fillStyle = FFT_TEXT_COLOR;
      ctx.font = "12px JetBrains Mono";
      ctx.textAlign = "right";
      ctx.lineWidth = 1 / dpr;

      // Ensure we start labeling from a clean multiple of VERTICAL_RANGE
      // We use a small epsilon to catch cases where fftMax is very close to a tick
      const labelStart = Math.floor((fftMax + 0.1) / VERTICAL_RANGE) * VERTICAL_RANGE;
      
      // Always include the actual fftMax as the top label, even if it's not on a VERTICAL_RANGE boundary
      const labels = [];
      if (Math.abs(fftMax - labelStart) > 0.1) {
        labels.push(fftMax); // Add the actual max as first label
      }
      
      // Add the regular grid labels
      for (let line = labelStart; line >= fftMin - 1; line -= VERTICAL_RANGE) {
        labels.push(line);
      }

      for (const line of labels) {
        const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor;
        
        // Bounds check with small padding
        if (yPos < FFT_AREA_MIN.y - 2 || yPos > fftAreaMax.y + 2) continue;

        ctx.beginPath();
        ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos));
        ctx.lineTo(fftAreaMax.x, Math.round(yPos));
        ctx.stroke();

        let label = `${Math.round(line)}`;
        // Append unit only to the top-most label (the first one in our array)
        if (line === labels[0]) {
          label += powerScale === "dBm" ? "dBm" : "dB";
        }

        ctx.fillText(
          label,
          FFT_AREA_MIN.x - 10,
          Math.round(yPos + 3),
        );
      }

      const step = findBestFrequencyRange(viewBandwidth2, 10);
      const formatTickLabel = (freq: number) => {
        if (maxFreq < 1) return `${Math.round(freq * 1000)}kHz`;
        if (step >= 0.5) return freq.toFixed(1);
        if (step >= 0.01) return freq.toFixed(2);
        return freq.toFixed(3);
      };
      const lowerFreq2 = Math.ceil((minFreq + 0.000001) / step) * step;
      const upperFreq2 = maxFreq;

      const freqToX2 = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth2) * plotWidth;

      const visualCenterFreq = (minFreq + maxFreq) / 2;

      // Top ticks
      const centerTicksMHz: number[] = [];
      if (viewBandwidth2 <= 5.0) centerTicksMHz.push(0.5);
      if (viewBandwidth2 <= 1.0) centerTicksMHz.push(0.1);
      if (viewBandwidth2 <= 0.5) {
        centerTicksMHz.push(0.05);
        centerTicksMHz.push(0.033);
      }
      if (viewBandwidth2 <= 0.25) centerTicksMHz.push(0.025);
      if (viewBandwidth2 <= 0.1) centerTicksMHz.push(0.01);
      if (viewBandwidth2 <= 0.05) centerTicksMHz.push(0.005);
      if (viewBandwidth2 <= 0.01) centerTicksMHz.push(0.001);

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

      // ── Collision Avoidance Setup ──────────────────────────────────────────
      const occupiedRects: { x1: number; x2: number }[] = [];
      const startLabel = formatFreq(minFreq);
      const endLabel = formatFreq(maxFreq);
      const centerLabelText =
        Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
          ? "-- MHz"
          : formatFreq(visualCenterFreq);

      const startW = ctx.measureText(startLabel).width;
      const endW = ctx.measureText(endLabel).width;
      const centerW = ctx.measureText(`✋  ${centerLabelText}`).width;

      occupiedRects.push({ x1: FFT_AREA_MIN.x - 5, x2: FFT_AREA_MIN.x + startW + 15 });
      occupiedRects.push({ x1: fftAreaMax.x - endW - 15, x2: fftAreaMax.x + 5 });
      occupiedRects.push({ x1: width / 2 - centerW / 2 - 15, x2: width / 2 + centerW / 2 + 15 });

      const isColliding = (x: number, text: string) => {
        const tw = ctx.measureText(text).width;
        const x1 = x - tw / 2 - 10;
        const x2 = x + tw / 2 + 10;
        return occupiedRects.some(r => (x1 < r.x2 && x2 > r.x1));
      };
      // ───────────────────────────────────────────────────────────────────────

      // Draw Start Line + Label
      const channelStartX = freqToX2(minFreq);
      ctx.beginPath();
      ctx.moveTo(Math.round(channelStartX), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(channelStartX), fftAreaMax.y + 7);
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillText(startLabel, FFT_AREA_MIN.x, fftAreaMax.y + 25);

      // Draw End Line + Label
      const channelEndX = freqToX2(maxFreq);
      ctx.beginPath();
      ctx.moveTo(Math.round(channelEndX), FFT_AREA_MIN.y);
      ctx.lineTo(Math.round(channelEndX), fftAreaMax.y + 7);
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.fillText(endLabel, fftAreaMax.x, fftAreaMax.y + 25);

      // Draw Ticks and Grid
      ctx.textAlign = "center";
      for (let freq = lowerFreq2; freq < upperFreq2 - 0.0001; freq += step) {
        const xPos = freqToX2(freq);
        const ix = Math.round(xPos);

        // Grid line
        ctx.strokeStyle = FFT_GRID_COLOR;
        ctx.beginPath();
        ctx.moveTo(ix, FFT_AREA_MIN.y);
        ctx.lineTo(ix, fftAreaMax.y);
        ctx.stroke();

        // Tick mark
        ctx.strokeStyle = FFT_TEXT_COLOR;
        ctx.beginPath();
        ctx.moveTo(ix, fftAreaMax.y);
        ctx.lineTo(ix, fftAreaMax.y + 7);
        ctx.stroke();

        // Tick label (with collision avoidance)
        // Zoomed out (step >= 0.5): just show x.x
        // Zoomed in: show more precision if needed, but no units as per request
        const label = formatTickLabel(freq);
        
        if (!isColliding(xPos, label)) {
          ctx.fillText(label, xPos, fftAreaMax.y + 25);
          // Don't mark as occupied to allow center label to "win" or other ticks to stay spaced
        }
      }

      // Top ticks
      if (centerTicksMHz.length > 0 && Number.isFinite(visualCenterFreq)) {
        ctx.save();
        ctx.strokeStyle = OFFSET_TICK_LINE_COLOR;
        ctx.fillStyle = OFFSET_TICK_TEXT_COLOR;
        ctx.font = "10px JetBrains Mono";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        for (const s of centerTicksMHz) {
          for (const sign of [-1, 1]) {
            const f = visualCenterFreq + s * sign;
            if (f <= minFreq || f >= maxFreq) continue;

            const x = Math.round(freqToX2(f));
            ctx.beginPath();
            ctx.moveTo(x, FFT_AREA_MIN.y);
            ctx.lineTo(x, fftAreaMax.y);
            ctx.stroke();

            const label = formatOffset(s);
            ctx.fillText(label, clampLabelX(x, label), FFT_AREA_MIN.y + 10);
          }
        }
        ctx.restore();
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

      // Draw mathematical hardware block boundaries if applicable
      const anchorRange = fullCaptureRange || frequencyRange;
      const totalSpan = anchorRange.max - anchorRange.min;
        const hwSpanMHz = hardwareSampleRateHz ? hardwareSampleRateHz / 1e6 : 0;
        const shouldShowHWGrid = totalSpan > hwSpanMHz + 0.001 && hwSpanMHz > 0;
        
        if (shouldShowHWGrid) {
          ctx.save();
          ctx.strokeStyle = SNAP_HW_RATE_LINE; // User specified color
          ctx.setLineDash([4, 4]); // Dashed line
          ctx.lineWidth = 1 / dpr;
          ctx.fillStyle = SNAP_HW_RATE_TEXT;
          ctx.font = "10px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";

          const formatOffset = (mhz: number) => {
            const abs = Math.abs(mhz);
            if (abs >= 1) return `${mhz.toFixed(1)}MHz`;
            if (abs >= 0.001) return `${Math.round(mhz * 1000)}kHz`;
            return `${Math.round(mhz * 1_000_000)}Hz`;
          };

          let currentFreq = anchorRange.min;
          while (currentFreq < anchorRange.max - 0.001) {
            const blockStart = currentFreq;
            const blockEnd = Math.min(blockStart + hwSpanMHz, anchorRange.max);
            const blockWidth = blockEnd - blockStart;
            const isFullBlock = blockWidth >= hwSpanMHz - 0.001;

            // Only draw if visible in the current zoomed frequency range
            if (blockEnd > minFreq && blockStart < maxFreq) {
              // Draw left boundary
              if (blockStart > anchorRange.min + 0.0001 && blockStart >= minFreq && blockStart <= maxFreq) {
                const lx = Math.round(freqToX2(blockStart));
                ctx.beginPath();
                ctx.moveTo(lx, FFT_AREA_MIN.y);
                ctx.lineTo(lx, fftAreaMax.y);
                ctx.stroke();
              }

              
              // Draw right boundary
              if (blockEnd < anchorRange.max - 0.0001 && blockEnd >= minFreq && blockEnd <= maxFreq) {
                const rx = Math.round(freqToX2(blockEnd));
                ctx.beginPath();
                ctx.moveTo(rx, FFT_AREA_MIN.y);
                ctx.lineTo(rx, fftAreaMax.y);
                ctx.stroke();
              }

              // Draw center label - clamp to visible region so it doesn't disappear when zoomed
              const visibleStart = Math.max(blockStart, minFreq);
              const visibleEnd = Math.min(blockEnd, maxFreq);
              const visibleCenter = (visibleStart + visibleEnd) / 2;
              
              if (
                visibleCenter >= minFreq &&
                visibleCenter <= maxFreq
              ) {
                const cx = Math.round(freqToX2(visibleCenter));
                const label = isFullBlock ? "Hardware Sample Rate" : "Next Sample";
                const subLabel = formatOffset(blockWidth);
                ctx.fillText(label, cx, FFT_AREA_MIN.y + 20);
                ctx.fillText(subLabel, cx, FFT_AREA_MIN.y + 32);
              }
            }
            currentFreq = blockEnd;
          }
          ctx.restore();
        }
    },
    [formatFrequency, formatFrequencyHighRes],
  );

  const drawMarkersOnContext = useCallback(
    (
      ctx: OffscreenCanvasRenderingContext2D,
      width: number,
      height: number,
      frequencyRange: { min: number; max: number },
      centerFrequencyMHz?: number,
      isDeviceConnected: boolean = true,
      fullCaptureRange?: { min: number; max: number },
      limitMarkers: SdrLimitMarker[] = [],
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

      const fullSpan = fullCaptureRange ? (fullCaptureRange.max - fullCaptureRange.min) : 0;
      const zoom = fullSpan > 0 ? fullSpan / viewBandwidth : 1;
      const useHighResLabels = zoom >= 100;

      const formatFreq = (f: number) => useHighResLabels ? formatFrequencyHighRes(f) : formatFrequency(f);

      const freqToX = (freq: number) =>
        FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth;
 
       const visualCenterFreq = (minFreq + maxFreq) / 2;
       const centerLabel =
         Number.isNaN(visualCenterFreq) || !Number.isFinite(visualCenterFreq)
           ? "✋  -- MHz"
           : `✋  ${formatFreq(visualCenterFreq)}`;

        if (
          centerFrequencyMHz !== undefined &&
          Number.isFinite(centerFrequencyMHz)
        ) {
          const cx = Math.round((FFT_AREA_MIN.x + fftAreaMax.x) / 2) + 0.5;
          ctx.save();
          ctx.strokeStyle = CENTER_LINE_COLOR;
          ctx.lineWidth = 1 / dpr;
          ctx.beginPath();
          ctx.moveTo(cx, FFT_AREA_MIN.y);
          ctx.lineTo(cx, fftAreaMax.y);
          ctx.stroke();
          ctx.restore();
        }

       ctx.save();
       ctx.font = "12px JetBrains Mono";
       ctx.textAlign = "center";
       ctx.textBaseline = "alphabetic";
       const labelX = (FFT_AREA_MIN.x + fftAreaMax.x) / 2;
       const labelY = fftAreaMax.y + 25;
       ctx.fillStyle = "#ffffff";
       ctx.fillText(centerLabel, labelX, labelY);
       ctx.restore();

       if (isDeviceConnected) {
         ctx.save();
         ctx.strokeStyle = "rgba(220, 38, 38, 0.75)";
         ctx.fillStyle = "rgba(255, 140, 140, 0.95)";
         ctx.lineWidth = 1 / dpr;
         ctx.font = "10px JetBrains Mono";
         ctx.textAlign = "center";
         ctx.textBaseline = "top";

         for (const marker of limitMarkers) {
           if (!Number.isFinite(marker.freq)) continue;
           if (marker.freq < minFreq || marker.freq > maxFreq) continue;

           const x = Math.round(freqToX(marker.freq)) + 0.5;
           ctx.beginPath();
           ctx.moveTo(x, FFT_AREA_MIN.y);
           ctx.lineTo(x, fftAreaMax.y);
           ctx.stroke();

           const textX = Math.max(FFT_AREA_MIN.x + 45, Math.min(fftAreaMax.x - 45, x));
           ctx.fillText(marker.label, textX, FFT_AREA_MIN.y + 20);
         }
         ctx.restore();
       }

       // Use isDeviceConnected and freqToX to satisfy lints if needed, 
       // but for now center line is the main one.
       if (!isDeviceConnected) {
         // potential future markers for disconnected state
       }
       if (freqToX(minFreq) > 0) {
         // anchor use
       }
    },
    [formatFrequency, formatFrequencyHighRes],
  );

  return {
    drawGridOnContext,
    drawMarkersOnContext,
  };
}
