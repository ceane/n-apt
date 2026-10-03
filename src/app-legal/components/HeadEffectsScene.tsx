import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { gsap } from 'gsap';
import { Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshStandardMaterial, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { clone as cloneSkinnedModel } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BRAIN_GLB_URL, HUMAN_MODEL_NEUTRAL_GLB_URL } from '@n-apt/three-d/modelAssetUrls';
import { attachModelWheelRotation } from '@n-apt/three-d/modelWheelRotation';
import { HeadScraggleEffect } from './HeadScraggleEffect';
import { HeadFurDotEffect } from './HeadFurDotEffect';
import { HeadClampEffect } from './HeadClampEffect';
import { HeadPipeEffect } from './HeadPipeEffect';
import { HeadPistonsEffect } from './HeadPistonsEffect';
import { HeadGhostsEffect } from './HeadGhostsEffect';
import { applyAPose } from './ghostRig';
import {
  HEAD_EFFECT_BLOB_DEFINITIONS,
  HEAD_EFFECT_APPEARANCE_STYLES,
  HEAD_EFFECT_BRAIN_OPACITY,
  HEAD_EFFECT_BRAIN_POSITION,
  HEAD_EFFECT_BRAIN_SCALE,
  HEAD_EFFECT_INACTIVE_COLOR,
  organicBlobRadius,
} from '../data/headEffectBlobs';

const MODEL_ROOT_POSITION: [number, number, number] = [0, 0.95, 0];
const HEADSHOT_POSITION: [number, number, number] = [0, 1.94, 0.67];
const HEADSHOT_TARGET: [number, number, number] = [0, 1.88, 0.01];

type HeadEffectsSceneProps = {
  selectedEffect?: string;
  appearanceStyle?: (typeof HEAD_EFFECT_APPEARANCE_STYLES)[number];
  onResetReady?: (reset: (() => void) | null) => void;
};

function HeadEffectsWheelRotation({ controlsRef }: { controlsRef: { current: any } }) {
  const { gl } = useThree();

  useEffect(() => attachModelWheelRotation(gl.domElement, () => controlsRef.current), [controlsRef, gl.domElement]);

  return null;
}

