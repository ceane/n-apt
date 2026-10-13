import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, Group, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { HEAD_EFFECT_FUR_CORE_RADIUS, HEAD_EFFECT_FUR_LENGTH } from '../data/headEffectBlobs';

const FUR_COUNT = 900;
const UP = new Vector3(0, 1, 0);

type Effect = {
  position: readonly [number, number, number];
  colors: readonly string[];
};

export function HeadFurDotEffect({ effect }: { effect: Effect }) {
  const groupRef = useRef<Group>(null);
  const furRef = useRef<InstancedMesh>(null);
  const coreMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.36, metalness: 0.22, transparent: true, depthTest: false, depthWrite: false }), []);
  const furMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.62, metalness: 0.08, side: DoubleSide, transparent: true, depthTest: false, depthWrite: false }), []);
  const palette = useMemo(() => effect.colors.map((value) => new Color(value)), [effect.colors]);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const fur = furRef.current;
    if (!fur) return;
    const strand = new Object3D();
    const normal = new Vector3();
    for (let index = 0; index < FUR_COUNT; index += 1) {
      const y = 1 - (index + 0.5) * 2 / FUR_COUNT;
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const radial = Math.sqrt(1 - y * y);
      normal.set(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
      const lengthVariation = 0.7 + ((index * 37) % 101) / 101 * 0.55;
      strand.position.copy(normal).multiplyScalar(HEAD_EFFECT_FUR_CORE_RADIUS + HEAD_EFFECT_FUR_LENGTH * 0.35);
      strand.quaternion.setFromUnitVectors(UP, normal);
      strand.scale.set(1, lengthVariation, 1);
      strand.updateMatrix();
      fur.setMatrixAt(index, strand.matrix);
    }
    fur.instanceMatrix.needsUpdate = true;
  }, []);

  useEffect(() => () => {
    coreMaterial.dispose();
    furMaterial.dispose();
  }, [coreMaterial, furMaterial]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    elapsedRef.current += delta;
    const elapsed = elapsedRef.current;
    const entrance = 1 - (1 - Math.min(elapsed / 0.6, 1)) ** 3;
    // A uniform scale keeps the dot round even while it turns.
    group.scale.setScalar(entrance * (1 + Math.sin(elapsed * 2.1) * 0.018));
    group.rotation.y = Math.sin(elapsed * 0.35) * 0.18;
    const position = elapsed * 0.48;
    const colorIndex = Math.floor(position) % palette.length;
    const color = palette[colorIndex].clone().lerp(palette[(colorIndex + 1) % palette.length], position % 1);
    coreMaterial.color.copy(color);
    coreMaterial.emissive.copy(color).multiplyScalar(0.42);
    furMaterial.color.copy(color).lerp(new Color('#ffffff'), 0.28);
    furMaterial.emissive.copy(color).multiplyScalar(0.35);
  });

  return (
    <group ref={groupRef} position={effect.position} scale={0}>
      <mesh material={coreMaterial} renderOrder={5}>
        <sphereGeometry args={[HEAD_EFFECT_FUR_CORE_RADIUS, 32, 24]} />
      </mesh>
      <instancedMesh ref={furRef} args={[undefined, undefined, FUR_COUNT]} material={furMaterial} renderOrder={6}>
        <coneGeometry args={[0.0011, HEAD_EFFECT_FUR_LENGTH, 3]} />
      </instancedMesh>
    </group>
  );
}
