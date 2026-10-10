import React, { useLayoutEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import styled from "styled-components";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { theme } from "@n-apt/app-article/consts/theme";
import CanvasHarness from "@n-apt/app-article/components/canvas/CanvasHarness";

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

function syncRendererSizeToCanvas(
  renderer: {
    setSize: (width: number, height: number, updateStyle?: boolean) => void;
  },
  canvas: HTMLCanvasElement,
) {
  const { width, height } = canvas.getBoundingClientRect();
  if (width > 0 && height > 0) {
    renderer.setSize(width, height, false);
  }
}

function RendererSizeSync() {
  const { gl, size } = useThree();

  useLayoutEffect(() => {
    gl.setSize(size.width, size.height, false);
  }, [gl, size.width, size.height]);

  return null;
}

export const SignalCanvasFrame: React.FC<
  React.PropsWithChildren<{
    title: string;
    overlay?: React.ReactNode;
    hideTitle?: boolean;
  }>
> = ({ children, title, overlay, hideTitle }) => (
  <CanvasHarness aspectRatio={theme.layout.aspectRatio}>
    <CanvasHost>{children}</CanvasHost>
    <Overlay>
      {!hideTitle && <RendererBadge>{title}</RendererBadge>}
      {overlay}
    </Overlay>
  </CanvasHarness>
);

export const SignalGraphFrame: React.FC<
  React.PropsWithChildren<{ title: string; overlay?: React.ReactNode }>
> = ({ children, title, overlay }) => (
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
          syncRendererSizeToCanvas(renderer, props.canvas as HTMLCanvasElement);
          return renderer;
        } catch {
          setFallback(true);
          const renderer = new THREE.WebGLRenderer(
            props as THREE.WebGLRendererParameters,
          );
          renderer.setClearColor(theme.colors.background);
          syncRendererSizeToCanvas(renderer, props.canvas as HTMLCanvasElement);
          return renderer;
        }
      }}
    >
      <RendererSizeSync />
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
