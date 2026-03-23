import React, { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
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
) => {
  const { viewport } = useThree();

  const points = useMemo(() => {
    const xMin = -viewport.width * 0.56;
    const xMax = viewport.width * 0.56;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(xMin, xMax, t);
      const angle = t * stretch * frequency + phase;
      const y = Math.sin(angle) * amplitude + offsetY;
      points.push(new THREE.Vector3(x, y, 0));
    }

    return points;
  }, [phase, amplitude, frequency, offsetY, samples, stretch, viewport.width]);

  return points;
}

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

const SignalGraphFrame: React.FC<React.PropsWithChildren<{ title: string; overlay?: React.ReactNode }>> = ({
  children,
  title,
  overlay,
}) => (
  <Frame>
    {children}
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

const PHASE_SHIFT_VIEWBOX_WIDTH = 980;
const PHASE_SHIFT_VIEWBOX_HEIGHT = 560;
const PHASE_SHIFT_MARGIN = {
  top: 40,
  right: 24,
  bottom: 40,
  left: 66,
};
const PHASE_SHIFT_DOMAIN_MIN = -Math.PI / 2;
const PHASE_SHIFT_DOMAIN_MAX = 2 * Math.PI + Math.PI / 2;
const PHASE_SHIFT_RANGE_MIN = -1.5;
const PHASE_SHIFT_RANGE_MAX = 1.5;
const PHASE_SHIFT_WAVE_AMPLITUDE = 0.62;
const PHASE_SHIFT_Y_TICK_STEP = 0.5;

const formatPhaseTick = (value: number) => {
  if (Math.abs(value) < 1e-6) {
    return "0";
  }
  if (Math.abs(value - Math.PI / 2) < 1e-6) {
    return "π/2";
  }
  if (Math.abs(value - Math.PI) < 1e-6) {
    return "π";
  }
  if (Math.abs(value - 2 * Math.PI) < 1e-6) {
    return "2π";
  }
  return value.toFixed(2);
};

const formatYTick = (value: number) => {
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  const whole = Math.floor(absValue);
  const fraction = absValue - whole;

  if (Math.abs(fraction) < 1e-6) {
    return `${sign}${whole || 0}`;
  }

  if (Math.abs(fraction - 0.5) < 1e-6) {
    if (whole === 0) {
      return `${sign}1/2`;
    }
    return `${sign}${whole} 1/2`;
  }

  return `${sign}${absValue.toFixed(1)}`;
};

const PhaseShiftingGraph: React.FC = () => {
  const { horizontalGridLines, verticalGridLines, waveADPath, waveBPath, tickLabels, yTickLabels, labelPositions } = useMemo(() => {
    const width = PHASE_SHIFT_VIEWBOX_WIDTH;
    const height = PHASE_SHIFT_VIEWBOX_HEIGHT;
    const innerWidth = width - PHASE_SHIFT_MARGIN.left;
    const innerHeight = height - PHASE_SHIFT_MARGIN.top - PHASE_SHIFT_MARGIN.bottom;
    const xScale = (value: number) => {
      const t = (value - PHASE_SHIFT_DOMAIN_MIN) / (PHASE_SHIFT_DOMAIN_MAX - PHASE_SHIFT_DOMAIN_MIN);
      return PHASE_SHIFT_MARGIN.left + t * innerWidth;
    };
    const yScale = (value: number) => {
      const t = (value - PHASE_SHIFT_RANGE_MIN) / (PHASE_SHIFT_RANGE_MAX - PHASE_SHIFT_RANGE_MIN);
      return PHASE_SHIFT_MARGIN.top + (1 - t) * innerHeight;
    };

    const xValues: number[] = [];
    for (let i = 0; i <= 6; i += 1) {
      xValues.push(PHASE_SHIFT_DOMAIN_MIN + i * (Math.PI / 2));
    }

    const yValues: number[] = [];
    for (let value = -1.5; value <= 1.5 + 1e-6; value += PHASE_SHIFT_Y_TICK_STEP) {
      yValues.push(Number(value.toFixed(2)));
    }

    const buildWavePath = (phaseShift: number) => {
      const samples = 540;
      const points: string[] = [];
      for (let i = 0; i <= samples; i += 1) {
        const t = i / samples;
        const x = PHASE_SHIFT_DOMAIN_MIN + t * (PHASE_SHIFT_DOMAIN_MAX - PHASE_SHIFT_DOMAIN_MIN);
        const y = Math.sin(x + phaseShift) * PHASE_SHIFT_WAVE_AMPLITUDE;
        const command = i === 0 ? "M" : "L";
        points.push(`${command} ${xScale(x)} ${yScale(y)}`);
      }
      return points.join(" ");
    };

    const phaseGuideTop = yScale(PHASE_SHIFT_WAVE_AMPLITUDE + 0.02);
    const axisY = yScale(0);
    const phaseStartX = xScale(0);
    const phaseEndX = xScale(Math.PI / 2);
    const phaseGuideBottom = height - PHASE_SHIFT_MARGIN.bottom;

    return {
      horizontalGridLines: yValues.map((value) => ({ value, y: yScale(value) })),
      verticalGridLines: xValues.map((value) => ({ value, x: xScale(value) })),
      waveADPath: buildWavePath(0),
      waveBPath: buildWavePath(-Math.PI / 2),
      tickLabels: [0, Math.PI / 2, Math.PI, 2 * Math.PI].map((value) => ({ value, x: xScale(value) })),
      yTickLabels: yValues.map((value) => ({ value, y: yScale(value) })),
      labelPositions: {
        axisY,
        xAxisLabelY: yScale(-0.42),
        yAxisLabelX: xScale(PHASE_SHIFT_DOMAIN_MIN) + 12,
        phaseTopY: phaseGuideTop - 36,
        phaseArrowY: phaseGuideTop - 20,
        phaseArrowStartX: phaseStartX + 44,
        phaseArrowEndX: phaseEndX - 44,
        phaseZeroLabelX: phaseStartX - 6,
        phaseNinetyLabelX: phaseEndX + 6,
        phaseLeftX: phaseStartX,
        phaseRightX: phaseEndX,
        phaseGuideTop,
        phaseGuideBottom,
      },
    };
  }, []);

  return (
    <svg
      viewBox={`0 0 ${PHASE_SHIFT_VIEWBOX_WIDTH} ${PHASE_SHIFT_VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      aria-hidden="true"
      role="img"
    >
      <rect x="0" y="0" width={PHASE_SHIFT_VIEWBOX_WIDTH} height={PHASE_SHIFT_VIEWBOX_HEIGHT} fill="#ffffff" />
      {verticalGridLines.map(({ value, x }) => (
        <line
          key={`v-${value.toFixed(4)}`}
          x1={x}
          y1={0}
          x2={x}
          y2={PHASE_SHIFT_VIEWBOX_HEIGHT}
          stroke="#d7d7d7"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {yTickLabels.map(({ value, y }) => (
        <g key={`ytick-${value.toFixed(2)}`}>
          <line
            x1={0}
            y1={y}
            x2={PHASE_SHIFT_VIEWBOX_WIDTH}
            y2={y}
            stroke="#d7d7d7"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={PHASE_SHIFT_MARGIN.left - 18}
            y={y + 5}
            fill={Math.abs(value) < 1e-6 ? "#111827" : "#9ca3af"}
            fontFamily="DM Mono, monospace"
            fontSize={18}
            fontWeight={700}
            textAnchor="end"
          >
            {formatYTick(value)}
          </text>
        </g>
      ))}
      {horizontalGridLines.map(({ value, y }) => (
        <line
          key={`h-${value.toFixed(2)}`}
          x1={PHASE_SHIFT_MARGIN.left}
          y1={y}
          x2={PHASE_SHIFT_VIEWBOX_WIDTH}
          y2={y}
          stroke="#d7d7d7"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <line
        x1={PHASE_SHIFT_MARGIN.left}
        y1={labelPositions.axisY}
        x2={PHASE_SHIFT_VIEWBOX_WIDTH}
        y2={labelPositions.axisY}
        stroke="#7c7f87"
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={labelPositions.phaseLeftX}
        y1={labelPositions.phaseGuideTop}
        x2={labelPositions.phaseLeftX}
        y2={labelPositions.phaseGuideBottom}
        stroke="#b9d6f0"
        strokeWidth={1.5}
        strokeDasharray="1.5 7"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={labelPositions.phaseRightX}
        y1={labelPositions.phaseGuideTop}
        x2={labelPositions.phaseRightX}
        y2={labelPositions.phaseGuideBottom}
        stroke="#b9d6f0"
        strokeWidth={1.5}
        strokeDasharray="1.5 7"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={labelPositions.phaseLeftX}
        y1={labelPositions.phaseGuideTop}
        x2={labelPositions.phaseRightX}
        y2={labelPositions.phaseGuideTop}
        stroke="#9ad0ff"
        strokeWidth={1.5}
        strokeDasharray="1.5 7"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M ${labelPositions.phaseArrowStartX} ${labelPositions.phaseArrowY} H ${labelPositions.phaseArrowEndX - 18} L ${labelPositions.phaseArrowEndX} ${labelPositions.phaseArrowY} L ${labelPositions.phaseArrowEndX - 18} ${labelPositions.phaseArrowY + 18}`}
        fill="none"
        stroke="#b7b7b7"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={PHASE_SHIFT_MARGIN.left}
        y1={0}
        x2={PHASE_SHIFT_MARGIN.left}
        y2={PHASE_SHIFT_VIEWBOX_HEIGHT}
        stroke="#7c7f87"
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={waveADPath}
        fill="none"
        stroke="#831eff"
        strokeWidth={5}
        strokeDasharray="3 10"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={waveBPath}
        fill="none"
        stroke="#be8cff"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {tickLabels.map(({ value, x }) => (
        <g key={`tick-${value.toFixed(4)}`}>
          <line
            x1={x}
            y1={labelPositions.axisY - 6}
            x2={x}
            y2={labelPositions.axisY + 6}
            stroke="#d7d7d7"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={x}
            y={labelPositions.axisY + 28}
            fill={Math.abs(value) < 1e-6 ? "#111827" : "#9ca3af"}
            fontFamily="DM Mono, monospace"
            fontSize={20}
            fontWeight={700}
            textAnchor="middle"
          >
            {formatPhaseTick(value)}
          </text>
        </g>
      ))}
      <text
        x={labelPositions.yAxisLabelX}
        y={(PHASE_SHIFT_MARGIN.top + labelPositions.axisY) / 2}
        fill="#111827"
        fontFamily="DM Mono, monospace"
        fontSize={20}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        y
      </text>
      <text
        x={(PHASE_SHIFT_MARGIN.left + (PHASE_SHIFT_VIEWBOX_WIDTH - PHASE_SHIFT_MARGIN.right)) / 2}
        y={labelPositions.xAxisLabelY}
        fill="#111827"
        fontFamily="DM Mono, monospace"
        fontSize={18}
        fontWeight={700}
        textAnchor="middle"
      >
        x
      </text>
      <text
        x={labelPositions.phaseZeroLabelX}
        y={labelPositions.phaseTopY}
        fill="#111827"
        fontFamily="DM Mono, monospace"
        fontSize={24}
        fontWeight={700}
        textAnchor="middle"
      >
        0°
      </text>
      <text
        x={labelPositions.phaseNinetyLabelX}
        y={labelPositions.phaseTopY}
        fill="#111827"
        fontFamily="DM Mono, monospace"
        fontSize={24}
        fontWeight={700}
        textAnchor="middle"
      >
        90°
      </text>
    </svg>
  );
};

export const PhaseShiftingCanvas: React.FC = () => {
  return (
    <SignalGraphFrame
      title="Phase Shifting"
    >
      <PhaseShiftingGraph />
    </SignalGraphFrame>
  );
};

export const FrequencyModulationCanvas: React.FC = () => {
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
      <FrequencyModulationScene />
    </SignalCanvasFrame>
  );
};

