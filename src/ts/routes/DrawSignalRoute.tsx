import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import styled from "styled-components";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useDrawMockNAPTSignal } from "@n-apt/hooks/useDrawMockNAPTSignal";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useDrawWebGPUFFTSignal, RESAMPLE_WGSL } from "@n-apt/hooks/useDrawWebGPUFFTSignal";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { useOverlayRenderer } from "@n-apt/hooks/useOverlayRenderer";
import { FFT_CANVAS_BG } from "@n-apt/consts";

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: 24px;
  background-color: #050505;
  color: #fff;
  box-sizing: border-box;
`;

const Header = styled.div`
  margin-bottom: 24px;
`;

const Title = styled.h1`
  font-size: 24px;
  margin-bottom: 8px;
  color: ${(props) => props.theme.primary || "#3b82f6"};
  font-family: "Outfit", "Inter", sans-serif;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, #fff 0%, #888 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: #666;
  font-family: "Outfit", "Inter", sans-serif;
`;

const VisualizerWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: ${FFT_CANVAS_BG};
  border: 1px solid #1a1a1a;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
`;

const CanvasElement = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
`;


const InfoBox = styled.div`
  position: absolute;
  bottom: 20px;
  left: 60px;
  background: rgba(10, 10, 11, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 12px 16px;
  backdrop-filter: blur(12px);
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
`;

const InfoItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  color: #888;
`;

const InfoValue = styled.span`
  color: ${(props) => props.theme.primary || "#3b82f6"};
  font-weight: 500;
`;

export const DrawSignalRoute: React.FC = () => {
  const { state } = useSpectrumStore();
  const { drawParams } = state;
  const { generateMockNAPTData } = useDrawMockNAPTSignal();
  const { drawWebGPUFFTSignal, cleanup: cleanupGPU } = useDrawWebGPUFFTSignal();
  const { draw2DFFTSignal, cleanup: cleanup2D } = useDraw2DFFTSignal();
  const { drawGridOnContext } = useOverlayRenderer();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // WebGPU initialization refs
  const waterfallGpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const resampleComputePipelineRef = useRef<GPUComputePipeline | null>(null);
  const resampleParamsBufferRef = useRef<GPUBuffer | null>(null);
  const gpuBufferPoolRef = useRef<GPUBuffer[]>([]);

  const {
    webgpuEnabled,
    isInitializingWebGPU,
    webgpuDeviceRef,
    webgpuFormatRef,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
  } = useWebGPUInit({
    force2D: false,
    spectrumGpuCanvasRef: canvasRef,
    waterfallGpuCanvasRef,
    resampleWgsl: RESAMPLE_WGSL,
    resampleComputePipelineRef,
    resampleParamsBufferRef,
    gpuBufferPoolRef,
  });

  // Generate data based on params
  const data = useMemo(() => {
    return generateMockNAPTData(drawParams);
  }, [drawParams, generateMockNAPTData]);

  const waveformArray = useMemo(() => data.map((p) => p.x), [data]);
  const floatWaveform = useMemo(() => new Float32Array(waveformArray), [waveformArray]);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0 || dimensions.height === 0 || waveformArray.length === 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(dimensions.width * dpr);
    const targetHeight = Math.round(dimensions.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    if (
      webgpuEnabled &&
      webgpuDeviceRef.current &&
      webgpuFormatRef.current
    ) {
      // Use WebGPU rendering
      const device = webgpuDeviceRef.current;
      const format = webgpuFormatRef.current;

      // Ensure context is configured
      const context = canvas.getContext("webgpu");
      if (context && !canvas.dataset.gpuConfigured) {
        context.configure({
          device,
          format,
          alphaMode: "premultiplied",
        });
        canvas.dataset.gpuConfigured = "true";
      }

      // Handle overlays
      if (gridOverlayRendererRef.current) {
        const overlay = gridOverlayRendererRef.current;
        const ctx = overlay.beginDraw(dimensions.width, dimensions.height, dpr);
        drawGridOnContext(
          ctx,
          dimensions.width,
          dimensions.height,
          { min: 0, max: 3 },
          -120,
          0,
        );
        overlay.endDraw();
      }

      drawWebGPUFFTSignal({
        canvas,
        device,
        format,
        waveform: floatWaveform,
        frequencyRange: { min: 0, max: 3 },
        fftMin: -120,
        fftMax: 0,
        gridOverlayRenderer: gridOverlayRendererRef.current ?? undefined,
        markersOverlayRenderer: markersOverlayRendererRef.current ?? undefined,
        showGrid: true,
        isDeviceConnected: true,
      });
    } else if (!isInitializingWebGPU) {
      // Fallback to Canvas2D
      draw2DFFTSignal({
        canvas,
        waveform: waveformArray,
        frequencyRange: { min: 0, max: 3 },
        fftMin: -120,
        fftMax: 0,
        showGrid: true,
        isDeviceConnected: true,
        centerFrequencyMHz: 1.5,
      });
    }
  }, [
    dimensions,
    waveformArray,
    floatWaveform,
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    isInitializingWebGPU,
    drawWebGPUFFTSignal,
    draw2DFFTSignal,
    drawGridOnContext,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
  ]);

  // Handle Resizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) {
          setDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });

    observer.observe(container);
    setDimensions({
      width: container.clientWidth,
      height: container.clientHeight,
    });

    return () => observer.disconnect();
  }, []);

  // Sync render with dimensions and data
  useEffect(() => {
    renderFrame();
  }, [renderFrame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupGPU();
      cleanup2D();
    };
  }, [cleanupGPU, cleanup2D]);

  return (
    <PageContainer>
      <Header>
        <Title>Draw N-APT Signal Simulator</Title>
        <Subtitle>
          An approximate mathematical synthesis of the N-APT frequency comb.
        </Subtitle>
      </Header>

      <VisualizerWrapper ref={containerRef}>

        <CanvasElement ref={canvasRef} />

        <InfoBox>
          <InfoItem>
            Spikes: <InfoValue>{drawParams.spikeCount}</InfoValue>
          </InfoItem>
          <InfoItem>
            Center Freq: <InfoValue>1.500 MHz</InfoValue>
          </InfoItem>
          <InfoItem>
            Spike Width: <InfoValue>{drawParams.spikeWidth.toFixed(2)}</InfoValue>
          </InfoItem>
          <InfoItem>
            Envelope: <InfoValue>{drawParams.envelopeWidth.toFixed(1)}</InfoValue>
          </InfoItem>
        </InfoBox>
      </VisualizerWrapper>
    </PageContainer>
  );
};

export default DrawSignalRoute;
