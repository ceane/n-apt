import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import { selectActiveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import {
  fileFrameRuntime,
  liveFrameRuntime,
} from "@n-apt/app/infrastructure/visualization/frameRuntime";

type IQFrame = {
  iq_data?: Uint8Array | null;
  sample_rate?: number | null;
};

interface IQPlaneNodeProps {
  data?: { label?: React.ReactNode };
}

const NODE_WIDTH = 760;
const NODE_HEIGHT = 520;
const WINDOW_SAMPLES = 100;
const MAX_TRACE_POINTS = 256;
const FREQUENCY_BINS = [-40, -30, -20, -10, 0, 10, 20, 30, 40] as const;
const TRACE_COLORS = [
  "#50d7ff",
  "#68e0b2",
  "#a3e563",
  "#ffd166",
  "#ff9f68",
  "#ff6f91",
  "#d18cff",
  "#8f9bff",
  "#72b7ff",
];

const OuterContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: ${NODE_WIDTH}px;
  min-width: ${NODE_WIDTH}px;
  height: ${NODE_HEIGHT}px;
  min-height: ${NODE_HEIGHT}px;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  overflow: hidden;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: ${({ theme }) => theme.colors.surface};
  padding: 8px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const SourceLabel = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  white-space: nowrap;
`;

const Plot = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  background: ${({ theme }) => theme.colors.background};
`;

const PlaneCanvas = styled.canvas`
  display: block;
  width: 100%;
  height: 100%;
`;

const EmptyState = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  pointer-events: none;
`;

const latestFrame = (value: unknown): IQFrame | null => {
  const frame = Array.isArray(value) ? value[value.length - 1] : value;
  return frame && typeof frame === "object" ? (frame as IQFrame) : null;
};

export const IQPlaneNode: React.FC<IQPlaneNodeProps> = ({ data }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasIqRef = useRef(false);
  const [hasIq, setHasIq] = useState(false);
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const sourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const deviceName = sourceDerived.deviceName || "I/Q source";
  const sourceRef = useMemo(
    () => (sourceMode === "file" ? fileFrameRuntime.ref : liveFrameRuntime.ref),
    [sourceMode],
  );

  useEffect(() => {
    hasIqRef.current = false;
    setHasIq(false);
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frameHandle = 0;
    let width = 0;
    let height = 0;
    let lastFrame: unknown = null;
    let lastIq: Uint8Array | null = null;
    const resizeObserver = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      lastIq = null;
      frameHandle = window.requestAnimationFrame(draw);
    });
    resizeObserver.observe(canvas);

    function draw() {
      const frame = latestFrame(sourceRef.current);
      const iq = frame?.iq_data;
      if (
        frame &&
        iq &&
        iq.length >= WINDOW_SAMPLES * 2 &&
        (frame !== lastFrame || iq !== lastIq)
      ) {
        lastFrame = frame;
        lastIq = iq;
        if (!hasIqRef.current) {
          hasIqRef.current = true;
          setHasIq(true);
        }
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.max(8, Math.min(width, height) * 0.4);
        const sampleCount = Math.floor(iq.length / 2);
        const blockCount = Math.floor(sampleCount / WINDOW_SAMPLES);
        const blockStride = Math.max(1, Math.ceil(blockCount / MAX_TRACE_POINTS));

        context.clearRect(0, 0, width, height);
        context.fillStyle = getComputedStyle(canvas).backgroundColor || "#0a0a0a";
        context.fillRect(0, 0, width, height);
        context.lineWidth = dpr;
        context.strokeStyle = "rgba(130, 145, 165, 0.25)";
        for (const fraction of [0.25, 0.5, 0.75, 1]) {
          context.beginPath();
          context.arc(centerX, centerY, radius * fraction, 0, Math.PI * 2);
          context.stroke();
        }
        context.strokeStyle = "rgba(160, 175, 195, 0.55)";
        context.beginPath();
        context.moveTo(centerX - radius, centerY);
        context.lineTo(centerX + radius, centerY);
        context.moveTo(centerX, centerY - radius);
        context.lineTo(centerX, centerY + radius);
        context.stroke();

        const toCanvas = (inPhase: number, quadrature: number) => ({
          x: centerX + inPhase * radius,
          y: centerY - quadrature * radius,
        });
        const frequencyStep =
          typeof frame.sample_rate === "number" && frame.sample_rate > 0
            ? frame.sample_rate / WINDOW_SAMPLES
            : null;

        FREQUENCY_BINS.forEach((bin, traceIndex) => {
          const color = TRACE_COLORS[traceIndex] ?? "#50d7ff";
          const angle = (-2 * Math.PI * bin) / WINDOW_SAMPLES;
          const stepReal = Math.cos(angle);
          const stepImaginary = Math.sin(angle);
          const points: Array<{ x: number; y: number }> = [];

          for (let blockIndex = 0; blockIndex < blockCount; blockIndex += blockStride) {
            const blockStart = blockIndex * WINDOW_SAMPLES;
            let oscillatorReal = 1;
            let oscillatorImaginary = 0;
            let sumReal = 0;
            let sumImaginary = 0;

            for (let sampleOffset = 0; sampleOffset < WINDOW_SAMPLES; sampleOffset += 1) {
              const byteIndex = (blockStart + sampleOffset) * 2;
              const sampleReal = ((iq[byteIndex] ?? 128) - 127.5) / 127.5;
              const sampleImaginary = ((iq[byteIndex + 1] ?? 128) - 127.5) / 127.5;
              sumReal += sampleReal * oscillatorReal - sampleImaginary * oscillatorImaginary;
              sumImaginary += sampleReal * oscillatorImaginary + sampleImaginary * oscillatorReal;

              const nextReal = oscillatorReal * stepReal - oscillatorImaginary * stepImaginary;
              oscillatorImaginary = oscillatorReal * stepImaginary + oscillatorImaginary * stepReal;
              oscillatorReal = nextReal;
            }

            points.push(toCanvas(sumReal / WINDOW_SAMPLES, sumImaginary / WINDOW_SAMPLES));
          }

          if (points.length === 0) return;
          context.beginPath();
          points.forEach(({ x, y }, index) => {
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.strokeStyle = color;
          context.lineWidth = Math.max(1, dpr * 1.3);
          context.stroke();

          context.fillStyle = color;
          for (const { x, y } of points) {
            context.beginPath();
            context.arc(x, y, Math.max(1.2, dpr * 1.5), 0, Math.PI * 2);
            context.fill();
          }

          const offset = frequencyStep === null ? null : (bin * frequencyStep) / 1000;
          const label = offset === null
            ? `bin ${bin}`
            : `${offset > 0 ? "+" : ""}${offset.toFixed(1)} kHz`;
          context.fillStyle = color;
          context.font = `${10 * dpr}px sans-serif`;
          context.fillText(label, 10 * dpr, (18 + traceIndex * 13) * dpr);
        });

        context.fillStyle = "#aab6c7";
        context.font = `${12 * dpr}px sans-serif`;
        context.fillText("I", centerX + radius + 6 * dpr, centerY - 5 * dpr);
        context.fillText("Q", centerX + 6 * dpr, centerY - radius - 6 * dpr);
        context.fillText(
          `${WINDOW_SAMPLES}-sample DFT · ${blockStride * WINDOW_SAMPLES} sample step`,
          10 * dpr,
          height - 10 * dpr,
        );
      }
      frameHandle = window.requestAnimationFrame(draw);
    }

    frameHandle = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
    };
  }, [sourceRef]);

  return (
    <OuterContainer data-testid="iq-plane-node">
      <Header>
        <Title>{data?.label ?? "I/Q Plane"}</Title>
        <SourceLabel>{deviceName} · 9 frequency traces</SourceLabel>
      </Header>
      <Plot>
        <PlaneCanvas ref={canvasRef} aria-label="I/Q frequency traces on complex plane" />
        {!hasIq && (
          <EmptyState>Waiting for I/Q samples</EmptyState>
        )}
      </Plot>
    </OuterContainer>
  );
};

export default IQPlaneNode;
