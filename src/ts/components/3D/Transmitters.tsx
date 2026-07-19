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

/** Reserved geometry slot for Gemini's RTL-SDR model. */
export function RTLSdr({ position = [0, 0, 0], scale = 1 }: TransmitterProps) {
  return (
    <group position={position} scale={scale} userData={{ model: "RTL-SDR", placeholder: true }}>
      <mesh>
        <boxGeometry args={[1.2, 0.24, 0.55]} />
        <meshStandardMaterial color="#1b2730" wireframe />
      </mesh>
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
