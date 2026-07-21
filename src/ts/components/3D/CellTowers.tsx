import { forwardRef } from "react";
import type { ThreeElements } from "@react-three/fiber";
import { Group } from "three";

// Materials
const MAT_POLE = (
  <meshStandardMaterial color="#888888" metalness={0.6} roughness={0.4} />
);
const MAT_PANEL = <meshStandardMaterial color="#eeeeee" roughness={0.2} />;
const MAT_BOX = <meshStandardMaterial color="#dddddd" roughness={0.5} />;
const MAT_WIRE = <meshStandardMaterial color="#333333" roughness={0.8} />;

type GroupProps = ThreeElements["group"];

// Wire helper component to flawlessly connect two 3D points
const Wire = ({
  start,
  end,
}: {
  start: [number, number, number];
  end: [number, number, number];
}) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const midX = (start[0] + end[0]) / 2;
  const midY = (start[1] + end[1]) / 2;
  const midZ = (start[2] + end[2]) / 2;

  // Calculate rotations so the cylinder (natively Y-up) aligns with the vector
  const pitch = Math.atan2(Math.sqrt(dx * dx + dz * dz), dy);
  const yaw = Math.atan2(dx, dz);

  return (
    <mesh position={[midX, midY, midZ]} rotation={[pitch, yaw, 0]}>
      <cylinderGeometry args={[0.02, 0.02, distance, 8]} />
      {MAT_WIRE}
    </mesh>
  );
};

export type TowerType =
  | "none"
  | "sector"
  | "diamond"
  | "pole_small"
  | "hexagonal"
  | "single_panel";

export interface TowerConfig {
  id: TowerType;
  name: string;
  antennaOrigin: [number, number, number];
  antennaRotation: [number, number, number];
  antennaSize: {
    width: number;
    height: number;
    depth: number;
  };
  emitterFaces: [number, number, number][];
}

export const TOWER_CONFIGS: Record<TowerType, TowerConfig> = {
  none: {
    id: "none",
    name: "No Tower (Floating)",
    antennaOrigin: [0, 5, 0],
    antennaRotation: [0, 0, 0],
    antennaSize: { width: 1.4, height: 3.9, depth: 0.12 },
    emitterFaces: [[0, 5, 0]],
  },
  sector: {
    id: "sector",
    name: "Sector Tower",
    antennaOrigin: [1.3, 9, 0], // Exactly at the front face of the center panel
    antennaRotation: [0, 0, 0],
    antennaSize: { width: 0.55, height: 2.5, depth: 0.1 },
    emitterFaces: [
      [1.25, 9, -1.2],
      [1.25, 9, 0],
      [1.25, 9, 1.2],
    ],
  },
  diamond: {
    id: "diamond",
    name: "Diamond Cell",
    antennaOrigin: [0.85, 6.5, 1], // Center of diamond face
    antennaRotation: [0, 0, 0],
    antennaSize: { width: 1.8, height: 1.8, depth: 0.1 },
    emitterFaces: [[0.85, 6.5, 1]],
  },
  pole_small: {
    id: "pole_small",
    name: "Pole-mounted Small Cell",
    antennaOrigin: [0.3, 9.25, 0], // Front face of the omni-directional top cylinder (radius 0.3)
    antennaRotation: [0, 0, 0],
    antennaSize: { width: 0.6, height: 1.5, depth: 0.6 },
    emitterFaces: [[0.3, 9.25, 0]],
  },
  hexagonal: {
    id: "hexagonal",
    name: "Hexagonal Small Cell",
    antennaOrigin: [0.55, 10, 0], // Front face of the hex cylinder
    antennaRotation: [0, 0, 0],
    antennaSize: { width: 1.04, height: 2, depth: 1.2 },
    emitterFaces: [
      [0.52, 10, 0], // North
      [0.26, 10, -0.45], // NW
      [0.26, 10, 0.45], // NE
      [-0.52, 10, 0], // South
      [-0.26, 10, -0.45], // SW
      [-0.26, 10, 0.45], // SE
    ],
  },
  single_panel: {
    id: "single_panel",
    name: "Single-panel Small Cell",
    antennaOrigin: [0.45, 8.5, 0], // Exact front face of the panel
    antennaRotation: [0, 0, 0],
    antennaSize: { width: 0.6, height: 2, depth: 0.1 },
    emitterFaces: [[0.45, 8.5, 0]],
  },
};

export const resolveTowerType = (value: unknown): TowerType => {
  if (typeof value !== "string") {
    return "none";
  }

  if (value in TOWER_CONFIGS) {
    return value as TowerType;
  }

  return (
    Object.values(TOWER_CONFIGS).find((config) => config.name === value)?.id ??
    "none"
  );
};

