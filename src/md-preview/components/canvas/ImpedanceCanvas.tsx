import { useEffect, useRef, useMemo, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import styled, { keyframes } from "styled-components";

import { theme } from "../../theme";

const BACKGROUND = theme.colors.background;

// Color variables
const COLORS = {
  background: theme.colors.background,
  textPrimary: theme.colors.text,
  textSecondary: "rgba(42, 42, 42, 0.8)",
  textTertiary: "rgba(42, 42, 42, 0.6)",
  textMuted: "rgba(92, 92, 92, 0.7)",
  textLight: "rgba(92, 92, 92, 0.6)",
  borderPrimary: "rgba(42, 42, 42, 0.3)",
  borderSecondary: "rgba(42, 42, 42, 0.2)",
  backgroundLight: "rgba(255, 255, 255, 0.8)",
  backgroundMedium: "rgba(255, 255, 255, 0.6)",
  dot: "rgba(42, 42, 42, 0.5)"
};

// Font family variables
const FONTS = {
  mono: theme.fonts.mono,
  monoShort: theme.fonts.mono,
  serif: '"Cambria Math", "Georgia", "Times New Roman", serif'
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── Main traveling wave with impedance zone ──────────────────────────────────
const mainWaveFragment = /* glsl */ `
  uniform float uTime;
  uniform float uObjectCenter;
  uniform float uObjectRadius;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    float x = vUv.x;
    float aspect = uResolution.x / uResolution.y;

    float objDist = abs(x - uObjectCenter) / uObjectRadius;
    float inObj = 1.0 - smoothstep(0.78, 1.12, objDist);

    float baseFreq = 2.1;
    float localFreq = mix(baseFreq, baseFreq * 2.8, inObj);
    float baseAmp = 0.4;
    float localAmp = mix(baseAmp, baseAmp * 0.35, inObj);

    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= aspect;

    float x0 = uv.x * 3.5;
    float y0 = uv.y;

    float minDist = 1e9;
    const int N = 6;
    float span = 0.35;

    for (int i = 0; i < N; i++) {
      float tSample = float(i) / float(N - 1);
      float xSample = x0 + mix(-span, span, tSample);
      float ySample = sin(xSample * localFreq - uTime * 2.4) * localAmp;
      float d = length(vec2((xSample - x0) / 6.28318, ySample - y0));
      minDist = min(minDist, d);
    }

    float thickness = 0.03;
    float aa = fwidth(minDist);
    float line = smoothstep(thickness + aa, thickness - aa, minDist);

    // Color: vibrant purple-magenta left → softer lavender right
    vec3 leftColor  = vec3(0.76, 0.22, 1.0);
    vec3 midColor   = vec3(0.58, 0.36, 0.96);
    vec3 rightColor = vec3(0.62, 0.55, 0.82);
    float t = smoothstep(0.0, 1.0, x);
    vec3 color = mix(leftColor, midColor, smoothstep(0.0, 0.42, t));
    color = mix(color, rightColor, smoothstep(0.42, 1.0, t));

    // Inside object: deeper blue shift
    vec3 objColor = vec3(0.35, 0.30, 0.78);
    color = mix(color, objColor, inObj * 0.65);

    gl_FragColor = vec4(color, line);
  }
`;

// ── Ghost echo waves (secondary harmonics) ───────────────────────────────────
const ghostWaveFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIndex;
  uniform float uObjectCenter;
  uniform float uObjectRadius;
  varying vec2 vUv;

  void main() {
    float x = vUv.x;
    float worldX = x * 12.0 - 6.0;

    float objDist = abs(x - uObjectCenter) / uObjectRadius;
    float inObj = 1.0 - smoothstep(0.78, 1.12, objDist);

    float freq = mix(3.8, 3.8 * 2.8, inObj);
    float amp = mix(0.17, 0.17 * 0.35, inObj);

    float phaseOff = uIndex * 0.45;
    float ampScale = 0.5 - uIndex * 0.15;

    float wave = sin(worldX * freq * (0.98 + uIndex * 0.04) - uTime * 2.4 + phaseOff) * amp * ampScale;
    float y = 0.5 + wave;

    float thickness = 0.008;
    float dist = abs(vUv.y - y);
    float line = smoothstep(thickness, thickness * 0.1, dist);
    float glow = smoothstep(thickness * 12.0, thickness * 0.5, dist) * 0.15;

    vec3 color = vec3(0.6, 0.35, 0.95);
    color = mix(color, vec3(0.35, 0.28, 0.72), inObj * 0.6);

    float t = smoothstep(0.0, 1.0, x);
    float alphaGrad = mix(0.45, 0.08, t);
    alphaGrad = mix(alphaGrad, max(alphaGrad, 0.35), inObj);
    float edgeFade = smoothstep(0.0, 0.04, x) * smoothstep(1.0, 0.96, x);

    float alpha = (line * 0.3 + glow) * alphaGrad * edgeFade;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ── Object inner wave ────────────────────────────────────────────────────────
const innerWaveFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p);

    float circleMask = 1.0 - smoothstep(0.42, 0.47, r);

    // Multiple internal resonance lines
    float totalAlpha = 0.0;
    vec3 totalColor = vec3(0.0);

    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float freq = 18.0 + fi * 1.0;
      float speed = 1.4 + fi * 0.2 + sin(fract(uTime * 0.7 + fi * 1.3) * 6.28318) * 0.15;
      float amp = 0.035 - fi * 0.018;
      float yOff = (fi - 2.0) * 0.19;

      float phaseOffset = fract(uTime * 0.4 + fi * 0.9) * 6.28318;
      float wave = sin(p.x * freq + uTime * speed + fi * 1.2 + phaseOffset) * amp;
      float dist = abs(p.y - yOff - wave);
      float line = smoothstep(0.010, 0.009, dist);
      float glow = smoothstep(0.05, 0.002, dist) * 0.25;

      vec3 col = mix(vec3(0.35, 0.38, 0.62), vec3(0.5, 0.45, 0.75), fi / 2.0);
      totalColor += col * (line + glow);
      totalAlpha += (line * 0.6 + glow) * (0.7 - fi * 0.15);
    }

    totalAlpha *= circleMask;

    gl_FragColor = vec4(totalColor, totalAlpha);
  }
