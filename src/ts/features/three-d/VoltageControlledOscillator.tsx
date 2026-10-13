import React, { useMemo } from "react";
import { Box, Cylinder, Line, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function Spark({ start, end, branchSide = 1, phase, frequencyHz }: {
  start: [number, number, number];
  end: [number, number, number];
  branchSide?: number;
  phase: number;
  frequencyHz: number;
}) {
  const coreRef = React.useRef<any>(null);
  const coronaRef = React.useRef<any>(null);
  const branchRef = React.useRef<any>(null);
  const flareRef = React.useRef<THREE.PointLight>(null);
  const lightRef = React.useRef<THREE.PointLight>(null);
  const seed = React.useMemo(() => phase * 91.7 + start[0] * 17.3 + end[2] * 31.1, [phase, start, end]);
  const makeBoltPoints = React.useCallback((time: number, branch = false) => {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
    const count = branch ? 5 : 15;
    const result: THREE.Vector3[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const envelope = Math.sin(Math.PI * t);
      const jitterA = Math.sin(seed + i * 19.17 + time * 1.7);
      const jitterB = Math.sin(seed * 0.73 + i * 31.71 - time * 2.1);
      const point = from.clone().lerp(to, t);
      if (i > 0 && i < count) {
        point.addScaledVector(side, envelope * jitterA * 0.11);
        point.y += envelope * jitterB * 0.055;
      }
      if (branch && i > count * 0.3) {
        const progress = (i - count * 0.3) / (count * 0.7);
        point.addScaledVector(side, branchSide * progress * 0.2);
        point.y += progress * 0.13;
      }
      result.push(point);
    }
    return result;
  }, [start, end, seed, branchSide]);

  useFrame(({ clock }) => {
    const rate = 4 + Math.min(frequencyHz, 10000) / 1700;
    const phasePosition = (clock.elapsedTime * rate + phase) % 1;
    const pulse = Math.pow(Math.max(0, Math.sin(phasePosition * Math.PI)), 1.7);
    const updateLine = (object: THREE.Object3D | null, positions: THREE.Vector3[], opacity: number) => {
      const line = object as (THREE.Line & { material: THREE.LineBasicMaterial }) | null;
      if (!line) return;
      line.geometry.setFromPoints(positions);
      (line.material as THREE.LineBasicMaterial).opacity = opacity;
    };
    updateLine(coreRef.current, makeBoltPoints(clock.elapsedTime), 0.35 + pulse * 0.65);
    updateLine(coronaRef.current, makeBoltPoints(clock.elapsedTime), 0.2 + pulse * 0.55);
    updateLine(branchRef.current, makeBoltPoints(clock.elapsedTime, true), 0.16 + pulse * 0.72);
    if (lightRef.current) lightRef.current.intensity = 0.15 + pulse * 4;
    if (flareRef.current) flareRef.current.intensity = 0.04 + pulse * 1.1;
  });
  return <>
    <Line ref={coronaRef} points={makeBoltPoints(0)} color="#168bff" lineWidth={1} transparent opacity={0.7} depthWrite={false} />
    <Line ref={coreRef} points={makeBoltPoints(0)} color="#ffffff" lineWidth={1} transparent opacity={1} depthWrite={false} />
    <Line ref={branchRef} points={makeBoltPoints(0, true)} color="#c9efff" lineWidth={1} transparent opacity={0.9} depthWrite={false} />
    <pointLight ref={lightRef} position={end} color="#56baff" distance={2.2} decay={2} intensity={0.2} />
    <pointLight ref={flareRef} position={start} color="#b9eaff" distance={0.9} decay={2} intensity={0.1} />
    <SparkBranch start={start} end={end} phase={phase + 0.18} frequencyHz={frequencyHz} side={-branchSide} />
  </>;
}

function SparkBranch({ start, end, phase, frequencyHz, side }: {
  start: [number, number, number]; end: [number, number, number]; phase: number; frequencyHz: number; side: number;
}) {
  const coreRef = React.useRef<any>(null);
  const glowRef = React.useRef<any>(null);
  const geometry = React.useMemo(() => new THREE.BufferGeometry(), []);
  const material = React.useMemo(() => new THREE.LineBasicMaterial({ color: "#e7f7ff", transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }), []);
  const glowMaterial = React.useMemo(() => new THREE.LineBasicMaterial({ color: "#238fff", transparent: true, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false }), []);
  const seed = start[0] * 53 + end[2] * 17 + phase;
  useFrame(({ clock }) => {
    const rate = 4 + Math.min(frequencyHz, 10000) / 1700;
    const pulse = Math.pow(Math.max(0, Math.sin((clock.elapsedTime * rate + phase) * Math.PI)), 1.7);
    const from = new THREE.Vector3(...start).lerp(new THREE.Vector3(...end), 0.36 + 0.28 * Math.sin(seed));
    const to = from.clone().add(new THREE.Vector3(side * (0.18 + 0.12 * Math.sin(seed * 2)), 0.08 + 0.08 * Math.cos(seed), side * 0.16));
    const bolt: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const p = from.clone().lerp(to, t);
      if (i > 0 && i < 6) p.add(new THREE.Vector3(Math.sin(clock.elapsedTime * 14 + seed + i * 4) * 0.04, Math.sin(i * 6 + seed) * 0.035, Math.cos(clock.elapsedTime * 11 + seed + i) * 0.045));
      bolt.push(p);
    }
    for (const object of [glowRef.current, coreRef.current]) {
      if (!object) continue;
      (object.geometry as THREE.BufferGeometry).setFromPoints(bolt);
    }
    if (coreRef.current) (coreRef.current.material as THREE.LineBasicMaterial).opacity = 0.08 + pulse * 0.9;
    if (glowRef.current) (glowRef.current.material as THREE.LineBasicMaterial).opacity = 0.04 + pulse * 0.55;
  });
  React.useEffect(() => () => { geometry.dispose(); material.dispose(); glowMaterial.dispose(); }, [geometry, material, glowMaterial]);
  return <>
    <primitive ref={glowRef} object={new THREE.Line(geometry, glowMaterial)} />
    <primitive ref={coreRef} object={new THREE.Line(geometry, material)} />
  </>;
}