export const SectorTower = forwardRef<Group, GroupProps>((props, ref) => (
  <group ref={ref} {...props}>
    {/* Main Pole resting perfectly on floor (height=10, so y=5) */}
    <mesh position={[0, 5, 0]}>
      <cylinderGeometry args={[0.3, 0.4, 10, 16]} />
      {MAT_POLE}
    </mesh>

    {/* Rectangular Equipment Box flat against side of pole, on the pole */}
    <mesh position={[-0.45, 4, 0]}>
      <boxGeometry args={[0.6, 1.5, 0.8]} />
      {MAT_BOX}
    </mesh>

    {/* Upper and lower triangle frames */}
    {[8.2, 9.8].map((yHeight, idx) => (
      <group key={`frame-height-${idx}`}>
        {/* 3 Faces of the triangle (crossbars) */}
        {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle, i) => (
          <group key={`face-${i}`} rotation={[0, angle, 0]}>
            <mesh position={[1.15, yHeight, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 4.0, 8]} />
              {MAT_POLE}
            </mesh>
          </group>
        ))}
        {/* 3 Corner Struts connecting to the pole */}
        {[Math.PI / 3, Math.PI, (Math.PI * 5) / 3].map((angle, i) => (
          <group key={`strut-${i}`} rotation={[0, angle, 0]}>
            <mesh position={[1.15, yHeight, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.04, 0.04, 2.3, 8]} />
              {MAT_POLE}
            </mesh>
          </group>
        ))}
      </group>
    ))}

    {/* 3 Faces * 3 Panels = 9 Panels Total */}
    {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle, i) => (
      <group key={i} rotation={[0, angle, 0]}>
        {[-1.2, 0, 1.2].map((zOffset) => (
          <group key={zOffset} position={[0, 0, zOffset]}>
            {/* Panel */}
            <mesh position={[1.2, 9, 0]}>
              <boxGeometry args={[0.1, 2.5, 0.55]} />
              {MAT_PANEL}
            </mesh>
            {/* Vertical mounting pipe behind the panel */}
            <mesh position={[1.15, 9, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 2.0, 8]} />
              {MAT_POLE}
            </mesh>
            {/* Panel mounting brackets (top/bottom) attaching panel to vertical pipe */}
            <mesh position={[1.175, 9.8, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.02, 0.02, 0.05, 8]} />
              {MAT_POLE}
            </mesh>
            <mesh position={[1.175, 8.2, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.02, 0.02, 0.05, 8]} />
              {MAT_POLE}
            </mesh>
          </group>
        ))}
      </group>
    ))}
  </group>
));

export const DiamondCell = forwardRef<Group, GroupProps>((props, ref) => (
  <group ref={ref} {...props}>
    {/* Large Rectangular Cabinet at the base (height=5 => y=2.5) */}
    <mesh position={[0, 2.5, 0]}>
      <boxGeometry args={[1.5, 5, 4]} />
      {MAT_BOX}
    </mesh>

    {/* Small Box on top right (-Z) */}
    <mesh position={[0, 6, -1]}>
      <boxGeometry args={[1.2, 2, 1.5]} />
      {MAT_BOX}
    </mesh>

    {/* Mast on top left (+Z) */}
    <mesh position={[0, 6, 1]}>
      <cylinderGeometry args={[0.2, 0.2, 2, 16]} />
      {MAT_POLE}
    </mesh>

    {/* Diamond panel facing +X natively. Rotated to form a diamond. */}
    <group position={[0.8, 6.5, 1]} rotation={[0, Math.PI / 2, 0]}>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[1.8, 1.8, 0.1]} />
        {MAT_PANEL}
      </mesh>
    </group>

    {/* Short strut connecting mast to panel */}
    <mesh position={[0.4, 6.5, 1]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.08, 0.08, 0.8, 8]} />
      {MAT_POLE}
    </mesh>

    {/* Wire from back of diamond antenna strut down to the small box */}
    <Wire start={[0.3, 6.5, 1]} end={[0, 7, -1]} />
  </group>
));

