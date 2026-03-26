import { useState, useMemo, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, Line } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { LevaPanel, useControls, useCreateStore } from 'leva';

const COLORS = {
  bg: '#E0E0E2',
  grid: '#FFFFFF', // White grid on light gray background for paper look
  axis: '#9CA3AF',
  dashed: '#9CA3AF',
  solid: '#8B5CF6', // Purple
  text: '#374151',
  accent: '#356CCB' // Orange
};

function Grid2D({ frequency }: { frequency: number }) {
  const lines = [];
  // Vertical lines (every pi/4 / frequency)
  for (let i = -32; i <= 32; i++) {
    const x = (i * Math.PI / 4) / frequency;
    if (x < -15 || x > 15) continue;
    const isMajor = i % 2 === 0;
    lines.push(
      <Line
        key={`v${i}`}
        points={[[x, -5, -1], [x, 5, -1]]}
        color={COLORS.grid}
        lineWidth={isMajor ? 2 : 1}
        opacity={isMajor ? 1 : 0.5}
        transparent
      />
    );
  }
  // Horizontal lines (every 0.5)
  for (let i = -10; i <= 10; i++) {
    const y = i * 0.5;
    const isMajor = i % 2 === 0;
    lines.push(
      <Line
        key={`h${i}`}
        points={[[-15, y, -1], [15, y, -1]]}
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
  for (let k = -32; k <= 32; k++) {
    if (k === 0) continue;
    const x = (k * Math.PI / 4) / frequency;
    if (x < -9.5 || x > 9.5) continue;

    const num = 5 * k;
    const den = 2 * Math.round(frequency * 10);
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const divisor = gcd(Math.abs(num), den);
    const n = Math.abs(num) / divisor;
    const d = den / divisor;

    let sign = k < 0 ? '-' : '';
    let piStr = n === 1 ? 'π' : `${n}π`;
    let label = d === 1 ? `${sign}${piStr}` : `${sign}${piStr}/${d}`;

    xLabels.push({ pos: x, label });
  }

  const yLabels = [];
  for (let i = -8; i <= 8; i++) {
    if (i === 0) continue;
    const y = i * 0.5;
    let label = y.toString();
    if (y === 0.5) label = '1/2';
    if (y === -0.5) label = '-1/2';
    if (y === 1.5) label = '3/2';
    if (y === -1.5) label = '-3/2';
    if (y === 2.5) label = '5/2';
    if (y === -2.5) label = '-5/2';
    if (y === 3.5) label = '7/2';
    if (y === -3.5) label = '-7/2';
    yLabels.push({ pos: y, label });
  }

  return (
    <group>
      {/* X Axis */}
      <Line points={[[-10, 0, 0], [10, 0, 0]]} color={COLORS.axis} lineWidth={2} />
      {/* Y Axis */}
      <Line points={[[0, -5, 0], [0, 5, 0]]} color={COLORS.axis} lineWidth={2} />

      {/* Labels */}
      <Text position={[9.5, 0.2, 0]} fontSize={0.16} color={COLORS.text}>x</Text>
      <Text position={[0.2, 4.8, 0]} fontSize={0.16} color={COLORS.text}>y</Text>
      <Text position={[-0.2, -0.2, 0]} fontSize={0.12} color={COLORS.text}>0</Text>

      {/* Tick marks X */}
      {xLabels.map(({ pos, label }, i) => (
        <group key={`x-${i}`} position={[pos, 0, 0]}>
          <Line points={[[0, -0.05, 0], [0, 0.05, 0]]} color={COLORS.axis} lineWidth={2} />
          <Text position={[0, -0.2, 0]} fontSize={0.11} color={COLORS.text}>{label}</Text>
        </group>
      ))}

      {/* Tick marks Y */}
      {yLabels.map(({ pos, label }, i) => (
        <group key={`y-${i}`} position={[0, pos, 0]}>
          <Line points={[[-0.05, 0, 0], [0.05, 0, 0]]} color={COLORS.axis} lineWidth={2} />
          <Text position={[-0.3, 0, 0]} fontSize={0.11} color={COLORS.text}>{label}</Text>
        </group>
      ))}
    </group>
  );
}

function Waves({ frequency, phaseShift, amplitude, animate, speed }: { 
  frequency: number, 
  phaseShift: number, 
  amplitude: number, 
  animate: boolean, 
  speed: number 
}) {
  const shiftedLineRef = useRef<any>(null);
  const phaseOffsetRef = useRef(0);

  const basePoints = useMemo(() => {
    const pts = [];
    for (let x = -10; x <= 10; x += 0.05) {
      pts.push(new THREE.Vector3(x, Math.sin(x * frequency) * amplitude, 0));
    }
    return pts;
  }, [amplitude, frequency]);

  const [displayPhase, setDisplayPhase] = useState(0);

  useFrame((_, delta) => {
    if (animate) {
      phaseOffsetRef.current = (phaseOffsetRef.current + delta * speed) % (Math.PI * 2);
    }
    const currentPhase = ((phaseShift * Math.PI) / 180) + phaseOffsetRef.current;
    
    // Update shifted line points directly for performance
    if (shiftedLineRef.current) {
      const pts = [];
      for (let x = -10; x <= 10; x += 0.05) {
        pts.push(new THREE.Vector3(x, Math.sin(x * frequency - currentPhase) * amplitude, 0));
      }
      shiftedLineRef.current.setPoints(pts);
    }

    // Only update React state occasionally or if needed for the UI text
    const displayDegrees = Math.round(((currentPhase % (Math.PI * 2)) * 180) / Math.PI);
    if (displayDegrees !== displayPhase) {
      setDisplayPhase(displayDegrees);
    }
  });

  // Indicator logic
  const normPhase = ((displayPhase * Math.PI) / 180);
  const arrowY = amplitude + 0.3;
  const arrowStart = 0;
  const arrowEnd = normPhase / frequency;

  const arrowPoints = useMemo(() => {
    if (Math.abs(arrowEnd - arrowStart) < 0.01) return null;
    const dir = Math.sign(arrowEnd - arrowStart);
    const headSize = 0.1;
    return [
      new THREE.Vector3(arrowStart, arrowY, 0),
      new THREE.Vector3(arrowEnd, arrowY, 0),
      new THREE.Vector3(arrowEnd - dir * headSize, arrowY + headSize, 0),
      new THREE.Vector3(arrowEnd, arrowY, 0),
      new THREE.Vector3(arrowEnd - dir * headSize, arrowY - headSize, 0),
    ];
  }, [arrowStart, arrowEnd, arrowY]);

  const displayDegrees = displayPhase;

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
        ref={shiftedLineRef}
        points={basePoints} // Initial points
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
            points={[[arrowStart, 0, 0], [arrowStart, arrowY, 0]]}
            color={COLORS.accent}
            lineWidth={1}
            dashed dashSize={0.05} gapSize={0.05} opacity={0.5} transparent
          />
          <Line
            points={[[arrowEnd, 0, 0], [arrowEnd, arrowY, 0]]}
            color={COLORS.accent}
            lineWidth={1}
            dashed dashSize={0.05} gapSize={0.05} opacity={0.5} transparent
          />
          <Text position={[arrowStart, arrowY + 0.2, 0]} fontSize={0.14} color={COLORS.accent}>
            0°
          </Text>
          <Text position={[arrowEnd, arrowY + 0.2, 0]} fontSize={0.14} color={COLORS.accent}>
            {`${displayDegrees}°`}
          </Text>
        </group>
      )}
    </group>
  );
}

