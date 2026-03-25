import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import styled from "styled-components";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useDrawMockNAPTSignal } from "@n-apt/hooks/useDrawMockNAPTSignal";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useSpectrumRenderer } from "@n-apt/hooks/useSpectrumRenderer";
import { RESAMPLE_WGSL } from "@n-apt/consts/shaders/resample";
import { FFT_CANVAS_BG } from "@n-apt/consts";
import { PolarRadioWaveWebGPU } from "@n-apt/components/3D/PolarRadioWaveWebGPU";
import { RadiationLobe3D } from "@n-apt/components/3D/RadiationLobe3D";
import { CollapsibleTitle } from "@n-apt/components/ui/Collapsible";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  padding: 24px;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
  box-sizing: border-box;
  overflow-y: auto;
`;

const Header = styled.div`
  margin-bottom: 24px;
`;

const Title = styled.h1`
  font-size: 24px;
  margin-bottom: 8px;
  color: ${(props: any) => props.theme.primary || "#3b82f6"};
  font-family: "Outfit", "Inter", sans-serif;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, ${(props) => props.theme.textPrimary} 0%, ${(props) => props.theme.textSecondary} 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textSecondary};
  font-family: "Outfit", "Inter", sans-serif;
`;

const VisualizerWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: ${(props) => props.theme.colors?.fftBackground ?? FFT_CANVAS_BG};
  border: 1px solid ${(props) => props.theme.canvasBorder ?? "#1a1a1a"};
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 500px;
  width: 100%;
`;

const CanvasElement = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
  aspect-ratio: 4 / 3;
  width: 100%;
`;


const InfoBox = styled.div`
  position: absolute;
  bottom: 20px;
  left: 60px;
  background: ${(props) => props.theme.surface}cc;
  border: 1px solid ${(props) => props.theme.borderHover};
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
  color: ${(props) => props.theme.textSecondary};
`;

const InfoValue = styled.span`
  color: ${(props: any) => props.theme.primary || "#3b82f6"};
  font-weight: 500;
`;

const PolarSectionContainer = styled.div`
  margin-top: 32px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 24px;
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const PolarHeaderWrapper = styled.div`
  grid-column: 1 / -1;
  width: 100%;
  margin-bottom: 8px; /* Reduced from 24px as CollapsibleTitleContainer has margin */
`;



const PolarCard = styled.div`
  background: ${(props) => props.theme.surfaceHover}66;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
`;

const PolarComposite = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 0;
  width: 100%;
  min-height: 500px;
  border-radius: 12px;
  overflow: hidden;
  background: ${(props) => props.theme.surface};
`;

const PolarPane = styled.div`
  position: relative;
  min-width: 0;
  min-height: 500px;

  &:first-child {
    border-right: 1px solid ${(props) => props.theme.border};
  }
`;

const CardTitle = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: ${(props) => props.theme.textMuted};
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

export const DrawSignalRoute: React.FC = () => {
  const { state, sampleRateHzEffective } = useSpectrumStore();
  const { drawParams } = state;
  const { generateMockNAPTData } = useDrawMockNAPTSignal();
  const { drawSpectrum, cleanup } = useSpectrumRenderer();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isPolarOpen, setIsPolarOpen] = useState(false);

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
    return generateMockNAPTData(drawParams, state.globalNoiseFloor);
  }, [drawParams, state.globalNoiseFloor, generateMockNAPTData]);

  const waveformArray = useMemo(() => data.map((p) => p.x), [data]);
  const floatWaveform = useMemo(() => new Float32Array(waveformArray), [waveformArray]);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (
      !canvas ||
      dimensions.width === 0 ||
      dimensions.height === 0 ||
      waveformArray.length === 0 ||
      isInitializingWebGPU
    ) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(dimensions.width * dpr);
    const targetHeight = Math.round(dimensions.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${dimensions.width}px`;
      canvas.style.height = `${dimensions.height}px`;
    }

    // Use the unified renderer hook
    drawSpectrum({
      canvas,
      webgpuEnabled,
      isInitializingWebGPU,
      device: webgpuDeviceRef.current,
      format: webgpuFormatRef.current,
      waveform: floatWaveform,
      frequencyRange: { min: 0, max: 3 },
      fftMin: -120,
      fftMax: 0,
      isIqRecordingActive: true,
      hardwareSampleRateHz: sampleRateHzEffective ?? undefined,
      gridOverlayRenderer: gridOverlayRendererRef.current,
      markersOverlayRenderer: markersOverlayRendererRef.current,
    });
  }, [
    dimensions,
    waveformArray,
    floatWaveform,
    webgpuEnabled,
    webgpuDeviceRef,
    webgpuFormatRef,
    sampleRateHzEffective,
    gridOverlayRendererRef,
    markersOverlayRendererRef,
    drawSpectrum,
    isInitializingWebGPU,
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
    return () => cleanup();
  }, [cleanup]);

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
            Clumps: <InfoValue>{drawParams.length}</InfoValue>
          </InfoItem>
          <InfoItem>
            Active: <InfoValue>#{state.activeClumpIndex + 1}</InfoValue>
          </InfoItem>
          <InfoItem>
            Spike Count: <InfoValue>{drawParams[state.activeClumpIndex]?.spikeCount ?? 0}</InfoValue>
          </InfoItem>
          <InfoItem>
            Spike Width: <InfoValue>{(drawParams[state.activeClumpIndex]?.spikeWidth ?? 0).toFixed(2)}</InfoValue>
          </InfoItem>
          <InfoItem>
            Envelope: <InfoValue>{(drawParams[state.activeClumpIndex]?.envelopeWidth ?? 0).toFixed(1)}</InfoValue>
          </InfoItem>
        </InfoBox>
      </VisualizerWrapper>

      <PolarSectionContainer>
        <PolarHeaderWrapper>
          <CollapsibleTitle
            label="Polar Emission Charts (radio wave shown from antenna face)"
            isOpen={isPolarOpen}
            onToggle={() => setIsPolarOpen(!isPolarOpen)}
          />
        </PolarHeaderWrapper>

        {isPolarOpen && (
          <div style={{ marginTop: '20px', position: 'relative', width: '100%' }}>
            <PolarCard style={{ width: '100%', position: 'relative', padding: 0 }}>
              <CardTitle style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 10 }}>
                High-Fidelity 3D Propagation & Radiation HUD
              </CardTitle>

              <PolarComposite>
                <PolarPane>
                  <Canvas
                    camera={{ position: [15, 15, 15], fov: 45 }}
                    style={{ width: '100%', minHeight: '500px', height: '100%' }}
                  >
                    <ambientLight intensity={0.5} />
                    <pointLight position={[20, 20, 20]} />
                    <RadiationLobe3D
                      frequency={drawParams[state.activeClumpIndex]?.centerOffset || 1.5}
                      aperture={0.04}
                      height={5}
                      n={6}
                      m={20}
                    />
                    <OrbitControls makeDefault />
                  </Canvas>
                </PolarPane>

                <PolarPane>
                  <PolarRadioWaveWebGPU
                    aperture={40}
                    beamWidth={(drawParams[state.activeClumpIndex]?.spikeWidth ?? 0.1) * 200}
                    rotation={0}
                    frequency={drawParams[state.activeClumpIndex]?.centerOffset ?? 1.5}
                  />
                </PolarPane>
              </PolarComposite>
            </PolarCard>
          </div>
        )}
      </PolarSectionContainer>
    </PageContainer>
  );
};

export default DrawSignalRoute;
