import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import styled from "styled-components";
import * as THREE from "three";
import { CanvasText } from "./CanvasText";

const BASE_URL = "";
const BODY_CHARACTER_SRC = `${BASE_URL}/md-preview/body-attenuation-character.png`;
const BACKGROUND_COLOR = "#e8e8ea";

const CHARACTER_SIZE = {
  width: 2.91,
  height: 5.32,
};

// Radio wave vertex shader (adapted from BodyAttenuationWebGPUCanvas)
const radioWaveVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Radio wave fragment shader — 3 staggered radial rings from antenna, smooth fade
const radioWaveFragmentShader = `
  uniform float uTime;
  uniform sampler2D uBodyTexture;
  uniform vec4 uBodyRect;
  uniform vec2 uAntennaCenter;
  varying vec2 vUv;

  float sampleBody(vec2 uv) {
    vec2 bodyUv = (uv - uBodyRect.xy) / uBodyRect.zw;
    if (bodyUv.x < 0.0 || bodyUv.x > 1.0 || bodyUv.y < 0.0 || bodyUv.y > 1.0) return 0.0;
    return texture2D(uBodyTexture, bodyUv).a;
  }

  float bodyEdge(vec2 uv, float radius) {
    float center = sampleBody(uv);
    float maxNeighbor = 0.0;
    for (float dx = -1.0; dx <= 1.0; dx += 1.0) {
      for (float dy = -1.0; dy <= 1.0; dy += 1.0) {
        if (dx == 0.0 && dy == 0.0) continue;
        maxNeighbor = max(maxNeighbor, sampleBody(uv + vec2(dx, dy) * radius));
      }
    }
    return maxNeighbor * (1.0 - center);
  }

  // Single radial wave ring contribution
  float waveRing(float distToAntenna, float radius) {
    float thickness = 0.025;
    float ring = smoothstep(thickness, 0.0, abs(distToAntenna - radius));
    // Fade in near antenna, fade out at distance
    float fadeIn = smoothstep(0.0, 0.08, radius);
    float fadeOut = smoothstep(1.1, 0.4, radius);
    return ring * fadeIn * fadeOut;
  }

  void main() {
    float bodyAlpha = sampleBody(vUv);
    bool insideBody = bodyAlpha > 0.15;

    float distToAntenna = distance(vUv, uAntennaCenter);

    // 3 overlapping waves, staggered by 1/3 of the cycle period
    float speed = 0.28;
    float cycleLen = 1.3;
    float wave1R = mod(uTime * speed, cycleLen);
    float wave2R = mod(uTime * speed + cycleLen / 3.0, cycleLen);
    float wave3R = mod(uTime * speed + 2.0 * cycleLen / 3.0, cycleLen);

    float ring1 = waveRing(distToAntenna, wave1R);
    float ring2 = waveRing(distToAntenna, wave2R);
    float ring3 = waveRing(distToAntenna, wave3R);
    float combinedRing = max(ring1, max(ring2, ring3));

    // Subtle ripple texture
    float ripple = 0.5 + 0.5 * sin(distToAntenna * 60.0 - uTime * 4.0);
    float detail = combinedRing * (0.7 + 0.3 * ripple);

    // Suppress inside body silhouette
    if (insideBody) {
      detail = 0.0;
    }

    // Edge outline glow when any wave front is near the body
    float edgeDetect = bodyEdge(vUv, 0.008);
    float nearWave1 = smoothstep(0.15, 0.0, abs(distToAntenna - wave1R));
    float nearWave2 = smoothstep(0.15, 0.0, abs(distToAntenna - wave2R));
    float nearWave3 = smoothstep(0.15, 0.0, abs(distToAntenna - wave3R));
    float nearWave = max(nearWave1, max(nearWave2, nearWave3));
    float outlineAlpha = edgeDetect * nearWave * 0.6;

    // Color: subtle grey-white arcs
    vec3 waveColor = mix(vec3(0.55, 0.56, 0.60), vec3(0.95, 0.96, 0.98), combinedRing);
    vec3 outlineColor = vec3(0.98, 0.98, 1.0);
    vec3 color = mix(waveColor, outlineColor, clamp(outlineAlpha, 0.0, 1.0));

    float alpha = clamp(detail * 0.55 + outlineAlpha, 0.0, 0.75);

    gl_FragColor = vec4(color, alpha);
  }
`;

