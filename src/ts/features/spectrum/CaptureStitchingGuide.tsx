import React from "react";
import styled, { useTheme } from "styled-components";
import type { AppStyledTheme } from "@n-apt/ui/Theme";
import { LazySDRCanvas } from "@n-apt/three-d/LazySDRCanvas";

const GuideCard = styled.figure`
  margin: 0 0 24px;
  padding: 20px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
  overflow: hidden;
`;

const GuideStage = styled.div`
  position: relative;
  width: 100%;
`;

const ProjectionSvg = styled.svg`
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const RtlSdrPreview = styled.div`
  position: absolute;
  top: 18%;
  left: 4%;
  z-index: 2;
  width: 60%;
  height: 26%;
  pointer-events: none;

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }
`;

const GuideSvg = styled.svg`
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  aspect-ratio: 980 / 1090;
  min-height: 0;

  .capture-window {
    animation: stitching-window 6s ease-in-out infinite;
  }

  .capture-window-interleaved {
    animation: stitching-window-interleaved 4.5s steps(6, end) infinite;
  }

  @keyframes stitching-window {
    0%,
    8% {
      transform: translateX(0);
    }
    30%,
    38% {
      transform: translateX(190px);
    }
    60%,
    68% {
      transform: translateX(380px);
    }
    92%,
    100% {
      transform: translateX(0);
    }
  }

  @keyframes stitching-window-interleaved {
    0%,
    14% {
      transform: translateX(0);
    }
    16%,
    30% {
      transform: translateX(190px);
    }
    32%,
    46% {
      transform: translateX(380px);
    }
    48%,
    62% {
      transform: translateX(0);
    }
    64%,
    78% {
      transform: translateX(190px);
    }
    80%,
    94% {
      transform: translateX(380px);
    }
    96%,
    100% {
      transform: translateX(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .capture-window,
    .capture-window-interleaved {
      animation: none;
    }
  }
`;

const waveformPath = (
  y: number,
  amplitude: number,
  phase: number = Math.PI,
  scale: number = 1,
) => {
  const startX = 110;
  const step = 25;
  const period = 150;
  const points = Array.from({ length: 31 }, (_, index) => {
    const x = startX + index * step;
    const angle = ((x - startX) / period) * Math.PI * 2 + phase;
    const value = y + amplitude * Math.sin(angle) * scale;
    const slope =
      amplitude * scale * ((Math.PI * 2) / period) * Math.cos(angle);
    return { x, value, slope };
  });

  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M${point.x} ${point.value}`;
    }

    const previous = points[index - 1];
    const controlOffset = step / 3;
    const firstControl = {
      x: previous.x + controlOffset,
      y: previous.value + previous.slope * controlOffset,
    };
    const secondControl = {
      x: point.x - controlOffset,
      y: point.value - point.slope * controlOffset,
    };

    return `${path} C${firstControl.x} ${firstControl.y} ${secondControl.x} ${secondControl.y} ${point.x} ${point.value}`;
  }, "");
};

const Waveform: React.FC<{
  y: number;
  stroke: string;
  opacity?: number;
}> = ({ y, stroke, opacity = 1 }) => {
  const pathRef = React.useRef<SVGPathElement>(null);

  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }

    let animationFrame = 0;

    const animate = (time: number) => {
      const t = time * 0.0026;
      const scale = 0.6 + 0.4 * Math.sin(t);
      const phase = Math.PI + 0.5 * Math.cos(t);
      pathRef.current?.setAttribute("d", waveformPath(y, 42, phase, scale));
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [y]);

  return (
    <path
      ref={pathRef}
      className="stitching-waveform"
      d={waveformPath(y, 42)}
      fill="none"
      stroke={stroke}
      strokeWidth="3"
      strokeLinecap="round"
      opacity={opacity}
    />
  );
};

const Window: React.FC<{
  x: number;
  y: number;
  label: string;
  stroke: string;
  fill: string;
}> = ({ x, y, label, stroke, fill }) => (
  <g>
    <rect
      x={x}
      y={y}
      width="170"
      height="76"
      rx="8"
      fill={fill}
      stroke={stroke}
      strokeWidth="2"
      strokeDasharray="6 4"
    />
    <text
      x={x + 85}
      y={y + 44}
      fill={stroke}
      fontFamily="monospace"
      fontSize="16"
      fontWeight="700"
      textAnchor="middle"
    >
      {label}
    </text>
  </g>
);

