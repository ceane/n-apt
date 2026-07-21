import React from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";

export const TRANSMITTER_MODEL_NAMES = ["HackRF One", "RTL-SDR", "SDRplay"] as const;

type TransmitterProps = {
  position?: [number, number, number];
  scale?: number;
};

/** Reusable HackRF-shaped transmitter model. Keep scene effects outside this component. */
export function HackRFOne({ position = [0, 0, 0], scale = 1 }: TransmitterProps) {
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

export function SpinningHackRFOne({ speed = 0.8, ...props }: TransmitterProps & { speed?: number }) {
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

export function RTLSdr({ position = [0, 0, 0], scale = 1 }: TransmitterProps) {
  const pixelSize = 0.025;
  const textMap = [
    "XXX XXX X     XXX XXX XXX",
    "X X  X  X     X   X X X X",
    "XXX  X  X     XXX X X XXX",
    "X X  X  X       X X X X X",
    "X X  X  XXX   XXX XXX X X"
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
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.1} />
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
    </group>
  );
}

export function SpinningRTLSdr({ speed = 0.8, ...props }: TransmitterProps & { speed?: number }) {
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

/** Reserved geometry slot for a future SDRplay model. */
export function SDRplay({ position = [0, 0, 0], scale = 1 }: TransmitterProps) {
  return (
    <group position={position} scale={scale} userData={{ model: "SDRplay", placeholder: true }}>
      <mesh>
        <boxGeometry args={[1.3, 0.26, 0.65]} />
        <meshStandardMaterial color="#24303a" wireframe />
      </mesh>
    </group>
  );
}

export type TransmitterModel = (typeof TRANSMITTER_MODEL_NAMES)[number];

export function Transmitters({ model, ...props }: TransmitterProps & { model: TransmitterModel }) {
  if (model === "RTL-SDR") return <RTLSdr {...props} />;
  if (model === "SDRplay") return <SDRplay {...props} />;
  return <HackRFOne {...props} />;
}

/** SDR capability namespaces: tx is transmit-capable; rx is receive-only. */
export const SDRs = {
  tx: { HackRFOne, SpinningHackRFOne },
  rx: { RTLSdr, SpinningRTLSdr, SDRplay },
} as const;
