import React, { useState, useMemo, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, Line, OrthographicCamera } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Leva, useControls } from 'leva';
import styled from 'styled-components';

const FONT_URL = 'https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@master/fonts/ttf/JetBrainsMono-Regular.ttf';

const COLORS = {
  bg: '#E0E0E2',
  grid: '#D6D7D9', // Grid lines and ticks
  axis: '#D6D7D9',
  dashed: '#6B7280',
  solid: '#8B5CF6', // Purple
  text: '#000000',
  accent: '#1180FF' // Arrow and degrees
};

const CanvasContainer = styled.div`
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  background-color: ${COLORS.bg};
  aspect-ratio: 16/9;
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
`;

const TextOverlay = styled.div`
  position: absolute;
  top: 14px;
  left: 16px;
  z-index: 2;
  pointer-events: none;
`;

const Title = styled.h1`
  font-size: clamp(0.2rem, 1vw, 1rem);
  letter-spacing: 0.04em;
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
  color: ${COLORS.text};
  margin: 0;
  font-weight: 600;

  @media (max-width: 640px) {
    top: 10px;
    left: 12px;
    font-size: 0.78rem;
  }
`;

const Formula = styled.div`
  font-size: clamp(0.72rem, 1.2vw, 1rem);
  font-weight: 600;
  color: ${COLORS.text};
  margin: 0.25rem 0;
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
`;

const SubLabel = styled.div`
  font-size: clamp(0.55rem, 1vw, 0.78rem);
  color: #6B7280;
  margin: 0.25rem 0;
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
`;

const ControlPanel = styled.div`
  position: absolute;
  top: 1.5rem;
  right: 1.5rem;
  z-index: 10;
  width: 20rem;
  max-width: calc(100vw - 2rem);
  pointer-events: auto;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid rgba(42, 42, 42, 0.3);
  background-color: rgba(255, 255, 255, 0.8);
`;

function formatPiLabel(i: number, f: number) {
  let n = Math.round(i * 10);
  let d = Math.round(4 * f * 10);
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(Math.abs(n), Math.abs(d));
  n = n / divisor;
  d = d / divisor;

  if (n === 0) return '0';

  let numStr = '';
  if (n === 1) numStr = 'π';
  else if (n === -1) numStr = '-π';
  else numStr = `${n}π`;

  if (d === 1) return numStr;
  return `${numStr}/${d}`;
}

function Grid2D({ frequency }: { frequency: number }) {
  const lines = [];
  const stepX = Math.PI / (4 * frequency);
  const maxI = Math.ceil(10 * Math.PI / stepX);

  // Vertical lines
  for (let i = -maxI; i <= maxI; i++) {
    const x = i * stepX;
    const isMajor = i % 4 === 0;
    lines.push(
      <Line
        key={`v${i}`}
        points={[[x, -20, -1], [x, 20, -1]]}
        color={COLORS.grid}
        lineWidth={isMajor ? 2 : 1}
        opacity={isMajor ? 1 : 0.5}
        transparent
      />
    );
  }

  // Horizontal lines
  for (let i = -40; i <= 40; i++) {
    const y = i * 0.5;
    const isMajor = i % 2 === 0;
    lines.push(
      <Line
        key={`h${i}`}
        points={[[-35, y, -1], [35, y, -1]]}
        color={COLORS.grid}
        lineWidth={isMajor ? 2 : 1}
        opacity={isMajor ? 1 : 0.5}
        transparent
      />
    );
  }
  return <group>{lines}</group>;
}

