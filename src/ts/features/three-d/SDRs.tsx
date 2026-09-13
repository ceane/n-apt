import React from "react";
import { useFrame } from "@react-three/fiber";
import { CatmullRomCurve3, Vector3 } from "three";
import type { Group } from "three";

export const TRANSMITTER_MODEL_NAMES = [
  "HackRF One",
  "RTL-SDR",
  "SDRplay",
] as const;

type TransmitterProps = {
  position?: [number, number, number];
  scale?: number;
};

type RTLSdrProps = TransmitterProps & {
  withAntenna?: boolean;
};

/** Reusable HackRF-shaped transmitter model. Keep scene effects outside this component. */
export function HackRFOne({
  position = [0, 0, 0],
  scale = 1,
}: TransmitterProps) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, -0.14, 0]} castShadow>
        <boxGeometry args={[1.5, 0.6, 1]} />
        <meshStandardMaterial color="#111111" roughness={0.5} />
      </mesh>
      <mesh position={[-0.8, 0, 0.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.2]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.8} />
      </mesh>
      <mesh position={[-0.75, 0, 0.5]}>
        <sphereGeometry args={[0.06]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      <mesh position={[-0.75, 1, 0.5]}>
        <cylinderGeometry args={[0.03, 0.03, 2]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      <mesh position={[0.8, 0, -0.4]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.1]} />
        <meshStandardMaterial color="#dd0000" />
      </mesh>
      <mesh position={[0.8, 0, 0.4]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.1]} />
        <meshStandardMaterial color="#dd0000" />
      </mesh>
    </group>
  );
}

export function SpinningHackRFOne({
  speed = 0.8,
  ...props
}: TransmitterProps & { speed?: number }) {
  const ref = React.useRef<Group>(null);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });

  return (
    <group ref={ref}>
      <HackRFOne {...props} />
    </group>
  );
}

function TelescopingAntenna({
  position,
  tilt = 0,
}: {
  position: [number, number, number];
  tilt?: number;
}) {
  return (
    <group position={position}>
      <group rotation={[0, 0, tilt]}>
        <mesh position={[0, 0.24, 0]} castShadow>
          <cylinderGeometry args={[0.065, 0.08, 0.48, 12]} />
          <meshStandardMaterial
            color="#bfc4c7"
            metalness={0.9}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 0.62, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.055, 0.3, 12]} />
          <meshStandardMaterial
            color="#e1e4e5"
            metalness={0.92}
            roughness={0.2}
          />
        </mesh>
        <mesh position={[0, 0.91, 0]} castShadow>
          <cylinderGeometry args={[0.025, 0.035, 0.28, 12]} />
          <meshStandardMaterial
            color="#aeb4b8"
            metalness={0.9}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 1.07, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.055, 0.06, 12]} />
          <meshStandardMaterial
            color="#d8dcde"
            metalness={0.9}
            roughness={0.2}
          />
        </mesh>
      </group>
    </group>
  );
}

function WireFedAntenna() {
  const cable = React.useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(-0.78, 0, 0),
        new Vector3(-1.02, -0.03, 0.02),
        new Vector3(-1.22, -0.14, 0.04),
        new Vector3(-1.42, -0.1, 0.04),
      ]),
    [],
  );

  return (
    <>
      <mesh>
        <tubeGeometry args={[cable, 32, 0.035, 8, false]} />
        <meshStandardMaterial color="#161616" roughness={0.65} />
      </mesh>
      <mesh position={[-0.82, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.16, 12]} />
        <meshStandardMaterial
          color="#d4af37"
          metalness={0.9}
          roughness={0.25}
        />
      </mesh>
      <mesh position={[-1.42, -0.1, 0.04]}>
        <cylinderGeometry args={[0.11, 0.13, 0.12, 12]} />
        <meshStandardMaterial color="#202020" roughness={0.7} />
      </mesh>
      <mesh position={[-1.42, 0.04, 0.04]}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial color="#202020" roughness={0.65} />
      </mesh>
      <TelescopingAntenna position={[-1.42, -0.03, 0.04]} tilt={-0.32} />
      <TelescopingAntenna position={[-1.42, -0.03, 0.04]} tilt={0.32} />
    </>
  );
}