export const PoleMountedSmallCell = forwardRef<Group, GroupProps>(
  (props, ref) => (
    <group ref={ref} {...props}>
      {/* Street Light Pole Base */}
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 8, 16]} />
        {MAT_POLE}
      </mesh>

      {/* Street light arm & fixture (Re-added lamp component from earlier) */}
      <mesh position={[-1.5, 6, 0]} rotation={[0, 0, Math.PI / 2.2]}>
        <cylinderGeometry args={[0.05, 0.1, 3, 16]} />
        {MAT_POLE}
      </mesh>
      <mesh position={[-3, 5.9, 0]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.2, 0.2, 0.8, 4, 8] as any} />
        <meshStandardMaterial color="#aaa" />
      </mesh>

      {/* Rectangular Equipment Box flat against side of pole */}
      <mesh position={[-0.25, 4.5, 0]}>
        <boxGeometry args={[0.4, 1.2, 0.5]} />
        {MAT_BOX}
      </mesh>

      {/* Wire from box up to the top antenna body */}
      <Wire start={[-0.2, 5.1, 0]} end={[-0.15, 8, 0]} />

      {/* Funnel/Cone transition from pole to antenna */}
      <mesh position={[0, 8.25, 0]}>
        <cylinderGeometry args={[0.3, 0.15, 0.5, 16]} />
        <meshStandardMaterial color="#666666" roughness={0.7} />
      </mesh>

      {/* Top Cylinder Antenna */}
      <mesh position={[0, 9.25, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 1.5, 16]} />
        <meshStandardMaterial color="#777777" roughness={0.6} />
      </mesh>

      {/* Top Cap */}
      <mesh position={[0, 10.05, 0]}>
        <cylinderGeometry args={[0.25, 0.3, 0.1, 16]} />
        <meshStandardMaterial color="#555555" roughness={0.8} />
      </mesh>
    </group>
  ),
);

export const HexagonalSmallCell = forwardRef<Group, GroupProps>(
  (props, ref) => (
    <group ref={ref} {...props}>
      {/* Pole (height=9 => y=4.5) */}
      <mesh position={[0, 4.5, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 9, 16]} />
        {MAT_POLE}
      </mesh>

      {/* Rectangular Bottom Equipment Box on pole */}
      <mesh position={[-0.35, 4, 0]}>
        <boxGeometry args={[0.4, 1.5, 0.5]} />
        {MAT_BOX}
      </mesh>

      {/* Rectangular Top Equipment Box on pole */}
      <mesh position={[-0.35, 6.5, 0]}>
        <boxGeometry args={[0.4, 1.5, 0.5]} />
        {MAT_BOX}
      </mesh>

      {/* Hexagonal Antenna pointing exactly +X */}
      <mesh position={[0, 10, 0]} rotation={[0, 0, 0]}>
        {/*
        To make the hexagonal faces well-defined, we're doing two things:
        1. Using a slightly darker material so lights interact better.
        2. In meshStandardMaterial, if we specify flatShading={true}, Three.js will render faces flat.
           However, cylinderGeometry natively creates smooth normals on the sides. We can force flat faces 
           by switching out standard material config, or relying on lighting with lower roughness.
      */}
        <cylinderGeometry args={[0.6, 0.6, 2, 6]} />
        <meshStandardMaterial
          color="#dddddd"
          roughness={0.6}
          flatShading={true}
        />
      </mesh>

      {/* Top cap */}
      <mesh position={[0, 11, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.1, 16]} />
        {MAT_POLE}
      </mesh>

      {/* Wires connected to underside of hex body and routing perfectly down to boxes */}
      <Wire start={[-0.2, 9, 0]} end={[-0.35, 7.25, 0]} />
      <Wire start={[-0.35, 5.75, 0]} end={[-0.35, 4.75, 0]} />
    </group>
  ),
);

export const SinglePanelSmallCell = forwardRef<Group, GroupProps>(
  (props, ref) => (
    <group ref={ref} {...props}>
      {/* Pole (height=8 => y=4) */}
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[0.15, 0.2, 8, 16]} />
        {MAT_POLE}
      </mesh>

      {/* Rectangular Equipment Box on pole */}
      <mesh position={[-0.25, 4.5, 0]}>
        <boxGeometry args={[0.4, 1.2, 0.5]} />
        {MAT_BOX}
      </mesh>

      {/* Top Panel Mount */}
      <mesh position={[0.1, 8.5, 0]}>
        <boxGeometry args={[0.2, 0.5, 0.2]} />
        {MAT_POLE}
      </mesh>

      {/* Rectangular Panel Antenna facing +X */}
      <mesh position={[0.25, 8.5, 0]}>
        <boxGeometry args={[0.1, 2, 0.6]} />
        {MAT_PANEL}
      </mesh>

      {/* Wire from direct back of antenna down to box top */}
      <Wire start={[0.2, 8.25, 0]} end={[-0.25, 5.1, 0]} />
    </group>
  ),
);
