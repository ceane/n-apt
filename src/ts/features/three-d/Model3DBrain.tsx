import React, { Suspense, useEffect } from "react";
import styled from "styled-components";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import Brain from "@n-apt/three-d/Brain";
import { CoronaScene } from "@n-apt/learn";
import { toBrainViewerPoint } from "@n-apt/learn/sidebar/AnatomyCardsSection";
import { useModel3D } from "@n-apt/three-d/hooks/useModel3D";
import { gsap } from "gsap";
import {
  MODEL_AMBIENT_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_INTENSITY,
  MODEL_BACK_LIGHT_POSITION,
  MODEL_FILL_LIGHT_INTENSITY,
  MODEL_FILL_LIGHT_POSITION,
  MODEL_FOV,
  MODEL_KEY_LIGHT_INTENSITY,
  MODEL_KEY_LIGHT_POSITION,
} from "@n-apt/consts";

const BrainLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.75fr);
  grid-template-rows: auto 1fr;
  gap: 24px;
  height: 100%;
  min-height: 0;
`;

const BrainHeader = styled.h1`
  grid-column: 1 / -1;
  margin: 0;
  color: ${(props) => props.theme.textPrimary};
  font-size: clamp(28px, 4vw, 54px);
  line-height: 0.95;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
  font-family: ${(props) => props.theme.typography?.mono || "monospace"};
`;

const BrainStage = styled.div`
  min-height: 0;
  display: grid;
  place-items: center;
`;

const TonePanel = styled.div`
  min-height: 0;
  display: grid;
  place-items: center;
`;

const ToneCanvasWrap = styled.div`
  width: min(30vw, 320px);
  aspect-ratio: 1;
  min-width: 240px;
  min-height: 240px;
`;

export const Model3DBrain: React.FC = () => {
  const { controlsRef, selectedArea } = useModel3D();
  const brainTarget = selectedArea?.meshName === "brain" ? toBrainViewerPoint(selectedArea.target) : null;

  useEffect(() => {
    if (!brainTarget || !controlsRef.current) return;
    gsap.to(controlsRef.current.target, { x: brainTarget[0], y: brainTarget[1], z: brainTarget[2], duration: .7, onUpdate: () => controlsRef.current?.update() });
    gsap.to(controlsRef.current.object.position, { x: brainTarget[0], y: brainTarget[1], z: brainTarget[2] + 1.35, duration: .7, onUpdate: () => controlsRef.current?.update() });
  }, [brainTarget, controlsRef]);

  return (
    <BrainLayout>
      <BrainHeader>Psychology</BrainHeader>
      <BrainStage>
        <Canvas
          style={{ width: "100%", height: "100%" }}
          camera={{ position: [0, 0, 1.4], fov: MODEL_FOV }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={MODEL_AMBIENT_LIGHT_INTENSITY} />
            <directionalLight
              position={MODEL_KEY_LIGHT_POSITION}
              intensity={MODEL_KEY_LIGHT_INTENSITY * 0.9}
            />
            <pointLight
              position={MODEL_FILL_LIGHT_POSITION}
              intensity={MODEL_FILL_LIGHT_INTENSITY}
              color="#ffffff"
            />
            <pointLight
              position={MODEL_BACK_LIGHT_POSITION}
              intensity={MODEL_BACK_LIGHT_INTENSITY}
              color="#8ddcff"
            />
            <pointLight
              position={[0, 1.5, 4]}
              intensity={1.7}
              color="#ff7ef5"
            />
            <pointLight
              position={[1.4, 0.8, 3.2]}
              intensity={1.2}
              color="#00d4ff"
            />
            <Brain
              position={[0.1, -0.6, 0]}
              rotation={[0, 0, 0]}
              scale={[0.34, 0.34, 0.34]}
            />
            {brainTarget && (
              <group position={brainTarget}>
                <mesh>
                  <sphereGeometry args={[0.045, 24, 24]} />
                  <meshStandardMaterial color="#48d8ff" emissive="#48d8ff" emissiveIntensity={1.3} transparent opacity={0.8} />
                </mesh>
                <mesh>
                  <sphereGeometry args={[0.095, 24, 24]} />
                  <meshBasicMaterial color="#48d8ff" transparent opacity={0.16} depthWrite={false} />
                </mesh>
              </group>
            )}
            <OrbitControls
              ref={controlsRef}
              makeDefault
              enableDamping={false}
              enablePan={false}
              enableZoom
              minPolarAngle={Math.PI / 2}
              maxPolarAngle={Math.PI / 2}
              minAzimuthAngle={-Math.PI / 7}
              maxAzimuthAngle={Math.PI / 7}
              minDistance={1.1}
              maxDistance={1.65}
              target={[0, 0, 0]}
            />
          </Suspense>
        </Canvas>
      </BrainStage>
      <TonePanel>
        <ToneCanvasWrap>
          <Canvas
            camera={{ position: [0, 0, 10], fov: 60 }}
            style={{ width: "100%", height: "100%" }}
          >
            <CoronaScene />
          </Canvas>
        </ToneCanvasWrap>
      </TonePanel>
    </BrainLayout>
  );
};