function Scene({ frequency, controls }: { frequency: number, controls: any }) {

  return (
    <>
      <color attach="background" args={[COLORS.bg]} />
      <ambientLight intensity={1} />

      <Grid2D frequency={frequency} />
      <Axes frequency={frequency} />
      <Waves frequency={frequency} {...controls} />

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.9} intensity={0.5} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export default function App() {
  const store = useCreateStore();
  const { frequency, ...controls } = useControls({
    frequency: { value: 1, min: 0.1, max: 3, step: 0.1 },
    phaseShift: { value: 90, min: -360, max: 360, step: 1, label: 'Phase Shift (Phi, φ)' },
    amplitude: { value: 1, min: 0.1, max: 3, step: 0.1 },
    animate: { value: false, label: 'Auto Animate' },
    speed: { value: 1, min: 0.1, max: 5, step: 0.1, render: (get) => get('animate') }
  }, { store });

  return (
    <div className="w-full h-full overflow-hidden relative" style={{ backgroundColor: COLORS.bg, minHeight: "100%", position: 'relative' }}>
      <div className="absolute top-[clamp(1.5rem,1vw,1rem)] left-[clamp(0.75rem,4vw,1.5rem)] z-10 pointer-events-none">
        <h1 className="font-bold tracking-tight !my-0" style={{ color: COLORS.text, fontSize: 'clamp(1.45rem, 4vw, 3rem)', lineHeight: 1.02 }}>Phase Shifting</h1>
        <p className="mt-1 max-w-md font-mono !mb-0" style={{ color: COLORS.text, fontSize: 'clamp(0.8rem, 1.8vw, 1.05rem)' }}>
          y = A · sin(2πfx - φ)
        </p>
        <p className="mt-1 max-w-md font-mono !my-0" style={{ color: COLORS.text, fontSize: 'clamp(0.8rem, 1.8vw, 1.05rem)' }}>
          φ = Phase Shift (Phi)
        </p>
      </div>
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 100, width: 280 }}>
          <LevaPanel
            store={store}
            fill
            flat
            titleBar={false}
            theme={{
              colors: {
                elevation1: '#f8fafc',
                elevation2: '#f1f5f9',
                elevation3: '#e2e8f0',
                accent1: '#8b5cf6',
                accent2: '#7c3aed',
                accent3: '#6d28d9',
                highlight1: '#0f172a',
                highlight2: '#334155',
                highlight3: '#475569',
              }
            }}
          />
        </div>
        <Canvas camera={{ position: [0, 0, 10], fov: 45 }} style={{ width: '100%', height: '100%', display: 'block' }}>
          <Suspense fallback={null}>
            <Scene frequency={frequency} controls={controls} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}