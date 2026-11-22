import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useAppSelector } from "@n-apt/redux";
import { selectActiveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import { formatFrequency } from "@n-apt/math/frequency";
import { fileFrameRuntime } from "@n-apt/app/infrastructure/visualization/frameRuntime";
import { useActivePresentationFrameRef } from "@n-apt/app/infrastructure/visualization/useActivePresentationFrame";
import {
  configureCanvasForDpr,
  formatSampleRate,
  projectIqSamples,
  resolveIqPlaneMetadata,
  type IqPlaneMetadata,
} from "./iqPlanePlot";

type IQFrame = {
  iq_data?: Uint8Array | null;
  sample_rate?: number | null;
  center_frequency_hz?: number | null;
};

interface IQPlaneNodeProps {
  data?: { label?: React.ReactNode };
}

const NODE_WIDTH = 560;
const NODE_HEIGHT = 400;
const MAX_PLOTTED_SAMPLES = 1200;

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
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  background: ${({ theme }) => theme.colors.surface};
  padding: 6px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const HeaderTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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

const SourceMetadata = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
`;

const RangeLegend = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 9px;
  line-height: 1;
  white-space: nowrap;
`;

const RangeLine = styled.span`
  position: relative;
  width: 34px;
  height: 1px;
  background: ${({ theme }) => theme.colors.textSecondary};

  &::after {
    position: absolute;
    top: -3px;
    left: 50%;
    width: 1px;
    height: 7px;
    background: ${({ theme }) => theme.colors.textSecondary};
    content: "";
  }
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
  const lastMetadataKeyRef = useRef("");
  const sampleCountRef = useRef<number | null>(null);
  const [hasIq, setHasIq] = useState(false);
  const [sampleCount, setSampleCount] = useState<number | null>(null);
  const [frameMetadata, setFrameMetadata] = useState<IqPlaneMetadata>({
    sampleRateHz: null,
    centerFrequencyHz: null,
  });
  const sourceMode = useAppSelector((state) => state.waterfall.sourceMode);
  const sourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const activeLiveFrameRef = useActivePresentationFrameRef();
  const deviceName = sourceDerived.deviceName || "I/Q source";
  const sourceMetadata = {
    sampleRateHz: sourceDerived.sampleRateHz,
    centerFrequencyHz: sourceDerived.sdrSettings?.center_frequency ?? null,
  };
  const displayedMetadata = {
    sampleRateHz: frameMetadata.sampleRateHz ?? sourceMetadata.sampleRateHz,
    centerFrequencyHz:
      frameMetadata.centerFrequencyHz ?? sourceMetadata.centerFrequencyHz,
  };
  const centerFrequencyLabel =
    typeof displayedMetadata.centerFrequencyHz === "number" &&
    Number.isFinite(displayedMetadata.centerFrequencyHz) &&
    displayedMetadata.centerFrequencyHz > 0
      ? formatFrequency(displayedMetadata.centerFrequencyHz, {
          precisionMHz: 3,
          precisionGHz: 4,
          precisionKHz: 1,
          trimTrailingZeros: true,
        })
      : "—";
  const sourceRef =
    sourceMode === "file" ? fileFrameRuntime.ref : activeLiveFrameRef;

  useEffect(() => {
    hasIqRef.current = false;
    lastMetadataKeyRef.current = "";
    sampleCountRef.current = null;
    setSampleCount(null);
    setFrameMetadata({ sampleRateHz: null, centerFrequencyHz: null });
    setHasIq(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const drawCanvas: HTMLCanvasElement = canvas;
    const drawContext: CanvasRenderingContext2D = context;

    let frameHandle = 0;
    let width = 0;
    let height = 0;
    let lastFrame: unknown = null;
    let lastIq: Uint8Array | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const nextWidth = Math.max(1, rect.width);
      const nextHeight = Math.max(1, rect.height);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      configureCanvasForDpr(
        drawCanvas,
        drawContext,
        width,
        height,
        window.devicePixelRatio || 1,
      );
      lastIq = null;
      frameHandle = window.requestAnimationFrame(draw);
    });
    resizeObserver.observe(drawCanvas);
    const handleWindowResize = () => {
      const cssWidth = drawCanvas.clientWidth;
      const cssHeight = drawCanvas.clientHeight;
      if (cssWidth <= 0 || cssHeight <= 0) return;
      width = cssWidth;
      height = cssHeight;
      configureCanvasForDpr(
        drawCanvas,
        drawContext,
        width,
        height,
        window.devicePixelRatio || 1,
      );
      lastIq = null;
      frameHandle = window.requestAnimationFrame(draw);
    };
    window.addEventListener("resize", handleWindowResize);

    function draw() {
      const frame = latestFrame(sourceRef.current);
      const iq = frame?.iq_data;
      if (
        frame &&
        iq &&
        iq.length >= 4 &&
        (frame !== lastFrame || iq !== lastIq)
      ) {
        lastFrame = frame;
        lastIq = iq;
        const rawSampleCount = Math.floor(iq.length / 2);
        if (rawSampleCount !== sampleCountRef.current) {
          sampleCountRef.current = rawSampleCount;
          setSampleCount(rawSampleCount);
        }
        const nextMetadata = resolveIqPlaneMetadata(frame, {
          sampleRateHz: null,
          centerFrequencyHz: null,
        });
        const metadataKey = `${nextMetadata.sampleRateHz ?? ""}:${nextMetadata.centerFrequencyHz ?? ""}`;
        if (metadataKey !== lastMetadataKeyRef.current) {
          lastMetadataKeyRef.current = metadataKey;
          setFrameMetadata(nextMetadata);
        }
        if (!hasIqRef.current) {
          hasIqRef.current = true;
          setHasIq(true);
        }
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.max(8, Math.min(width, height) * 0.35);
        const points = projectIqSamples(iq, MAX_PLOTTED_SAMPLES);

        drawContext.clearRect(0, 0, width, height);
        drawContext.fillStyle =
          getComputedStyle(drawCanvas).backgroundColor || "#0a0a0a";
        drawContext.fillRect(0, 0, width, height);
        drawContext.lineWidth = 1.25;
        drawContext.strokeStyle = "rgba(110, 126, 148, 0.38)";
        for (const fraction of [0.25, 0.5, 0.75, 1]) {
          drawContext.beginPath();
          drawContext.arc(centerX, centerY, radius * fraction, 0, Math.PI * 2);
          drawContext.stroke();
        }
        drawContext.strokeStyle = "rgba(110, 126, 148, 0.72)";
        drawContext.beginPath();
        drawContext.moveTo(centerX - radius, centerY);
        drawContext.lineTo(centerX + radius, centerY);
        drawContext.moveTo(centerX, centerY - radius);
        drawContext.lineTo(centerX, centerY + radius);
        drawContext.stroke();

        drawContext.fillStyle = "rgba(25, 130, 235, 0.58)";
        for (const point of points) {
          const x = centerX + point.i * radius;
          const y = centerY - point.q * radius;
          drawContext.beginPath();
          drawContext.arc(x, y, 1.5, 0, Math.PI * 2);
          drawContext.fill();
        }

        drawContext.fillStyle = "#aab6c7";
        drawContext.font = "600 11px sans-serif";
        drawContext.fillText("I", centerX + radius + 6, centerY - 5);
        drawContext.fillText("Q", centerX + 6, centerY - radius - 6);
      }
      frameHandle = window.requestAnimationFrame(draw);
    }

    frameHandle = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [sourceRef]);

  return (
    <OuterContainer data-testid="iq-plane-node">
      <Header>
        <HeaderTop>
          <Title>{data?.label ?? "I/Q Plane"}</Title>
          <SourceMetadata>
            <SourceLabel>{deviceName}</SourceLabel>
            <SourceLabel>
              Sample rate {formatSampleRate(displayedMetadata.sampleRateHz)} ·{" "}
              Center {centerFrequencyLabel} · Auto-scaled I/Q ·{" "}
              {sampleCount?.toLocaleString("en-US") ?? "—"} samples
            </SourceLabel>
          </SourceMetadata>
        </HeaderTop>
        <RangeLegend aria-label="I/Q signed range from minus 128 to plus 127">
          <span>I/Q signed range</span>
          <span>−128</span>
          <RangeLine aria-hidden="true" />
          <span>0</span>
          <RangeLine aria-hidden="true" />
          <span>+127</span>
        </RangeLegend>
      </Header>
      <Plot>
        <PlaneCanvas
          ref={canvasRef}
          aria-label="Auto-scaled I/Q sample cloud on complex plane"
        />
        {!hasIq && <EmptyState>Waiting for I/Q samples</EmptyState>}
      </Plot>
    </OuterContainer>
  );
};

export default IQPlaneNode;
