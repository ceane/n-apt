import React, { lazy, Suspense } from "react";
import styled from "styled-components";
import type { Group } from "three";

/**
 * The spinning 3D SDR models pull in three.js + @react-three/fiber + drei,
 * which is most of the auth-route bundle weight. This module lazy-loads the
 * entire renderer (Canvas + models) on first mount, after the auth screen has
 * painted, so the initial bundle stays small.
 */
const Canvas = lazy(() =>
  import("@react-three/fiber").then((m) => ({ default: m.Canvas })),
);

const SpinningRTLSdr = lazy(() =>
  import("@n-apt/three-d/SDRs").then((m) => ({
    default: m.SpinningRTLSdr,
  })),
);

const SpinningRTLSdrWithAntenna = lazy(() =>
  import("@n-apt/three-d/SDRs").then((m) => ({
    default: m.SpinningRTLSdrWithAntenna,
  })),
);

const SpinningHackRFOne = lazy(() =>
  import("@n-apt/three-d/SDRs").then((m) => ({
    default: m.SpinningHackRFOne,
  })),
);

const ProjectionPointReporter = lazy(() =>
  import("@n-apt/three-d/ProjectionPointReporter").then((m) => ({
    default: m.ProjectionPointReporter,
  })),
);

const AntennaOrbitControls = lazy(() =>
  import("@n-apt/three-d/AntennaOrbitControls").then((m) => ({
    default: m.AntennaOrbitControls,
  })),
);

const SDRPreview = styled.div`
  width: 100%;
  height: 100%;

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }
`;

const Placeholder = styled.div`
  display: flex;
  width: 82%;
  height: 32px;
  margin: 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px dashed ${(props) => props.theme.primary ?? "#00d4ff"};
  border-radius: 5px;
  color: ${(props) => props.theme.primary ?? "#00d4ff"};
  font-family: ${(props) => props.theme.typography?.mono ?? "monospace"};
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const LazySDRCanvas: React.FC<{
  variant: "rtl" | "hackrf";
  withAntenna?: boolean;
  onProjectionPoint?: (point: { x: number; y: number }) => void;
}> = ({ variant, withAntenna = false, onProjectionPoint }) => {
  const Model =
    variant === "rtl"
      ? withAntenna
        ? SpinningRTLSdrWithAntenna
        : SpinningRTLSdr
      : SpinningHackRFOne;
  const isAntennaVariant = variant === "rtl" && withAntenna;
  const modelRef = React.useRef<Group>(null);
  const modelScale = variant === "rtl" ? (isAntennaVariant ? 3 : 1.2) : 0.72;
  const modelPosition: [number, number, number] =
    variant === "rtl"
      ? isAntennaVariant
        ? [0, -0.8, 0]
        : [0, -0.2, 0]
      : [0, -0.55, 0];

  return (
    <SDRPreview
      aria-label={`${variant === "rtl" ? "RTL-SDR" : "HackRF One"}${isAntennaVariant ? " with antenna" : ""} 3D model spinning`}
    >
      <Suspense fallback={<Placeholder>Loading 3D…</Placeholder>}>
        <Canvas
          camera={{
            position: isAntennaVariant ? [3.2, 2.2, 4] : [2.1, 1.2, 2.5],
            fov: isAntennaVariant ? 45 : 35,
          }}
          dpr={[1, 1.5]}
          frameloop={isAntennaVariant ? "always" : "demand"}
        >
          <ambientLight intensity={1.2} />
          <hemisphereLight args={["#dffaff", "#07131a", 1.6]} />
          <directionalLight
            position={[0, 6, 2]}
            intensity={7}
            color="#ffffff"
          />
          <spotLight
            position={[0, 5, 2]}
            angle={0.7}
            penumbra={0.45}
            intensity={12}
            color="#ffffff"
          />
          <pointLight position={[-2, 1.5, 2]} intensity={5} color="#00d4ff" />
          <pointLight position={[2, 0.5, 1]} intensity={4} color="#ffffff" />
          {isAntennaVariant && <AntennaOrbitControls />}
          <group ref={modelRef} position={modelPosition} scale={modelScale}>
            <Model speed={isAntennaVariant ? 0 : 0.8} />
          </group>
          {isAntennaVariant && onProjectionPoint && (
            <ProjectionPointReporter
              modelRef={modelRef}
              onPoint={onProjectionPoint}
            />
          )}
        </Canvas>
      </Suspense>
    </SDRPreview>
  );
};

export default LazySDRCanvas;
