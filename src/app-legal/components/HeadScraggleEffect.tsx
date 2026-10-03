import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import { HEAD_EFFECT_BLOB_DEFINITIONS, scraggleEmissionPoint, scraggleStrokePoint } from '../data/headEffectBlobs';

type Effect = (typeof HEAD_EFFECT_BLOB_DEFINITIONS)[number];

const SMOKE_COUNT = 110;
const STREAK_COUNT = 9;

const SMOKE_VERTEX_SHADER = `
  attribute vec3 aSeed;
  uniform float uTime;
  varying float vLife;
  varying float vVariation;

  void main() {
    float life = fract(aSeed.x + uTime * (0.14 + aSeed.z * 0.06));
    float turn = aSeed.y * 6.28318 + life * 12.0 + uTime * 1.55;
    float radius = (0.11 + life * 0.48) * (0.65 + aSeed.z * 0.35);
    vec3 smokePosition = vec3(
      cos(turn) * radius,
      -0.64 + life * 1.38,
      0.16 + sin(turn) * 0.11
    );
    vec4 viewPosition = modelViewMatrix * vec4(smokePosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = (13.0 + life * 19.0) * (0.48 / max(0.2, -viewPosition.z));
    vLife = sin(life * 3.14159);
    vVariation = aSeed.z;
  }
`;

const SMOKE_FRAGMENT_SHADER = `
  uniform vec3 uTint;
  uniform float uTime;
  varying float vLife;
  varying float vVariation;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float angle = atan(point.y, point.x);
    float raggedEdge = sin(angle * 5.0 + uTime * 0.8 + vVariation * 9.0) * 0.1;
    float softness = 1.0 - smoothstep(0.22, 1.0, length(point) + raggedEdge);
    float alpha = softness * vLife * (0.26 + vVariation * 0.18);
    vec3 smokeColor = mix(vec3(0.39, 0.42, 0.5), uTint, 0.2);
    gl_FragColor = vec4(smokeColor, alpha);
    #include <colorspace_fragment>
  }
`;

function createSmokeGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(SMOKE_COUNT * 3);
  const seeds = new Float32Array(SMOKE_COUNT * 3);
  for (let index = 0; index < SMOKE_COUNT; index += 1) {
    seeds[index * 3] = (index + 0.5) / SMOKE_COUNT;
    seeds[index * 3 + 1] = (index * 0.61803398875) % 1;
    seeds[index * 3 + 2] = (index * 0.754877666) % 1;
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 3));
  return geometry;
}

export function HeadScraggleEffect({ effect }: { effect: Effect }) {
  const strokesRef = useRef<Group>(null);
  const strokeGeometry = useMemo(() => {
    const points = Array.from({ length: 241 }, (_, index) => new Vector3(...scraggleStrokePoint(index / 240)));
    return new TubeGeometry(new CatmullRomCurve3(points), 320, 0.032, 8, false);
  }, []);
  const streakGeometries = useMemo(() => Array.from({ length: STREAK_COUNT }, (_, stroke) => {
    const points = Array.from({ length: 17 }, (_, index) => new Vector3(...scraggleEmissionPoint(stroke, index / 16)));
    return new TubeGeometry(new CatmullRomCurve3(points), 24, 0.013, 6, false);
  }), []);
  const strokeMaterial = useMemo(() => new MeshBasicMaterial({
    color: '#111827',
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  }), []);
  const streakMaterial = useMemo(() => new MeshBasicMaterial({
    color: '#1f2937',
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  }), []);
  const smokeGeometry = useMemo(createSmokeGeometry, []);
  const smokeMaterial = useMemo(() => new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new Color(effect.colors[0]) },
    },
    vertexShader: SMOKE_VERTEX_SHADER,
    fragmentShader: SMOKE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  }), [effect.colors]);

  useEffect(() => () => {
    strokeGeometry.dispose();
    strokeMaterial.dispose();
    streakGeometries.forEach((geometry) => geometry.dispose());
    streakMaterial.dispose();
    smokeGeometry.dispose();
    smokeMaterial.dispose();
  }, [strokeGeometry, strokeMaterial, streakGeometries, streakMaterial, smokeGeometry, smokeMaterial]);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    smokeMaterial.uniforms.uTime.value = elapsed;
    if (strokesRef.current) {
      strokesRef.current.rotation.y = elapsed * 0.9;
      strokesRef.current.rotation.z = Math.sin(elapsed * 0.48) * 0.08;
      strokesRef.current.position.y = Math.sin(elapsed * 0.75) * 0.015;
    }
    streakGeometries.forEach((geometry, index) => {
      const phase = (elapsed * 0.52 + index / STREAK_COUNT) % 1;
      const extension = Math.min(phase / 0.34, 1);
      const retreat = phase > 0.72 ? Math.max(0, (1 - phase) / 0.28) : 1;
      const availableTriangles = Math.floor((geometry.index?.count ?? 0) / 3);
      geometry.setDrawRange(0, Math.floor(availableTriangles * extension * retreat) * 3);
    });
  });

  return (
    <group position={effect.position} scale={effect.radius}>
      <points geometry={smokeGeometry} material={smokeMaterial} renderOrder={3} />
      <group ref={strokesRef}>
        <mesh geometry={strokeGeometry} material={strokeMaterial} renderOrder={4} />
        {streakGeometries.map((geometry, index) => (
          <mesh key={index} geometry={geometry} material={streakMaterial} renderOrder={4} />
        ))}
      </group>
    </group>
  );
}