function Axes({ frequency }: { frequency: number }) {
  const xLabels = [];
  const stepX = Math.PI / (4 * frequency);
  const maxI = Math.ceil(10 * Math.PI / stepX);

  for (let i = -maxI; i <= maxI; i++) {
    if (i === 0) continue;
    const x = i * stepX;

    let shouldLabel = true;
    if (stepX < 0.4 && i % 2 !== 0) shouldLabel = false;
    if (stepX < 0.2 && i % 4 !== 0) shouldLabel = false;

    xLabels.push({
      pos: x,
      label: shouldLabel ? formatPiLabel(i, frequency) : ''
    });
  }

  const yLabels = [];
  for (let i = -20; i <= 20; i++) {
    if (i === 0) continue;
    const y = i * 0.5;
    yLabels.push({ pos: y, label: y.toFixed(1) });
  }

  return (
    <group>
      {/* X Axis */}
      <Line points={[[-35, 0, 0], [35, 0, 0]]} color={COLORS.axis} lineWidth={2} />
      {/* Y Axis */}
      <Line points={[[0, -15, 0], [0, 15, 0]]} color={COLORS.axis} lineWidth={2} />

      {/* Labels */}
      <Text font={FONT_URL} position={[33.5, 0.4, 0]} fontSize={0.3} color={COLORS.text}>x</Text>
      <Text font={FONT_URL} position={[0.4, 14.5, 0]} fontSize={0.3} color={COLORS.text}>y</Text>
      <Text font={FONT_URL} position={[-0.3, -0.3, 0]} fontSize={0.2} color={COLORS.text}>0</Text>

      {/* Tick marks X */}
      {xLabels.map(({ pos, label }, i) => (
        <group key={`x-${i}`} position={[pos, 0, 0]}>
          <Line points={[[0, -0.15, 0], [0, 0.15, 0]]} color={COLORS.axis} lineWidth={2} />
          {label && <Text font={FONT_URL} position={[0, -0.5, 0]} fontSize={0.2} color={COLORS.text}>{label}</Text>}
        </group>
      ))}

      {/* Tick marks Y */}
      {yLabels.map(({ pos, label }, i) => (
        <group key={`y-${i}`} position={[0, pos, 0]}>
          <Line points={[[-0.15, 0, 0], [0.15, 0, 0]]} color={COLORS.axis} lineWidth={2} />
          <Text font={FONT_URL} position={[-0.6, 0, 0]} fontSize={0.2} color={COLORS.text}>{label}</Text>
        </group>
      ))}
    </group>
  );
}

function Waves({ frequency }: { frequency: number }) {
  const { phaseShift, amplitude, animate, speed } = useControls({
    phaseShift: { value: 90, min: -360, max: 360, step: 1, label: 'Phase Shift (Phi, φ)' },
    amplitude: { value: 1, min: 0.1, max: 3, step: 0.1 },
    animate: { value: false, label: 'Auto Animate' },
    speed: { value: 1, min: 0.1, max: 5, step: 0.1, render: (get) => get('animate') }
  });

  const [animatedPhase, setAnimatedPhase] = useState((phaseShift * Math.PI) / 180);
  const phaseOffsetRef = useRef(0);

  useFrame((state, delta) => {
    if (animate) {
      phaseOffsetRef.current = (phaseOffsetRef.current + delta * speed) % (Math.PI * 2);
    }
    const currentPhase = ((phaseShift * Math.PI) / 180) + phaseOffsetRef.current;
    setAnimatedPhase(currentPhase);
  });

  const basePoints = useMemo(() => {
    const pts = [];
    for (let x = -35; x <= 35; x += 0.02) {
      pts.push(new THREE.Vector3(x, Math.sin(frequency * x) * amplitude, -0.1));
    }
    return pts;
  }, [amplitude, frequency]);

  const shiftedPoints = useMemo(() => {
    const pts = [];
    for (let x = -35; x <= 35; x += 0.02) {
      pts.push(new THREE.Vector3(x, Math.sin(frequency * x - animatedPhase) * amplitude, 0.1));
    }
    return pts;
  }, [amplitude, frequency, animatedPhase]);

  // Arrow points
  const arrowY = amplitude + 0.5;
  const arrowStart = 0;

  let normalizedPhase = animatedPhase % (Math.PI * 2);
  if (normalizedPhase > Math.PI) normalizedPhase -= Math.PI * 2;
  if (normalizedPhase < -Math.PI) normalizedPhase += Math.PI * 2;

  const arrowEnd = normalizedPhase / frequency;

  const arrowPoints = useMemo(() => {
    if (Math.abs(arrowEnd - arrowStart) < 0.01) return null;
    const dir = Math.sign(arrowEnd - arrowStart);
    const headSize = 0.15;
    return [
      new THREE.Vector3(arrowStart, arrowY, 1),
      new THREE.Vector3(arrowEnd, arrowY, 1),
      new THREE.Vector3(arrowEnd - dir * headSize, arrowY + headSize * 0.5, 1),
      new THREE.Vector3(arrowEnd, arrowY, 1),
      new THREE.Vector3(arrowEnd - dir * headSize, arrowY - headSize * 0.5, 1),
    ];
  }, [arrowStart, arrowEnd, arrowY]);

  const displayDegrees = Math.round((normalizedPhase * 180) / Math.PI);

  return (
    <group>
      {/* Base Wave (Dashed) */}
      <Line
        points={basePoints}
        color={COLORS.dashed}
        lineWidth={3}
        dashed={true}
        dashSize={0.15}
        gapSize={0.1}
        opacity={0.6}
        transparent
      />

      {/* Shifted Wave (Solid) */}
      <Line
        points={shiftedPoints}
        color={COLORS.solid}
        lineWidth={5}
        toneMapped={false}
      />

      {/* Phase Shift Indicator */}
      {arrowPoints && (
        <group>
          <Line
            points={arrowPoints}
            color={COLORS.accent}
            lineWidth={2}
            toneMapped={false}
          />
          <Line
            points={[[arrowStart, 0, 1], [arrowStart, arrowY, 1]]}
            color={COLORS.dashed}
            lineWidth={1}
            dashed dashSize={0.05} gapSize={0.05} opacity={0.5} transparent
          />
          <Line
            points={[[arrowEnd, 0, 1], [arrowEnd, arrowY, 1]]}
            color={COLORS.accent}
            lineWidth={1}
            dashed dashSize={0.05} gapSize={0.05} opacity={0.5} transparent
          />
          <Text font={FONT_URL} position={[arrowStart, arrowY + 0.4, 1]} fontSize={0.4} color={COLORS.dashed}>
            0°
          </Text>
          <Text font={FONT_URL} position={[arrowEnd, arrowY + 0.4, 1]} fontSize={0.4} color={COLORS.accent}>
            {`${displayDegrees}°`}
          </Text>
        </group>
      )}
    </group>
  );
}

