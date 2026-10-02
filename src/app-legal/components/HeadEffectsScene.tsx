import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { BRAIN_GLB_URL, HUMAN_MODEL_NEUTRAL_GLB_URL } from '@n-apt/three-d/modelAssetUrls';
import {
  HEAD_EFFECT_BLOB_DEFINITIONS,
  HEAD_EFFECT_BRAIN_OPACITY,
  HEAD_EFFECT_BRAIN_POSITION,
  HEAD_EFFECT_BRAIN_SCALE,
  HEAD_EFFECT_INACTIVE_COLOR,
  organicBlobRadius,
} from '../data/headEffectBlobs';

const MODEL_ROOT_POSITION: [number, number, number] = [0, 0.95, 0];
const HEADSHOT_POSITION: [number, number, number] = [0, 1.95, 0.52];
const HEADSHOT_TARGET: [number, number, number] = [0, 1.94, 0.01];

type HeadEffectsSceneProps = {
  selectedEffect?: string;
};

function TranslucentHead() {
  const { scene } = useGLTF(HUMAN_MODEL_NEUTRAL_GLB_URL);
  const translucentScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const makeTranslucent = (material: MeshStandardMaterial) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.opacity = 0.18;
        copy.depthWrite = false;
        return copy;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => makeTranslucent(material as MeshStandardMaterial))
        : makeTranslucent(object.material as MeshStandardMaterial);
    });
    return clone;
  }, [scene]);

  return <primitive object={translucentScene} position={[0, -0.95, 0]} />;
}

function TranslucentBrain() {
  const { scene } = useGLTF(BRAIN_GLB_URL);
  const translucentScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const makeTranslucent = (material: MeshStandardMaterial) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.opacity = HEAD_EFFECT_BRAIN_OPACITY;
        copy.depthWrite = false;
        return copy;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => makeTranslucent(material as MeshStandardMaterial))
        : makeTranslucent(object.material as MeshStandardMaterial);
    });
    return clone;
  }, [scene]);

  return (
    <primitive
      object={translucentScene}
      position={HEAD_EFFECT_BRAIN_POSITION}
      scale={[HEAD_EFFECT_BRAIN_SCALE, HEAD_EFFECT_BRAIN_SCALE, HEAD_EFFECT_BRAIN_SCALE]}
    />
  );
}

function deformBlobGeometry(geometry: BufferGeometry, basePositions: Float32Array, seed: number, elapsed: number) {
  const positions = geometry.getAttribute('position') as BufferAttribute;
  for (let index = 0; index < basePositions.length; index += 3) {
    const x = basePositions[index];
    const y = basePositions[index + 1];
    const z = basePositions[index + 2];
    const angle = Math.atan2(y, x);
    const contour = organicBlobRadius(angle, seed, elapsed);
    const depth = 0.76 + Math.sin(angle * 3 + seed) * z * 0.06;
    positions.setXYZ(index / 3, x * contour, y * contour, z * contour * depth);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

function EffectBlob({
  effect,
  isActive,
}: {
  effect: (typeof HEAD_EFFECT_BLOB_DEFINITIONS)[number];
  isActive: boolean;
}) {
  const blobRef = useRef<Mesh>(null);
  const elapsedRef = useRef(0);
  const palette = useMemo(() => effect.colors.map((color) => new Color(color)), [effect]);
  const { geometry, basePositions } = useMemo(() => {
    const nextGeometry = new SphereGeometry(1, 40, 28);
    const positions = nextGeometry.getAttribute('position') as BufferAttribute;
    const base = new Float32Array(positions.array);
    deformBlobGeometry(nextGeometry, base, effect.seed, 0);
    return { geometry: nextGeometry, basePositions: base };
  }, [effect.seed]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    if (isActive) elapsedRef.current = 0;
  }, [isActive]);

  useFrame((_, delta) => {
    const blob = blobRef.current;
    if (!blob) return;
    const material = blob.material as MeshStandardMaterial;
    if (!isActive) {
      blob.scale.setScalar(effect.radius * 0.8);
      material.color.set(HEAD_EFFECT_INACTIVE_COLOR);
      material.opacity = 0.58;
      return;
    }

    elapsedRef.current += delta;
    const elapsed = elapsedRef.current;
    deformBlobGeometry(geometry, basePositions, effect.seed, elapsed);
    const entrance = Math.min(elapsed / 0.65, 1);
    const easeOut = 1 - (1 - entrance) ** 3;
    const pulseX = 1 + Math.sin(elapsed * 2.4) * 0.11;
    const pulseY = 1 + Math.sin(elapsed * 2.4 + 0.9) * 0.11;
    blob.scale.set(effect.radius * easeOut * pulseX, effect.radius * easeOut * pulseY, effect.radius * 0.76 * easeOut);

    material.opacity = 0.95;
    const colorPosition = elapsed * 0.48;
    const colorIndex = Math.floor(colorPosition) % palette.length;
    const nextColorIndex = (colorIndex + 1) % palette.length;
    material.color.copy(palette[colorIndex]).lerp(palette[nextColorIndex], colorPosition % 1);
  });

  return (
    <mesh ref={blobRef} position={effect.position} geometry={geometry}>
      <meshStandardMaterial color={HEAD_EFFECT_INACTIVE_COLOR} transparent opacity={0.58} roughness={0.32} metalness={0.04} />
    </mesh>
  );
}

function EffectsScene({ selectedEffect }: HeadEffectsSceneProps) {
  const effect = HEAD_EFFECT_BLOB_DEFINITIONS.find(({ name }) => name === selectedEffect)
    ?? HEAD_EFFECT_BLOB_DEFINITIONS[0];

  return (
    <group position={MODEL_ROOT_POSITION}>
      <TranslucentHead />
      <TranslucentBrain />
      <EffectBlob effect={effect} isActive={Boolean(selectedEffect)} />
      <ambientLight intensity={1.25} />
      <directionalLight position={[1, 2.4, 3]} intensity={2.1} />
      <pointLight position={[-1.6, 2.2, 1.8]} color="#dce8ff" intensity={0.7} />
      <OrbitControls makeDefault enableDamping enableRotate={false} target={HEADSHOT_TARGET} minDistance={0.42} maxDistance={0.9} />
    </group>
  );
}

export function HeadEffectsScene({ selectedEffect }: HeadEffectsSceneProps) {
  return (
    <Canvas camera={{ position: HEADSHOT_POSITION, fov: 34 }}>
      <Suspense fallback={null}>
        <EffectsScene selectedEffect={selectedEffect} />
      </Suspense>
    </Canvas>
  );
}