`;

// ── Object rim glow shader ───────────────────────────────────────────────────
const rimGlowFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p);

    // Soft ring glow
    float ring = smoothstep(0.50, 0.44, r) * smoothstep(0.38, 0.44, r);
    float outerGlow = smoothstep(0.55, 0.42, r) * 0.15;

    // Subtle pulse
    float pulse = 0.85 + 0.15 * sin(uTime * 1.2);

    vec3 color = vec3(0.5, 0.45, 0.72);
    float alpha = (ring * 0.5 + outerGlow) * pulse;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ── Particle field background ────────────────────────────────────────────────
const particleFragment = /* glsl */ `
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    uv.x *= aspect;

    float brightness = 0.0;

    for (int i = 0; i < 60; i++) {
      float fi = float(i);
      vec2 seed = vec2(fi * 0.173, fi * 0.391);
      vec2 pos = vec2(hash(seed) * aspect, hash(seed + 1.0));

      // Gentle drift
      pos.x += sin(uTime * 0.15 + fi * 0.5) * 0.02;
      pos.y += cos(uTime * 0.12 + fi * 0.7) * 0.015;

      float d = length(uv - pos);
      float size = 0.001 + hash(seed + 2.0) * 0.002;
      float twinkle = 0.5 + 0.5 * sin(uTime * (0.5 + hash(seed + 3.0) * 1.5) + fi);
      brightness += smoothstep(size, 0.0, d) * twinkle * (0.3 + hash(seed + 4.0) * 0.7);
    }

    vec3 color = vec3(0.5, 0.45, 0.75) * brightness;
    gl_FragColor = vec4(color, brightness * 0.5);
  }
`;

// ── Grid overlay ─────────────────────────────────────────────────────────────
const gridFragment = /* glsl */ `
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    uv.x *= aspect;

    float gridSize = 0.06;
    vec2 grid = abs(fract(uv / gridSize - 0.5) - 0.5) / fwidth(uv / gridSize);
    float line = min(grid.x, grid.y);
    float gridAlpha = 1.0 - min(line, 1.0);

    vec3 color = vec3(0.35, 0.32, 0.55);
    gl_FragColor = vec4(color, gridAlpha * 0.06);
  }
