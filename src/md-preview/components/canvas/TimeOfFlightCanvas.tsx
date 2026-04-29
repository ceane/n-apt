import React, { useEffect, useMemo, useRef, useState } from "react";
import CanvasImage from "@n-apt/md-preview/components/canvas/shared/CanvasImage";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import styled from "styled-components";
import * as THREE from "three";
import { CanvasText } from "@n-apt/md-preview/components/CanvasText";
import { theme } from "@n-apt/md-preview/consts/theme";
import CanvasHarness from "@n-apt/md-preview/components/canvas/CanvasHarness";

import { assetImageUrl } from "@n-apt/md-preview/utils/asset-helpers";
const BODY_CHARACTER_SRC = assetImageUrl("body-attenuation-character.png");

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

    float speed = 0.5;
    float pulsePhase = mod(uTime * speed, 3.0);
    float waveR = 0.0;
    if (pulsePhase <= 1.0) waveR = pulsePhase;
    else if (pulsePhase <= 2.0) waveR = 2.0 - pulsePhase;

    float combinedRing = pulsePhase <= 2.0 ? waveRing(distToAntenna, waveR) : 0.0;

    // Subtle ripple texture
    float ripple = 0.5 + 0.5 * sin(distToAntenna * 60.0 - uTime * 6.0);
    float detail = combinedRing * (0.7 + 0.3 * ripple);

    // Suppress inside body silhouette
    if (insideBody) {
      detail = 0.0;
    }

    // Edge outline glow when any wave front is near the body
    float edgeDetect = bodyEdge(vUv, 0.008);
    float nearWave = smoothstep(0.15, 0.0, abs(distToAntenna - waveR));
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

    // Wave-driven reveal
    float speed = 0.5;
    float pulsePhase = mod(uTime * speed, 3.0);
    float waveR = 0.0;
    if (pulsePhase <= 1.0) waveR = pulsePhase;
    else if (pulsePhase <= 2.0) waveR = 2.0 - pulsePhase;
    float distToAntenna = distance(vUv, uAntennaCenter);
    
    float revealAlpha = 0.0;
    if (pulsePhase <= 1.0) {
        revealAlpha = 0.0;
    } else if (pulsePhase <= 2.0) {
        float hasPassedBack = smoothstep(0.05, -0.05, waveR - distToAntenna);
        float waveProximity = smoothstep(0.18, 0.0, abs(distToAntenna - waveR));
        revealAlpha = max(waveProximity, hasPassedBack);
    } else {
        revealAlpha = 1.0 - (pulsePhase - 2.0);
    }

    float alpha = smoothstep(0.15, 0.30, bodyAlpha) * 0.92 * revealAlpha;

    gl_FragColor = vec4(heatColor, alpha);
  }
`;

const RadioWave: React.FC<{ bodyTexture: THREE.Texture }> = ({ bodyTexture }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => {
    const charWorldX = 2.8; // Character all the way to the right
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
      uAntennaCenter: { value: new THREE.Vector2(0.08, 0.61) },
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



const binaryRowVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const binaryRowFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uTime;
  uniform vec2 uAntennaCenter;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    if (texColor.a < 0.1) discard;

    vec2 screenUv = vec2(vWorldPosition.x / 10.0 + 0.5, vWorldPosition.y / 6.5 + 0.5);
    float distToAntenna = distance(screenUv, uAntennaCenter);
    
    float speed = 0.5;
    float pulsePhase = mod(uTime * speed, 3.0);
    float waveR = 0.0;
    if (pulsePhase <= 1.0) waveR = pulsePhase;
    else if (pulsePhase <= 2.0) waveR = 2.0 - pulsePhase;

    float revealed = 0.0;
    if (pulsePhase <= 1.0) {
        revealed = 0.0;
    } else if (pulsePhase <= 2.0) {
        revealed = smoothstep(0.05, -0.05, waveR - distToAntenna);
    } else {
        revealed = 1.0 - (pulsePhase - 2.0);
    }

    float hit = clamp(revealed, 0.0, 1.0);
    
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263, 0.416, 0.557);
    vec3 litColor = a + b * cos(6.28318 * (c * (uTime * 0.4 + vWorldPosition.x * 0.1 + vWorldPosition.y * 0.1) + d));
    
    gl_FragColor = vec4(litColor, texColor.a * hit);
  }
`;