// Heatmap overlay shader
const heatmapVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const heatmapFragmentShader = `
  uniform sampler2D uBodyTexture;
  uniform vec4 uBodyRect;
  uniform float uTime;
  uniform float uWaveProgress;
  uniform vec2 uAntennaCenter;
  varying vec2 vUv;

  float sampleBody(vec2 uv) {
    vec2 bodyUv = (uv - uBodyRect.xy) / uBodyRect.zw;
    if (bodyUv.x < 0.0 || bodyUv.x > 1.0 || bodyUv.y < 0.0 || bodyUv.y > 1.0) return 0.0;
    return texture2D(uBodyTexture, bodyUv).a;
  }

  // Approximate distance from the nearest silhouette edge by marching outward
  // in 16 directions and finding the shortest distance to a transparent pixel.
  float edgeDistance(vec2 uv) {
    float maxDist = 0.08; // max search radius in UV space
    float minFound = maxDist;
    const int DIRS = 16;
    const int STEPS = 12;
    for (int d = 0; d < DIRS; d++) {
      float angle = float(d) * 6.2831853 / float(DIRS);
      vec2 dir = vec2(cos(angle), sin(angle));
      for (int s = 1; s <= STEPS; s++) {
        float r = maxDist * float(s) / float(STEPS);
        vec2 samplePos = uv + dir * r;
        float a = sampleBody(samplePos);
        if (a < 0.15) {
          minFound = min(minFound, r);
          break;
        }
      }
    }
    return minFound / maxDist; // normalize 0..1
  }

  vec3 thermalColor(float t) {
    // Thermal palette: dark blue -> blue -> green -> yellow -> red -> pink/white
    // Matching the reference image's color ramp
    vec3 color;
    if (t < 0.15) {
      // Dark blue/indigo edge glow
      color = mix(vec3(0.08, 0.0, 0.42), vec3(0.0, 0.15, 0.85), t / 0.15);
    } else if (t < 0.35) {
      // Blue to green
      color = mix(vec3(0.0, 0.15, 0.85), vec3(0.0, 0.9, 0.2), (t - 0.15) / 0.20);
    } else if (t < 0.55) {
      // Green to yellow
      color = mix(vec3(0.0, 0.9, 0.2), vec3(1.0, 1.0, 0.0), (t - 0.35) / 0.20);
    } else if (t < 0.75) {
      // Yellow to red
      color = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.15, 0.0), (t - 0.55) / 0.20);
    } else {
      // Red to hot pink/magenta for the very core
      color = mix(vec3(1.0, 0.15, 0.0), vec3(1.0, 0.3, 0.6), (t - 0.75) / 0.25);
    }
    return color;
  }

  void main() {
    float bodyAlpha = sampleBody(vUv);

    if (bodyAlpha < 0.15) {
      discard;
    }

    // Core idea: distance from edge determines heat.
    float dist = edgeDistance(vUv);

    // Boost head and chest regions slightly — they have denser tissue
    vec2 bodyUv = (vUv - uBodyRect.xy) / uBodyRect.zw;
    float headBoost = smoothstep(0.72, 0.92, bodyUv.y) * smoothstep(0.15, 0.45, 1.0 - abs(bodyUv.x - 0.5)) * 0.18;
    float chestBoost = smoothstep(0.42, 0.72, bodyUv.y) * smoothstep(0.10, 0.50, 1.0 - abs(bodyUv.x - 0.5)) * 0.12;

    float density = clamp(dist + headBoost + chestBoost, 0.0, 1.0);

    vec3 heatColor = thermalColor(density);

    // Wave-driven reveal: compute closest wave front distance to this pixel
    float speed = 0.28;
    float cycleLen = 1.3;
    float wave1R = mod(uTime * speed, cycleLen);
    float wave2R = mod(uTime * speed + cycleLen / 3.0, cycleLen);
    float wave3R = mod(uTime * speed + 2.0 * cycleLen / 3.0, cycleLen);

    float distToAntenna = distance(vUv, uAntennaCenter);
    float near1 = smoothstep(0.18, 0.0, abs(distToAntenna - wave1R));
    float near2 = smoothstep(0.18, 0.0, abs(distToAntenna - wave2R));
    float near3 = smoothstep(0.18, 0.0, abs(distToAntenna - wave3R));
    float waveProximity = max(near1, max(near2, near3));

    // Base 10% opacity, ramp to full when wave passes through the character
    float baseAlpha = 0.10;
    float revealAlpha = mix(baseAlpha, 1.0, waveProximity);

    float alpha = smoothstep(0.15, 0.30, bodyAlpha) * 0.92 * revealAlpha;

    gl_FragColor = vec4(heatColor, alpha);
  }
`;

