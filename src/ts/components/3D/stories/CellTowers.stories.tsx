import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import {
  SectorTower,
  DiamondCell,
  PoleMountedSmallCell,
  HexagonalSmallCell,
  SinglePanelSmallCell
} from '../CellTowers';

export default {
  title: 'ThreeD/CellTowers',
};

const Setup = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: '100%', height: '600px', background: '#050505' }}>
    <Canvas camera={{ position: [15, 10, 15], fov: 45 }}>
      <color attach="background" args={['#050505']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} />
      <directionalLight position={[-10, 5, -10]} intensity={0.4} />

      {/* Ground plane for reference at y=0 */}
      <Grid
        args={[30, 30]}
        cellSize={1}
        cellThickness={1}
        cellColor="#333"
        sectionSize={5}
        sectionThickness={1.5}
        sectionColor="#555"
        fadeDistance={25}
        fadeStrength={1.5}
        position={[0, 0, 0]}
      />

      {children}

      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2} />
    </Canvas>
  </div>
);

export const Sector = () => (
  <Setup>
    <SectorTower />
  </Setup>
);

export const Diamond = () => (
  <Setup>
    <DiamondCell />
  </Setup>
);

export const PoleMounted = () => (
  <Setup>
    <PoleMountedSmallCell />
  </Setup>
);

export const Hexagonal = () => (
  <Setup>
    <HexagonalSmallCell />
  </Setup>
);

export const SinglePanel = () => (
  <Setup>
    <SinglePanelSmallCell />
  </Setup>
);

export const AllTowers = () => (
  <Setup>
    <group position={[-10, 0, 0]}>
      <SectorTower />
    </group>
    <group position={[-5, 0, 0]}>
      <DiamondCell />
    </group>
    <group position={[0, 0, 0]}>
      <PoleMountedSmallCell />
    </group>
    <group position={[5, 0, 0]}>
      <HexagonalSmallCell />
    </group>
    <group position={[10, 0, 0]}>
      <SinglePanelSmallCell />
    </group>
  </Setup>
);
