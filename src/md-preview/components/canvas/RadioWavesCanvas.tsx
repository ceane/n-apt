import React, { useMemo, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import styled from "styled-components";
import { Leva, useControls } from "leva";
import { levaFrequency } from "@n-apt/components/ui/levaFrequencyPlugin";
import { SignalCanvasFrame, ZeroLine } from "@n-apt/md-preview/components/canvas/shared";
import { theme } from "@n-apt/md-preview/consts/theme";

const ControlButton = styled.button`
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(0, 0, 0, 0.15);
  color: #1f2937;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  transition: all 0.2s ease;

  &:hover {
    background: #ffffff;
    box-shadow: 0 2px 4px rgba(0,0,0,0.12);
  }

  &:active {
    transform: scale(0.96);
  }
`;

// Custom smooth tube geometry hook with 16 radial segments (versus default 6) to eliminate blockiness
const useSmoothTubeGeometry = (points: THREE.Vector3[], radius: number, segments = 300) =>
  useMemo(() => {
    if (!points.length || points.length < 4) return null;
    const curve = new THREE.CatmullRomCurve3(points);
    curve.curveType = "centripetal";
    return new THREE.TubeGeometry(curve, segments, radius, 16, false);
  }, [points, radius, segments]);

const SmoothWaveTube: React.FC<{
  points: THREE.Vector3[];
  color: string;
  thickness?: number;
  z?: number;
  segments?: number;
}> = ({ points, color, thickness = 0.032, z = 0, segments = 300 }) => {
  const geometry = useSmoothTubeGeometry(points, thickness, segments);

  React.useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry || !points.length) return null;

  return (
    <mesh geometry={geometry} position={[0, 0, z]} frustumCulled={false}>
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
};

const RadioWavesScene: React.FC<{ 
  isPaused: boolean;
  frequency: number;
  amplitude: number;
  variance: number;
}> = ({ isPaused, frequency, amplitude, variance }) => {
  const { viewport } = useThree();
  const [phase, setPhase] = useState(0);

  useFrame((_state, delta) => {
    if (!isPaused) {
      setPhase((prev) => prev + delta * 4.5);
    }
  });
  
  const wavePoints = useMemo(() => {
    const samples = 400; 
    const xMin = -viewport.width * 0.56;
    const xMax = viewport.width * 0.56;
    const pts: THREE.Vector3[] = [];
    
    // Map frequency input (Hz) to cycle count across viewport. Default 30 MHz = 3 cycles.
    const baseCycles = frequency / 10_000_000;

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(xMin, xMax, t);
      
      const angle = (t * Math.PI * 2 * baseCycles) - phase;
      
      // Variance now modulates the amplitude of each cycle across the wave
      const amplitudeMod = 1 + Math.sin(t * Math.PI * baseCycles * 0.5) * variance * 0.5;
      const y = Math.sin(angle) * amplitude * amplitudeMod;
      
      pts.push(new THREE.Vector3(x, y, 0));
    }
    return pts;
  }, [viewport.width, phase, frequency, amplitude, variance]);

  return (
    <SmoothWaveTube points={wavePoints} color={theme.colors.accent} thickness={0.032} z={0.12} segments={300} />
  );
};

export const RadioWavesCanvas: React.FC<{ hideTitle?: boolean }> = ({ hideTitle }) => {
  const [isPaused, setIsPaused] = useState(false);

  const { frequency, amplitude, variance } = useControls("Wave Settings", {
    frequency: levaFrequency(30_000_000), // Default 30 MHz
    amplitude: { value: 1.25, min: 0.1, max: 2.0, step: 0.05 },
    variance: { value: 0, min: 0, max: 1.0, step: 0.02, label: "Cycle Variance" },
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <SignalCanvasFrame
        title="Radio Wave Propagation"
        hideTitle={hideTitle}
        overlay={(
          <>
            <ZeroLine style={{ top: "50%" }} aria-hidden="true" />
            <ControlButton onClick={() => setIsPaused(!isPaused)}>
              {isPaused ? "▶ Play" : "❚❚ Pause"}
            </ControlButton>
          </>
        )}
      >
        <RadioWavesScene
          isPaused={isPaused}
          frequency={frequency}
          amplitude={amplitude}
          variance={variance}
        />
      </SignalCanvasFrame>
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10, width: 280 }}>
        <Leva
          fill
          titleBar={false}
          hideCopyButton
          theme={{
            colors: {
              elevation1: "rgba(30, 41, 59, 0.92)",
              elevation2: "rgba(15, 23, 42, 0.95)",
              elevation3: "rgba(51, 65, 85, 1)",
              accent1: theme.colors.accent,
              accent2: theme.colors.accent,
              accent3: theme.colors.accent,
              folderTextColor: "#f1f5f9",
              folderWidgetColor: "#f1f5f9",
              highlight3: "#ffffff",
              highlight2: "#e2e8f0",
              highlight1: "#94a3b8",
            }
          }}
        />
      </div>
    </div>
  );
};