`;

// STYLED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const subtlePulse = keyframes`
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
`;

const Frame = styled.div`
  width: 100%;
  margin: 0;
  border-radius: 18px;
  overflow: hidden;
  background: ${BACKGROUND};
  aspect-ratio: 1.7 / 1;
  position: relative;
  border: 1px solid rgba(107, 90, 205, 0.15);
  box-shadow:
    0 0 60px rgba(107, 90, 205, 0.08),
    0 4px 24px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }
`;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
`;

const TopBar = styled.div`
  text-align: center;
  padding-top: 3%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;

const Title = styled.div`
  font-family: ${FONTS.mono};
  font-size: clamp(.85rem, 2vw, 1.85rem);
  font-weight: 700;
  color: ${COLORS.textPrimary};
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.45);
  letter-spacing: -0.02em;
  margin-top: 4px;
`;

const LabelRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1.5% 4% 0;
  gap: 2%;
  margin-top: 5%;
`;

const LabelCell = styled.div<{ $align?: string }>`
  display: flex;
  flex-direction: column;
  align-items: ${({ $align }) =>
    $align === "left" ? "flex-start" : "flex-end"};
  text-align: ${({ $align }) => $align};
  flex-shrink: 0;
`;

const LabelMain = styled.span`
  font-family: ${FONTS.mono};
  font-size: clamp(1.2rem, 4vw, 2.7rem);
  font-weight: 700;
  color: ${COLORS.textPrimary};
  line-height: 1.2;
`;

const LabelSub = styled.span`
  font-family: ${FONTS.monoShort};
  font-size: clamp(0.55rem, 1vw, 0.78rem);
  font-weight: 400;
  color: ${COLORS.textMuted};
  line-height: 1.2;
`;

const ImprintLabel = styled.div`
  position: absolute;
  top: 35%;
  right: 16%;
`;

const ImprintPill = styled.span`
  font-family: ${FONTS.monoShort};
  font-size: clamp(0.55rem, 1vw, 0.78rem);
  font-weight: 500;
  color: ${COLORS.textSecondary};
  background: ${COLORS.backgroundMedium};
  border: 1px solid ${COLORS.borderSecondary};
  border-radius: 6px;
  padding: 3px 10px;
  letter-spacing: 0.03em;
`;

const EquationBox = styled.div`
  position: absolute;
  bottom: 15%;
  right: 5%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
`;

const EqLabel = styled.span`
  font-family: ${FONTS.monoShort};
  font-size: clamp(0.42rem, 0.7vw, 0.55rem);
  font-weight: 500;
  color: ${COLORS.textTertiary};
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Equation = styled.div`
  font-family: ${FONTS.serif};
  font-size: clamp(.5rem, 2vw, 1.6rem);
  color: ${COLORS.textPrimary};
  letter-spacing: 0.02em;

  i {
    font-style: italic;
  }
`;

const BottomMeta = styled.div`
  position: absolute;
  bottom: 9%;
  left: 4%;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ${FONTS.monoShort};
  font-size: clamp(.3rem, 1.4vw, 10px);
  color: ${COLORS.textLight};
  letter-spacing: 0.02em;
`;

const TargetLabelContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: max-content;
  max-width: min(42vw, 22rem);
  padding: clamp(2px, 0.6vw, 6px) clamp(6px, 1vw, 12px);
  border-radius: 8px;
`;

const TargetMain = styled.span`
  font-family: ${FONTS.mono};
  font-size: clamp(.75rem, 1.1vw, 1.55rem);
  font-weight: 700;
  color: ${COLORS.textPrimary};
  line-height: 1.2;
  margin-bottom: clamp(1px, 0.2vw, 3px);
`;

const TargetSub = styled.span`
  font-family: ${FONTS.monoShort};
  font-size: clamp(0.4rem, .75vw, 0.88rem);
  font-weight: 400;
  color: ${COLORS.textMuted};
  line-height: 1.2;
`;

const MetaText = styled.span`
  /* Additional styling if needed */
`;

