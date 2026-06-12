import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import styled from "styled-components";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDrawSignalPagination } from "@n-apt/contexts/DrawSignalPaginationContext";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useDrawMockNAPTSignal } from "@n-apt/hooks/useDrawMockNAPTSignal";
import { useWebGPUInit } from "@n-apt/hooks/useWebGPUInit";
import { useSpectrumRenderer } from "@n-apt/hooks/useSpectrumRenderer";
import { RESAMPLE_WGSL } from "@n-apt/shaders";
import { FFT_CANVAS_BG } from "@n-apt/consts";
import { PolarRadioWaveWebGPU } from "@n-apt/components/3D/PolarRadioWaveWebGPU";
import { RadiationLobe3D } from "@n-apt/components/3D/RadiationLobe3D";
import { DecryptionFallback } from "@n-apt/components/ui/DecryptionFallback";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
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
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
`;

const Title = styled.h1`
  font-size: 24px;
  margin-bottom: 8px;
  color: ${(props: any) => props.theme.primary || "#3b82f6"};
  font-family: "Outfit", "Inter", sans-serif;
  letter-spacing: -0.5px;
  background: linear-gradient(
    135deg,
    ${(props) => props.theme.textPrimary} 0%,
    ${(props) => props.theme.textSecondary} 100%
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: ${(props) => props.theme.textSecondary};
  font-family: "Outfit", "Inter", sans-serif;
`;

const PageControls = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`;

const PageLabel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const PageCounter = styled.div`
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  color: ${(props) => props.theme.textMuted};
`;

const PageArrow = styled.button`
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    border-color: ${(props) => props.theme.primary};
    color: ${(props) => props.theme.primary};
    background: ${(props) => props.theme.surfaceHover};
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
`;

const VisualizerWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: ${(props) =>
    props.theme.colors?.fftBackground ?? FFT_CANVAS_BG};
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

const MathOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  pointer-events: none;
  aspect-ratio: 4 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
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
  flex: 1;
  min-height: 400px;
  display: flex;
  flex-direction: column;
  width: 100%;
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
  min-height: 400px;
  height: 100%;
  box-sizing: border-box;
`;

const PolarComposite = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 0;
  width: 100%;
  min-height: 400px;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: ${(props) => props.theme.surface};
`;

const PolarPane = styled.div`
  position: relative;
  min-width: 0;
  min-height: 400px;
  height: 100%;

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

const PageViewport = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const PolarPageWrap = styled.div`
  flex: 1;
  min-height: 400px;
  height: 100%;
  display: flex;
`;

const PolarCanvasWrap = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 400px;
  height: 100%;
`;

export const DrawSignalRoute: React.FC = () => {
  const { state, sampleRateHzEffective } = useSpectrumStore();
  const { drawParams } = state;
  const { generateMockNAPTData, mathLoaded } = useDrawMockNAPTSignal();
  const { drawSpectrum, cleanup } = useSpectrumRenderer();
  const { pageIndex, setPageIndex, pageCount } = useDrawSignalPagination();

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
  }, [drawParams, state.globalNoiseFloor, generateMockNAPTData, mathLoaded]);

  const waveformArray = useMemo(() => data.map((p) => p.x), [data]);
  const floatWaveform = useMemo(
    () => new Float32Array(waveformArray),
    [waveformArray],
  );

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
      frequencyRange: { min: 0, max: 3_000_000 },
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
  }, [pageIndex]);

  // Sync render with dimensions and data
  useEffect(() => {
    let frameCount = 0;
    let rafId: number;

    const loop = () => {
      renderFrame();
      frameCount++;
      // Draw for several consecutive frames to ensure WebGPU
      // swap chain and DOM layout have fully settled after remount
      if (frameCount < 10) {
        rafId = requestAnimationFrame(loop);
      }
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [renderFrame, pageIndex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const pageTitle =
    pageIndex === 0 ? "Draw N-APT Signal Simulator" : "Polar Radiation View";
  const pageSubtitle =
    pageIndex === 0
      ? "An approximate mathematical synthesis of the N-APT frequency comb."
      : "Polar radiation coordinates and lobe visualization.";

  return (
    <PageContainer data-testid="draw-signal-route">
      <Header>
        <PageLabel>
          <Title>{pageTitle}</Title>
          <Subtitle>{pageSubtitle}</Subtitle>
        </PageLabel>
        <PageControls>
          <PageCounter>
            {pageIndex + 1} / {pageCount}
          </PageCounter>
          <PageArrow
            type="button"
            aria-label="Previous section"
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            disabled={pageIndex === 0}
          >
            <ChevronLeft size={16} />
          </PageArrow>
          <PageArrow
            type="button"
            aria-label="Next section"
            onClick={() =>
              setPageIndex((current) => Math.min(pageCount - 1, current + 1))
            }
            disabled={pageIndex === pageCount - 1}
          >
            <ChevronRight size={16} />
          </PageArrow>
        </PageControls>
      </Header>

      <PageViewport>
        {pageIndex === 0 ? (
          <VisualizerWrapper ref={containerRef}>
            {mathLoaded ? (
              <CanvasElement ref={canvasRef} />
            ) : (
              <MathOverlay>
                <DecryptionFallback
                  moduleName="Spike-EQ Math"
                  errorType="latex"
                />
              </MathOverlay>
            )}

            {mathLoaded && (
              <InfoBox>
                <InfoItem>
                  Clumps: <InfoValue>{drawParams.length}</InfoValue>
                </InfoItem>
                <InfoItem>
                  Active: <InfoValue>#{state.activeClumpIndex + 1}</InfoValue>
                </InfoItem>
                <InfoItem>
                  Spike Count:{" "}
                  <InfoValue>
                    {drawParams[state.activeClumpIndex]?.spikeCount ?? 0}
                  </InfoValue>
                </InfoItem>
                <InfoItem>
                  Spike Width:{" "}
                  <InfoValue>
                    {(
                      drawParams[state.activeClumpIndex]?.spikeWidth ?? 0
                    ).toFixed(2)}
                  </InfoValue>
                </InfoItem>
                <InfoItem>
                  Envelope:{" "}
                  <InfoValue>
                    {(
                      drawParams[state.activeClumpIndex]?.envelopeWidth ?? 0
                    ).toFixed(1)}
                  </InfoValue>
                </InfoItem>
              </InfoBox>
            )}
          </VisualizerWrapper>
        ) : (
          <PolarSectionContainer>
            <PolarPageWrap>
              <PolarCanvasWrap>
                <PolarCard style={{ padding: 0 }}>
                  <CardTitle
                    style={{
                      position: "absolute",
                      top: "16px",
                      left: "16px",
                      zIndex: 10,
                    }}
                  >
                    High-Fidelity 3D Propagation & Radiation HUD
                  </CardTitle>

                  <PolarComposite>
                    <PolarPane>
                      <Canvas
                        camera={{ position: [15, 15, 15], fov: 45 }}
                        style={{
                          width: "100%",
                          minHeight: "400px",
                          height: "100%",
                        }}
                      >
                        <ambientLight intensity={0.5} />
                        <pointLight position={[20, 20, 20]} />
                        <RadiationLobe3D
                          frequency={
                            drawParams[state.activeClumpIndex]?.centerOffset ||
                            1.5
                          }
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
                        beamWidth={
                          (drawParams[state.activeClumpIndex]?.spikeWidth ??
                            0.1) * 200
                        }
                        rotation={0}
                        frequency={
                          drawParams[state.activeClumpIndex]?.centerOffset ??
                          1.5
                        }
                      />
                    </PolarPane>
                  </PolarComposite>
                </PolarCard>
              </PolarCanvasWrap>
            </PolarPageWrap>
          </PolarSectionContainer>
        )}
      </PageViewport>
    </PageContainer>
  );
};

export default DrawSignalRoute;
