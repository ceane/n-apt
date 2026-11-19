import React, { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { BRAIN_POSITION, BRAIN_SCALE } from "@n-apt/consts";
import { BRAIN_GLB_URL } from "@n-apt/three-d";
import { Box3, Vector3 } from "three";
import type { Material, Mesh } from "three";

function Brain({
  children,
  position = BRAIN_POSITION,
  scale = BRAIN_SCALE,
  rotation = [0, 0, 0] as const,
  opacity = 1,
  centerAt,
}: {
  children?: React.ReactNode;
  position?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  opacity?: number;
  centerAt?: readonly [number, number, number];
}) {
  const { scene } = useGLTF(BRAIN_GLB_URL);
  const sceneCenter = useMemo(() => {
    const bounds = new Box3().setFromObject(scene);
    return bounds.getCenter(new Vector3());
  }, [scene]);
  const displayScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      const translucent = (material: Material): Material => {
        const cloneMaterial = material.clone();
        cloneMaterial.transparent = opacity < 1;
        cloneMaterial.opacity = opacity;
        cloneMaterial.depthWrite = opacity >= 1;
        cloneMaterial.needsUpdate = true;
        return cloneMaterial;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(translucent)
        : translucent(mesh.material);
    });
    return clone;
  }, [opacity, scene]);
  useEffect(() => () => {
    if (displayScene === scene) return;
    displayScene.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const { material } = object as Mesh;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    });
  }, [displayScene, scene]);

  return centerAt ? (
    <group position={centerAt} rotation={rotation} scale={scale}>
      <group position={[-sceneCenter.x, -sceneCenter.y, -sceneCenter.z]}>
        <primitive object={displayScene} />
        <group position={sceneCenter}>{children}</group>
      </group>
    </group>
  ) : (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={displayScene} />
      {children}
    </group>
  );
}

export default Brain;
