import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Group, PlaneGeometry, ShaderMaterial } from 'three';

type Effect = { position: readonly [number, number, number] };

const vertexShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vLight;

  void main() {
    vUv = uv;
    vec3 p = position;
    // A broad traveling S-curve, with the far end curling upward.
    float phase = uv.x * 6.28318 - uTime * 0.85;
    float wave = sin(phase) * 0.027 + sin(phase * 1.6 + uv.y * 2.4) * 0.006;
    float curl = smoothstep(0.78, 1.0, uv.x);
    p.z += wave + curl * curl * 0.019;
    vLight = 0.68 + cos(phase) * 0.2 + curl * 0.1;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying float vLight;

  float roundedBox(vec2 uv, vec2 halfSize, float radius) {
    vec2 p = abs(uv - 0.5) - halfSize + radius;
    return length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) - radius;
  }

  void main() {
    vec2 edge = min(vUv, 1.0 - vUv);
    float silhouette = roundedBox(vUv, vec2(0.494, 0.49), 0.055);
    float alpha = 1.0 - smoothstep(-0.003, 0.005, silhouette);
    vec3 purple = vec3(0.35, 0.105, 0.52);
    vec3 violet = vec3(0.49, 0.19, 0.62);
    vec3 gold = vec3(0.95, 0.72, 0.32);

    float weave = sin(vUv.x * 300.0) * sin(vUv.y * 180.0) * 0.016;
    vec3 color = mix(purple, violet, 0.34 + weave);

    // Gold binding, a decorative track, and the large inset field.
    float outerBand = 1.0 - smoothstep(0.015, 0.045, min(edge.x, edge.y));
    float innerTrack = 1.0 - smoothstep(0.004, 0.011, abs(min(edge.x / 0.11, edge.y / 0.14) - 0.76) * 0.08);
    float panelLine = 1.0 - smoothstep(0.003, 0.009, abs(roundedBox(vUv, vec2(0.315, 0.285), 0.09)));

    vec2 motifUv = fract(vec2(vUv.x * 16.0, vUv.y * 11.0)) - 0.5;
    float diamond = 1.0 - smoothstep(0.12, 0.19, abs(motifUv.x) + abs(motifUv.y));
    float sideMotifs = diamond * step(edge.y, 0.145) * step(0.055, edge.y);
    float endMotifs = diamond * step(edge.x, 0.11) * step(0.04, edge.x);
    float ornament = max(sideMotifs, endMotifs) * 0.9;

    float gilding = max(max(outerBand, panelLine), max(innerTrack * 0.85, ornament));
    color = mix(color, gold, clamp(gilding, 0.0, 1.0));
    color *= vLight;
    gl_FragColor = vec4(color, alpha * 0.97);
    #include <colorspace_fragment>
  }
`;

export function HeadMagicCarpetEffect({ effect }: { effect: Effect }) {
  const geometry = useMemo(() => new PlaneGeometry(0.24, 0.16, 72, 40), []);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  }), []);
  const tassels = useRef<Group>(null);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta;
    if (tassels.current) {
      const phase = -material.uniforms.uTime.value * 0.85;
      tassels.current.position.z = Math.sin(phase) * 0.027 + Math.sin(phase * 1.6 + 1.2) * 0.006;
    }
  });

  return (
    <group position={[effect.position[0], effect.position[1] - 0.055, 0.13]} rotation={[0, Math.PI / 2, 0]}>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh geometry={geometry} material={material} renderOrder={8} />
        <group ref={tassels} position={[-0.12, 0, 0]}>
          {Array.from({ length: 9 }, (_, index) => (
            <mesh key={index} position={[-0.011, (index - 4) * 0.018, 0]} scale={[0.016, 0.007, 0.007]} renderOrder={9}>
              <sphereGeometry args={[1, 12, 8]} />
              <meshStandardMaterial color="#71308b" roughness={0.82} transparent depthTest={false} depthWrite={false} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
