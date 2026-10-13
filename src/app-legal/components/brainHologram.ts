import { Group, Mesh, MeshStandardMaterial } from 'three';

type BrainHologramOptions = {
  opacity: number;
  outlineOpacity: number;
  outlineGlow: number;
  renderOrder: number;
  depthTest: boolean;
  cutoffY?: number;
};

export function createBrainHologram(source: Group, options: BrainHologramOptions) {
  const scene = source.clone(true);
  const timeUniforms: { value: number }[] = [];
  const materials: MeshStandardMaterial[] = [];

  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.renderOrder = options.renderOrder;
    const makeMaterial = (material: MeshStandardMaterial) => {
      const copy = material.clone();
      materials.push(copy);
      copy.transparent = true;
      copy.opacity = options.opacity;
      copy.depthTest = options.depthTest;
      copy.depthWrite = false;
      copy.onBeforeCompile = (shader) => {
        shader.uniforms.uHoloTime = { value: 0 };
        timeUniforms.push(shader.uniforms.uHoloTime);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vHoloWorldPosition;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoloWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vHoloWorldPosition;\nuniform float uHoloTime;')
          .replace('#include <opaque_fragment>', `
            vec3 holoColor = vec3(0.12, 0.78, 1.0);
            vec2 gridUv = vHoloWorldPosition.xz * 42.0;
            vec2 gridDistance = min(fract(gridUv), 1.0 - fract(gridUv));
            float gridLines = 1.0 - smoothstep(0.015, 0.075, min(gridDistance.x, gridDistance.y));
            float scan = 1.0 - smoothstep(0.0, 0.09, fract(vHoloWorldPosition.y * 54.0 - uHoloTime * 0.42));
            float rim = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 2.0);
            float outline = smoothstep(0.24, 0.78, rim);
            outgoingLight = mix(outgoingLight, holoColor, 0.14 + rim * 0.24);
            outgoingLight += holoColor * (gridLines * 0.22 + scan * 0.16 + rim * 0.2 + outline * ${options.outlineGlow});
            diffuseColor.a = max(diffuseColor.a, outline * ${options.outlineOpacity});
            ${options.cutoffY === undefined ? '' : `diffuseColor.a *= smoothstep(${options.cutoffY - 0.03}, ${options.cutoffY + 0.03}, vHoloWorldPosition.y);`}
            #include <opaque_fragment>
          `);
      };
      copy.customProgramCacheKey = () => `brain-hologram-v4-${options.outlineGlow}-${options.outlineOpacity}-${options.cutoffY ?? 'none'}`;
      return copy;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => makeMaterial(material as MeshStandardMaterial))
      : makeMaterial(object.material as MeshStandardMaterial);
  });

  return {
    scene,
    updateTime(time: number) {
      for (const uniform of timeUniforms) uniform.value = time;
    },
    dispose() {
      for (const material of materials) material.dispose();
    },
  };
}
