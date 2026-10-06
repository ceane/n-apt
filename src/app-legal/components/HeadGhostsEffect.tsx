import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Color, FrontSide, ShaderMaterial, Vector3 } from 'three';
import { HUMAN_GHOST_EXPRESSIVE_GLB_URL } from '@n-apt/three-d/modelAssetUrls';

import { animateGhostRig, applyAPose, createGhostRig } from './ghostRig';

const GHOST_VERTEX_SHADER = `
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  uniform float uBody;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vFade;
  varying float vDrapeFold;
  void main() {
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    // Fade follows the posed surface, leaving a short shoulder cap above the arm cut.
    float shoulderSpan = smoothstep(0.12, 0.5, abs(transformed.x));
    float folds = sin(transformed.x * 34.0 + transformed.z * 8.0) * 0.058
      + sin(transformed.x * 67.0 - transformed.z * 5.0) * 0.024;
    float drapeEdge = mix(1.4, 1.52, shoulderSpan) + folds;
    float drape = smoothstep(drapeEdge - 0.12, drapeEdge + 0.045, transformed.y)
      * (1.0 - smoothstep(0.5, 0.68, abs(transformed.x)));
    float armSide = smoothstep(0.18, 0.3, abs(transformed.x));
    float armBelowShoulder = 1.0 - smoothstep(1.42, 1.64, transformed.y);
    float armFade = 1.0 - armSide * armBelowShoulder;
    vFade = mix(1.0, drape * armFade, uBody);
    vDrapeFold = sin(transformed.x * 34.0 + transformed.z * 8.0);
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vec4 viewPosition = viewMatrix * worldPosition;
    vWorld = worldPosition.xyz;
    vNormal = normalize(normalMatrix * objectNormal);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const GHOST_FRAGMENT_SHADER = `
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uPresence;
  uniform float uCutoff;
  uniform float uBody;
  uniform float uBrainGlow;
  uniform vec3 uBrainCenter;
  uniform vec3 uBrainRadii;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vFade;
  varying float vDrapeFold;
  void main() {
    float shoulderFade = vFade * mix(smoothstep(uCutoff, uCutoff + 0.055, vWorld.y), 1.0, uBody);
    if (shoulderFade < 0.005) discard;
    vec3 normal = normalize(vNormal);
    float facing = max(dot(normal, normalize(vView)), 0.0);
    float rim = pow(1.0 - facing, 2.0);
    float keyLight = max(dot(normal, normalize(vec3(-0.42, 0.64, 0.64))), 0.0);
    float facialShade = 0.22 + keyLight * 0.78;
    float face = uBody * smoothstep(1.62, 1.78, vWorld.y);
    float facialContour = pow(1.0 - facing, 1.4);
    float sheen = pow(max(sin(vWorld.x * 26.0 + vWorld.y * 18.0 - uTime * 1.7), 0.0), 14.0);
    float breathing = 0.92 + sin(uTime * 1.5 + vWorld.y * 3.0) * 0.08;
    vec3 color = mix(uTint * facialShade, vec3(0.9, 0.98, 1.0), rim * 0.26 + sheen * 0.14);
    color *= 1.0 - face * facialContour * 0.52;
    vec3 brainSpace = (vWorld - uBrainCenter) / max(uBrainRadii, vec3(0.001));
    float brainSurfaceDistance = length(brainSpace);
    float insideBrain = 1.0 - smoothstep(0.76, 1.04, brainSurfaceDistance);
    float nearBrainSurface = 1.0 - smoothstep(0.04, 0.22, abs(brainSurfaceDistance - 1.0));
    float contact = max(insideBrain * 0.78, nearBrainSurface * 0.64) * uBrainGlow;
    vec3 contactLight = vec3(0.35, 0.9, 1.0);
    color = mix(color, vec3(0.78, 1.0, 1.0), contact * mix(0.18, 0.04, face));
    color += contactLight * contact * mix(0.16, 0.04, face);
    float drapeZone = uBody * (1.0 - smoothstep(1.38, 1.82, vWorld.y));
    float pleat = 0.58 + 0.42 * (0.5 + 0.5 * vDrapeFold);
    color *= mix(1.0, pleat, drapeZone);
    float drapeOpacity = 0.78 + 0.22 * (0.5 + 0.5 * vDrapeFold);
    float alpha = (0.76 + rim * 0.1 + sheen * 0.05 + contact * 0.08) * shoulderFade * mix(1.0, drapeOpacity, drapeZone) * breathing * uPresence;
    alpha = mix(alpha, 0.97 * shoulderFade, face);
    float scalp = face * smoothstep(1.92, 2.04, vWorld.y);
    alpha *= 1.0 - scalp * 0.86;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

function createGhostMaterial(tint: string, cutoff: number, brainCenter: Vector3, brainRadii: Vector3, body = false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBody: { value: body ? 1 : 0 },
      uTint: { value: new Color(tint) },
      uTime: { value: 0 },
      uPresence: { value: 1 },
      uCutoff: { value: cutoff },
      uBrainGlow: { value: body ? 1 : 0 },
      uBrainCenter: { value: brainCenter.clone() },
      uBrainRadii: { value: brainRadii.clone() },
    },
    vertexShader: GHOST_VERTEX_SHADER,
    fragmentShader: GHOST_FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: FrontSide,
  });
}

function GhostBust({ variant, brainCenter, brainRadii }: { variant: 'evil' | 'peeking'; brainCenter: Vector3; brainRadii: Vector3 }) {
  const peeking = variant === 'peeking';
  const tint = peeking ? '#3ba8b6' : '#8054b5';
  const { scene } = useGLTF(HUMAN_GHOST_EXPRESSIVE_GLB_URL);
  const material = useMemo(() => createGhostMaterial(tint, 1.58, brainCenter, brainRadii, true), [tint, brainCenter, brainRadii]);
  const rig = useMemo(() => {
    const result = createGhostRig(scene);
    for (const mesh of result.meshes) {
      mesh.material = material;
      mesh.renderOrder = 6;
    }
    return result;
  }, [scene, material]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    applyAPose(rig.scene, scene);
    material.uniforms.uTime.value += delta;
    const time = material.uniforms.uTime.value as number;
    const approach = animateGhostRig(rig, time, variant);
    material.uniforms.uPresence.value = peeking ? .9 + approach * .1 : 1;
  });

  return (
    <group position={[0, 1, 0.14]} scale={0.73}>
      <primitive object={rig.scene} position={[0, -1.95, 0]} dispose={null} />
    </group>
  );
}

export function HeadGhostsEffect({ variant, brainCenter, brainRadii }: { variant: 'evil' | 'peeking'; brainCenter: Vector3; brainRadii: Vector3 }) {
  return <GhostBust variant={variant} brainCenter={brainCenter} brainRadii={brainRadii} />;
}