const BLOB_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uStyle;
  varying vec3 vBlobNormal;
  varying vec3 vBlobViewPosition;
  varying vec3 vBlobLocalPosition;
  varying vec2 vBlobUv;

  void main() {
    vBlobNormal = normalize(normalMatrix * normal);
    vBlobUv = uv;
    vBlobLocalPosition = position;
    vec3 animatedPosition = position;
    if (uStyle > 0.5 && uStyle < 1.5) {
      float swell = sin(uv.x * 11.0 + uTime * 0.85) * sin(uv.y * 12.0 - uTime * 0.7);
      float pile = sin(uv.x * 37.0 + uTime * 1.3) * sin(uv.y * 34.0 - uTime * 1.1);
      animatedPosition += normal * (swell * 0.032 + pile * 0.006);
    }
    vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    vBlobViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const BLOB_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uStyle;
  uniform float uActive;
  uniform float uShell;
  varying vec3 vBlobNormal;
  varying vec3 vBlobViewPosition;
  varying vec3 vBlobLocalPosition;
  varying vec2 vBlobUv;

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float noise21(vec2 point) {
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    fraction = fraction * fraction * (3.0 - 2.0 * fraction);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
  }

  float cloudNoise(vec2 point) {
    float value = 0.0;
    float weight = 0.5;
    for (int layer = 0; layer < 4; layer++) {
      value += weight * noise21(point);
      point = point * 2.03 + vec2(7.1, 3.7);
      weight *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 normal = normalize(vBlobNormal);
    vec3 viewDirection = normalize(-vBlobViewPosition);
    float facing = max(dot(normal, viewDirection), 0.0);
    vec3 color = uColor;
    float alpha = uOpacity;

    if (uShell > 0.5) {
      float fibers = noise21(vBlobUv * vec2(180.0, 142.0) + vec2(uTime * 0.28, -uTime * 0.34));
      float softPatches = cloudNoise(vBlobUv * vec2(55.0, 49.0));
      color = mix(uColor, vec3(0.86, 0.82, 0.91), 0.34) * (0.8 + softPatches * 0.25);
      alpha = uActive > 0.5 ? 0.34 * smoothstep(-0.05, 0.45, facing + (fibers - 0.5) * 0.5) * (0.3 + fibers * 0.7) : 0.0;
    } else if (uActive < 0.5) {
      alpha *= smoothstep(0.01, 0.36, facing);
    } else if (uStyle < 0.5) {
      vec3 lightDirection = normalize(vec3(-0.45, 0.7, 0.9));
      vec3 halfVector = normalize(lightDirection + viewDirection);
      float diffuse = max(dot(normal, lightDirection), 0.0);
      float specular = pow(max(dot(normal, halfVector), 0.0), 62.0);
      float brushed = sin(vBlobUv.y * 210.0 + sin(vBlobUv.x * 24.0) * 2.0) * 0.035;
      color = mix(vec3(0.28, 0.105, 0.012), vec3(0.99, 0.59, 0.095), 0.28 + diffuse * 0.72);
      color += vec3(1.0, 0.82, 0.34) * (specular * 0.7 + brushed);
      alpha = smoothstep(0.015, 0.14, facing);
    } else if (uStyle < 1.5) {
      vec2 pileUv = vBlobUv * vec2(86.0, 66.0);
      vec2 pileCell = floor(pileUv);
      vec2 jitter = vec2(hash21(pileCell), hash21(pileCell + vec2(13.0, 29.0))) * 0.48 - 0.24;
      vec2 tuftOffset = fract(pileUv) - 0.5 - jitter;
      float tuft = exp(-dot(tuftOffset, tuftOffset) * 9.0);
      float fineNap = noise21(vBlobUv * vec2(206.0, 174.0) + vec2(uTime * 0.2, -uTime * 0.3));
      float softPatches = cloudNoise(vBlobUv * vec2(16.0, 13.0) + vec2(uTime * 0.04, 0.0));
      float diffuse = max(dot(normal, normalize(vec3(-0.4, 0.7, 0.85))), 0.0);
      float velvetRim = pow(1.0 - facing, 1.8);
      color = mix(uColor * 0.52 + vec3(0.05, 0.04, 0.07), uColor * 1.14 + vec3(0.18, 0.16, 0.2), tuft * 0.67 + softPatches * 0.28);
      color *= 0.72 + diffuse * 0.28;
      color += vec3(0.18, 0.14, 0.21) * velvetRim * 0.48;
      alpha *= smoothstep(0.015, 0.38, facing + (fineNap - 0.5) * 0.17);
    } else {
      vec2 point = vBlobLocalPosition.xy;
      float radius = length(point);
      float angle = atan(point.y, point.x);
      float spiral = angle * 5.0 - radius * 23.0 - uTime * 2.0;
      float turbulence = cloudNoise(point * 5.0 + vec2(cos(angle + uTime * 0.55), sin(angle + uTime * 0.55)) * 1.6);
      float arms = 0.5 + 0.5 * sin(spiral + turbulence * 5.0);
      float vapor = smoothstep(0.26, 0.83, arms * 0.65 + turbulence * 0.6);
      float eye = smoothstep(0.08, 0.32, radius);
      color = mix(uColor * 0.27 + vec3(0.035, 0.06, 0.16), vec3(0.7, 0.86, 1.0), vapor);
      color += vec3(0.12, 0.2, 0.36) * turbulence;
      alpha *= smoothstep(0.02, 0.4, facing) * (0.55 + vapor * 0.45) * eye;
    }

    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

function createBlobMaterial(shell: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(HEAD_EFFECT_INACTIVE_COLOR) },
      uOpacity: { value: 0.58 },
      uTime: { value: 0 },
      uStyle: { value: 0 },
      uActive: { value: 0 },
      uShell: { value: shell ? 1 : 0 },
    },
    vertexShader: BLOB_VERTEX_SHADER,
    fragmentShader: BLOB_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

function TranslucentHead() {
  const { scene } = useGLTF(HUMAN_MODEL_NEUTRAL_GLB_URL);
  const translucentScene = useMemo(() => {
    const clone = cloneSkinnedModel(scene);
    applyAPose(clone, scene);
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

  useFrame(() => applyAPose(translucentScene, scene));

  return <primitive object={translucentScene} position={[0, -0.95, 0]} />;
}

function TranslucentBrain({ scene }: { scene: Group }) {
  const hologramTimeUniforms = useRef<{ value: number }[]>([]);
  const translucentScene = useMemo(() => {
    hologramTimeUniforms.current = [];
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const makeTranslucent = (material: MeshStandardMaterial) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.opacity = HEAD_EFFECT_BRAIN_OPACITY;
        copy.depthWrite = false;
        copy.onBeforeCompile = (shader) => {
          shader.uniforms.uHoloTime = { value: 0 };
          hologramTimeUniforms.current.push(shader.uniforms.uHoloTime);
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vHoloWorldPosition;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoloWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vHoloWorldPosition;\nuniform float uHoloTime;')
            .replace('#include <lights_fragment_end>', `
              #include <lights_fragment_end>
              vec3 holoColor = vec3(0.12, 0.78, 1.0);
              vec2 gridUv = vHoloWorldPosition.xz * 42.0;
              vec2 gridDistance = min(fract(gridUv), 1.0 - fract(gridUv));
              float gridLines = 1.0 - smoothstep(0.015, 0.075, min(gridDistance.x, gridDistance.y));
              float scan = 1.0 - smoothstep(0.0, 0.09, fract(vHoloWorldPosition.y * 54.0 - uHoloTime * 0.42));
              float rim = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 2.0);
              float outline = smoothstep(0.24, 0.78, rim);
              outgoingLight = mix(outgoingLight, holoColor, 0.14 + rim * 0.24);
              outgoingLight += holoColor * (gridLines * 0.22 + scan * 0.16 + rim * 0.2 + outline * 1.35);
              diffuseColor.a = max(diffuseColor.a, outline * 0.92);
            `);
        };
        copy.customProgramCacheKey = () => 'brain-hologram-v1';
        return copy;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => makeTranslucent(material as MeshStandardMaterial))
        : makeTranslucent(object.material as MeshStandardMaterial);
    });
    return clone;
  }, [scene]);

  useFrame(({ clock }) => {
    for (const uniform of hologramTimeUniforms.current) uniform.value = clock.elapsedTime;
  });

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
  appearanceStyle,
}: {
  effect: (typeof HEAD_EFFECT_BLOB_DEFINITIONS)[number];
  isActive: boolean;
  appearanceStyle?: (typeof HEAD_EFFECT_APPEARANCE_STYLES)[number];
}) {
  const blobRef = useRef<Mesh>(null);
  const elapsedRef = useRef(0);
  const palette = useMemo(() => effect.colors.map((color) => new Color(color)), [effect]);
  const material = useMemo(() => createBlobMaterial(false), []);
  const { geometry, basePositions } = useMemo(() => {
    const nextGeometry = new SphereGeometry(1, 64, 48);
    const positions = nextGeometry.getAttribute('position') as BufferAttribute;
    const base = new Float32Array(positions.array);
    deformBlobGeometry(nextGeometry, base, effect.seed, 0);
    return { geometry: nextGeometry, basePositions: base };
  }, [effect.seed]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  useEffect(() => {
    if (isActive) elapsedRef.current = 0;
  }, [isActive]);

  useFrame((_, delta) => {
    const blob = blobRef.current;
    if (!blob) return;
    const shader = blob.material as ShaderMaterial;
    const styleIndex = appearanceStyle === 'Vortex clouds' ? 2 : 0;
    shader.uniforms.uTime.value = elapsedRef.current;
    shader.uniforms.uStyle.value = styleIndex;
    shader.uniforms.uActive.value = isActive ? 1 : 0;
    if (!isActive) {
      blob.scale.setScalar(effect.radius * 0.8);
      shader.uniforms.uColor.value.set(HEAD_EFFECT_INACTIVE_COLOR);
      shader.uniforms.uOpacity.value = 0.58;
      return;
    }

    elapsedRef.current += delta;
    const elapsed = elapsedRef.current;
    deformBlobGeometry(geometry, basePositions, effect.seed, elapsed);
    const entrance = Math.min(elapsed / 0.65, 1);
    const easeOut = 1 - (1 - entrance) ** 3;
    const pulseX = 1 + Math.sin(elapsed * 2.4) * 0.11;
    const pulseY = 1 + Math.sin(elapsed * 2.4 + 0.9) * 0.11;
    blob.scale.set(effect.radius * easeOut * pulseX, effect.radius * easeOut * pulseY, effect.radius * 0.36 * easeOut);

    shader.uniforms.uOpacity.value = 0.95;
    const colorPosition = elapsed * 0.48;
    const colorIndex = Math.floor(colorPosition) % palette.length;
    const nextColorIndex = (colorIndex + 1) % palette.length;
    shader.uniforms.uColor.value.copy(palette[colorIndex]).lerp(palette[nextColorIndex], colorPosition % 1);
  });

  return (
    <mesh ref={blobRef} position={effect.position} geometry={geometry} material={material} renderOrder={2} />
  );
}

function EffectsScene({ selectedEffect, appearanceStyle, onResetReady }: HeadEffectsSceneProps) {
  const controlsRef = useRef<any>(null);
  const shakePlayedRef = useRef(false);
  const { scene: brainScene } = useGLTF(BRAIN_GLB_URL);
  const brainCollider = useMemo(() => {
    const brainRoot = new Group();
    brainRoot.position.set(...HEAD_EFFECT_BRAIN_POSITION);
    brainRoot.scale.setScalar(HEAD_EFFECT_BRAIN_SCALE);
    brainRoot.add(brainScene.clone(true));
    brainRoot.updateMatrixWorld(true);
    const brainBounds = new Box3().setFromObject(brainRoot);
    return {
      center: brainBounds.getCenter(new Vector3()).add(new Vector3(...MODEL_ROOT_POSITION)),
      radii: brainBounds.getSize(new Vector3()).multiplyScalar(0.5),
    };
  }, [brainScene]);
  const effect = HEAD_EFFECT_BLOB_DEFINITIONS.find(({ name }) => name === selectedEffect)
    ?? HEAD_EFFECT_BLOB_DEFINITIONS[0];
  const shakeCameraOnce = useCallback(() => {
    if (shakePlayedRef.current) return;
    const controls = controlsRef.current;
    if (!controls) return;
    shakePlayedRef.current = true;
    const cameraPosition = controls.object.position;
    const { x, y } = cameraPosition;
    const timeline = gsap.timeline({ onUpdate: () => controls.update() });
    timeline.to(cameraPosition, { x: x + 0.012, y: y - 0.007, duration: 0.045 })
      .to(cameraPosition, { x: x - 0.01, y: y + 0.006, duration: 0.05 })
      .to(cameraPosition, { x: x + 0.006, y: y - 0.004, duration: 0.06 })
      .to(cameraPosition, { x, y, duration: 0.11, ease: 'power2.out' });
  }, []);
  const resetCamera = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    gsap.killTweensOf(controls.object.position);
    gsap.killTweensOf(controls.target);
    const animation = {
      duration: 0.9,
      ease: 'power2.inOut',
      onUpdate: () => controls.update(),
    };
    gsap.to(controls.object.position, {
      ...animation,
      x: HEADSHOT_POSITION[0],
      y: HEADSHOT_POSITION[1],
      z: HEADSHOT_POSITION[2],
    });
    gsap.to(controls.target, {
      ...animation,
      x: HEADSHOT_TARGET[0],
      y: HEADSHOT_TARGET[1],
      z: HEADSHOT_TARGET[2],
    });
  }, []);

  useEffect(() => {
    onResetReady?.(resetCamera);
    return () => onResetReady?.(null);
  }, [onResetReady, resetCamera]);

  return (
    <group position={MODEL_ROOT_POSITION}>
      <TranslucentHead />
      <TranslucentBrain scene={brainScene} />
      {appearanceStyle === 'Scraggles' && selectedEffect
        ? <HeadScraggleEffect effect={effect} />
        : appearanceStyle === 'C-clamp' && selectedEffect
          ? <HeadClampEffect effect={effect} />
        : appearanceStyle === 'Water pipe' && selectedEffect
          ? <HeadPipeEffect effect={effect} />
        : appearanceStyle === 'Rusty pistons' && selectedEffect
          ? <HeadPistonsEffect effect={effect} onClap={shakeCameraOnce} />
        : appearanceStyle === 'Evil ghost'
          ? <HeadGhostsEffect variant="evil" brainCenter={brainCollider.center} brainRadii={brainCollider.radii} />
        : appearanceStyle === 'Peeking ghost'
          ? <HeadGhostsEffect variant="peeking" brainCenter={brainCollider.center} brainRadii={brainCollider.radii} />
        : appearanceStyle === 'Fur dot' && selectedEffect
          ? <HeadFurDotEffect effect={effect} />
          : <EffectBlob effect={effect} isActive={Boolean(selectedEffect)} appearanceStyle={appearanceStyle} />}
      <ambientLight intensity={1.25} />
      <directionalLight position={[1, 2.4, 3]} intensity={2.1} />
      <pointLight position={[-1.6, 2.2, 1.8]} color="#dce8ff" intensity={0.7} />
      <OrbitControls ref={controlsRef} makeDefault enableDamping enableRotate={false} target={HEADSHOT_TARGET} minDistance={0.42} maxDistance={1.55} />
      <HeadEffectsWheelRotation controlsRef={controlsRef} />
    </group>
  );
}

export function HeadEffectsScene({ selectedEffect, appearanceStyle, onResetReady }: HeadEffectsSceneProps) {
  return (
    <Canvas camera={{ position: HEADSHOT_POSITION, fov: 38 }}>
      <Suspense fallback={null}>
        <EffectsScene selectedEffect={selectedEffect} appearanceStyle={appearanceStyle} onResetReady={onResetReady} />
      </Suspense>
    </Canvas>
  );
}
