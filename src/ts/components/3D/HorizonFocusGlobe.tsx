import React, { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei";
import { extend } from "@react-three/fiber";

const FocusGlobeMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color("#ac77ff"),
    uOpacity: 0.6,
    uOpening: 0.0, // 0.0 is closed, 1.0 is open
    uResolution: new THREE.Vector2(1000, 1000),
  },
  // Vertex Shader
  `
  varying vec3 vBarycentric;
  varying vec3 vNormal;
  varying vec3 vLocalPosition;
  varying vec3 vViewDirection;
  varying vec3 vViewOffset;
  varying vec3 vWorldPosition;

  attribute vec3 barycentric;

  void main() {
    vBarycentric = barycentric;
    vNormal = normalize(normalMatrix * normal);
    vLocalPosition = position;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDirection = normalize(-mvPosition.xyz);
    // View-space offset from mesh center (for camera-fixed exclusion zone)
    vec4 mvCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vViewOffset = mvPosition.xyz - mvCenter.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
  `,
  // Fragment Shader
  `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uOpening;

  varying vec3 vBarycentric;
  varying vec3 vNormal;
  varying vec3 vLocalPosition;
  varying vec3 vViewDirection;
  varying vec3 vViewOffset;
  varying vec3 vWorldPosition;

  float getEdge(vec3 barycentric, float width) {
    vec3 d = fwidth(barycentric);
    vec3 a3 = smoothstep(vec3(0.0), d * width, barycentric);
    return 1.0 - min(min(a3.x, a3.y), a3.z);
  }

  float rand(float n){return fract(sin(n) * 43758.5453123);}

  void main() {
    // Hard clip against the floor plane for a strict 90-degree dome cutoff
    if (vWorldPosition.y < 0.0) discard;

    // Holographic wireframe
    float wireframe = getEdge(vBarycentric, 1.2);

    // Exclusion zone: use view-space direction, make it large enough
    vec3 viewDir = normalize(vViewOffset);
    float ovalDist = length(vec2(viewDir.x / 0.4, (viewDir.y + 0.1) / 0.8));
    
    // Discard everything inside the oval
    if (ovalDist < 1.0) discard;

    // Faded edges for the opening
    float mask = smoothstep(1.0, 1.3, ovalDist);

    // Fresnel glow
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDirection), 0.0), 3.5);
    
    // Holographic effects
    float flick = 0.7 + 0.3 * rand(uTime);
    
    float finalAlpha = (fresnel * 0.3 + wireframe * 1.5) * uOpacity * mask * flick;
    
    // Add holographic scanlines
    finalAlpha *= (0.9 + 0.1 * sin(gl_FragCoord.y * 1.5 + uTime * 5.0));

    if (finalAlpha < 0.05) discard;

    gl_FragColor = vec4(uColor, finalAlpha);
  }
  `
);

extend({ FocusGlobeMaterial });

export const HorizonFocusGlobe: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<any>(null);
  const geoRef = useRef<THREE.IcosahedronGeometry>(null);

  useEffect(() => {
    if (geoRef.current) {
      const geometry = geoRef.current;
      const count = geometry.attributes.position.count;
      const barycentric = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        barycentric[i * 3 + (i % 3)] = 1;
      }
      geometry.setAttribute("barycentric", new THREE.BufferAttribute(barycentric, 3));
    }
  }, []);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uTime = state.clock.elapsedTime;

      const targetScale = active ? new THREE.Vector3(3.6, 2.7, 3.6) : new THREE.Vector3(0.01, 0.01, 0.01);
      const scaleLerp = active ? 0.05 : 0.15;
      meshRef.current?.scale.lerp(targetScale, scaleLerp);

      // Auto rotate
      if (meshRef.current) {
        meshRef.current.rotation.y += 0.003;
      }
    }
  });

  return (
    <mesh ref={meshRef} scale={[0.01, 0.01, 0.01]} position={[0, 0, 0]}>
      <icosahedronGeometry ref={geoRef} args={[1, 1]} />
      {/* @ts-ignore */}
      <focusGlobeMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};