const BinaryRow = ({ text, x, y, widthWorld }: { text: string; x: number; y: number; widthWorld: number }) => {
  const [cycle, setCycle] = useState(0);

  const { texture, width, height } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { texture: null, width: 1, height: 1 };

    const chars = "0123456789ABCDEF";
    let dynamicText = "";
    for (let i = 0; i < text.length; i++) {
       if (text[i] === ' ') dynamicText += ' ';
       else dynamicText += chars[Math.floor(Math.random() * 16)];
    }

    const baseSize = 14 + Math.random() * 8;
    ctx.font = `normal ${baseSize}px "JetBrains Mono", monospace`;
    const metrics = ctx.measureText(dynamicText);
    const textWidth = metrics.width;
    const textHeight = baseSize * 1.2;

    canvas.width = Math.ceil(textWidth);
    canvas.height = Math.ceil(textHeight);

    ctx.font = `normal ${baseSize}px "JetBrains Mono", monospace`;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.fillText(dynamicText, 0, baseSize * 0.1);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;

    return { texture: tex, width: widthWorld, height: widthWorld * (canvas.height / canvas.width) };
  }, [text, widthWorld, cycle]);

  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => ({
    uTexture: { value: texture },
    uTime: { value: 0 },
    uAntennaCenter: { value: new THREE.Vector2(0.08, 0.61) }
  }), [texture]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
    const newCycle = Math.floor(state.clock.elapsedTime / 6.0);
    if (newCycle !== cycle) setCycle(newCycle);
  });

  if (!texture) return null;

  return (
    <mesh position={[x + width / 2, y, 0.18]}>
      <planeGeometry args={[width, height]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={binaryRowVertexShader}
        fragmentShader={binaryRowFragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

const BinaryMatrixOverlay = () => {
  const rows = useMemo(() => {
    const ROW_HEIGHT = 0.35; // Added vertical spacing
    const rowData = [];

    const centerX = 2.8;
    const centerY = -0.55;
    const radiusX = 1.6;
    const radiusY = 2.66;
    const topY = centerY + radiusY;
    const bottomY = centerY - radiusY;

    let currentY = topY - ROW_HEIGHT;

    while (currentY > bottomY) {
      const normalizedY = (currentY - centerY) / radiusY;
      const xOffset = radiusX * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));

      const endX = centerX - xOffset - 0.2;
      const startX = endX - 0.3; // 1 column wide
      const widthWorld = 0.3;

      rowData.push({
        y: currentY,
        x: startX,
        text: "00", // Will be replaced with 2 random hex chars in BinaryRow
        widthWorld: widthWorld
      });

      currentY -= ROW_HEIGHT;
    }
    return rowData;
  }, []);

  return (
    <group>
      {rows.map((r, i) => (
        <BinaryRow key={i} text={r.text} x={r.x} y={r.y} widthWorld={r.widthWorld} />
      ))}
    </group>
  );
};

const HeatmapOverlay: React.FC<{ bodyTexture: THREE.Texture }> = ({ bodyTexture }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => {
    const charWorldX = 2.8; // Character all the way to the right
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
      uAntennaCenter: { value: new THREE.Vector2(0.08, 0.61) },
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
    <mesh position={[2.8, -0.55, 0.15]}>
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
      <ambientLight intensity={1.8} />
      <directionalLight position={[0, 0, 3]} intensity={1.25} color="#ffffff" />



      {/* Radio waves flowing left to right */}
      <RadioWave bodyTexture={texture} />

      {/* Binary string rows contouring right side of the body */}
      <BinaryMatrixOverlay />

      {/* Character on the right */}
      <Character texture={texture} />

      {/* Heatmap overlay */}
      <HeatmapOverlay bodyTexture={texture} />

      {/* Labels */}
      <CanvasText position={[-3.3, 2.05, 0.35]} fontSize={0.24} color="#1e1e26" anchorX="center" anchorY="middle" fontWeight={700} text="Antenna" />
      <CanvasText position={[2.8, 2.5, 0.35]} fontSize={0.24} color="#1e1e26" anchorX="center" anchorY="middle" fontWeight={700} text="Target" />

      <DynamicStatsOverlay />
    </>
  );
};

const DynamicStatsOverlay = () => {
  const [stats, setStats] = useState({
    distance: "500m",
    frequency: "15 MHz",
    phase: "0°",
    aperture: "50.00 m²"
  });
  const cycleRef = useRef<number>(-1);

  useFrame((state) => {
    const cycle = Math.floor(state.clock.elapsedTime / 6.0);
    if (cycleRef.current !== cycle) {
      cycleRef.current = cycle;

      const dKm = 0.01 + Math.random() * 0.99;
      const fMHz = 1 + Math.random() * 29;

      const fspl = 20 * Math.log10(dKm) + 20 * Math.log10(fMHz) + 32.44;
      const gainDb = fspl - 22 - 24;
      let aperture = (Math.pow(10, gainDb / 10) * 90000) / (4 * Math.PI * fMHz * fMHz);
      let apertureStr = aperture > 10000 ? `${(aperture / 10000).toFixed(2)} ha` : `${aperture.toFixed(2)} m²`;

      const distStr = dKm < 1 ? `${Math.round(dKm * 1000)} m` : `${dKm.toFixed(2)} km`;
      const freqStr = `${fMHz.toFixed(2)} MHz`;
      const phaseStr = `${Math.round(Math.random() * 360)}°`;

      setStats({
        distance: distStr,
        frequency: freqStr,
        phase: phaseStr,
        aperture: apertureStr
      });
    }
  });

  return (
    <group position={[-4.1, -1.6, 0.4]}>
      <CanvasText position={[0, 0.5, 0]} fontSize={0.16} color="#3a3a42" anchorX="left" fontWeight={700} text="Distance:" />
      <CanvasText position={[2.7, 0.5, 0]} fontSize={0.16} color="#1a1a22" anchorX="right" text={stats.distance} />

      <CanvasText position={[0, 0.1, 0]} fontSize={0.16} color="#3a3a42" anchorX="left" fontWeight={700} text="Frequency:" />
      <CanvasText position={[2.7, 0.1, 0]} fontSize={0.16} color="#1a1a22" anchorX="right" text={stats.frequency} />

      <CanvasText position={[0, -0.3, 0]} fontSize={0.16} color="#3a3a42" anchorX="left" fontWeight={700} text="Phase:" />
      <CanvasText position={[2.7, -0.3, 0]} fontSize={0.16} color="#1a1a22" anchorX="right" text={stats.phase} />

      <CanvasText position={[0, -0.7, 0]} fontSize={0.16} color="#3a3a42" anchorX="left" fontWeight={700} text="Aperture (for -22dBm):" />
      <CanvasText position={[2.7, -1.0, 0]} fontSize={0.18} color="#1a1a22" anchorX="right" fontWeight={700} text={stats.aperture} />
    </group>
  );
};

const TimeOfFlightCanvas: React.FC = () => {
  return (
    <CanvasHarness aspectRatio="10 / 6.4">
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <RendererBadgeText>Time of Flight</RendererBadgeText>
        <CanvasImage
          src="hex-small-cell-tower.svg"
          alt="Antenna"
          position="absolute"
          left="4%"
          bottom="0px"
          height="65%"
          zIndex={10}
          pointerEvents="none"
        />
        <Canvas
          style={{ position: 'relative', zIndex: 20 }}
          orthographic
          dpr={[1, 2]}
          camera={{ position: [0, 0, 10] }}
          gl={{ antialias: true, alpha: true }}
        >
          <React.Suspense fallback={null}>
            <SceneContents />
          </React.Suspense>
        </Canvas>
      </div>
    </CanvasHarness>
  );
};

// Frame removed because CanvasHarness handles the container, aspect ratio, and background logic.
const RendererBadgeText = styled.div`
  position: absolute;
  top: 14px;
  left: 16px;
  font-size: ${theme.fontSizes.canvasTitle};
  letter-spacing: 0.04em;
  font-family: ${theme.fonts.mono};
  color: ${theme.colors.text};
  z-index: 20;
  pointer-events: none;
`;

export { TimeOfFlightCanvas };
