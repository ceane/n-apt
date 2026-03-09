import React, { Suspense } from "react";
import styled from "styled-components";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, TransformControls } from "@react-three/drei";
import Brain from "@n-apt/components/Brain";
import {
  MODEL_CAMERA_POSITION,
  MODEL_CAMERA_TARGET,
  MODEL_FOV,
  MODEL_ROOT_POSITION,
  SPHERE_GEOMETRY_SEGMENTS,
  SPHERE_MARKER_COLOR,
  SPHERE_MARKER_BASE_INTENSITY,
  MODEL_AMBIENT_LIGHT_INTENSITY,
  MODEL_KEY_LIGHT_INTENSITY,
  MODEL_KEY_LIGHT_POSITION,
  MODEL_FILL_LIGHT_INTENSITY,
  MODEL_FILL_LIGHT_POSITION,
  MODEL_BACK_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_POSITION,
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
  const { scene } = useGLTF("/glb_models/human_model_afro_male.glb");

  return (
    <group position={MODEL_ROOT_POSITION}>
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
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;

  canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
  }
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
          <ambientLight intensity={MODEL_AMBIENT_LIGHT_INTENSITY} />
          <directionalLight position={MODEL_KEY_LIGHT_POSITION} intensity={MODEL_KEY_LIGHT_INTENSITY} />
          <pointLight position={MODEL_FILL_LIGHT_POSITION} intensity={MODEL_FILL_LIGHT_INTENSITY} color="#ffffff" />
          <pointLight position={MODEL_BACK_LIGHT_POSITION} intensity={MODEL_BACK_LIGHT_INTENSITY} color="#8ddcff" />
          <pointLight position={[-2.8, 2.4, -4.2]} intensity={1.4} color="#7cc7ff" />
          <pointLight position={[2.8, 2.4, -4.2]} intensity={1.4} color="#7cc7ff" />
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
