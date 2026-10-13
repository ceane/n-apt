import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ExtrudeGeometry, Group, Shape } from 'three';

type Effect = { position: readonly [number, number, number] };

// The brain is translucent and rendered after opaque meshes. Put the clamp in
// front of it, then draw its metal surfaces in the transparent pass.
export const CLAMP_FRONT_DEPTH = 0.13;

function createClampFrame(): ExtrudeGeometry {
  const outline = new Shape();
  outline.moveTo(0.34, 0.34);
  outline.lineTo(-0.22, 0.34);
  outline.quadraticCurveTo(-0.42, 0.34, -0.42, 0.14);
  outline.lineTo(-0.42, -0.16);
  outline.quadraticCurveTo(-0.42, -0.34, -0.24, -0.34);
  outline.lineTo(0.34, -0.34);
  outline.lineTo(0.34, -0.22);
  outline.lineTo(-0.23, -0.22);
  outline.quadraticCurveTo(-0.30, -0.22, -0.30, -0.14);
  outline.lineTo(-0.30, 0.14);
  outline.quadraticCurveTo(-0.30, 0.22, -0.22, 0.22);
  outline.lineTo(0.34, 0.22);
  outline.closePath();
  const geometry = new ExtrudeGeometry(outline, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 3, steps: 1 });
  geometry.center();
  return geometry;
}

export function HeadClampEffect({ effect }: { effect: Effect }) {
  const frameGeometry = useMemo(createClampFrame, []);
  const screwRef = useRef<Group>(null);
  const elapsedRef = useRef(0);

  useEffect(() => () => frameGeometry.dispose(), [frameGeometry]);

  useFrame((_, delta) => {
    const screw = screwRef.current;
    if (!screw) return;
    elapsedRef.current += delta;
    const phase = elapsedRef.current * 0.85;
    // One revolution advances the screw; reversing it opens the clamp again.
    const travel = (1 - Math.cos(phase)) * 0.055;
    screw.position.y = travel;
    screw.rotation.y = Math.sin(phase) * Math.PI * 1.8;
  });

  const steel = { color: '#a5adb8', metalness: 0.8, roughness: 0.3 } as const;
  const darkSteel = { color: '#59616c', metalness: 0.78, roughness: 0.4 } as const;

  return (
    <group position={[effect.position[0], effect.position[1], CLAMP_FRONT_DEPTH]} scale={0.10} rotation={[0.08, -0.22, 0]}>
      <mesh geometry={frameGeometry} renderOrder={5}>
        <meshStandardMaterial {...steel} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={[0.30, 0.18, 0.01]} renderOrder={6}>
        <cylinderGeometry args={[0.075, 0.075, 0.08, 20]} />
        <meshStandardMaterial {...darkSteel} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <group ref={screwRef} position={[0.30, 0, 0.01]}>
        <mesh position={[0, -0.27, 0]} renderOrder={6}>
          <cylinderGeometry args={[0.029, 0.029, 0.64, 16]} />
          <meshStandardMaterial {...steel} transparent depthTest={false} depthWrite={false} />
        </mesh>
        {Array.from({ length: 13 }, (_, index) => (
          <mesh key={index} position={[0, -0.55 + index * 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={7}>
            <torusGeometry args={[0.031, 0.005, 5, 16]} />
            <meshStandardMaterial {...darkSteel} transparent depthTest={false} depthWrite={false} />
          </mesh>
        ))}
        <mesh position={[0, 0.04, 0]} renderOrder={7}>
          <sphereGeometry args={[0.055, 16, 12]} />
          <meshStandardMaterial {...steel} transparent depthTest={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, -0.61, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={7}>
          <cylinderGeometry args={[0.016, 0.016, 0.42, 12]} />
          <meshStandardMaterial {...darkSteel} transparent depthTest={false} depthWrite={false} />
        </mesh>
        {[-0.21, 0.21].map((offset) => (
          <mesh key={offset} position={[offset, -0.61, 0]} renderOrder={8}>
            <sphereGeometry args={[0.027, 12, 8]} />
            <meshStandardMaterial {...steel} transparent depthTest={false} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