export function VoltageControlledOscillator({ frequencyHz = 1000 }: { frequencyHz?: number }) {
  const board = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0d583a", roughness: 0.82 }), []);
  const chip = useMemo(() => new THREE.MeshStandardMaterial({ color: "#171d27", roughness: 0.32, metalness: 0.35 }), []);
  const gold = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c8a85a", metalness: 0.8, roughness: 0.25 }), []);
  const crystalCan = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9ca6ad", metalness: 0.88, roughness: 0.24 }), []);
  const crystalCap = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c2c9cd", metalness: 0.78, roughness: 0.28 }), []);
  const crystalInsulator = useMemo(() => new THREE.MeshStandardMaterial({ color: "#171a1d", metalness: 0.25, roughness: 0.6 }), []);
  const knobRotation = -0.9 + ((frequencyHz - 100) / 9900) * 1.8;

  return <group rotation={[-0.22, 0.12, 0]}>
    <Box args={[5.8, 0.18, 3.7]} position={[0, -0.13, 0]} material={board} />
    <Box args={[5.8, 0.08, 3.7]} position={[0, -0.02, 0]} material={new THREE.MeshStandardMaterial({ color: "#123b30", metalness: 0.3 })} />
    {/* Oscillator IC and voltage-control stage */}
    <Box args={[1.65, 0.42, 1.3]} position={[0.15, 0.29, 0.05]} material={chip} />
    <Text position={[0.15, 0.62, 0.05]} fontSize={0.16} color="#e0e8ee" anchorX="center" anchorY="middle" outlineWidth={0.008} outlineColor="#171d27" outlineOpacity={0.42} depthOffset={-2}>VCO · CORE</Text>
    {[-0.48, -0.16, 0.16, 0.48].flatMap((x) => [-0.78, 0.78].map((z) => <Box key={`${x}-${z}`} args={[0.08, 0.16, 0.07]} position={[0.15 + x, 0.2, z + 0.05]} material={gold} />))}
    <Box args={[0.58, 0.35, 0.42]} position={[-1.35, 0.22, 0.3]} material={chip} />
    <Text position={[-1.35, 0.52, 0.3]} fontSize={0.12} color="#e0e8ee" anchorX="center" anchorY="middle" outlineWidth={0.008} outlineColor="#171d27" outlineOpacity={0.42} depthOffset={-2}>CV IN</Text>
    {/* HC-49 style hermetic quartz timing crystal, with two load capacitors */}
    <Box args={[0.58, 0.09, 0.7]} position={[1.42, 0.1, -0.62]} material={crystalInsulator} />
    <Cylinder args={[0.19, 0.19, 0.56, 32]} rotation={[Math.PI / 2, 0, 0]} position={[1.42, 0.52, -0.62]} material={crystalCan} />
    <Cylinder args={[0.175, 0.175, 0.018, 32]} rotation={[Math.PI / 2, 0, 0]} position={[1.42, 0.52, -0.91]} material={crystalCap} />
    <Cylinder args={[0.175, 0.175, 0.018, 32]} rotation={[Math.PI / 2, 0, 0]} position={[1.42, 0.52, -0.33]} material={crystalCap} />
    <Cylinder args={[0.025, 0.025, 0.34, 10]} position={[1.3, 0.15, -0.62]} material={gold} />
    <Cylinder args={[0.025, 0.025, 0.34, 10]} position={[1.54, 0.15, -0.62]} material={gold} />
    <Text position={[1.42, 0.91, -0.62]} fontSize={0.11} lineHeight={1.15} textAlign="center" color="#d9f7ff" anchorX="center" anchorY="middle" outlineWidth={0.006} outlineColor="#10202a" outlineOpacity={0.38} depthOffset={-2}>QUARTZ CRYSTAL{"\n"}RESONATOR</Text>
    <Box args={[0.16, 0.12, 0.16]} position={[1.06, 0.11, -0.98]} material={chip} />
    <Box args={[0.16, 0.12, 0.16]} position={[1.78, 0.11, -0.26]} material={chip} />
    <Text position={[1.06, 0.23, -0.98]} fontSize={0.065} color="#e0e8ee" anchorX="center">C1</Text>
    <Text position={[1.78, 0.23, -0.26]} fontSize={0.065} color="#e0e8ee" anchorX="center">C2</Text>
    {/* Large frequency tuning knob */}
    <Cylinder args={[0.5, 0.55, 0.32, 40]} position={[-2.05, 0.25, -0.85]} material={chip} />
    <Cylinder args={[0.34, 0.34, 0.12, 40]} position={[-2.05, 0.47, -0.85]} rotation={[0, knobRotation, 0]} material={gold} />
    <Box args={[0.045, 0.035, 0.27]} position={[-2.05 + 0.15 * Math.sin(knobRotation), 0.545, -0.85 + 0.15 * Math.cos(knobRotation)]} material={new THREE.MeshBasicMaterial({ color: "#fff1a6" })} />
    <Text position={[-2.05, 0.75, -0.85]} fontSize={0.13} color="#ffe59b" anchorX="center">FREQUENCY</Text>
    {/* Copper traces carry the oscillation around the board to the output */}
    <Line points={[[-1.05, 0.12, 0.3], [-0.78, 0.12, 0.3], [-0.78, 0.12, 0.05], [-0.68, 0.12, 0.05]]} color="#e6a94c" lineWidth={2} />
    <Line points={[[0.98, 0.12, 0.05], [1.05, 0.12, 0.05], [1.05, 0.12, 0.92], [2.05, 0.12, 0.92]]} color="#e6a94c" lineWidth={2} />
    <Line points={[[1.8, 0.18, 0.92], [2.05, 0.18, 0.92], [2.05, 0.48, 0.92], [2.38, 0.18, 0.92]]} color="#a8f2ff" lineWidth={3} />
    <Text position={[2.3, 0.55, 0.92]} fontSize={0.13} color="#a8f2ff" anchorX="center">SINE OUT</Text>
    <Spark phase={0} frequencyHz={frequencyHz} start={[0.82, 0.34, 0.05]} end={[1.08, 0.34, 0.92]} branchSide={1} />
    <Spark phase={0.35} frequencyHz={frequencyHz} start={[1.08, 0.34, 0.92]} end={[2.04, 0.34, 0.92]} branchSide={-1} />
    <Spark phase={0.7} frequencyHz={frequencyHz} start={[2.04, 0.34, 0.92]} end={[2.38, 0.4, 0.92]} branchSide={1} />
    {/* SMD passives and gold vias */}
    {Array.from({ length: 12 }, (_, i) => <React.Fragment key={i}>
      <Box args={[0.2, 0.12, 0.12]} position={[-2.35 + (i % 6) * 0.75, 0.13, 1.25 - Math.floor(i / 6) * 2.5]} material={i % 3 === 0 ? gold : chip} />
      <Cylinder args={[0.06, 0.06, 0.025, 12]} position={[-2.65 + (i % 6) * 0.95, 0.08, 1.53 - Math.floor(i / 6) * 3.06]} material={gold} />
    </React.Fragment>)}
    <OrbitingSignal frequencyHz={frequencyHz} />
  </group>;
}

function OrbitingSignal({ frequencyHz }: { frequencyHz: number }) {
  const ref = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const cycle = (clock.elapsedTime * (0.18 + Math.min(frequencyHz, 10000) / 20000)) % 1;
    ref.current.position.set(-0.78 + 2.83 * cycle, 0.24 + 0.06 * Math.sin(clock.elapsedTime * 12), 0.05);
  });
  return <mesh ref={ref}><sphereGeometry args={[0.085, 16, 16]} /><meshBasicMaterial color="#aaffdc" toneMapped={false} /></mesh>;
}