const RadioWave: React.FC<{ bodyTexture: THREE.Texture }> = ({ bodyTexture }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => {
    const charWorldX = 3; // Character on the right (updated position)
    const charWorldY = -0.55;
    const halfW = CHARACTER_SIZE.width / 2;
    const halfH = CHARACTER_SIZE.height / 2;
    const uvLeft = (charWorldX - halfW + 5) / 10;
    const uvBottom = (charWorldY - halfH + 3.25) / 6.5;
    const uvW = CHARACTER_SIZE.width / 10;
    const uvH = CHARACTER_SIZE.height / 6.5;

    return {
      uTime: { value: 0 },
      uBodyTexture: { value: bodyTexture },
      uBodyRect: { value: new THREE.Vector4(uvLeft, uvBottom, uvW, uvH) },
      uAntennaCenter: { value: new THREE.Vector2(0.185, 0.37) },
    };
  }, [bodyTexture]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uBodyTexture.value = bodyTexture;
    }
  }, [bodyTexture]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <mesh position={[0, 0, -0.5]} frustumCulled={false}>
      <planeGeometry args={[10, 6.5]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={radioWaveVertexShader}
        fragmentShader={radioWaveFragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

const Antenna: React.FC = () => (
  <group>
    <mesh position={[-3.15, -2.08, 0]}>
      <boxGeometry args={[0.48, 0.12, 0.18]} />
      <meshStandardMaterial color="#4d4d4f" roughness={0.72} metalness={0.08} />
    </mesh>

    <mesh position={[-3.15, -0.48, 0]}>
      <cylinderGeometry args={[0.11, 0.12, 3.05, 16]} />
      <meshStandardMaterial color="#4d4d4f" roughness={0.58} metalness={0.12} />
    </mesh>

    <mesh position={[-3.08, -0.48, 0.02]}>
      <cylinderGeometry args={[0.03, 0.03, 2.95, 16]} />
      <meshBasicMaterial color="#d0d0d2" transparent opacity={0.38} />
    </mesh>

    <mesh position={[-3.15, 1.18, 0]}>
      <cylinderGeometry args={[0.14, 0.14, 0.16, 16]} />
      <meshStandardMaterial color="#5a5a5c" roughness={0.5} metalness={0.1} />
    </mesh>

    <mesh position={[-3.15, 1.58, 0]} rotation={[0, Math.PI / 6, 0]}>
      <cylinderGeometry args={[0.34, 0.34, 0.8, 6]} />
      <meshStandardMaterial color="#ececec" roughness={0.36} metalness={0.06} flatShading />
    </mesh>

    <mesh position={[-3.15, 2.0, 0]}>
      <cylinderGeometry args={[0.1, 0.1, 0.14, 16]} />
      <meshStandardMaterial color="#cbcbcd" roughness={0.45} metalness={0.1} />
    </mesh>
  </group>
);

const HeatmapOverlay: React.FC<{ bodyTexture: THREE.Texture }> = ({ bodyTexture }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => {
    const charWorldX = 3; // Character on the right (updated position)
    const charWorldY = -0.55;
    const halfW = CHARACTER_SIZE.width / 2;
    const halfH = CHARACTER_SIZE.height / 2;
    const uvLeft = (charWorldX - halfW + 5) / 10;
    const uvBottom = (charWorldY - halfH + 3.25) / 6.5;
    const uvW = CHARACTER_SIZE.width / 10;
    const uvH = CHARACTER_SIZE.height / 6.5;

    return {
      uBodyTexture: { value: bodyTexture },
      uBodyRect: { value: new THREE.Vector4(uvLeft, uvBottom, uvW, uvH) },
      uTime: { value: 0 },
      uWaveProgress: { value: 0 },
      uAntennaCenter: { value: new THREE.Vector2(0.185, 0.37) },
    };
  }, [bodyTexture]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uBodyTexture.value = bodyTexture;
    }
  }, [bodyTexture]);

  useFrame((state) => {
    if (materialRef.current) {
      const time = state.clock.elapsedTime;
      const speed = 0.4;
      const progress = ((time * speed) % 2.5 - 0.5) / 2.5 + 0.5; // Normalize to 0-1
      materialRef.current.uniforms.uTime.value = time;
      materialRef.current.uniforms.uWaveProgress.value = progress;
    }
  });

  return (
    <mesh position={[0, 0, 0.1]} frustumCulled={false}>
      <planeGeometry args={[10, 6.5]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={heatmapVertexShader}
        fragmentShader={heatmapFragmentShader}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
};

const Character: React.FC<{ texture: THREE.Texture }> = ({ texture }) => {
  return (
    <mesh position={[3, -0.55, 0.15]}>
      <planeGeometry args={[CHARACTER_SIZE.width, CHARACTER_SIZE.height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.8}
      />
    </mesh>
  );
};

const SceneContents: React.FC = () => {
  const texture = useTexture(BODY_CHARACTER_SRC);
  const { size, camera } = useThree();

  useEffect(() => {
    if (camera.type === "OrthographicCamera") {
      const ortho = camera as THREE.OrthographicCamera;
      ortho.zoom = size.width / 10;
      ortho.updateProjectionMatrix();
    }
  }, [size, camera]);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }, [texture]);

  return (
    <>
      <color attach="background" args={[BACKGROUND_COLOR]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[0, 0, 3]} intensity={1.25} color="#ffffff" />

      <mesh position={[0, 0, -0.6]}>
        <planeGeometry args={[10, 6.5]} />
        <meshBasicMaterial color={BACKGROUND_COLOR} />
      </mesh>

      {/* Antenna on the left */}
      <Antenna />

      {/* Radio waves flowing left to right */}
      <RadioWave bodyTexture={texture} />

      {/* Character on the right */}
      <Character texture={texture} />

      {/* Heatmap overlay */}
      <HeatmapOverlay bodyTexture={texture} />

      {/* Labels */}
      <CanvasText position={[-3.15, 2.35, 0.35]} fontSize={0.24} color="#1e1e26" anchorX="center" anchorY="middle" fontWeight={700} text="Antenna" />
      <CanvasText position={[3, 2.5, 0.35]} fontSize={0.24} color="#1e1e26" anchorX="center" anchorY="middle" fontWeight={700} text="Target" />
      <CanvasText position={[0, -2.5, 0.35]} fontSize={0.26} color="#1e1e26" anchorX="center" anchorY="middle" fontWeight={700} text="Time of Flight" />
    </>
  );
};

const TimeOfFlightCanvas: React.FC = () => {
  return (
    <Frame>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [0, 0, 10] }}
        gl={{ antialias: true, alpha: true }}
      >
        <SceneContents />
      </Canvas>
      <RendererBadge>WebGPU</RendererBadge>
    </Frame>
  );
};

const Frame = styled.div`
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 2rem 0;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(12, 14, 18, 0.36);
  background: ${BACKGROUND_COLOR};
  aspect-ratio: 10 / 6.4;
  position: relative;

  > div {
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
  }

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
    cursor: default;
    touch-action: none;
  }
`;

const RendererBadge = styled.div`
  display: none;
`;

export default TimeOfFlightCanvas;