const MetaDot = styled.span`
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: ${COLORS.dot};
  animation: ${subtlePulse} 3s ease-in-out infinite;
`;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const ParticleField = () => {
  const matRef = useRef<any>(null);
  const { size } = useThree();
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
  }), []);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  useEffect(() => {
    if (matRef.current) {
      matRef.current.uniforms.uResolution.value.set(size.width, size.height);
    }
  }, [size]);

  return (
    <mesh position={[0, 0, -0.5]} frustumCulled={false}>
      <planeGeometry args={[14, 8]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={particleFragment}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
};

const GridOverlay = () => {
  const matRef = useRef<any>(null);
  const { size } = useThree();
  const uniforms = useMemo(() => ({
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
  }), []);

  useEffect(() => {
    if (matRef.current) {
      matRef.current.uniforms.uResolution.value.set(size.width, size.height);
    }
  }, [size]);

  return (
    <mesh position={[0, 0, -0.3]} frustumCulled={false}>
      <planeGeometry args={[14, 8]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={gridFragment}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
};

const MovingWave = () => {
  const matRef = useRef<any>(null);
  const { size } = useThree();

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uObjectCenter: { value: 0.5 },
    uObjectRadius: { value: 0.115 },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
  }), []);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <mesh position={[0, -0.35, 0.1]} frustumCulled={false}>
      <planeGeometry args={[11.5, 4.0]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={mainWaveFragment}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
};

const GhostWave = ({ index }: { index: number }) => {
  const matRef = useRef<any>(null);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIndex: { value: index },
    uObjectCenter: { value: 0.5 },
    uObjectRadius: { value: 0.115 },
  }), [index]);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <mesh position={[0, -0.35, 0.08 - index * 0.01]} frustumCulled={false}>
      <planeGeometry args={[11.5, 4.0]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={ghostWaveFragment}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
};

const ImpedanceObject = () => {
  const innerRef = useRef<any>(null);
  const rimRef = useRef<any>(null);

  const innerUniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const rimUniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame(({ clock }) => {
    if (innerRef.current) innerRef.current.uniforms.uTime.value = clock.elapsedTime;
    if (rimRef.current) rimRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <group position={[0, -0.35, 0.2]}>
      {/* Outer glow */}
      <mesh position={[0, 0, -0.02]}>
        <circleGeometry args={[1.55, 128]} />
        <meshBasicMaterial color="#2a2545" transparent opacity={0.3} />
      </mesh>
      {/* Main circle */}
      <mesh>
        <circleGeometry args={[1.28, 128]} />
        <meshBasicMaterial color="#181828" transparent opacity={0.88} />
      </mesh>
      {/* Rim glow */}
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[3.2, 3.2]} />
        <shaderMaterial
          ref={rimRef}
          uniforms={rimUniforms}
          vertexShader={vertexShader}
          fragmentShader={rimGlowFragment}
          transparent
          depthWrite={false}
        />
      </mesh>
      {/* Inner waves */}
      <mesh position={[0, 0, 0.05]}>
        <planeGeometry args={[2.56, 2.56]} />
        <shaderMaterial
          ref={innerRef}
          uniforms={innerUniforms}
          vertexShader={vertexShader}
          fragmentShader={innerWaveFragment}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

// ── Arrow with glow ──────────────────────────────────────────────────────────
const ArrowLine = ({ from, to, headSize = 0.22, color = "#4a4570", glowColor = "#6b5acd" }: { from: [number, number, number]; to: [number, number, number]; headSize?: number; color?: string; glowColor?: string }) => {
  const geo = useMemo(() => {
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], 0).normalize();
    const perp = new THREE.Vector3(-dir.y, dir.x, 0);
    const tip = new THREE.Vector3(...to);
    const base1 = tip.clone().sub(dir.clone().multiplyScalar(headSize)).add(perp.clone().multiplyScalar(headSize * 0.48));
    const base2 = tip.clone().sub(dir.clone().multiplyScalar(headSize)).sub(perp.clone().multiplyScalar(headSize * 0.48));

    const hw = Math.max(0.012, headSize * 0.08);
    const shaftStart = new THREE.Vector3(...from);
    const shaftEnd = tip.clone().sub(dir.clone().multiplyScalar(headSize * 0.15));
    const s1 = shaftStart.clone().add(perp.clone().multiplyScalar(hw));
    const s2 = shaftStart.clone().sub(perp.clone().multiplyScalar(hw));
    const s3 = shaftEnd.clone().add(perp.clone().multiplyScalar(hw));
    const s4 = shaftEnd.clone().sub(perp.clone().multiplyScalar(hw));

    const verts = new Float32Array([
      s1.x, s1.y, 0, s2.x, s2.y, 0, s3.x, s3.y, 0,
      s2.x, s2.y, 0, s4.x, s4.y, 0, s3.x, s3.y, 0,
      tip.x, tip.y, 0, base1.x, base1.y, 0, base2.x, base2.y, 0,
    ]);

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }, [from, to, headSize]);

  // Glow version
  const glowGeo = useMemo(() => {
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], 0).normalize();
    const perp = new THREE.Vector3(-dir.y, dir.x, 0);
    const tip = new THREE.Vector3(...to);
    const shaftStart = new THREE.Vector3(...from);
    const shaftEnd = tip.clone().sub(dir.clone().multiplyScalar(headSize * 0.15));

    const hw = Math.max(0.04, headSize * 0.28);
    const s1 = shaftStart.clone().add(perp.clone().multiplyScalar(hw));
    const s2 = shaftStart.clone().sub(perp.clone().multiplyScalar(hw));
    const s3 = shaftEnd.clone().add(perp.clone().multiplyScalar(hw));
    const s4 = shaftEnd.clone().sub(perp.clone().multiplyScalar(hw));

    const verts = new Float32Array([
      s1.x, s1.y, 0, s2.x, s2.y, 0, s3.x, s3.y, 0,
      s2.x, s2.y, 0, s4.x, s4.y, 0, s3.x, s3.y, 0,
    ]);

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return g;
  }, [from, to, headSize]);

  return (
    <group>
      <mesh geometry={glowGeo} position={[0, 0, 0.11]}>
        <meshBasicMaterial color={glowColor} transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geo} position={[0, 0, 0.12]}>
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

