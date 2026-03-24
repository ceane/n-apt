import React, { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import styled from "styled-components";

const BACKGROUND = "#ffffff";

// ─── Shared vertex shader ──────────────────────────────────────────────────────
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ─── Main sine wave ────────────────────────────────────────────────────────────
// Continuous sine scrolling right. Purple on left → pale lavender on right.
// Inside the object zone the wavelength compresses (v = c/√ε → shorter λ)
// and the amplitude reduces (absorption). Smooth transition at boundaries.
const mainWaveFragment = /* glsl */ `
  uniform float uTime;
  uniform float uObjectCenter; // object center in UV x
  uniform float uObjectRadius; // object radius in UV x
  varying vec2 vUv;

  void main() {
    float x = vUv.x;
    float worldX = x * 12.0 - 6.0;

    // How deep inside the object are we? 0 = outside, 1 = dead center
    float objDist = abs(x - uObjectCenter) / uObjectRadius;
    float inObj = 1.0 - smoothstep(0.82, 1.08, objDist); // gradual boundary

    // Wavelength compression: frequency increases ~2.5x inside (like √ε ≈ 2.5)
    float baseFreq = 3.6;
    float localFreq = mix(baseFreq, baseFreq * 2.5, inObj);

    // Amplitude reduces inside object (absorption)
    float baseAmp = 0.19;
    float localAmp = mix(baseAmp, baseAmp * 0.42, inObj);

    // Phase accumulation — integrate frequency along x for continuous phase.
    // Use the same sine with blended freq so wave stays connected at edges.
    float wave = sin(worldX * localFreq - uTime * 2.6) * localAmp;
    float y = 0.5 + wave;

    // Stroke: slightly thinner inside object
    float thickness = mix(0.026, 0.016, inObj);
    float dist = abs(vUv.y - y);
    float line = smoothstep(thickness, thickness * 0.15, dist);

    // Color gradient left→right
    vec3 leftColor  = vec3(0.69, 0.18, 1.0);
    vec3 midColor   = vec3(0.72, 0.50, 0.92);
    vec3 rightColor = vec3(0.76, 0.68, 0.88);
    float t = smoothstep(0.0, 1.0, x);
    vec3 color = mix(leftColor, midColor, smoothstep(0.0, 0.45, t));
    color = mix(color, rightColor, smoothstep(0.45, 1.0, t));

    // Inside object: shift color slightly bluer (medium interaction)
    vec3 objColor = vec3(0.55, 0.38, 0.88);
    color = mix(color, objColor, inObj * 0.55);

    // Alpha gradient: strong left, gentle fade right
    float alphaGrad = mix(1.0, 0.28, smoothstep(0.0, 1.0, t));

    // Inside object: keep the wave visible (slight alpha boost so compression reads)
    alphaGrad = mix(alphaGrad, max(alphaGrad, 0.7), inObj);

    // Edge fade
    float edgeFade = smoothstep(0.0, 0.025, x) * smoothstep(1.0, 0.975, x);

    gl_FragColor = vec4(color, line * alphaGrad * edgeFade);
  }
`;

// ─── Object's own wave — the medium's intrinsic oscillation ─────────────────
// This is distinct from the compressed radio wave — it represents the object's
// own resonant response / internal impedance characteristic.
const innerWaveFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p);

    float circleMask = 1.0 - smoothstep(0.44, 0.48, r);

    // Object's own wave — different frequency & phase from the radio wave
    // Slower, slightly offset vertically to visually separate from radio wave
    float wave = sin(p.x * 22.0 + uTime * 1.8) * 0.04;
    float yOffset = -0.04; // sit slightly below the radio wave centerline
    float dist = abs(p.y - yOffset - wave);
    float line = smoothstep(0.014, 0.002, dist);

    // Muted blue-gray, distinct from the purple radio wave
    vec3 color = vec3(0.45, 0.48, 0.68);
    float alpha = line * circleMask * 0.65;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ─── Moving wave component ────────────────────────────────────────────────────
