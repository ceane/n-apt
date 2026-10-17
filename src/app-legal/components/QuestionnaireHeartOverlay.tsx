import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, Group, Mesh, MeshStandardMaterial } from 'three';
import { HEART_GLB_URL } from '@n-apt/three-d/modelAssetUrls';
import { MODEL_ROOT_POSITION } from '@n-apt/consts';

const HEART_MARKER_POSITION: [number, number, number] = [0.095, 1.55, 0.151];
const HEART_PULSE_GLOW = new Color('#ff1824');

export function heartBeatPulse(time: number) {
  const phase = time % 1.05;
  const firstBeat = Math.exp(-(((phase - 0.12) / 0.065) ** 2) * 0.5);
  const secondBeat = Math.exp(-(((phase - 0.31) / 0.085) ** 2) * 0.5) * 0.62;
  return Math.min(1, firstBeat + secondBeat);
}

export function QuestionnaireHeartOverlay() {
  const { scene } = useGLTF(HEART_GLB_URL);
  const pulseGroup = useRef<Group>(null);
  const heart = useMemo(() => {
    const clone = scene.clone(true);
    const materials: { material: MeshStandardMaterial; emissive: Color; intensity: number }[] = [];
    clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const cloneMaterial = (material: MeshStandardMaterial) => {
        const copy = material.clone();
        // Keep the heart readable while letting the translucent hands show through it.
        copy.transparent = true;
        copy.opacity = 0.78;
        copy.depthWrite = false;
        materials.push({ material: copy, emissive: copy.emissive.clone(), intensity: copy.emissiveIntensity });
        return copy;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => cloneMaterial(material as MeshStandardMaterial))
        : cloneMaterial(object.material as MeshStandardMaterial);
    });
    return { scene: clone, materials };
  }, [scene]);

  useFrame(({ clock }) => {
    const pulse = heartBeatPulse(clock.elapsedTime);
    if (pulseGroup.current) pulseGroup.current.scale.setScalar(0.9 * (1 + pulse * 0.14));
    for (const { material, emissive, intensity } of heart.materials) {
      material.emissive.copy(emissive).lerp(HEART_PULSE_GLOW, pulse * 0.9);
      material.emissiveIntensity = intensity + pulse * 1.7;
    }
  });

  return (
    <group
      ref={pulseGroup}
      position={[0.095, 1.55 - MODEL_ROOT_POSITION[1] - 0.074, 0.10]}
      scale={0.9}
    >
      <primitive object={heart.scene} />
    </group>
  );
}

export function QuestionnaireHeartCircle() {
  return (
    <mesh position={[
      HEART_MARKER_POSITION[0] - MODEL_ROOT_POSITION[0],
      HEART_MARKER_POSITION[1] - MODEL_ROOT_POSITION[1],
      HEART_MARKER_POSITION[2] - MODEL_ROOT_POSITION[2],
    ]}>
      <sphereGeometry args={[0.032 * 1.55 * 1.8, 24, 24]} />
      <meshStandardMaterial
        color="#2563eb"
        emissive="#2563eb"
        emissiveIntensity={0.6}
        transparent
        opacity={0.2}
        depthWrite={false}
      />
    </mesh>
  );
}
