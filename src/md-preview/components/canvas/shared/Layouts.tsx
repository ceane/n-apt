import React, { useState } from "react";
import { Canvas } from "@react-three/fiber";
import styled from "styled-components";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { theme } from "@n-apt/md-preview/consts/theme";
import CanvasHarness from "@n-apt/md-preview/components/canvas/CanvasHarness";

const Frame = styled.div`
  width: 100%;
  min-width: min(100%, 320px);
  margin: ${theme.spacing.containerMargin};
  border-radius: ${theme.layout.borderRadius};
  overflow: hidden;
  border: 1px solid ${theme.colors.gridBorder};
  background: ${theme.colors.background};
  position: relative;
  aspect-ratio: ${theme.layout.aspectRatio};

  @media (max-width: 640px) {
    aspect-ratio: ${theme.layout.mobileAspectRatio};
  }

  > div {
    width: 100% !important;
    height: 100% !important;
  }

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    cursor: default;
  }
`;

const RendererBadge = styled.div`
  position: absolute;
  top: 14px;
  left: 16px;
  font-size: ${theme.fontSizes.canvasTitle};
  letter-spacing: 0.04em;
  font-family: ${theme.fonts.mono};
  color: ${theme.colors.text};
  z-index: 2;
  pointer-events: none;

  @media (max-width: 640px) {
    top: 10px;
    left: 12px;
    font-size: 0.78rem;
  }
`;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
`;

export const SignalCanvasFrame: React.FC<React.PropsWithChildren<{ title: string; overlay?: React.ReactNode }>> = ({
  children,
  title,
  overlay,
}) => (
  <CanvasHarness aspectRatio={theme.layout.aspectRatio}>
    <CanvasHost>{children}</CanvasHost>
    <Overlay>
      <RendererBadge>{title}</RendererBadge>
      {overlay}
    </Overlay>
  </CanvasHarness>
);

export const SignalGraphFrame: React.FC<React.PropsWithChildren<{ title: string; overlay?: React.ReactNode }>> = ({
  children,
  title,
  overlay,
}) => (
  <CanvasHarness aspectRatio={theme.layout.aspectRatio}>
    {children}
    <Overlay>
      <RendererBadge>{title}</RendererBadge>
      {overlay}
    </Overlay>
  </CanvasHarness>
);

export const CanvasHost: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [fallback, setFallback] = useState(false);

  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [0, 0, 10], zoom: 68 }}
      gl={async (props) => {
        try {
          const renderer = new WebGPURenderer(props as never);
          await renderer.init();
          renderer.setClearColor(theme.colors.background);
          return renderer;
        } catch {
          setFallback(true);
          const renderer = new THREE.WebGLRenderer(props as THREE.WebGLRendererParameters);
          renderer.setClearColor(theme.colors.background);
          return renderer;
        }
      }}
    >
      {/* eslint-disable-next-line react/no-unknown-property */}
      <color attach="background" args={[theme.colors.background]} />
      {/* eslint-disable-next-line react/no-unknown-property */}
      <ambientLight intensity={0.9} />
      {children}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <group visible={false} userData={{ fallback }} />
    </Canvas>
  );
};
