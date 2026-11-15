import { Object3D } from "three";
import type { Material, Mesh } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export const createAnatomyFigureScene = (
  source: Object3D,
  opacity = 0.34,
): Object3D => {
  // A normal Object3D clone shares the original skeleton bindings; the
  // expressive ghost is skinned, so clone its bones and meshes together.
  const scene = clone(source);
  scene.traverse((object) => {
    if (!(object as Mesh).isMesh) return;
    const mesh = object as Mesh;
    const soften = (material: Material): Material => {
      const translucent = material.clone();
      translucent.transparent = true;
      translucent.opacity = opacity;
      translucent.depthWrite = false;
      translucent.needsUpdate = true;
      return translucent;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(soften)
      : soften(mesh.material);
  });
  return scene;
};

export const disposeAnatomyFigureScene = (scene: Object3D): void => {
  scene.traverse((object) => {
    if (!(object as Mesh).isMesh) return;
    const { material } = object as Mesh;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  });
};