const MovingWave: React.FC = () => {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = React.useMemo(() => ({
    uTime: { value: 0 },
    uObjectCenter: { value: 0.40 },
    uObjectRadius: { value: 0.115 },
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

// ─── Gray circle object with inner wave ───────────────────────────────────────
const ImpedanceObject: React.FC = () => {
  const innerRef = useRef<THREE.ShaderMaterial>(null);

  const innerUniforms = React.useMemo(() => ({
    uTime: { value: 0 },
  }), []);

  useFrame(({ clock }) => {
    if (innerRef.current) {
      innerRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <group position={[-0.7, -0.35, 0.2]}>
      <mesh>
        <circleGeometry args={[1.28, 128]} />
        <meshBasicMaterial color="#d8d8d8" transparent opacity={0.82} />
      </mesh>
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

// ─── Arrow built from a BufferGeometry line for crisp connected arrowhead ─────
const ArrowLine: React.FC<{
  from: [number, number, number];
  to: [number, number, number];
  headSize?: number;
  color?: string;
  lineWidth?: number;
}> = ({ from, to, headSize = 0.22, color = "#bfbfbf" }) => {
  const geo = React.useMemo(() => {
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], 0).normalize();
    const perp = new THREE.Vector3(-dir.y, dir.x, 0);
    const tip = new THREE.Vector3(...to);
    const base1 = tip.clone().sub(dir.clone().multiplyScalar(headSize)).add(perp.clone().multiplyScalar(headSize * 0.48));
    const base2 = tip.clone().sub(dir.clone().multiplyScalar(headSize)).sub(perp.clone().multiplyScalar(headSize * 0.48));

    // Shaft as a thin quad
    const hw = 0.022; // half-width of shaft
    const shaftStart = new THREE.Vector3(...from);
    const shaftEnd = tip.clone().sub(dir.clone().multiplyScalar(headSize * 0.15));
    const s1 = shaftStart.clone().add(perp.clone().multiplyScalar(hw));
    const s2 = shaftStart.clone().sub(perp.clone().multiplyScalar(hw));
    const s3 = shaftEnd.clone().add(perp.clone().multiplyScalar(hw));
    const s4 = shaftEnd.clone().sub(perp.clone().multiplyScalar(hw));

    const verts = new Float32Array([
      // shaft quad (2 tris)
      s1.x, s1.y, 0, s2.x, s2.y, 0, s3.x, s3.y, 0,
      s2.x, s2.y, 0, s4.x, s4.y, 0, s3.x, s3.y, 0,
      // arrowhead triangle
      tip.x, tip.y, 0, base1.x, base1.y, 0, base2.x, base2.y, 0,
    ]);

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }, [from, to, headSize]);

  return (
    <mesh geometry={geo} position={[0, 0, 0.12]}>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  );
};

// ─── Up-arrow for equation ────────────────────────────────────────────────────
const UpArrowLine: React.FC = () => (
  <ArrowLine
    from={[2.6, -1.72, 0]}
    to={[2.6, -1.18, 0]}
    headSize={0.16}
    color="#c4c4c4"
  />
);

// ─── Scene composition ────────────────────────────────────────────────────────
const SceneContents: React.FC = () => {
  const { camera, size } = useThree();

  useEffect(() => {
    if (camera.type === "OrthographicCamera") {
      const ortho = camera as THREE.OrthographicCamera;
      ortho.zoom = size.width / 11;
      ortho.updateProjectionMatrix();
    }
  }, [camera, size]);

  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <MovingWave />
      <ImpedanceObject />
      <ArrowLine from={[-3.4, 1.18, 0]} to={[3.6, 1.18, 0]} headSize={0.24} />
      <UpArrowLine />
    </>
  );
};

// ─── Root component ───────────────────────────────────────────────────────────
const ImpedanceCanvas: React.FC = () => {
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
        <Title>Impedance</Title>
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
        <ImprintLabel>Original + Imprint</ImprintLabel>

        <Equation>
          <i>dx</i>&nbsp;=&nbsp;<i>x</i>(<i>t</i>&nbsp;+&nbsp;<i>dt</i>)&nbsp;−&nbsp;<i>x</i>(<i>t</i>)
        </Equation>
      </Overlay>
    </Frame>
  );
};

// ─── Styled components ────────────────────────────────────────────────────────
const Frame = styled.div`
  width: 100%;
  margin: 2rem 0;
  border-radius: 14px;
  overflow: hidden;
  background: ${BACKGROUND};
  aspect-ratio: 2.05 / 1;
  position: relative;
  border: 1px solid rgba(20, 20, 20, 0.06);

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

const Title = styled.div`
  text-align: center;
  padding-top: 2.5%;
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
  font-size: 18px;
  font-weight: 700;
  color: #111;
  letter-spacing: 0.02em;
`;

const LabelRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1.2% 3% 0;
  gap: 2%;
`;

const LabelCell = styled.div<{ $align: "left" | "center" | "right" }>`
  display: flex;
  flex-direction: column;
  align-items: ${({ $align }) =>
    $align === "left" ? "flex-start" : $align === "right" ? "flex-end" : "center"};
  text-align: ${({ $align }) => $align};
  flex-shrink: 0;
  min-width: 0;
`;

const LabelMain = styled.span`
  font-family: "Courier New", "Courier", monospace;
  font-size: clamp(0.68rem, 1.3vw, 0.98rem);
  font-weight: 600;
  color: #333;
  line-height: 1.2;
  white-space: nowrap;
`;

const LabelSub = styled.span`
  font-family: "Courier New", "Courier", monospace;
  font-size: clamp(0.62rem, 1.1vw, 0.88rem);
  font-weight: 500;
  color: #555;
  line-height: 1.2;
`;

const ImprintLabel = styled.div`
  position: absolute;
  top: 20%;
  right: 18%;
  font-family: "Courier New", "Courier", monospace;
  font-size: clamp(0.68rem, 1.3vw, 0.98rem);
  font-weight: 600;
  color: #333;
  white-space: nowrap;
`;

const Equation = styled.div`
  position: absolute;
  bottom: 5%;
  right: 7%;
  font-family: "Times New Roman", "Georgia", serif;
  font-size: clamp(1.05rem, 2vw, 1.7rem);
  color: #222;
  letter-spacing: 0.02em;

  i {
    font-style: italic;
  }
`;

export default ImpedanceCanvas;
