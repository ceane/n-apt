import React, { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import styled from "styled-components";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";

const Frame = styled.div`
  width: 100%;
  min-width: min(100%, 320px);
  margin: 2rem 0;
  border-radius: 0;
  overflow: hidden;
  border: 1px solid rgba(17, 24, 39, 0.08);
  background: #ffffff;
  position: relative;
  aspect-ratio: 16 / 9;

  @media (max-width: 640px) {
    aspect-ratio: 4 / 3;
  }

  > div {
    width: 100% !important;
    height: 100% !important;
  }

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    cursor: default;
  }
`;

const RendererBadge = styled.div`
  position: absolute;
  top: 14px;
  left: 16px;
  font-size: clamp(0.9rem, 1.5vw, 1.35rem);
  letter-spacing: 0.04em;
  font-family: "DM Mono", monospace;
  color: #101117;
  z-index: 2;
  pointer-events: none;

  @media (max-width: 640px) {
    top: 10px;
    left: 12px;
    font-size: 0.78rem;
  }
`;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
`;

const OverlayText = styled.div<{
  $top?: string;
  $right?: string;
  $bottom?: string;
  $left?: string;
  $align?: "left" | "center" | "right";
  $color?: string;
  $weight?: number;
}>`
  position: absolute;
  top: ${({ $top }) => $top ?? "auto"};
  right: ${({ $right }) => $right ?? "auto"};
  bottom: ${({ $bottom }) => $bottom ?? "auto"};
  left: ${({ $left }) => $left ?? "auto"};
  transform: ${({ $align, $left, $right }) => {
    if ($align === "center" && $left === "50%") {
      return "translateX(-50%)";
    }
    if ($align === "right" && $right) {
      return "translateX(0)";
    }
    return "translateX(0)";
  }};
  font-family: "DM Mono", monospace;
  font-size: clamp(0.72rem, 1.2vw, 1rem);
  line-height: 1.2;
  color: ${({ $color }) => $color ?? "#4b5563"};
  font-weight: ${({ $weight }) => $weight ?? 500};
  text-align: ${({ $align }) => $align ?? "left"};
  max-width: min(32vw, 260px);

  @media (max-width: 640px) {
    font-size: 0.68rem;
    max-width: 42vw;
    top: ${({ $top }) => $top ?? "auto"};
    right: ${({ $right }) => $right ?? "auto"};
    bottom: ${({ $bottom }) => $bottom ?? "auto"};
    left: ${({ $left }) => $left ?? "auto"};
  }
`;

const palette = {
  background: "#ffffff",
  gridBase: "#f4f6fb",
  accent: "#c770ff",
  accentSecondary: "#6cf4ff",
  accentTertiary: "#ffb86f",
  muted: "rgba(107, 114, 128, 0.5)",
};

const createWebGpuRenderer = async (props: Record<string, unknown>) => {
  const renderer = new WebGPURenderer(props as never);
  await renderer.init();
  renderer.setClearColor(palette.background);
  return renderer;
};

const useWavePoints = (
  phase = 0,
  amplitude = 1,
  frequency = 1,
  offsetY = 0,
  samples = 220,
  stretch = Math.PI * 2,
) =>
  useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(-4, 4, t);
      const angle = t * stretch * frequency + phase;
      const y = Math.sin(angle) * amplitude + offsetY;
      points.push(new THREE.Vector3(x, y, 0));
    }
    return points;
  }, [phase, amplitude, frequency, offsetY, samples, stretch]);

const useTubeGeometry = (points: THREE.Vector3[], radius: number, segments = 420) =>
  useMemo(() => {
    if (!points.length) {
      return null;
    }
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, segments, radius, 12, false);
  }, [points, radius, segments]);

const WaveTube: React.FC<{
  points: THREE.Vector3[];
  color: string;
  thickness?: number;
  opacity?: number;
  z?: number;
  segments?: number;
}> = ({ points, color, thickness = 0.055, opacity = 1, z = 0, segments = 420 }) => {
  const geometry = useTubeGeometry(points, thickness, segments);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) {
    return null;
  }

  return (
    <mesh geometry={geometry} position={[0, 0, z]} frustumCulled={false}>
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </mesh>
  );
};

const DottedWave: React.FC<{
  points: THREE.Vector3[];
  color: string;
  step?: number;
  size?: number;
  opacity?: number;
  z?: number;
}> = ({ points, color, step = 10, size = 0.055, opacity = 0.8, z = 0.12 }) => {
  const dots = useMemo(() => points.filter((_, index) => index % step === 0), [points, step]);

  return (
    <>
      {dots.map((point, index) => (
        <mesh key={index} position={[point.x, point.y, z]}>
          <sphereGeometry args={[size, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
};

const useGridTexture = () =>
  useMemo(() => {
    if (typeof document === "undefined") {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.08)";
    ctx.lineWidth = 2;

    const spacing = 64;
    for (let x = 0; x <= canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, []);

const GridBackdrop: React.FC = () => {
  const texture = useGridTexture();

  useEffect(() => () => texture?.dispose(), [texture]);

  return (
    <mesh position={[0, 0, -0.4]}>
      <planeGeometry args={[8.6, 4.8]} />
      <meshBasicMaterial
        color={palette.gridBase}
        map={texture ?? undefined}
        transparent
        opacity={texture ? 0.9 : 1}
      />
    </mesh>
  );
};

const useLinearPoints = (start: THREE.Vector3, end: THREE.Vector3, segments = 80) =>
  useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      pts.push(
        new THREE.Vector3(
          THREE.MathUtils.lerp(start.x, end.x, t),
          THREE.MathUtils.lerp(start.y, end.y, t),
          THREE.MathUtils.lerp(start.z, end.z, t),
        ),
      );
    }
    return pts;
  }, [start, end, segments]);

const useSegmentArrow = (from: THREE.Vector3, to: THREE.Vector3, length = 0.22, width = 0.12) =>
  useMemo(() => {
    const direction = new THREE.Vector3().subVectors(to, from).normalize();
    const normal = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
    const tip = to.clone();
    const base = to.clone().addScaledVector(direction, -length);
    const left = base.clone().addScaledVector(normal, width / 2);
    const right = base.clone().addScaledVector(normal, -width / 2);
    return [tip, left, right];
  }, [from, to, length, width]);

const useSinePathBetweenPoints = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  amplitude = 0.12,
  cycles = 8,
  samples = 180,
) =>
  useMemo(() => {
    const delta = new THREE.Vector3().subVectors(end, start);
    const length = delta.length();
    if (length === 0) {
      return [start.clone()];
    }

    const direction = delta.clone().normalize();
    const normal = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const base = start.clone().addScaledVector(direction, length * t);
      const offset = Math.sin(t * Math.PI * 2 * cycles) * amplitude;
      points.push(base.addScaledVector(normal, offset));
    }

    return points;
  }, [start, end, amplitude, cycles, samples]);

const ArrowHead: React.FC<{
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  z?: number;
}> = ({ from, to, color, z = 0.18 }) => {
  const points = useSegmentArrow(from, to);
  const shape = useMemo(() => {
    const triangle = new THREE.Shape();
    triangle.moveTo(points[0].x, points[0].y);
    triangle.lineTo(points[1].x, points[1].y);
    triangle.lineTo(points[2].x, points[2].y);
    triangle.closePath();
    return triangle;
  }, [points]);
  const geometry = useMemo(() => new THREE.ShapeGeometry(shape), [shape]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} position={[0, 0, z]}>
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
};

const SignalCanvasFrame: React.FC<React.PropsWithChildren<{ title: string; overlay?: React.ReactNode }>> = ({
  children,
  title,
  overlay,
}) => (
  <Frame>
    <CanvasHost>{children}</CanvasHost>
    <Overlay>
      <RendererBadge>{title}</RendererBadge>
      {overlay}
    </Overlay>
  </Frame>
);

const CanvasHost: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [fallback, setFallback] = useState(false);

  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [0, 0, 10], zoom: 68 }}
      gl={async (props) => {
        try {
          setFallback(false);
          return await createWebGpuRenderer(props);
        } catch {
          setFallback(true);
          const renderer = new THREE.WebGLRenderer(props as THREE.WebGLRendererParameters);
          renderer.setClearColor(palette.background);
          return renderer;
        }
      }}
    >
      <color attach="background" args={[palette.background]} />
      <ambientLight intensity={0.9} />
      {children}
      <group visible={false} userData={{ fallback }} />
    </Canvas>
  );
};

export const PhaseShiftingCanvas: React.FC = () => {
  const referenceWave = useWavePoints(0, 0.85, 1.05);
  const shiftedWave = useWavePoints(Math.PI / 2, 0.85, 1.05);

  return (
    <SignalCanvasFrame
      title="Phase Shifting"
      overlay={(
        <>
          <OverlayText $top="16px" $left="50%" $align="center" $color="#111827" $weight={700}>Δφ = 90°</OverlayText>
          <OverlayText $top="18px" $left="16px" $color="#6b7280">0°</OverlayText>
          <OverlayText $top="18px" $right="16px" $align="right" $color={palette.accent}>90°</OverlayText>
        </>
      )}
    >
      <GridBackdrop />
      <DottedWave points={referenceWave} color={palette.muted} step={6} size={0.036} opacity={0.7} />
      <WaveTube points={shiftedWave} color={palette.accent} thickness={0.038} z={0.12} />
    </SignalCanvasFrame>
  );
};

export const FrequencyModulationCanvas: React.FC = () => {
  const carrier = useWavePoints(0, 0.55, 2.0);
  const modulator = useWavePoints(0, 0.38, 0.45, -1.2, 180, Math.PI * 1.6);
  const fmWave = useMemo(() => {
    const samples = 360;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(-4, 4, t);
      const modulation = Math.sin(t * Math.PI * 2 * 0.45);
      const instantaneousFreq = 2.2 + modulation * 1.3;
      const amplitude = 0.75 + modulation * 0.2;
      const angle = t * Math.PI * 4 * instantaneousFreq;
      const y = Math.sin(angle) * amplitude;
      pts.push(new THREE.Vector3(x, y, 0));
    }
    return pts;
  }, []);

  return (
    <SignalCanvasFrame
      title="Frequency Modulation"
      overlay={(
        <>
          <OverlayText $top="52px" $left="16px" $color="#6b7280">Carrier</OverlayText>
          <OverlayText $top="16px" $left="50%" $align="center" $color={palette.accentSecondary} $weight={700}>FM Output</OverlayText>
          <OverlayText $bottom="18px" $right="16px" $align="right" $color={palette.accentTertiary}>Modulating Wave</OverlayText>
        </>
      )}
    >
      <GridBackdrop />
      <WaveTube points={carrier} color="#c7cedd" thickness={0.018} opacity={0.8} />
      <WaveTube points={fmWave} color={palette.accentSecondary} thickness={0.034} z={0.12} />
      <DottedWave points={modulator} color={palette.accentTertiary} step={7} size={0.032} z={0.15} />
    </SignalCanvasFrame>
  );
};

export const MultipathCanvas: React.FC = () => {
  const transmitter = useMemo(() => new THREE.Vector3(-3.45, -0.2, 0), []);
  const target = useMemo(() => new THREE.Vector3(-1.45, -0.2, 0), []);
  const receiver = useMemo(() => new THREE.Vector3(3.35, -0.2, 0), []);
  const obstacleCenter = useMemo(() => new THREE.Vector3(1.15, -0.2, 0), []);

  // Reflector positions (surface points)
  const upperReflect = useMemo(() => new THREE.Vector3(1.35, 1.89, 0), []); // Bottom of top block
  const lowerReflect = useMemo(() => new THREE.Vector3(1.35, -2.09, 0), []); // Top of bottom block

  // Path Offsets (Wave is "above" Arrow)
  const offset = 0.16;

  // Tx -> Target
  const txTargetArrowStart = useMemo(() => transmitter.clone().add(new THREE.Vector3(0.18, 0, 0)), [transmitter]);
  const txTargetArrowEnd = useMemo(() => target.clone().add(new THREE.Vector3(-0.18, 0, 0)), [target]);
  const txTargetWaveStart = useMemo(() => txTargetArrowStart.clone().add(new THREE.Vector3(0, offset, 0)), [txTargetArrowStart]);
  const txTargetWaveEnd = useMemo(() => txTargetArrowEnd.clone().add(new THREE.Vector3(0, offset, 0)), [txTargetArrowEnd]);

  // Upper Reflection (Arrow hits reflectors)
  const upperTargetStart = useMemo(() => target.clone().add(new THREE.Vector3(0.12, 0.12, 0)), [target]);
  const upperReceiverEnd = useMemo(() => receiver.clone().add(new THREE.Vector3(-0.12, 0.12, 0)), [receiver]);

  // Calculate intersection of two lines defined by (p1, dir1) and (p2, dir2)
  const getIntersection = (p1: THREE.Vector3, dir1: THREE.Vector3, p2: THREE.Vector3, dir2: THREE.Vector3) => {
    const det = dir1.x * dir2.y - dir1.y * dir2.x;
    if (Math.abs(det) < 0.0001) return p1.clone(); // Parallel

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    const t = (dx * dir2.y - dy * dir2.x) / det;
    return new THREE.Vector3(p1.x + t * dir1.x, p1.y + t * dir1.y, 0);
  };

  // Calculate Wave points by offsetting normals
  const upperLeg1Dir = new THREE.Vector3().subVectors(upperReflect, upperTargetStart).normalize();
  const upperLeg1Norm = new THREE.Vector3(-upperLeg1Dir.y, upperLeg1Dir.x, 0); // Up-Left
  const upperLeg2Dir = new THREE.Vector3().subVectors(upperReceiverEnd, upperReflect).normalize();
  const upperLeg2Norm = new THREE.Vector3(-upperLeg2Dir.y, upperLeg2Dir.x, 0); // Up-Right

  const upperWaveStart = upperTargetStart.clone().addScaledVector(upperLeg1Norm, offset);
  const upperWaveEnd = upperReceiverEnd.clone().addScaledVector(upperLeg2Norm, offset);
  const upperWaveReflect = getIntersection(upperWaveStart, upperLeg1Dir, upperWaveEnd, new THREE.Vector3().copy(upperLeg2Dir).negate());

  // Lower Reflection (Arrow hits reflectors)
  const lowerTargetStart = useMemo(() => target.clone().add(new THREE.Vector3(0.12, -0.12, 0)), [target]);
  const lowerReceiverEnd = useMemo(() => receiver.clone().add(new THREE.Vector3(-0.12, -0.12, 0)), [receiver]);

  // For bottom path, "Wave Above Arrow" means Wave is Top, Arrow is Bottom
  const lowerLeg1Dir = new THREE.Vector3().subVectors(lowerReflect, lowerTargetStart).normalize();
  const lowerLeg1Norm = new THREE.Vector3(-lowerLeg1Dir.y, lowerLeg1Dir.x, 0); // Up-Right
  const lowerLeg2Dir = new THREE.Vector3().subVectors(lowerReceiverEnd, lowerReflect).normalize();
  const lowerLeg2Norm = new THREE.Vector3(-lowerLeg2Dir.y, lowerLeg2Dir.x, 0); // Up-Left

  const lowerWaveStart = lowerTargetStart.clone().addScaledVector(lowerLeg1Norm, offset);
  const lowerWaveEnd = lowerReceiverEnd.clone().addScaledVector(lowerLeg2Norm, offset);
  const lowerWaveReflect = getIntersection(lowerWaveStart, lowerLeg1Dir, lowerWaveEnd, new THREE.Vector3().copy(lowerLeg2Dir).negate());

  // Paths
  const txTargetWave = useSinePathBetweenPoints(txTargetWaveStart, txTargetWaveEnd, 0.08, 5, 120);
  const txTargetGuide = useLinearPoints(txTargetArrowStart, txTargetArrowEnd, 60);

  const upperLeftWave = useSinePathBetweenPoints(upperWaveStart, upperWaveReflect, 0.08, 8, 160);
  const upperRightWave = useSinePathBetweenPoints(upperWaveReflect, upperWaveEnd, 0.08, 7, 160);
  const upperLeftGuide = useLinearPoints(upperTargetStart, upperReflect, 60);
  const upperRightGuide = useLinearPoints(upperReflect, upperReceiverEnd, 60);

  const lowerLeftWave = useSinePathBetweenPoints(lowerWaveStart, lowerWaveReflect, 0.08, 8, 160);
  const lowerRightWave = useSinePathBetweenPoints(lowerWaveReflect, lowerWaveEnd, 0.08, 7, 160);
  const lowerLeftGuide = useLinearPoints(lowerTargetStart, lowerReflect, 60);
  const lowerRightGuide = useLinearPoints(lowerReflect, lowerReceiverEnd, 60);

  return (
    <SignalCanvasFrame
      title="Multipath"
      overlay={(
        <>
          <OverlayText $bottom="24px" $left="16px" $color="#374151" $weight={700}>Tx / transmitter / source</OverlayText>
          <OverlayText $top="48%" $left="23%" $align="center" $color="#374151" $weight={700}>Target</OverlayText>
          <OverlayText $bottom="24px" $right="16px" $align="right" $color="#374151" $weight={700}>Receiver / Rx</OverlayText>
          <OverlayText $top="38%" $left="58%" $align="left" $color="#6b7280" $weight={500}>Blocking object</OverlayText>
        </>
      )}
    >
      <GridBackdrop />

      {/* Obstacle */}
      <mesh position={[obstacleCenter.x, obstacleCenter.y, 0.11]}>
        <boxGeometry args={[0.9, 2.4, 0.18]} />
        <meshBasicMaterial color="#d1d5db" toneMapped={false} />
      </mesh>

      {/* Reflectors */}
      <mesh position={[1.35, 2.05, 0.11]}>
        <boxGeometry args={[1.2, 0.12, 0.1]} />
        <meshBasicMaterial color="#9ca3af" toneMapped={false} />
      </mesh>
      <mesh position={[1.35, -2.25, 0.11]}>
        <boxGeometry args={[1.2, 0.12, 0.1]} />
        <meshBasicMaterial color="#9ca3af" toneMapped={false} />
      </mesh>

      <WaveTube points={txTargetGuide} color="#c9ccd3" thickness={0.008} z={0.1} segments={60} opacity={1} />
      <WaveTube points={upperLeftGuide} color="#c9ccd3" thickness={0.008} z={0.1} segments={60} opacity={1} />
      <WaveTube points={upperRightGuide} color="#c9ccd3" thickness={0.008} z={0.1} segments={60} opacity={1} />
      <WaveTube points={lowerLeftGuide} color="#c9ccd3" thickness={0.008} z={0.1} segments={60} opacity={1} />
      <WaveTube points={lowerRightGuide} color="#c9ccd3" thickness={0.008} z={0.1} segments={60} opacity={1} />

      <WaveTube points={txTargetWave} color="#111827" thickness={0.014} z={0.13} segments={180} />
      <WaveTube points={upperLeftWave} color="#111111" thickness={0.014} z={0.13} segments={180} />
      <WaveTube points={upperRightWave} color="#111111" thickness={0.014} z={0.13} segments={180} />
      <WaveTube points={lowerLeftWave} color="#111111" thickness={0.014} z={0.13} segments={180} />
      <WaveTube points={lowerRightWave} color="#111111" thickness={0.014} z={0.13} segments={180} />

      <ArrowHead from={txTargetGuide[txTargetGuide.length - 2]} to={txTargetGuide[txTargetGuide.length - 1]} color="#c9ccd3" z={0.11} />
      <ArrowHead from={upperLeftGuide[upperLeftGuide.length - 10]} to={upperLeftGuide[upperLeftGuide.length - 1]} color="#c9ccd3" z={0.11} />
      <ArrowHead from={upperRightGuide[upperRightGuide.length - 10]} to={upperRightGuide[upperRightGuide.length - 1]} color="#c9ccd3" z={0.11} />
      <ArrowHead from={lowerLeftGuide[lowerLeftGuide.length - 10]} to={lowerLeftGuide[lowerLeftGuide.length - 1]} color="#c9ccd3" z={0.11} />
      <ArrowHead from={lowerRightGuide[lowerRightGuide.length - 10]} to={lowerRightGuide[lowerRightGuide.length - 1]} color="#c9ccd3" z={0.11} />

      {[
        { point: transmitter, color: "#3b82f6", radius: 0.16, ring: true },
        { point: target, color: "#d1d5db", radius: 0.54, ring: false },
        { point: receiver, color: "#3b82f6", radius: 0.16, ring: true },
      ].map(({ point, color, radius, ring }, index) => (
        <React.Fragment key={index}>
          <mesh position={[point.x, point.y, 0.24]}>
            <circleGeometry args={[radius, 48]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
          {ring ? (
            <>
              <mesh position={[point.x, point.y, 0.22]}>
                <ringGeometry args={[0.26, 0.34, 64]} />
                <meshBasicMaterial color="#9cc7ec" transparent opacity={0.9} toneMapped={false} />
              </mesh>
              <mesh position={[point.x, point.y, 0.21]}>
                <ringGeometry args={[0.42, 0.47, 64]} />
                <meshBasicMaterial color="#dbe8f6" transparent opacity={0.95} toneMapped={false} />
              </mesh>
            </>
          ) : null}
        </React.Fragment>
      ))}
    </SignalCanvasFrame>
  );
};

export const HeterodyningCanvas: React.FC = () => {
  const waveA = useWavePoints(0, 0.58, 0.9, 0.95);
  const waveB = useWavePoints(Math.PI / 3, 0.58, 1.8, -0.95);
  const sideband = useWavePoints(0, 0.95, 0.55);

  return (
    <SignalCanvasFrame
      title="Heterodyning"
      overlay={(
        <>
          <OverlayText $top="52px" $left="16px" $color={palette.accentSecondary}>Wave A</OverlayText>
          <OverlayText $bottom="18px" $right="16px" $align="right" $color={palette.accentTertiary}>Wave B</OverlayText>
          <OverlayText $top="16px" $left="50%" $align="center" $color={palette.accent} $weight={700}>Sideband</OverlayText>
        </>
      )}
    >
      <GridBackdrop />
      <WaveTube points={waveA} color={palette.accentSecondary} thickness={0.03} z={0.12} />
      <WaveTube points={waveB} color={palette.accentTertiary} thickness={0.03} z={0.1} />
      <WaveTube points={sideband} color={palette.accent} thickness={0.038} z={0.14} />
    </SignalCanvasFrame>
  );
};