type ProjectionOverlayHandle = {
  setStart: (point: { x: number; y: number }) => void;
};

const ProjectionOverlay = React.forwardRef<
  ProjectionOverlayHandle,
  { stageRef: React.RefObject<HTMLDivElement | null>; color: string }
>(({ stageRef, color }, ref) => {
  const linesRef = React.useRef<(SVGLineElement | null)[]>([]);
  const targetXs = [122, 160, 198, 236, 274];

  React.useImperativeHandle(
    ref,
    () => ({
      setStart: (point) => {
        const stage = stageRef.current;
        if (!stage) return;

        const rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const x = ((point.x - rect.left) / rect.width) * 980;
        const y = ((point.y - rect.top) / rect.height) * 1090;

        linesRef.current.forEach((line, index) => {
          if (!line) return;
          line.setAttribute("x1", String(x));
          line.setAttribute("y1", String(y));
          line.setAttribute("x2", String(targetXs[index]));
          line.setAttribute("y2", "168");
        });
      },
    }),
    [stageRef],
  );

  return (
    <ProjectionSvg
      viewBox="0 0 980 1090"
      aria-label="Projection from the RTL-SDR antenna to the Max sample window"
      role="img"
    >
      {targetXs.map((targetX, index) => (
        <line
          key={targetX}
          ref={(line) => {
            linesRef.current[index] = line;
          }}
          x1={targetX}
          y1="168"
          x2={targetX}
          y2="168"
          stroke={color}
          strokeWidth="2"
          strokeDasharray="6 5"
          opacity={index === 2 ? 0.82 : 0.52}
        />
      ))}
    </ProjectionSvg>
  );
});

ProjectionOverlay.displayName = "ProjectionOverlay";

