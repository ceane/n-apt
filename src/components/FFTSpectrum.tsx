import { memo, useRef, useEffect, useCallback } from "react";
import styled from "styled-components";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";

interface FFTSpectrumProps {
  width: number;
  height: number;
  waveform: Float32Array | null;
  frequencyRange: { min: number; max: number };
  webgpuEnabled: boolean;
  webgpuDevice?: GPUDevice | null;
  webgpuFormat?: GPUTextureFormat | null;
  resampleSpectrumInto: (source: Float32Array, target: Float32Array) => void;
  onRenderComplete?: () => void;
  centerFrequencyMHz?: number;
  isDeviceConnected?: boolean;
  showGrid?: boolean;
}

const SpectrumCanvas = styled.canvas<{ $width: number; $height: number }>`
  display: block;
  width: ${({ $width }) => $width}px;
  height: ${({ $height }) => $height}px;
  background-color: #0a0a0a;
`;

export const FFTSpectrum = memo<FFTSpectrumProps>(
  ({
    width,
    height,
    waveform,
    frequencyRange,
    webgpuEnabled,
    webgpuDevice,
    webgpuFormat,
    resampleSpectrumInto,
    onRenderComplete,
    centerFrequencyMHz,
    isDeviceConnected = true,
    showGrid = true,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Use appropriate rendering hook based on WebGPU availability
    const { draw2DFFTSignal } = useDraw2DFFTSignal();
    const { drawWebGPUFFTSignal } = useDrawWebGPUFFTSignal();

    // Render spectrum using appropriate method
    const renderSpectrum = useCallback(async () => {
      const canvas = canvasRef.current;
      if (!canvas || !waveform || waveform.length === 0) return;

      // Convert Float32Array to regular array for hooks
      const waveformArray = Array.from(waveform);

      if (webgpuEnabled && webgpuDevice && webgpuFormat) {
        // Use WebGPU rendering
        const success = await drawWebGPUFFTSignal({
          canvas,
          device: webgpuDevice,
          format: webgpuFormat,
          waveform: new Float32Array(waveformArray),
          frequencyRange,
          showGrid,
          centerFrequencyMHz,
          isDeviceConnected,
        });

        if (success) {
          onRenderComplete?.();
        }
      } else {
        // Use 2D Canvas rendering
        const success = draw2DFFTSignal({
          canvas,
          waveform: waveformArray,
          frequencyRange,
          showGrid,
          centerFrequencyMHz,
          isDeviceConnected,
          highPerformanceMode: false,
        });

        if (success) {
          onRenderComplete?.();
        }
      }
    }, [
      width,
      height,
      waveform,
      frequencyRange,
      webgpuEnabled,
      webgpuDevice,
      webgpuFormat,
      showGrid,
      centerFrequencyMHz,
      isDeviceConnected,
      draw2DFFTSignal,
      drawWebGPUFFTSignal,
      onRenderComplete,
    ]);

    // Auto-render when dependencies change
    useEffect(() => {
      renderSpectrum();
    }, [renderSpectrum]);

    return (
      <SpectrumCanvas
        ref={canvasRef}
        $width={width}
        $height={height}
      />
    );
  },
);

FFTSpectrum.displayName = "FFTSpectrum";
