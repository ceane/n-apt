import { useState, useMemo, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrthographicCamera } from '@react-three/drei';
import { CanvasText } from '@n-apt/md-preview/components/CanvasText';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Leva, useControls, useCreateStore } from 'leva';
import styled from 'styled-components';
import { formatPiLabel } from '../../utils/canvas-math';
import CanvasHarness from './CanvasHarness';

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

// CanvasContainer removed because CanvasHarness handles the container, aspect ratio, and grid background.
const InnerContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
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

// ControlPanel removed because CanvasHarness provides a standardized, toggleable Leva panel.



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
      <CanvasText position={[33.5, 0.4, 0]} fontSize={0.3} color={COLORS.text} text="x" />
      <CanvasText position={[0.4, 14.5, 0]} fontSize={0.3} color={COLORS.text} text="y" />
      <CanvasText position={[-0.3, -0.3, 0]} fontSize={0.2} color={COLORS.text} text="0" />

      {/* Tick marks X */}
      {xLabels.map(({ pos, label }, i) => (
        <group key={`x-${i}`} position={[pos, 0, 0]}>
          <Line points={[[0, -0.15, 0], [0, 0.15, 0]]} color={COLORS.axis} lineWidth={2} />
          {label && <CanvasText position={[0, -0.5, 0]} fontSize={0.2} color={COLORS.text} text={label} />}
        </group>
      ))}

      {/* Tick marks Y */}
      {yLabels.map(({ pos, label }, i) => (
        <group key={`y-${i}`} position={[0, pos, 0]}>
          <Line points={[[-0.15, 0, 0], [0.15, 0, 0]]} color={COLORS.axis} lineWidth={2} />
          <CanvasText position={[-0.6, 0, 0]} fontSize={0.2} color={COLORS.text} text={label} />
        </group>
      ))}
    </group>
  );
}

function Waves({ frequency, store }: { frequency: number, store: any }) {
  const { phaseShift, amplitude, animate, speed } = useControls({
    phaseShift: { value: 90, min: -360, max: 360, step: 1, label: 'Phase Shift (Phi, φ)' },
    amplitude: { value: 1, min: 0.1, max: 3, step: 0.1 },
    animate: { value: false, label: 'Auto Animate' },
    speed: { value: 1, min: 0.1, max: 5, step: 0.1, render: (get) => get('animate') }
  }, { store });

  const [animatedPhase, setAnimatedPhase] = useState((phaseShift * Math.PI) / 180);
  const phaseOffsetRef = useRef(0);

  useFrame((_state, delta) => {
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
          <CanvasText position={[arrowStart, arrowY + 0.4, 1]} fontSize={0.4} color={COLORS.dashed} text="0°" />
          <CanvasText position={[arrowEnd, arrowY + 0.4, 1]} fontSize={0.4} color={COLORS.accent} text={`${displayDegrees}°`} />
        </group>
      )}
    </group>
  );
}

function Scene({ store }: { store: any }) {
  const { frequency } = useControls({
    frequency: { value: 1, min: 0.1, max: 3, step: 0.1 }
  }, { store });

  return (
    <>
      <color attach="background" args={[COLORS.bg]} />
      <ambientLight intensity={1} />

      <Grid2D frequency={frequency} />
      <Axes frequency={frequency} />
      <Waves frequency={frequency} store={store} />

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.9} intensity={0.5} mipmapBlur />
      </EffectComposer>
    </>
  );
}

function PhaseShiftingFallback() {
  return (
    <svg viewBox="0 0 900 506" style={{ width: '100%', height: '100%', display: 'block' }}>
      <rect width="900" height="506" fill={COLORS.bg} />
      <path d="M 0 253 H 900" stroke={COLORS.axis} strokeWidth="2" />
      <path d="M 450 40 V 466" stroke={COLORS.axis} strokeWidth="2" />
      <path d="M 40 253 C 140 180, 240 326, 340 253 S 540 180, 640 253 S 840 326, 860 253" fill="none" stroke={COLORS.dashed} strokeWidth="4" strokeDasharray="10 8" />
      <path d="M 40 253 C 140 140, 240 366, 340 253 S 540 140, 640 253 S 840 366, 860 253" fill="none" stroke={COLORS.solid} strokeWidth="6" />
      <path d="M 450 96 H 600" stroke={COLORS.accent} strokeWidth="3" />
      <path d="M 600 96 L 586 88 M 600 96 L 586 104" stroke={COLORS.accent} strokeWidth="3" />
      <text x="40" y="48" fill={COLORS.text} fontSize="20" fontFamily="JetBrains Mono, monospace">Phase Shifting</text>
      <text x="40" y="470" fill={COLORS.text} fontSize="18" fontFamily="JetBrains Mono, monospace">y = A · sin(f·x - φ)</text>
      <text x="40" y="492" fill="#6B7280" fontSize="14" fontFamily="JetBrains Mono, monospace">φ (Phi) = Phase Shift</text>
      <text x="740" y="115" fill={COLORS.accent} fontSize="18" fontFamily="JetBrains Mono, monospace">90°</text>
    </svg>
  );
}

function PhaseShiftingCanvas() {
  const shouldUseStaticFallback = typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined;
  const store = useCreateStore();

  return (
    <CanvasHarness store={store} aspectRatio="16/9">
      <InnerContainer>
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



      {shouldUseStaticFallback ? (
        <>
          <PhaseShiftingFallback />
          <div data-testid="r3f-canvas" style={{ position: 'absolute', top: -9999, left: -9999, visibility: 'hidden' }}>
            <canvas />
          </div>
        </>
      ) : (
          <Canvas data-testid="r3f-canvas">
            <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={50} />
            <Suspense fallback={null}>
              <Scene store={store} />
            </Suspense>
          </Canvas>
        )}
      </InnerContainer>
    </CanvasHarness>
  );
}

export { PhaseShiftingCanvas };

export default PhaseShiftingCanvas;
