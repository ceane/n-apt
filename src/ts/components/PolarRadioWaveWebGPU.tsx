import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import styled from "styled-components";

interface PolarRadioWaveWebGPUProps {
  aperture?: number;
  beamWidth?: number;
  rotation?: number;
  gain?: number;
  frequency?: number;
  active?: boolean;
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  background: #050507;
  border-radius: 12px;
  overflow: hidden;
`;

const SEGMENTS = 360; // Resolution of the polar pattern

const PolarLobeLine: React.FC<{
  aperture: number;
  beamWidth: number;
  rotation: number;
  frequency: number;
}> = ({ aperture, beamWidth: propBeamWidth, rotation, frequency }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Use BoxGeometry for 3D lines
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#ac77ff",
    transparent: true,
    opacity: 0.9,
  }), []);

  const MAX_RADIUS = 7.5;
  const ANTENNA_VISUAL_RADIUS = (aperture / 100) * 1.5;

  useFrame(() => {
    if (!meshRef.current) return;

    const radRotation = (rotation * Math.PI) / 180;
    const points: THREE.Vector3[] = [];

    // Physics-based wavelength calculation
    // frequency is in MHz, speed of light c is ~300,000,000 m/s
    // λ = c / f -> λ(mm) = 300,000 / f(MHz)
    const wavelengthMm = 300000 / (frequency || 1);

    // Theoretical beamwidth estimation (Aperture vs Wavelength)
    // HPBW approx 51 * (λ / A)
    const physicsBeamWidth = 51 * (wavelengthMm / aperture);

    // Merge prop with physics, biasing towards physics if it's broad
    const effectiveBeamWidth = Math.min(180, Math.max(propBeamWidth || 5, physicsBeamWidth));

    for (let i = 0; i <= SEGMENTS; i++) {
      const theta = (i * Math.PI * 2) / SEGMENTS;
      const relativeTheta = theta - radRotation;

      let normTheta = relativeTheta;
      while (normTheta > Math.PI) normTheta -= Math.PI * 2;
      while (normTheta < -Math.PI) normTheta += Math.PI * 2;

      const k = 180 / effectiveBeamWidth;
      const x = normTheta * k;

      let intensity = 0;
      if (Math.abs(x) < 0.001) {
        intensity = 1.0;
      } else {
        intensity = Math.pow(Math.sin(x) / x, 2);
      }

      // If Aperture < Wavelength, diffraction dominates (leaks behind much more)
      const diffractionRatio = Math.min(1.0, wavelengthMm / aperture);
      const diffractionFloor = 0.05 + 0.4 * diffractionRatio * (0.5 + 0.5 * Math.cos(normTheta));

      const finalIntensity = intensity + (1 - intensity) * diffractionFloor;

      const r = ANTENNA_VISUAL_RADIUS + finalIntensity * (MAX_RADIUS - ANTENNA_VISUAL_RADIUS);
      points.push(new THREE.Vector3(r * Math.sin(theta), 0.01, -r * Math.cos(theta)));
    }

    for (let i = 0; i < SEGMENTS; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      const center = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      const distance = p1.distanceTo(p2);

      dummy.position.copy(center);
      dummy.lookAt(p2);
      dummy.scale.set(0.04, 0.04, distance);

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, SEGMENTS]} />
  );
};

const DegreeLabel = styled.div`
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  color: #555;
  pointer-events: none;
  white-space: nowrap;
`;

// 3D Polar Grid Component
const PolarGrid3D: React.FC<{ aperture: number }> = ({ aperture }) => {
  const ANTENNA_VISUAL_RADIUS = (aperture / 100) * 1.5;
  const MAX_RADIUS = 7.5;
  const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  return (
    <group>
      {/* Rings */}
      {[0.2, 0.4, 0.6, 0.8, 1.0].map((r, i) => (
        <mesh key={`ring-${i}`} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry
            args={[
              ANTENNA_VISUAL_RADIUS + r * (MAX_RADIUS - ANTENNA_VISUAL_RADIUS) - 0.015,
              ANTENNA_VISUAL_RADIUS + r * (MAX_RADIUS - ANTENNA_VISUAL_RADIUS) + 0.015,
              128
            ]}
          />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.08} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Angle lines & Labels */}
      {angles.map(angle => {
        const rad = (angle * Math.PI) / 180;
        const len = MAX_RADIUS;
        const labelPos = ANTENNA_VISUAL_RADIUS + 1.2 * (MAX_RADIUS - ANTENNA_VISUAL_RADIUS);
        return (
          <group key={`angle-grp-${angle}`}>
            <mesh
              position={[len / 2 * Math.sin(rad), 0, -len / 2 * Math.cos(rad)]}
              rotation={[0, -rad, 0]}
            >
              <boxGeometry args={[0.015, 0.001, len]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.05} />
            </mesh>

            {/* 3D Label emulation - simple HTML overlay in the scene */}
            <Html position={[labelPos * Math.sin(rad), 0, -labelPos * Math.cos(rad)]} center transform={false}>
              <DegreeLabel>{angle}°</DegreeLabel>
            </Html>
          </group>
        );
      })}

      {/* Central Antenna Model */}
      <group position={[0, 0.05, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[ANTENNA_VISUAL_RADIUS, 64]} />
          <meshBasicMaterial color="#0a0a0c" side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ANTENNA_VISUAL_RADIUS - 0.03, ANTENNA_VISUAL_RADIUS, 64]} />
          <meshBasicMaterial color="#ac77ff" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
};

const MetricsOverlay = styled.div`
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: none;
`;

const MetricItem = styled.div`
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  color: #888;
  display: flex;
  gap: 6px;
  align-items: center;
`;

const MetricValue = styled.span`
  color: #ac77ff;
  font-weight: 500;
`;

const MathText = styled.span`
  font-family: serif;
  font-style: italic;
  font-size: 11px;
  margin-right: 2px;
`;

const formatDistance = (mm: number) => {
  if (mm >= 1000000) return `${(mm / 1000000).toFixed(2)} km`;
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  return `${mm.toFixed(0)} mm`;
};

export const PolarRadioWaveWebGPU: React.FC<PolarRadioWaveWebGPUProps> = (props) => {
  return (
    <Container style={{ position: 'relative' }}>
      <Canvas
        orthographic
        gl={async (glProps: any) => {
          const renderer = new WebGPURenderer({ ...glProps, antialias: true, alpha: true });
          await renderer.init();
          return renderer as any;
        }}
        camera={{ position: [0, 15, 2.0], zoom: 15.5, up: [0, 0, -1], far: 1000, near: -1000 }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />

        <PolarGrid3D aperture={props.aperture ?? 30} />

        <PolarLobeLine
          aperture={props.aperture ?? 30}
          beamWidth={props.beamWidth ?? 25}
          rotation={props.rotation ?? 0}
          frequency={props.frequency ?? 2.4}
        />

        <gridHelper args={[30, 30, 0x333333, 0x1a1a1e]} position={[0, -0.01, 0]} />
      </Canvas>

      <MetricsOverlay>
        <MetricItem>
          <MathText>ƒ</MathText> (Frequency): <MetricValue style={{ marginLeft: '4px' }}>{(props.frequency ?? 2.4).toFixed(3)} MHz</MetricValue>
        </MetricItem>
        <MetricItem>
          <MathText>λ</MathText> (Wavelength): <MetricValue style={{ marginLeft: '4px' }}>
            {formatDistance(300000 / (props.frequency ?? 2.4))}
          </MetricValue>
        </MetricItem>
        <MetricItem>
          <MathText>A</MathText> (Aperture/Antenna Panel or Face): <MetricValue style={{ marginLeft: '4px' }}>
            {formatDistance(props.aperture ?? 40)}
          </MetricValue>
        </MetricItem>
      </MetricsOverlay>
    </Container>
  );
};
