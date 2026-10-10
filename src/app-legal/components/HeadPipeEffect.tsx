import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Object3D, ShaderMaterial } from 'three';

type Effect = { position: readonly [number, number, number] };

const PIPE_RADIUS = 0.055;
const PIPE_LENGTH = 0.145;
const WATER_RADIUS = 0.043;
const STREAK_COUNT = 66;
const BUBBLE_COUNT = 42;
const LEAK_COUNT = 28;
const STEAM_COUNT = 220;
const SEAMS = [PIPE_LENGTH / 2, 0.038, -0.038, -PIPE_LENGTH / 2];

const WATER_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const WATER_FRAGMENT_SHADER = `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x), f.y);
  }
  float flowNoise(vec2 p) {
    float value = 0.0;
    float weight = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise(p) * weight;
      p = p * 2.07 + vec2(3.8, 5.1);
      weight *= 0.5;
    }
    return value;
  }
  void main() {
    // Increasing the texture offset moves each feature from top to bottom.
    vec2 flow = vec2(vUv.x * 8.0, vUv.y * 13.0 + uTime * 3.4);
    float turbulence = flowNoise(flow * vec2(0.9, 0.7));
    float fine = flowNoise(flow * vec2(3.4, 2.2) + vec2(turbulence * 3.0, 0.0));
    float current = sin(vUv.y * 105.0 + uTime * 23.0 + turbulence * 9.0 + sin(vUv.x * 22.0) * 1.5);
    float whitewater = smoothstep(0.43, 0.86, fine * 0.7 + current * 0.18 + turbulence * 0.25);
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.8);
    vec3 color = mix(vec3(0.025, 0.36, 0.59), vec3(0.29, 0.79, 0.94), turbulence * 0.7 + fine * 0.3);
    color = mix(color, vec3(0.78, 0.96, 1.0), whitewater * 0.76 + rim * 0.3);
    float endFade = smoothstep(0.0, 0.045, vUv.y) * smoothstep(0.0, 0.045, 1.0 - vUv.y);
    gl_FragColor = vec4(color, (0.39 + whitewater * 0.22 + rim * 0.12) * endFade);
    #include <colorspace_fragment>
  }
`;

const BUBBLE_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const BUBBLE_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);
    vec3 color = mix(vec3(0.24, 0.7, 0.86), vec3(0.9, 0.98, 1.0), rim);
    gl_FragColor = vec4(color, 0.13 + rim * 0.76);
    #include <colorspace_fragment>
  }
`;

const STEAM_VERTEX_SHADER = `
  uniform float uTime;
  attribute float aSeed;
  varying float vAge;
  varying float vSeed;
  void main() {
    float age = fract(uTime * (0.24 + mod(aSeed * 17.0, 0.12)) + aSeed);
    float angle = aSeed * 92.0;
    vec3 plume = position;
    plume.x += cos(angle) * (0.004 + age * 0.054) + sin(uTime * 1.4 + angle) * age * 0.01;
    plume.y += age * 0.072;
    plume.z += sin(angle) * (0.004 + age * 0.054);
    vec4 viewPosition = modelViewMatrix * vec4(plume, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = (9.0 + age * 34.0) * clamp(0.48 / -viewPosition.z, 0.65, 1.8);
    vAge = age;
    vSeed = aSeed;
  }
`;

const STEAM_FRAGMENT_SHADER = `
  uniform float uTime;
  varying float vAge;
  varying float vSeed;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 point = gl_PointCoord - vec2(0.5);
    vec2 drift = vec2(uTime * 0.13 + vSeed * 11.0, -uTime * 0.1 + vSeed * 17.0);
    float coarse = noise(point * 6.0 + drift);
    float detail = noise(point * 15.0 - drift * 1.7);
    float irregularRadius = length(vec2(point.x * 1.12, point.y * 0.82)) * 2.0
                          + (0.5 - coarse) * 0.42 + (0.5 - detail) * 0.14;
    float softness = 1.0 - smoothstep(0.28, 0.94, irregularRadius);
    float wisps = smoothstep(0.24, 0.78, coarse * 0.7 + detail * 0.3);
    float lifetime = sin(vAge * 3.14159265) * (1.0 - vAge * 0.5);
    gl_FragColor = vec4(vec3(0.38, 0.5, 0.57), softness * wisps * lifetime * 0.17);
    #include <colorspace_fragment>
  }
