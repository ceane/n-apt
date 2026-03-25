import { memo, useRef, useEffect, useCallback } from "react";
import styled from "styled-components";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDraw3DWaterfallSignal } from "@n-apt/hooks/useDraw3DWaterfallSignal";

interface FFTSpectrumProps {
  width: number;
  height: number;
  waveform: Float32Array | null;
  frequencyRange: { min: number; max: number };
  webgpuEnabled: boolean;
  webgpuDevice?: GPUDevice | null;
  webgpuFormat?: GPUTextureFormat | null;
  resampleSpectrumInto: (_source: Float32Array, target: Float32Array) => void;
  onRenderComplete?: () => void;
  centerFrequencyMHz?: number;
  isDeviceConnected?: boolean;
  showGrid?: boolean;
  drawSignal3D?: boolean;
}

const SpectrumCanvas = styled.canvas<{ $width: number; $height: number }>`
  display: block;
  width: ${({ $width }) => $width}px;
  height: ${({ $height }) => $height}px;
  background-color: ${(props) => props.theme.fftBackground};
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
    resampleSpectrumInto: _resampleSpectrumInto,
    onRenderComplete,
    centerFrequencyMHz,
    isDeviceConnected = true,
    showGrid = true,
    drawSignal3D = false,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Use appropriate rendering hook based on WebGPU availability and 3D mode
    const { draw2DFFTSignal } = useDraw2DFFTSignal();
    const { drawWebGPUFFTSignal } = useDrawWebGPUFFTSignal();
    const { draw3DWaterfallSignal } = useDraw3DWaterfallSignal();

    // Render spectrum using appropriate method
    const renderSpectrum = useCallback(async () => {
      const canvas = canvasRef.current;
      if (!canvas || !waveform || waveform.length === 0) return;

      // Convert Float32Array to regular array for hooks
      const waveformArray = Array.from(waveform);

      // Check if 3D mode is enabled
      if (drawSignal3D && webgpuEnabled && webgpuDevice && webgpuFormat) {
        // Use 3D WebGPU rendering
        const success = await draw3DWaterfallSignal({
          canvas,
          device: webgpuDevice,
          format: webgpuFormat,
          waveform: new Float32Array(waveformArray),
          frequencyRange,
          fftMin: -120,
          fftMax: 0,
          showGrid,
          centerFrequencyMHz,
          isDeviceConnected,
        });

        if (success) {
          onRenderComplete?.();
        }
      } else if (webgpuEnabled && webgpuDevice && webgpuFormat) {
        // Use regular WebGPU rendering
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
      drawSignal3D,
      draw2DFFTSignal,
      drawWebGPUFFTSignal,
      draw3DWaterfallSignal,
      onRenderComplete,
    ]);

    // Auto-render when dependencies change
    useEffect(() => {
      renderSpectrum();
    }, [renderSpectrum]);

    return <SpectrumCanvas ref={canvasRef} $width={width} $height={height} />;
  },
);

FFTSpectrum.displayName = "FFTSpectrum";
