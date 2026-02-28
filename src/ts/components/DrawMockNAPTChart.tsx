import { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useOverlayRenderer } from "@n-apt/hooks/useOverlayRenderer";
import { useDrawMockNAPTSignal, MockNAPTParams } from "@n-apt/hooks/useDrawMockNAPTSignal";
import { FFT_CANVAS_BG } from "@n-apt/consts";

const ChartContainer = styled.div`
  background-color: transparent;
  padding: 20px;
  height: calc(100vh - 200px);
  min-height: 400px;
  position: relative;
`;

const CanvasLayer = styled.canvas`
  position: absolute;
  top: 20px;
  left: 20px;
  width: calc(100% - 40px);
  height: calc(100% - 40px);
  border: 1px solid #1f1f1f;
  border-radius: 8px;
  background-color: ${FFT_CANVAS_BG};
`;

const ToggleableCanvasLayer = styled(CanvasLayer).attrs<{ $visible: boolean }>(props => ({
  style: {
    display: props.$visible ? "block" : "none",
  },
}))`
  z-index: 0;
`;

const DrawMockNAPTChart: React.FC<MockNAPTParams> = ({
  spikeCount,
  spikeWidth,
  centerSpikeBoost,
  floorAmplitude,
  decayRate,
  envelopeWidth,
}) => {
  const [data, setData] = useState<{ x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);

  const { draw2DFFTSignal } = useDraw2DFFTSignal();
  const { drawWebGPUFFTSignal } = useDrawWebGPUFFTSignal();
  const { generateMockNAPTData } = useDrawMockNAPTSignal();

  // Dummy refs for WebGPU Init
  const waterfallGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const resampleComputePipelineRef = useRef<GPUComputePipeline | null>(null);
  const resampleParamsBufferRef = useRef<GPUBuffer | null>(null);
  const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);

  const {
    isInitialized,
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
  } = useWebGPUInit({
    force2D: false,
    spectrumGpuCanvasRef: gpuCanvasRef,
    waterfallGpuCanvasRef,
    resampleWgsl: "",
    resampleComputePipelineRef,
    resampleParamsBufferRef,
    gpuBufferPoolRef,
  });

  const { drawGridOnContext } = useOverlayRenderer();

  // Update data when parameters change
  useEffect(() => {
    setData(generateMockNAPTData({
      spikeCount,
      spikeWidth,
      centerSpikeBoost,
      floorAmplitude,
      decayRate,
      envelopeWidth,
    }));
  }, [
    spikeCount,
    spikeWidth,
    centerSpikeBoost,
    floorAmplitude,
    decayRate,
    envelopeWidth,
    generateMockNAPTData
  ]);

  // Draw FFT-style spectrum
  useEffect(() => {
    // Wait until WebGPU initialization check is complete before rendering
    if (!isInitialized) return;

    const dpr = window.devicePixelRatio || 1;
    const waveformArray = data.map((point) => point.x);

    if (webgpuEnabled && webgpuDeviceRef.current && webgpuFormatRef.current && gpuCanvasRef.current) {
      // Use WebGPU rendering
      const canvas = gpuCanvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      const targetWidth = Math.max(1, Math.round(width * dpr));
      const targetHeight = Math.max(1, Math.round(height * dpr));

      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;

      // Render grid overlay if we have the renderer
      if (gridOverlayRendererRef.current) {
        const overlay = gridOverlayRendererRef.current;
        const ctx = overlay.beginDraw(width, height, dpr);
        drawGridOnContext(ctx, width, height, { min: 0, max: 3 }, -80, 0);
        overlay.endDraw();
      }

      // Convert to Float32Array for WebGPU
      const floatWaveform = new Float32Array(waveformArray);

      drawWebGPUFFTSignal({
        canvas,
        device: webgpuDeviceRef.current,
        format: webgpuFormatRef.current,
        waveform: floatWaveform,
        frequencyRange: { min: 0, max: 3 },
        fftMin: -80,
        fftMax: 0,
        gridOverlayRenderer: gridOverlayRendererRef.current ?? undefined,
        markersOverlayRenderer: markersOverlayRendererRef.current ?? undefined,
        showGrid: true,
        isDeviceConnected: true,
      });
    } else {
      // Fallback to Canvas2D renderer
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const displayWidth = rect.width;
      const displayHeight = rect.height;

      const targetWidth = Math.max(1, Math.round(displayWidth * dpr));
      const targetHeight = Math.max(1, Math.round(displayHeight * dpr));

      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;

      ctx.resetTransform();
      ctx.scale(dpr, dpr);

      draw2DFFTSignal({
        canvas,
        waveform: waveformArray,
        frequencyRange: { min: 0, max: 3 },
        fftMin: -80,
        fftMax: 0,
        showGrid: true,
        isDeviceConnected: true,
      });
    }
  }, [
    data,
    draw2DFFTSignal,
    drawWebGPUFFTSignal,
    isInitialized,
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
    drawGridOnContext
  ]);

  return (
    <ChartContainer>
      {/* 2D Canvas (Fallback) */}
      <ToggleableCanvasLayer
        ref={canvasRef}
        $visible={isInitialized && !webgpuEnabled}
      />
      {/* WebGPU Canvas */}
      <ToggleableCanvasLayer
        ref={gpuCanvasRef}
        $visible={isInitialized && webgpuEnabled}
      />
    </ChartContainer>
  );
};

export default DrawMockNAPTChart;
