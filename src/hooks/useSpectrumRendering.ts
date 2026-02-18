import { useCallback, useRef, useEffect } from "react";

export interface SpectrumRenderingOptions {
  canvas: HTMLCanvasElement | null;
  waveform: Float32Array | null;
  width: number;
  height: number;
  frequencyRange: { min: number; max: number };
  webgpuEnabled: boolean;
  webgpuRenderer: any;
  resampleBufRef: React.MutableRefObject<Float32Array | null>;
  resampleSpectrumInto: (source: Float32Array, target: Float32Array) => void;
  onRenderComplete?: () => void;
}

export function useSpectrumRendering({
  canvas,
  waveform,
  width,
  height,
  frequencyRange,
  webgpuEnabled,
  webgpuRenderer,
  resampleBufRef,
  resampleSpectrumInto,
  onRenderComplete,
}: SpectrumRenderingOptions) {
  const lastRenderRef = useRef<{ width: number; height: number; waveformLength: number } | null>(null);

  // Render spectrum using WebGPU or 2D fallback
  const renderSpectrum = useCallback(() => {
    if (!canvas || !waveform || waveform.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Update canvas dimensions
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Calculate display width (account for margins)
    const displayWidth = Math.max(1, Math.floor(width - 40)); // 40px margin

    // Prepare resampling buffer
    if (!resampleBufRef.current || resampleBufRef.current.length !== displayWidth) {
      if (resampleBufRef.current) {
        resampleBufRef.current.fill(0);
      }
      resampleBufRef.current = new Float32Array(displayWidth);
    }
    const outBuf = resampleBufRef.current;

    // Resample waveform to display width
    if (waveform.length === displayWidth) {
      outBuf.set(waveform);
    } else {
      resampleSpectrumInto(waveform, outBuf);
    }

    // Prevent NaNs/Infs that can cause visual artifacts
    for (let i = 0; i < outBuf.length; i++) {
      if (!Number.isFinite(outBuf[i])) {
        outBuf[i] = -120; // Fallback value
      }
    }

    // Clear canvas
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, width, height);

    // Draw spectrum
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 1;
    ctx.beginPath();

    const stepX = width / outBuf.length;
    for (let i = 0; i < outBuf.length; i++) {
      const x = i * stepX;
      const normalizedValue = (outBuf[i] + 120) / 120; // Normalize -120 to 0 dB range
      const y = height - (normalizedValue * height * 0.8 + height * 0.1); // 10% margins

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Draw frequency markers if needed
    if (frequencyRange && typeof frequencyRange.min === 'number' && typeof frequencyRange.max === 'number') {
      ctx.fillStyle = "#666";
      ctx.font = "10px monospace";
      
      const freqSpan = frequencyRange.max - frequencyRange.min;
      const markerFreqs = [
        frequencyRange.min,
        frequencyRange.min + freqSpan * 0.25,
        frequencyRange.min + freqSpan * 0.5,
        frequencyRange.min + freqSpan * 0.75,
        frequencyRange.max,
      ];

      markerFreqs.forEach((freq) => {
        const normalizedX = (freq - frequencyRange.min) / freqSpan;
        const x = normalizedX * width;
        
        ctx.fillText(`${freq.toFixed(1)}MHz`, x - 20, height - 5);
      });
    }

    onRenderComplete?.();
  }, [
    canvas,
    waveform,
    width,
    height,
    frequencyRange,
    webgpuEnabled,
    webgpuRenderer,
    resampleBufRef,
    resampleSpectrumInto,
    onRenderComplete,
  ]);

  // Auto-render when dependencies change
  useEffect(() => {
    // Skip if dimensions haven't changed and waveform is the same
    const current = { width, height, waveformLength: waveform?.length || 0 };
    const last = lastRenderRef.current;
    
    if (last && 
        last.width === current.width && 
        last.height === current.height && 
        last.waveformLength === current.waveformLength) {
      return;
    }
    
    lastRenderRef.current = current;
    renderSpectrum();
  }, [renderSpectrum, width, height, waveform?.length]);

  return {
    renderSpectrum,
    forceRender: useCallback(() => {
      lastRenderRef.current = null;
      renderSpectrum();
    }, [renderSpectrum]),
  };
}