`;

function createSteamGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const seeds: number[] = [];
  for (let index = 0; index < STEAM_COUNT; index += 1) {
    const angle = index * 2.39996323;
    const seam = SEAMS[index % SEAMS.length];
    positions.push(Math.cos(angle) * PIPE_RADIUS, seam, Math.sin(angle) * PIPE_RADIUS);
    seeds.push((index * 0.61803398875) % 1);
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
  return geometry;
}

export function HeadPipeEffect({ effect }: { effect: Effect }) {
  const waterMaterial = useMemo(() => new ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, vertexShader: WATER_VERTEX_SHADER, fragmentShader: WATER_FRAGMENT_SHADER,
    transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
  }), []);
  const bubbleMaterial = useMemo(() => new ShaderMaterial({
    vertexShader: BUBBLE_VERTEX_SHADER, fragmentShader: BUBBLE_FRAGMENT_SHADER,
    transparent: true, depthTest: false, depthWrite: false,
  }), []);
  const steamMaterial = useMemo(() => new ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, vertexShader: STEAM_VERTEX_SHADER, fragmentShader: STEAM_FRAGMENT_SHADER,
    transparent: true, depthTest: false, depthWrite: false,
  }), []);
  const steamGeometry = useMemo(createSteamGeometry, []);
  const streakRef = useRef<InstancedMesh>(null);
  const bubbleRef = useRef<InstancedMesh>(null);
  const leakRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const elapsedRef = useRef(0);

  useEffect(() => () => {
    waterMaterial.dispose(); bubbleMaterial.dispose(); steamMaterial.dispose(); steamGeometry.dispose();
  }, [waterMaterial, bubbleMaterial, steamMaterial, steamGeometry]);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const time = elapsedRef.current;
    waterMaterial.uniforms.uTime.value = time;
    steamMaterial.uniforms.uTime.value = time;

    const streaks = streakRef.current;
    if (streaks) {
      for (let index = 0; index < STREAK_COUNT; index += 1) {
        const speed = 1.2 + (index % 5) * 0.13;
        const progress = (time * speed + index / STREAK_COUNT) % 1;
        const angle = index * 2.39996323;
        const radius = 0.007 + (index % 8) * 0.004;
        const fade = Math.min(1, progress * 18, (1 - progress) * 18);
        dummy.position.set(Math.cos(angle) * radius, PIPE_LENGTH * (0.5 - progress), Math.sin(angle) * radius);
        dummy.scale.set(0.0011 * fade, (0.004 + (index % 4) * 0.0015) * fade, 0.0011 * fade);
        dummy.updateMatrix(); streaks.setMatrixAt(index, dummy.matrix);
      }
      streaks.instanceMatrix.needsUpdate = true;
    }

    const bubbles = bubbleRef.current;
    if (bubbles) {
      for (let index = 0; index < BUBBLE_COUNT; index += 1) {
        const progress = (time * (0.42 + (index % 4) * 0.07) + index * 0.157) % 1;
        const angle = index * 2.39996323;
        const radius = 0.006 + (index % 7) * 0.0045;
        const fade = Math.min(1, progress * 14, (1 - progress) * 14);
        dummy.position.set(Math.cos(angle) * radius + Math.sin(time * 3.0 + index) * 0.0015,
          PIPE_LENGTH * (0.5 - progress), Math.sin(angle) * radius);
        dummy.scale.setScalar((0.0023 + (index % 5) * 0.0007) * fade);
        dummy.updateMatrix(); bubbles.setMatrixAt(index, dummy.matrix);
      }
      bubbles.instanceMatrix.needsUpdate = true;
    }

    const leaks = leakRef.current;
    if (leaks) {
      for (let index = 0; index < LEAK_COUNT; index += 1) {
        const progress = (time * 0.95 + index * 0.173) % 1;
        const angle = index * 2.39996323;
        const seam = SEAMS[index % SEAMS.length];
        const distance = PIPE_RADIUS + progress * 0.026;
        dummy.position.set(Math.cos(angle) * distance, seam - progress * 0.025, Math.sin(angle) * distance);
        const fade = Math.sin(progress * Math.PI);
        dummy.scale.set(0.0024 * fade, 0.0038 * fade, 0.0024 * fade);
        dummy.updateMatrix(); leaks.setMatrixAt(index, dummy.matrix);
      }
      leaks.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group position={[effect.position[0], effect.position[1] - 0.075, 0.12]}>
      <mesh material={waterMaterial} renderOrder={5}>
        <cylinderGeometry args={[WATER_RADIUS, WATER_RADIUS, PIPE_LENGTH, 48, 1, true]} />
      </mesh>
      <mesh renderOrder={6}>
        <cylinderGeometry args={[PIPE_RADIUS, PIPE_RADIUS, PIPE_LENGTH, 48, 1, true]} />
        <meshPhysicalMaterial color="#d8f6ff" transparent opacity={0.19} metalness={0.12} roughness={0.04} depthTest={false} depthWrite={false} side={DoubleSide} />
      </mesh>
      {SEAMS.map((height) => (
        <mesh key={height} position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={7}>
          <torusGeometry args={[PIPE_RADIUS, 0.0035, 8, 48]} />
          <meshPhysicalMaterial color="#a4ddea" transparent opacity={0.72} metalness={0.3} roughness={0.1} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
      <group position={[0.077, 0, 0.039]}>
        <mesh position={[0, 0, -0.006]} renderOrder={8}>
          <boxGeometry args={[0.027, 0.128, 0.006]} />
          <meshStandardMaterial color="#64757c" metalness={0.55} roughness={0.42} transparent depthTest={false} depthWrite={false} />
        </mesh>
        <mesh renderOrder={9}>
          <cylinderGeometry args={[0.006, 0.006, 0.109, 16]} />
          <meshPhysicalMaterial color="#e9fbff" transparent opacity={0.6} roughness={0.06} depthTest={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, -0.013, 0.003]} renderOrder={10}>
          <cylinderGeometry args={[0.0031, 0.0031, 0.078, 12]} />
          <meshStandardMaterial color="#ff3325" emissive="#e62312" emissiveIntensity={0.5} transparent depthTest={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, -0.052, 0.003]} renderOrder={10}>
          <sphereGeometry args={[0.009, 16, 12]} />
          <meshStandardMaterial color="#ff281a" emissive="#ec210c" emissiveIntensity={0.55} transparent depthTest={false} depthWrite={false} />
        </mesh>
        {[0, 1, 2, 3, 4].map((index) => (
          <mesh key={index} position={[0.01, -0.025 + index * 0.017, 0.004]} renderOrder={10}>
            <boxGeometry args={[index === 4 ? 0.009 : 0.006, 0.0015, 0.001]} />
            <meshBasicMaterial color={index === 4 ? '#ff7551' : '#d6e4e7'} transparent depthTest={false} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <instancedMesh ref={streakRef} args={[undefined, undefined, STREAK_COUNT]} renderOrder={8}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#b5f2ff" transparent opacity={0.78} depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={bubbleRef} args={[undefined, undefined, BUBBLE_COUNT]} material={bubbleMaterial} renderOrder={9}>
        <sphereGeometry args={[1, 12, 10]} />
      </instancedMesh>
      <instancedMesh ref={leakRef} args={[undefined, undefined, LEAK_COUNT]} renderOrder={10}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#8be6ff" transparent opacity={0.76} depthTest={false} depthWrite={false} />
      </instancedMesh>
      <points geometry={steamGeometry} material={steamMaterial} renderOrder={11} />
    </group>
  );
}
