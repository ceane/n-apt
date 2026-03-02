import { useState, useEffect, useRef, useCallback } from "react";
import styled from "styled-components";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { useDrawWebGPUFFTSignal, RESAMPLE_WGSL } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useOverlayRenderer } from "@n-apt/hooks/useOverlayRenderer";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useDrawMockNAPTSignal } from "@n-apt/hooks/useDrawMockNAPTSignal";
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

export const DrawSignalRoute: React.FC = () => {
  const { state } = useSpectrumStore();
  const {
    spikeCount,
    spikeWidth,
    centerSpikeBoost,
    floorAmplitude,
    decayRate,
    envelopeWidth,
  } = state.drawParams;
  const [data, setData] = useState<{ x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasNode, setCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const [gpuCanvasNode, setGpuCanvasNode] = useState<HTMLCanvasElement | null>(null);

  // Store layout dimensions
  const dimsRef = useRef<{ width: number; height: number } | null>(null);

  const { draw2DFFTSignal } = useDraw2DFFTSignal();
  const { drawWebGPUFFTSignal } = useDrawWebGPUFFTSignal();
  const { generateMockNAPTData } = useDrawMockNAPTSignal();

  // Dummy refs for WebGPU Init
  const waterfallGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const resampleComputePipelineRef = useRef<GPUComputePipeline | null>(null);
  const resampleParamsBufferRef = useRef<GPUBuffer | null>(null);
  const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);

  const {
    isInitializingWebGPU,
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
  } = useWebGPUInit({
    force2D: false,
    spectrumGpuCanvasRef: { current: gpuCanvasNode },
    waterfallGpuCanvasRef,
    resampleWgsl: RESAMPLE_WGSL,
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

  const forceRender = useCallback(() => {
    if (!dimsRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    const waveformArray = data.map((point) => point.x);
    if (waveformArray.length === 0) return;

    // The dimensions of the inner canvas area
    const displayWidth = dimsRef.current.width - 40; // padding left/right
    const displayHeight = dimsRef.current.height - 40; // padding top/bottom

    if (displayWidth <= 0 || displayHeight <= 0) return;

    const targetWidth = Math.max(1, Math.round(displayWidth * dpr));
    const targetHeight = Math.max(1, Math.round(displayHeight * dpr));

    if (webgpuEnabled && webgpuDeviceRef.current && webgpuFormatRef.current && gpuCanvasNode) {
      // Use WebGPU rendering
      const canvas = gpuCanvasNode;

      let needsConfigure = false;
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        needsConfigure = true;
      }

      // Ensure we configure the context at least once, even if initial dimensions match
      if (!canvas.dataset.gpuConfigured) {
        needsConfigure = true;
        canvas.dataset.gpuConfigured = "true";
      }

      if (needsConfigure) {
        const context = canvas.getContext("webgpu");
        if (context) {
          context.configure({
            device: webgpuDeviceRef.current,
            format: webgpuFormatRef.current,
            alphaMode: "premultiplied",
          });
        }
      }

      // Explicitly set CSS size to prevent layout feedback loops
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      // Render grid overlay if we have the renderer
      if (gridOverlayRendererRef.current) {
        const overlay = gridOverlayRendererRef.current;
        const ctx = overlay.beginDraw(displayWidth, displayHeight, dpr);
        drawGridOnContext(ctx, displayWidth, displayHeight, { min: 0, max: 3 }, -120, 0);
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
        fftMin: -120,
        fftMax: 0,
        gridOverlayRenderer: gridOverlayRendererRef.current ?? undefined,
        markersOverlayRenderer: markersOverlayRendererRef.current ?? undefined,
        showGrid: true,
        isDeviceConnected: true,
      });
    } else if (!isInitializingWebGPU && canvasNode) {
      // Fallback to Canvas2D renderer
      const canvas = canvasNode;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      ctx.resetTransform();
      ctx.scale(dpr, dpr);

      draw2DFFTSignal({
        canvas,
        waveform: waveformArray,
        frequencyRange: { min: 0, max: 3 },
        fftMin: -120,
        fftMax: 0,
        showGrid: true,
        isDeviceConnected: true,
      });
    }
  }, [
    data,
    draw2DFFTSignal,
    drawWebGPUFFTSignal,
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
    drawGridOnContext,
    canvasNode,
    gpuCanvasNode,
    isInitializingWebGPU
  ]);

  // Handle ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) {
          dimsRef.current = {
            width: container.clientWidth,
            height: container.clientHeight
          };
          forceRender();
        }
      }
    });

    observer.observe(container);

    // Initial measure
    dimsRef.current = {
      width: container.clientWidth,
      height: container.clientHeight
    };
    forceRender();

    return () => {
      observer.disconnect();
    };
  }, [forceRender]);

  // Trigger render when data or webgpu state changes
  useEffect(() => {
    forceRender();
  }, [data, forceRender, webgpuEnabled, isInitializingWebGPU]);

  return (
    <ChartContainer ref={containerRef}>
      {/* 2D Canvas (Fallback) */}
      {!webgpuEnabled && (
        <CanvasLayer ref={setCanvasNode} />
      )}
      {/* WebGPU Canvas */}
      {webgpuEnabled && (
        <CanvasLayer ref={setGpuCanvasNode} />
      )}
    </ChartContainer>
  );
};

export default DrawSignalRoute;