function Scene() {
  const { frequency } = useControls({
    frequency: { value: 1, min: 0.1, max: 3, step: 0.1 }
  });

  return (
    <>
      <color attach="background" args={[COLORS.bg]} />
      <ambientLight intensity={1} />

      <Grid2D frequency={frequency} />
      <Axes frequency={frequency} />
      <Waves frequency={frequency} />

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.9} intensity={0.5} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export default function PhaseShiftingCanvas() {
  return (
    <CanvasContainer>
      <TextOverlay>
        <Title style={{
          fontSize: "20px",
          top: "10px",
          left: "12px",
          margin: "0",
          fontFamily: "JetBrains Mono, monospace",
          color: "black"
        }}>
          Phase Shifting
        </Title>
      </TextOverlay>

      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '16px',
        zIndex: 2,
        pointerEvents: 'none'
      }}>
        <Formula>y = A · sin(f·x - φ)</Formula>
        <SubLabel>φ (Phi) = Phase Shift</SubLabel>
        <SubLabel>f = Frequency</SubLabel>
        <SubLabel>A = Amplitude</SubLabel>
      </div>

      <ControlPanel>
        <Leva
          fill
          flat
          titleBar={{ title: 'Controls', filter: false }}
          theme={{
            colors: {
              elevation1: 'rgba(255, 255, 255, 0.8)',
              elevation2: '#E0E0E2',
              elevation3: 'rgba(42, 42, 42, 0.3)',
              accent1: COLORS.accent,
              accent2: COLORS.solid,
              accent3: '#f59e0b',
              highlight1: COLORS.text,
              highlight2: '#6B7280',
              highlight3: '#9ca3af',
              vivid1: COLORS.accent,
              folderWidgetColor: '#6B7280',
              folderTextColor: COLORS.text,
              toolTipBackground: 'rgba(255, 255, 255, 0.8)',
              toolTipText: COLORS.text,
            }
          }}
        />
      </ControlPanel>

      <Canvas>
        <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={50} />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </CanvasContainer>
  );
}
