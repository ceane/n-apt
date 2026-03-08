import React, { Suspense } from "react";
import styled from "styled-components";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, TransformControls } from "@react-three/drei";
import Brain from "@n-apt/components/Brain";
import {
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
  MODEL_FOV,
  SPHERE_GEOMETRY_SEGMENTS,
  SPHERE_MARKER_COLOR,
  SPHERE_MARKER_BASE_INTENSITY,
} from "@n-apt/consts";

type Area = {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  meshName: string;
};

function Model({
  selectedArea,
  children,
}: {
  selectedArea: Area | null;
  children?: React.ReactNode;
}) {
  const { scene } = useGLTF("/glb_models/androgynous_body.glb");

  return (
    <group>
      <primitive object={scene} />
      {selectedArea && (
        <group position={selectedArea.target}>
          <mesh>
            <sphereGeometry
              args={[0.1, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
            />
            <meshStandardMaterial
              color={SPHERE_MARKER_COLOR}
              emissive={SPHERE_MARKER_COLOR}
              emissiveIntensity={
                selectedArea.name === "Head" ? 0 : SPHERE_MARKER_BASE_INTENSITY
              }
              transparent
              opacity={selectedArea.name === "Head" ? 0 : 0.4}
            />
          </mesh>
          <mesh>
            <sphereGeometry
              args={[0.15, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
            />
            <meshStandardMaterial
              color={SPHERE_MARKER_COLOR}
              emissive={SPHERE_MARKER_COLOR}
              emissiveIntensity={0.4}
              transparent
              opacity={0.2}
            />
          </mesh>
          <mesh>
            <sphereGeometry
              args={[0.2, SPHERE_GEOMETRY_SEGMENTS, SPHERE_GEOMETRY_SEGMENTS]}
            />
            <meshStandardMaterial
              color={SPHERE_MARKER_COLOR}
              emissive={SPHERE_MARKER_COLOR}
              emissiveIntensity={0.2}
              transparent
              opacity={0.1}
            />
          </mesh>
        </group>
      )}
      {children}
    </group>
  );
}

interface HumanModelViewerSimpleProps {
  selectedArea: Area | null;
  controlsRef: React.RefObject<any>;
  width?: string | number;
  height?: string | number;
}

const CanvasContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
`;

export const HumanModelViewerSimple: React.FC<HumanModelViewerSimpleProps> = ({
  selectedArea,
  controlsRef,
  width = "100%",
  height = "100%",
}) => {
  return (
    <CanvasContainer style={{ width, height }}>
      <Canvas
        style={{
          width: "100%",
          height: "100%",
        }}
        camera={{ position: MODEL_CAMERA_POSITION, fov: MODEL_FOV }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <TransformControls mode="translate">
            <Model selectedArea={selectedArea}>
              <Brain />
            </Model>
          </TransformControls>
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            target={MODEL_CAMERA_TARGET}
          />
        </Suspense>
      </Canvas>
    </CanvasContainer>
  );
};
