import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, Sphere, Text } from '@react-three/drei';
import styled from 'styled-components';

interface RadiationLobe3DProps {
  frequency?: number;      // MHz
  aperture?: number;       // m (D)
  height?: number;         // m (h)
  n?: number;             // horizontal beam shaping
  m?: number;             // vertical beam shaping
  showNearFarField?: boolean;
  showGroundInterference?: boolean;
}

const LobeLabel = styled.div`
  background: rgba(0, 0, 0, 0.7);
  color: #ac77ff;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #ac77ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
`;

export const RadiationLobe3D: React.FC<RadiationLobe3DProps> = ({
  frequency = 1.5,
  aperture = 0.04,
  height = 5,
  n = 6,
  m = 20,
  showNearFarField = true,
  showGroundInterference = true,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const visualScale = 5; // Visual scale factor for the 3D lobe

  // Physics constants
  const c = 3e8; // m/s
  const wavelength = c / (frequency * 1e6); // m
  const k = (2 * Math.PI) / wavelength;
  const farFieldDistance = (2 * Math.pow(aperture, 2)) / wavelength;

  // HPBW Calculation (Half-Power Beamwidth)
  // R(theta) = cos(theta)^n = 0.5 => theta = acos(0.5^(1/n))
  const hpbwHorizontal = 2 * Math.acos(Math.pow(0.5, 1 / n)) * (180 / Math.PI);
  const hpbwVertical = 2 * Math.acos(Math.pow(0.5, 1 / m)) * (180 / Math.PI);

  // Generate 3D Surface Geometry
  const geometry = useMemo(() => {
    const size = 64;
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];

    for (let j = 0; j <= size; j++) {
      const phi = (j / size) * Math.PI - Math.PI / 2; // elevation [-pi/2, pi/2]
      for (let i = 0; i <= size; i++) {
        const theta = (i / size) * Math.PI * 2; // azimuth [0, 2pi]

        // Radiation Model: R(theta, phi) = max(0, cos(theta))^n * max(0, cos(phi))^m
        // We orient the main lobe along the positive X axis (theta = 0, phi = 0)
        const cosTheta = Math.cos(theta);
        const cosPhi = Math.cos(phi);

        let intensity = Math.pow(Math.max(0, cosTheta), n) * Math.pow(Math.max(0, cosPhi), m);

        // Ground reflection interference model: interference lobes
        if (showGroundInterference) {
          // ground_factor = |1 + exp(i * k * 2h * sin(phi))|
          const phase = k * 2 * height * Math.sin(phi);
          const groundFactor = Math.sqrt(2 * (1 + Math.cos(phase))); // Real magnitude
          intensity *= (groundFactor / 2); // Normalize peak to 1
        }

        const r = intensity;

        // Spherical to Cartesian (scaled for visibility)
        const x = r * Math.cos(phi) * Math.cos(theta) * visualScale;
        const y = r * Math.cos(phi) * Math.sin(theta) * visualScale;
        const z = r * Math.sin(phi) * visualScale;

        vertices.push(x, z, -y); // Y is up in Three.js, but Z is up in original request. Adjusting to R3F standard (Y up)

        // Color based on intensity (Jet color map simplified)
        colors.push(intensity, 1 - intensity, 0.5);
      }
    }

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const row1 = j * (size + 1);
        const row2 = (j + 1) * (size + 1);
        indices.push(row1 + i, row1 + i + 1, row2 + i);
        indices.push(row1 + i + 1, row2 + i + 1, row2 + i);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [n, m, height, k, showGroundInterference, visualScale]);

  return (
    <group position={[0, height, 0]}>
      {/* Antenna Marker */}
      <mesh>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color="#ac77ff" />
        <Html position={[0, 0.2, 0]} center>
          <LobeLabel>Antenna (h={height}m)</LobeLabel>
        </Html>
      </mesh>

      {/* Radiation Lobe Surface */}
      <mesh geometry={geometry} ref={meshRef}>
        <meshStandardMaterial vertexColors transparent opacity={0.75} side={THREE.DoubleSide} />
      </mesh>

      {/* Near-Field / Far-Field Boundary */}
      {showNearFarField && (
        <Sphere args={[farFieldDistance * 5, 32, 32]}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.05} wireframe />
          <Html position={[0, farFieldDistance * 5, 0]} center>
            <LobeLabel style={{ borderColor: '#aaa', color: '#aaa' }}>
              Far-Field Boundary ({farFieldDistance.toFixed(3)}m)
            </LobeLabel>
          </Html>
        </Sphere>
      )}

      {/* Lobe Labels */}
      <Html position={[visualScale * 1.1, 0, 0]} center>
        <LobeLabel>Main Lobe (HPBW: H:{hpbwHorizontal.toFixed(1)}° V:{hpbwVertical.toFixed(1)}°)</LobeLabel>
      </Html>

      <Html position={[visualScale * 0.4, visualScale * 0.3, visualScale * 0.4]} center>
        <LobeLabel style={{ opacity: 0.7, fontSize: '8px' }}>Side Lobe</LobeLabel>
      </Html>

      <Html position={[visualScale * 0.4, -visualScale * 0.3, -visualScale * 0.4]} center>
        <LobeLabel style={{ opacity: 0.7, fontSize: '8px' }}>Minor Lobe</LobeLabel>
      </Html>

      {/* Back Lobe detection area */}
      <Html position={[-visualScale * 0.3, 0, 0]} center>
        <LobeLabel style={{ opacity: 0.6 }}>Back Lobe</LobeLabel>
      </Html>

      {/* Ground Plane reference at y=0 */}
      <gridHelper args={[60, 60, 0x444444, 0x222222]} position={[0, -height, 0]} />

      {/* Normalized Gain Scale Legend */}
      <Html position={[-visualScale * 1.5, visualScale, 0]} center>
        <div style={{ background: 'rgba(0,0,0,0.8)', padding: '8px', borderRadius: '8px', border: '1px solid #444' }}>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>GAIN SCALE</div>
          <div style={{ height: '100px', width: '12px', background: 'linear-gradient(to top, #7f00ff, #00ff00, #ff0000)', borderRadius: '2px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100px', fontSize: '9px', marginLeft: '16px', position: 'absolute', top: '24px', left: '20px' }}>
            <span>1.0</span>
            <span>0.5</span>
            <span>0.0</span>
          </div>
        </div>
      </Html>
    </group>
  );
};