export function RTLSdr({
  position = [0, 0, 0],
  scale = 1,
  withAntenna = false,
}: RTLSdrProps) {
  const pixelSize = 0.025;
  const textMap = [
    "XXX XXX X     XXX XXX XXX",
    "X X  X  X     X   X X X X",
    "XXX  X  X     XXX X X XXX",
    "X X  X  X       X X X X X",
    "X X  X  XXX   XXX XXX X X",
  ];
  const pixels: [number, number][] = [];
  textMap.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "X") {
        pixels.push([x, -y]);
      }
    }
  });

  return (
    <group position={position} scale={scale} userData={{ model: "RTL-SDR" }}>
      {/* Main Body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[1.2, 0.25, 0.55]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.7} />
      </mesh>

      {/* USB Connector */}
      <mesh position={[0.75, 0, 0]}>
        <boxGeometry args={[0.3, 0.12, 0.3]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* USB Connector Details (holes) */}
      <mesh position={[0.75, 0.061, 0.08]}>
        <boxGeometry args={[0.04, 0.01, 0.04]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      <mesh position={[0.75, 0.061, -0.08]}>
        <boxGeometry args={[0.04, 0.01, 0.04]} />
        <meshStandardMaterial color="#222222" />
      </mesh>

      {/* SMA Connector (Gold) */}
      <mesh position={[-0.62, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.1, 0.05, 6]} />
        <meshStandardMaterial color="#d4af37" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[-0.7, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.15]} />
        <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.4} />
      </mesh>
      <mesh position={[-0.78, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.02]} />
        <meshStandardMaterial color="#222222" />
      </mesh>

      {/* Pixilated Text */}
      <group position={[-0.3, 0.126, 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        {pixels.map((p, i) => (
          <mesh key={i} position={[p[0] * pixelSize, p[1] * pixelSize, 0]}>
            <boxGeometry args={[pixelSize * 0.9, pixelSize * 0.9, 0.005]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.1}
            />
          </mesh>
        ))}
      </group>

      {/* Case Ridges */}
      <group position={[0, 0.126, -0.15]}>
        {[-0.2, -0.1, 0, 0.1, 0.2].map((x, i) => (
          <mesh key={i} position={[x, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <boxGeometry args={[0.02, 0.15, 0.005]} />
            <meshStandardMaterial color="#0a0a0a" />
          </mesh>
        ))}
      </group>

      {withAntenna && <WireFedAntenna />}
    </group>
  );
}

export function RTLSdrWithAntenna(props: Omit<RTLSdrProps, "withAntenna">) {
  return <RTLSdr {...props} withAntenna />;
}

export function SpinningRTLSdr({
  speed = 0.8,
  ...props
}: RTLSdrProps & { speed?: number }) {
  const ref = React.useRef<Group>(null);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });

  return (
    <group ref={ref}>
      <RTLSdr {...props} />
    </group>
  );
}

export function SpinningRTLSdrWithAntenna(
  props: Omit<RTLSdrProps, "withAntenna"> & { speed?: number },
) {
  return <SpinningRTLSdr {...props} withAntenna />;
}

/** Reserved geometry slot for a future SDRplay model. */
export function SDRplay({ position = [0, 0, 0], scale = 1 }: TransmitterProps) {
  return (
    <group
      position={position}
      scale={scale}
      userData={{ model: "SDRplay", placeholder: true }}
    >
      <mesh>
        <boxGeometry args={[1.3, 0.26, 0.65]} />
        <meshStandardMaterial color="#24303a" wireframe />
      </mesh>
    </group>
  );
}

export type TransmitterModel = (typeof TRANSMITTER_MODEL_NAMES)[number];

export function Transmitters({
  model,
  ...props
}: TransmitterProps & { model: TransmitterModel }) {
  if (model === "RTL-SDR") return <RTLSdr {...props} />;
  if (model === "SDRplay") return <SDRplay {...props} />;
  return <HackRFOne {...props} />;
}

/** SDR capability namespaces: tx is transmit-capable; rx is receive-only. */
export const SDRs = {
  tx: { HackRFOne, SpinningHackRFOne },
  rx: {
    RTLSdr,
    RTLSdrWithAntenna,
    SpinningRTLSdr,
    SpinningRTLSdrWithAntenna,
    SDRplay,
  },
} as const;