export const CaptureStitchingGuide: React.FC = () => {
  const theme = useTheme() as AppStyledTheme;
  const colors = theme.colors;
  const panelFill = colors.background;
  const accent = colors.primary;
  const secondary = colors.secondary ?? colors.primary;
  const signal = colors.fftLine ?? colors.primary;
  const stageRef = React.useRef<HTMLDivElement>(null);
  const projectionRef = React.useRef<ProjectionOverlayHandle>(null);
  const handleProjectionPoint = React.useCallback(
    (point: { x: number; y: number }) => {
      projectionRef.current?.setStart(point);
    },
    [],
  );

  return (
    <GuideCard>
      <GuideStage ref={stageRef}>
        <GuideSvg
          viewBox="0 0 980 1090"
          role="img"
          aria-labelledby="capture-stitching-guide-title capture-stitching-guide-description"
        >
          <title id="capture-stitching-guide-title">
            Stepwise and interleaved (TDMS) I/Q capture stitching
          </title>
          <desc id="capture-stitching-guide-description">
            An RTL-SDR sample window covers only part of a wider waveform. The
            sample window is projected across the waveform, then Stepwise I/Q
            capture completes window A, then B, then C. Interleaved TDMS I/Q
            capture rapidly cycles through A, B, and C. The partial windows are
            aligned and stitched into one waveform.
          </desc>
          <defs>
            <marker
              id="capture-stitching-guide-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
            >
              <path d="M0 0 L10 5 L0 10 Z" fill={accent} />
            </marker>
          </defs>

          <rect
            x="20"
            y="20"
            width="940"
            height="520"
            rx="14"
            fill={panelFill}
            stroke={colors.border}
          />
          <text
            x="48"
            y="55"
            fill={colors.textPrimary}
            fontFamily="monospace"
            fontSize="18"
            fontWeight="700"
          >
            Why stitching is needed
          </text>
          <text
            x="48"
            y="84"
            fill={colors.textSecondary}
            fontFamily="sans-serif"
            fontSize="15"
          >
            The waveform / channel span is wider than the SDR's maximum sample rate.
          </text>
          <Waveform y={130} stroke={signal} />
          <Window
            x={110}
            y={92}
            label="Max"
            stroke={accent}
            fill={`${accent}18`}
          />
          <text
            x="780"
            y="176"
            fill={colors.textMuted}
            fontFamily="monospace"
            fontSize="12"
          >
            wide waveform →
          </text>

          <rect
            x="20"
            y="570"
            width="940"
            height="190"
            rx="14"
            fill={panelFill}
            stroke={colors.border}
          />
          <text
            x="48"
            y="606"
            fill={colors.textPrimary}
            fontFamily="monospace"
            fontSize="18"
            fontWeight="700"
          >
            Stepwise I/Q capture
          </text>
          <text
            x="48"
            y="632"
            fill={colors.textSecondary}
            fontFamily="sans-serif"
            fontSize="14"
          >
            Finish one window, step to the next, then align the pieces.
          </text>
          <Waveform y={685} stroke={signal} opacity={0.5} />
          <Window
            x={110}
            y={647}
            label="A"
            stroke={accent}
            fill={`${accent}18`}
          />
          <Window
            x={300}
            y={647}
            label="B"
            stroke={accent}
            fill={`${accent}18`}
          />
          <Window
            x={490}
            y={647}
            label="C"
            stroke={accent}
            fill={`${accent}18`}
          />
          <rect
            className="capture-window"
            x="110"
            y="647"
            width="170"
            height="76"
            rx="8"
            fill="none"
            stroke={accent}
            strokeWidth="4"
          />
          <path
            d="M195 725 H385 M385 725 H575"
            fill="none"
            stroke={accent}
            strokeWidth="2"
            markerEnd="url(#capture-stitching-guide-arrow)"
          />
          <text
            x="690"
            y="680"
            fill={colors.textMuted}
            fontFamily="monospace"
            fontSize="13"
          >
            A → B → C
          </text>
          <text
            x="690"
            y="703"
            fill={colors.textMuted}
            fontFamily="sans-serif"
            fontSize="13"
          >
            one window at a time
          </text>

          <rect
            x="20"
            y="785"
            width="940"
            height="190"
            rx="14"
            fill={panelFill}
            stroke={colors.border}
          />
          <text
            x="48"
            y="821"
            fill={colors.textPrimary}
            fontFamily="monospace"
            fontSize="18"
            fontWeight="700"
          >
            Interleaved (TDMS) I/Q capture
          </text>
          <text
            x="48"
            y="847"
            fill={colors.textSecondary}
            fontFamily="sans-serif"
            fontSize="14"
          >
            Rapidly cycle through windows so each piece stays close in time.
          </text>
          <Waveform y={900} stroke={signal} opacity={0.5} />
          <Window
            x={110}
            y={862}
            label="A"
            stroke={secondary}
            fill={`${secondary}18`}
          />
          <Window
            x={300}
            y={862}
            label="B"
            stroke={secondary}
            fill={`${secondary}18`}
          />
          <Window
            x={490}
            y={862}
            label="C"
            stroke={secondary}
            fill={`${secondary}18`}
          />
          <rect
            className="capture-window-interleaved"
            x="110"
            y="862"
            width="170"
            height="76"
            rx="8"
            fill="none"
            stroke={secondary}
            strokeWidth="4"
          />
          <text
            x="690"
            y="895"
            fill={colors.textMuted}
            fontFamily="monospace"
            fontSize="13"
          >
            A → B → C → A → B → C
          </text>
          <text
            x="690"
            y="918"
            fill={colors.textMuted}
            fontFamily="sans-serif"
            fontSize="13"
          >
            repeated time-divided visits
          </text>

          <path
            d="M490 995 V1015"
            stroke={accent}
            strokeWidth="2"
            markerEnd="url(#capture-stitching-guide-arrow)"
          />
          <text
            x="540"
            y="1045"
            fill={colors.textPrimary}
            fontFamily="monospace"
            fontSize="15"
            fontWeight="700"
          >
            align + stitch → one continuous waveform
          </text>
        </GuideSvg>
        <ProjectionOverlay
          ref={projectionRef}
          stageRef={stageRef}
          color={accent}
        />
        <RtlSdrPreview>
          <LazySDRCanvas
            variant="rtl"
            withAntenna
            onProjectionPoint={handleProjectionPoint}
          />
        </RtlSdrPreview>
      </GuideStage>
    </GuideCard>
  );
};