const FrequencyModulationScene: React.FC = () => {
  const { viewport } = useThree();
  const carrier = useWavePoints(0, 0.55, 2.0);
  const modulator = useWavePoints(0, 0.38, 0.45, -1.2, 180, Math.PI * 1.6);
  const fmWave = useMemo(() => {
    const samples = 360;
    const xMin = -viewport.width * 0.56;
    const xMax = viewport.width * 0.56;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(xMin, xMax, t);
      const modulation = Math.sin(t * Math.PI * 2 * 0.45);
      const instantaneousFreq = 2.2 + modulation * 1.3;
      const amplitude = 0.75 + modulation * 0.2;
      const angle = t * Math.PI * 4 * instantaneousFreq;
      const y = Math.sin(angle) * amplitude;
      pts.push(new THREE.Vector3(x, y, 0));
    }
    return pts;
  }, [viewport.width]);

  return (
    <>
      <GridBackdrop />
      <WaveTube points={carrier} color="#c7cedd" thickness={0.018} opacity={0.8} />
      <WaveTube points={fmWave} color={palette.accentSecondary} thickness={0.034} z={0.12} />
      <DottedWave points={modulator} color={palette.accentTertiary} step={7} size={0.032} z={0.15} />
    </>
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
  return (
    <SignalCanvasFrame
      title="Heterodyning"
      overlay={(
        <>
          <OverlayText $top="52px" $right="16px" $color={waveAColor}>Wave A (100,000,030MHz)</OverlayText>
          <OverlayText $top="50%" $right="16px" $color={sidebandColor} $weight={700}>Sideband/Envelope (30Hz)</OverlayText>
          <OverlayText $bottom="18px" $right="16px" $color={waveBColor}>Wave B (100MHz)</OverlayText>
        </>
      )}
    >
      <HeterodyningScene />
    </SignalCanvasFrame>
  );
};

const waveAColor = "#7c3aed";
const waveBColor = "#a855f7";
const sidebandColor = "#d4acff";

const HeterodyningScene: React.FC = () => {
  const waveA = useWavePoints(0.2, 1.1, 0.99, 0.9);
  const waveB = useWavePoints(0.2, 1.1, 1.15, -0.9);
  const sideband = useWavePoints(0, 0.95, 0.55);

  return (
    <>
      <GridBackdrop />
      <WaveTube points={waveA} color={waveAColor} thickness={0.03} z={0.12} />
      <WaveTube points={waveB} color={waveBColor} thickness={0.03} z={0.1} />
      <DottedWave points={sideband} color={sidebandColor} step={8} size={0.042} opacity={0.95} z={0.14} />
    </>
  );
};