const UpArrowLine = () => (
  <ArrowLine
    from={[2.78, -1.85, 0]}
    to={[2.78, -1.38, 0]}
    headSize={0.13}
    color="#4a4570"
    glowColor="#6b5acd"
  />
);

const TargetLabel = () => (
  <Html position={[0, 1.7, 0]} transform center>
    <TargetLabelContainer>
      <TargetMain>Target</TargetMain>
      <TargetSub>(with its own electrical activity)</TargetSub>
    </TargetLabelContainer>
  </Html>
);

// ── Scene ────────────────────────────────────────────────────────────────────
const SceneContents = () => {
  const { camera, size } = useThree();
  const showUpArrow = size.width >= 500;

  useEffect(() => {
    if (camera.type === "OrthographicCamera") {
      const ortho = camera;
      ortho.zoom = size.width / 11;
      ortho.updateProjectionMatrix();
    }
  }, [camera, size]);

  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <ParticleField />
      <GridOverlay />
      <GhostWave index={1} />
      <GhostWave index={2} />
      <MovingWave />
      <ImpedanceObject />
      <TargetLabel />
      {showUpArrow ? <UpArrowLine /> : null}
    </>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════

const ImpedanceCanvas = () => {
  const [showImprint, setShowImprint] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 500;
  });

  useEffect(() => {
    const updateShowImprint = () => setShowImprint(window.innerWidth >= 500);
    updateShowImprint();
    window.addEventListener("resize", updateShowImprint);
    return () => window.removeEventListener("resize", updateShowImprint);
  }, []);

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

      <Overlay>
        <TopBar>
          <Title>Impedance</Title>
        </TopBar>

        <LabelRow>
          <LabelCell $align="left">
            <LabelMain>Tx</LabelMain>
            <LabelSub>(transmit)</LabelSub>
          </LabelCell>
          <LabelCell $align="right">
            <LabelMain>Rx</LabelMain>
            <LabelSub>(receive)</LabelSub>
          </LabelCell>
        </LabelRow>

        {showImprint ? (
          <ImprintLabel>
            <ImprintPill>Original + Imprint</ImprintPill>
          </ImprintLabel>
        ) : null}

        <EquationBox>
          <EqLabel>Differential / Difference</EqLabel>
          <Equation>
            <i>dx</i>&nbsp;=&nbsp;<i>x</i>(<i>t</i>&nbsp;+&nbsp;<i>dt</i>)&nbsp;−&nbsp;<i>x</i>(<i>t</i>)
          </Equation>
        </EquationBox>

        <BottomMeta>
          <MetaDot />
          <MetaText>λ (wavelength) compresses inside medium</MetaText>
          <MetaDot />
          <MetaText>Amplitude attenuates</MetaText>
        </BottomMeta>
      </Overlay>
    </Frame>
  );
};

export { ImpedanceCanvas };