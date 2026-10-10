import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  DataTexture, Group, LinearFilter, Mesh, MeshStandardMaterial, RGBAFormat,
  RepeatWrapping, SRGBColorSpace, UnsignedByteType, Vector3,
} from 'three';

type Effect = { position: readonly [number, number, number] };

const CYCLE_SECONDS = 2.4;
const CLOSED_GAP = 0.008;
const OPEN_GAP = 0.043;
const UP = new Vector3(0, 1, 0);

function positionLink(mesh: Mesh | null, start: Vector3, end: Vector3): void {
  if (!mesh) return;
  const direction = end.clone().sub(start);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
  mesh.scale.y = direction.length();
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function pistonGap(phase: number): number {
  if (phase < 0.35) return OPEN_GAP + (CLOSED_GAP - OPEN_GAP) * smoothstep(phase / 0.35);
  if (phase < 0.43) return CLOSED_GAP;
  if (phase < 0.78) return CLOSED_GAP + (OPEN_GAP - CLOSED_GAP) * smoothstep((phase - 0.43) / 0.35);
  return OPEN_GAP;
}

function createRustMaterial(): MeshStandardMaterial {
  const size = 96;
  const pixels = new Uint8Array(size * size * 4);
  const noise = (x: number, y: number) => {
    const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return value - Math.floor(value);
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coarse = noise(Math.floor(x / 9), Math.floor(y / 9));
      const grain = noise(x, y);
      const stain = Math.max(0, Math.min(1, coarse * 0.75 + grain * 0.35 - 0.12));
      const offset = (y * size + x) * 4;
      pixels[offset] = 73 + stain * 104;
      pixels[offset + 1] = 82 - stain * 25;
      pixels[offset + 2] = 91 - stain * 59;
      pixels[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const material = new MeshStandardMaterial({ map: texture, metalness: 0.42, roughness: 0.76, transparent: true, depthTest: false, depthWrite: false });
  return material;
}

export function HeadPistonsEffect({ effect, onClap }: { effect: Effect; onClap: () => void }) {
  const rust = useMemo(createRustMaterial, []);
  const leftHeadRef = useRef<Group>(null);
  const rightHeadRef = useRef<Group>(null);
  const leftRodRef = useRef<Mesh>(null);
  const rightRodRef = useRef<Mesh>(null);
  const rotorRef = useRef<Group>(null);
  const crankRef = useRef<Group>(null);
  const leftLinkRef = useRef<Mesh>(null);
  const rightLinkRef = useRef<Mesh>(null);
  const elapsedRef = useRef(0);
  const clapCountRef = useRef(0);
  const closedRef = useRef(false);
  const shookRef = useRef(false);

  useEffect(() => () => {
    rust.map?.dispose();
    rust.dispose();
  }, [rust]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const phase = (elapsedRef.current % CYCLE_SECONDS) / CYCLE_SECONDS;
    const crankAngle = elapsedRef.current * Math.PI * 2 / CYCLE_SECONDS;
    const gap = pistonGap(phase);
    if (rotorRef.current) rotorRef.current.rotation.z = elapsedRef.current * 0.34;
    if (crankRef.current) crankRef.current.rotation.z = crankAngle;
    const closed = phase >= 0.35 && phase < 0.43;
    if (closed && !closedRef.current) {
      clapCountRef.current += 1;
      if (clapCountRef.current === 3 && !shookRef.current) {
        shookRef.current = true;
        onClap();
      }
    }
    closedRef.current = closed;

    if (leftHeadRef.current) leftHeadRef.current.position.x = -gap;
    if (rightHeadRef.current) rightHeadRef.current.position.x = gap;
    const rodLength = 0.064 - gap;
    if (leftRodRef.current) {
      leftRodRef.current.position.x = (-0.064 - gap) / 2;
      leftRodRef.current.scale.y = rodLength;
    }
    if (rightRodRef.current) {
      rightRodRef.current.position.x = (0.064 + gap) / 2;
      rightRodRef.current.scale.y = rodLength;
    }
    positionLink(leftLinkRef.current,
      new Vector3(-gap, 0, -0.008),
      new Vector3(-Math.cos(crankAngle) * 0.046, -Math.sin(crankAngle) * 0.046, -0.022));
    positionLink(rightLinkRef.current,
      new Vector3(gap, 0, -0.008),
      new Vector3(Math.cos(crankAngle) * 0.046, Math.sin(crankAngle) * 0.046, -0.022));
  });

  return (
    <group position={[effect.position[0], effect.position[1], 0.13]}>
      <group ref={rotorRef} scale={0.82}>
      <group ref={crankRef} position={[0, 0, -0.026]}>
        <mesh material={rust} renderOrder={4}>
          <torusGeometry args={[0.056, 0.006, 10, 48]} />
        </mesh>
        {[0, Math.PI / 2].map((rotation) => (
          <mesh key={rotation} rotation={[0, 0, rotation]} renderOrder={4}>
            <boxGeometry args={[0.104, 0.009, 0.009]} />
            <meshStandardMaterial color="#8e6757" metalness={0.5} roughness={0.65} transparent depthTest={false} depthWrite={false} />
          </mesh>
        ))}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.046, 0, 0.007]} renderOrder={5}>
            <sphereGeometry args={[0.009, 14, 10]} />
            <meshStandardMaterial color="#c19b6d" metalness={0.65} roughness={0.48} transparent depthTest={false} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh ref={leftLinkRef} renderOrder={6}>
        <cylinderGeometry args={[0.0045, 0.0045, 1, 10]} />
        <meshStandardMaterial color="#92705e" metalness={0.6} roughness={0.58} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <mesh ref={rightLinkRef} renderOrder={6}>
        <cylinderGeometry args={[0.0045, 0.0045, 1, 10]} />
        <meshStandardMaterial color="#92705e" metalness={0.6} roughness={0.58} transparent depthTest={false} depthWrite={false} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.098, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={rust} renderOrder={5}>
            <cylinderGeometry args={[0.022, 0.022, 0.069, 24]} />
          </mesh>
          {[0.068, 0.126].map((offset) => (
            <mesh key={offset} position={[side * offset, 0, 0]} rotation={[0, Math.PI / 2, 0]} renderOrder={6}>
              <torusGeometry args={[0.022, 0.003, 7, 24]} />
              <meshStandardMaterial color="#7f5747" metalness={0.55} roughness={0.7} transparent depthTest={false} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh ref={leftRodRef} position={[-0.055, 0, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={7}>
        <cylinderGeometry args={[0.007, 0.007, 1, 14]} />
        <meshStandardMaterial color="#b0a396" metalness={0.75} roughness={0.35} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <mesh ref={rightRodRef} position={[0.055, 0, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={7}>
        <cylinderGeometry args={[0.007, 0.007, 1, 14]} />
        <meshStandardMaterial color="#b0a396" metalness={0.75} roughness={0.35} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <group ref={leftHeadRef} position={[-OPEN_GAP, 0, 0]}>
        <mesh material={rust} renderOrder={8}>
          <boxGeometry args={[0.016, 0.055, 0.05]} />
        </mesh>
        <mesh position={[0.009, 0, 0]} renderOrder={9}>
          <boxGeometry args={[0.002, 0.047, 0.044]} />
          <meshStandardMaterial color="#67554e" metalness={0.48} roughness={0.8} transparent depthTest={false} depthWrite={false} />
        </mesh>
      </group>
      <group ref={rightHeadRef} position={[OPEN_GAP, 0, 0]}>
        <mesh material={rust} renderOrder={8}>
          <boxGeometry args={[0.016, 0.055, 0.05]} />
        </mesh>
        <mesh position={[-0.009, 0, 0]} renderOrder={9}>
          <boxGeometry args={[0.002, 0.047, 0.044]} />
          <meshStandardMaterial color="#67554e" metalness={0.48} roughness={0.8} transparent depthTest={false} depthWrite={false} />
        </mesh>
      </group>
      </group>
    </group>
  );
}
