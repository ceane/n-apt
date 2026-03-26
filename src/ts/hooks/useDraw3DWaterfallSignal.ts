import { useCallback, useRef } from "react";
import {
  FFT_AREA_MIN,
  FFT_CANVAS_BG,
  LINE_COLOR,
  SHADOW_COLOR,
} from "@n-apt/consts";
{"type":"frequency_range","min_mhz":0.017999999999999794,"max_mhz":3.218}import { validateSpectrumDataComprehensive } from "@n-apt/validation";

export interface Draw3DWaterfallSignalOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  waveform: Float32Array;
  frequencyRange: { min: number; max: number };
  fftMin?: number;
  fftMax?: number;
  showGrid?: boolean;
  centerFrequencyMHz?: number;
  isDeviceConnected?: boolean;
  maxFrames?: number;
  frameSpacing?: number;
  // Validation options
  fftSize?: number;
  sampleRate?: number;
  centerFrequencyHz?: number;
  isPaused?: boolean;
  isFirstFrame?: boolean;
}

export function useDraw3DWaterfallSignal() {
  const frameHistoryRef = useRef<Float32Array[]>([]);
  const maxFrames = 48;

  const draw3DWaterfallSignal = useCallback(async (options: Draw3DWaterfallSignalOptions): Promise<boolean> => {
    const {
      canvas,
      waveform,
      frequencyRange: _frequencyRange,
      fftMin = -150,
      fftMax = 0,
      maxFrames: maxFramesParam = maxFrames,
      frameSpacing = 10,
      fftSize,
      sampleRate,
      centerFrequencyHz,
      isPaused = false,
      isFirstFrame = false,
    } = options;

    try {
      // Validate waveform data on first frame or when paused
      if (isFirstFrame || isPaused) {
        const validationResult = validateSpectrumDataComprehensive(waveform, {
          fftSize,
          sampleRate,
          centerFrequencyHz,
          timestamp: Date.now(),
          isPaused,
          isFirstFrame
        });
        
        if (!validationResult.isValid) {
          console.error(`3D waterfall validation failed (${isFirstFrame ? 'first frame' : 'paused'}):`, validationResult.errors);
        } else if (validationResult.warnings.length > 0) {
          console.warn(`3D waterfall validation warnings (${isFirstFrame ? 'first frame' : 'paused'}):`, validationResult.warnings);
        }
        
        // Log validation metadata for debugging (only in development)
        if (process.env.NODE_ENV === 'development') {
          console.log('3D waterfall validation metadata:', validationResult.metadata);
        }
      }
      
      frameHistoryRef.current.push(waveform.slice());
      if (frameHistoryRef.current.length > maxFramesParam) {
        frameHistoryRef.current.shift();
      }

      const frames = frameHistoryRef.current;
      if (frames.length === 0) return false;

      const ctx = canvas.getContext("2d");
      if (!ctx) return false;

      const width = canvas.width;
      const height = canvas.height;
      const plotLeft = FFT_AREA_MIN.x;
      const plotRight = width - 40;
      const plotTop = FFT_AREA_MIN.y;
      const plotBottom = height - 40;
      const plotWidth = Math.max(1, plotRight - plotLeft);
      const plotHeight = Math.max(1, plotBottom - plotTop);
      const usableFrames = Math.max(1, Math.min(frames.length, Math.floor(plotHeight / 6)));
      const startIndex = Math.max(0, frames.length - usableFrames);
      const visibleFrames = frames.slice(startIndex);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = FFT_CANVAS_BG;
      ctx.fillRect(0, 0, width, height);

      for (let frameIdx = 0; frameIdx < visibleFrames.length; frameIdx++) {
        const frame = visibleFrames[frameIdx];
        const depthT = frameIdx / Math.max(1, visibleFrames.length - 1);
        const yOffset = (visibleFrames.length - 1 - frameIdx) * Math.max(4, Number(frameSpacing));
        const xInset = depthT * 28;
        const alpha = 0.25 + (1 - depthT) * 0.75;
        const lineWidth = 1 + (1 - depthT) * 1.4;
        const red = Math.round(255 - depthT * 140);
        const green = Math.round(80 + depthT * 120);
        const blue = Math.round(220 + depthT * 20);

        ctx.beginPath();
        for (let i = 0; i < frame.length; i++) {
          const xNorm = i / Math.max(1, frame.length - 1);
          const x = plotLeft + xInset + xNorm * Math.max(1, plotWidth - xInset * 2);
          const dbNorm = (frame[i] - fftMin) / Math.max(1, fftMax - fftMin);
          const yBase = plotBottom - dbNorm * plotHeight;
          const y = yBase + yOffset;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }

      const frontFrame = visibleFrames[visibleFrames.length - 1];
      ctx.beginPath();
      for (let i = 0; i < frontFrame.length; i++) {
        const xNorm = i / Math.max(1, frontFrame.length - 1);
        const x = plotLeft + xNorm * plotWidth;
        const dbNorm = (frontFrame[i] - fftMin) / Math.max(1, fftMax - fftMin);
        const y = plotBottom - dbNorm * plotHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = SHADOW_COLOR;
      ctx.fillRect(plotLeft, plotBottom, plotWidth, 1);

      return true;
    } catch (error) {
      console.error("Error drawing 3D waterfall:", error);
      return false;
    }
  }, []);

  const cleanup = useCallback(() => {
    frameHistoryRef.current = [];
  }, []);

  return {
    draw3DWaterfallSignal,
    cleanup,
  };
}
