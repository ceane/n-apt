import React, { useRef, useEffect, useState, useCallback } from "react";
import styled, { useTheme } from "styled-components";
import { FFT_MIN_DB, FFT_MAX_DB } from "@n-apt/consts";
import { formatFrequency } from "@n-apt/utils/frequency";
import { type AppStyledTheme } from "@n-apt/components/ui/Theme";
import Tooltip from "@n-apt/components/ui/Tooltip";

const Card = styled.div`
  width: 100%;
  padding: 0;
  margin-bottom: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};

  &:first-child {
    border-radius: 8px 8px 0 0;
  }

  &:last-child {
    border-radius: 0 0 8px 8px;
  }

  &:not(:first-child) {
    border-top: none;
  }
`;

const CanvasWrapper = styled.div<{ $aspectRatio?: string }>`
  position: relative;
  width: 100%;
  aspect-ratio: ${(props) => props.$aspectRatio || "21 / 11"};
`;

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surfaceHover};
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: ${({ theme }) => theme.colors.textMuted};
  }
`;

const Badge = styled.div<{ color?: string }>`
  background: ${(props) => props.color || props.theme.colors.primary};
  color: ${(props) =>
    props.theme.mode === "dark" ? "#000" : "#fff"}; // High contrast text
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
`;

interface FFTDiagnosticCanvasProps {
  title: string;
  tooltip?: string;
  badgeText?: string;
  data: any;
  frameIndex: number;
  type: "raw" | "stitched";
  zoomRange: [number, number] | null;
  onZoomChange: (range: [number, number] | null) => void;
}

const decodeDbFrame = (
  data: any,
  frameIndex: number,
  frameKind: "hop1" | "hop2" | "stitched",
) => {
  if (!data) return [];

  if (typeof data.decodeFrame === "function" && Number.isFinite(data.fft_size)) {
    if (typeof data.getFrame === "function") {
      return data.getFrame(frameKind, frameIndex);
    }
    const fftSize = data.fft_size as number;
    const offset =
      frameKind === "hop1"
        ? frameIndex * fftSize
        : frameKind === "hop2"
          ? data.frameSpan + frameIndex * fftSize
          : 0;
    return data.decodeFrame(offset);
  }

  if (frameKind === "hop1") return (data.hop1_frames || [])[frameIndex] || [];
  if (frameKind === "hop2") return (data.hop2_frames || [])[frameIndex] || [];
  return (data.stitched_frames || [])[frameIndex] || [];
};

/** Max-pooling decimation to extract signal envelope when points > pixels */
const decimateWaveform = (
  waveform: number[] | Float32Array,
  targetWidth: number,
): number[] | Float32Array => {
  const len = waveform.length;
  if (len <= targetWidth * 1.5 || targetWidth <= 0) return waveform;
  const out = Array.from({ length: targetWidth }, () => 0);
  const factor = len / targetWidth;
  for (let i = 0; i < targetWidth; i++) {
    const start = Math.floor(i * factor);
    const end = Math.min(len, Math.floor((i + 1) * factor));
    let max = -Infinity;
    for (let j = start; j < end; j++) {
      const v = waveform[j];
      if (v > max) max = v;
    }
    out[i] = max === -Infinity ? -120 : max;
  }
  return out;
};

export const FFTDiagnosticCanvas: React.FC<FFTDiagnosticCanvasProps> = ({
  title,
  tooltip,
  badgeText,
  data,
  frameIndex,
  type,
  zoomRange,
  onZoomChange,
}) => {
  const theme = useTheme() as AppStyledTheme;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  // Helper to normalize frequency ranges to Hz
  const toHz = (r: [number, number] | undefined) => {
    if (!r) return [0, 0] as [number, number];
    const multiplier = Math.max(Math.abs(r[0]), Math.abs(r[1])) < 10000 ? 1e6 : 1;
    return [r[0] * multiplier, r[1] * multiplier] as [number, number];
  };

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    }

    return { ctx, dpr, width: canvas.width, height: canvas.height, rect };
  }, []);

  const drawTrace = useCallback((
    ctx: CanvasRenderingContext2D,
    logicalWidth: number,
    logicalHeight: number,
    traceData: number[] | Float32Array,
    traceRange: [number, number],
    color: string,
    fill: string,
    globalRange: [number, number],
    isStitched: boolean
  ) => {
    if (!traceData || traceData.length === 0) return;

    const leftMargin = 70;
    const rightMargin = 30;
    const bottomMargin = 40;
    const topMargin = isStitched ? 50 : 125;

    const fftAreaMax = { x: logicalWidth - rightMargin, y: logicalHeight - bottomMargin };
    const fftHeight = fftAreaMax.y - topMargin;
    const plotWidth = fftAreaMax.x - leftMargin;

    const dbMin = FFT_MIN_DB;
    const dbMax = FFT_MAX_DB;
    const vertRange = dbMax - dbMin;
    const scaleFactor = fftHeight / vertRange;

    const x0 = leftMargin + ((traceRange[0] - globalRange[0]) / (globalRange[1] - globalRange[0])) * plotWidth;
    const x1 = leftMargin + ((traceRange[1] - globalRange[0]) / (globalRange[1] - globalRange[0])) * plotWidth;
    const w = x1 - x0;

    const decimated = decimateWaveform(traceData, Math.ceil(w));
    const getY = (db: number) => fftAreaMax.y - (db - dbMin) * scaleFactor;
    const clampY = (y: number) => Math.max(topMargin, Math.min(fftAreaMax.y, y));

    const gradient = ctx.createLinearGradient(0, topMargin, 0, fftAreaMax.y);
    gradient.addColorStop(0, fill);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.beginPath();
    ctx.fillStyle = gradient;
    ctx.moveTo(x0, fftAreaMax.y);
    for (let i = 0; i < decimated.length; i++) {
      const x = x0 + (i / (decimated.length - 1)) * w;
      ctx.lineTo(x, clampY(getY(decimated[i])));
    }
    ctx.lineTo(x1, fftAreaMax.y);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < decimated.length; i++) {
      const x = x0 + (i / (decimated.length - 1)) * w;
      if (i === 0) ctx.moveTo(x, clampY(getY(decimated[i])));
      else ctx.lineTo(x, clampY(getY(decimated[i])));
    }
    ctx.stroke();
  }, [theme]);

  const drawAxis = useCallback((
    ctx: CanvasRenderingContext2D,
    logicalWidth: number,
    logicalHeight: number,
    range: [number, number],
    hop1_range?: [number, number],
    hop2_range?: [number, number],
    h1_phase?: number,
    h2_phase?: number,
    correction?: number,
    fmDeviation?: number,
    isStitched?: boolean
  ) => {
    const leftMargin = 70;
    const rightMargin = 30;
    const bottomMargin = 40;
    const topMargin = isStitched ? 50 : 125;

    const fftAreaMax = { x: logicalWidth - rightMargin, y: logicalHeight - bottomMargin };
    const fftHeight = fftAreaMax.y - topMargin;
    const plotWidth = fftAreaMax.x - leftMargin;

    const dbMin = FFT_MIN_DB;
    const dbMax = FFT_MAX_DB;
    const vertRange = dbMax - dbMin;
    const scaleFactor = fftHeight / vertRange;

    ctx.strokeStyle = theme.colors.fftGrid;
    ctx.fillStyle = theme.colors.fftText;
    ctx.font = `11px ${theme.typography.mono}`;
    ctx.textAlign = "right";
    ctx.lineWidth = 1;

    for (let line = dbMax; line >= dbMin; line -= 20) {
      const yPos = fftAreaMax.y - (line - dbMin) * scaleFactor;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(leftMargin, Math.round(yPos));
      ctx.lineTo(fftAreaMax.x, Math.round(yPos));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`${line}dB`, leftMargin - 10, Math.round(yPos + 4));
    }

    ctx.textAlign = "center";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const x = leftMargin + (i / steps) * plotWidth;
      const val = range[0] + (i / steps) * (range[1] - range[0]);
      ctx.strokeStyle = theme.colors.fftText;
      ctx.beginPath();
      ctx.moveTo(x, fftAreaMax.y);
      ctx.lineTo(x, fftAreaMax.y + 7);
      ctx.stroke();
      ctx.fillText(formatFrequency(val), x, fftAreaMax.y + 22);
    }

    const drawHWBlock = (startFreq: number, endFreq: number, color: string, label: string, phaseDeg?: number) => {
      if (startFreq < range[1] && endFreq > range[0]) {
        const x1 = leftMargin + ((Math.max(startFreq, range[0]) - range[0]) / (range[1] - range[0])) * plotWidth;
        const x2 = leftMargin + ((Math.min(endFreq, range[1]) - range[0]) / (range[1] - range[0])) * plotWidth;

        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;

        if (startFreq >= range[0]) {
          ctx.beginPath();
          ctx.moveTo(x1, topMargin); ctx.lineTo(x1, fftAreaMax.y); ctx.stroke();
        }
        if (endFreq <= range[1]) {
          ctx.beginPath();
          ctx.moveTo(x2, topMargin); ctx.lineTo(x2, fftAreaMax.y); ctx.stroke();
        }

        const cx = Math.max(x1 + 60, Math.min(x2 - 60, (x1 + x2) / 2));
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.font = `bold 13px ${theme.typography.mono}`;
        ctx.fillText(label, cx, topMargin - 80);

        if (phaseDeg !== undefined) {
          ctx.font = `10px ${theme.typography.mono}`;
          ctx.fillStyle = color.replace("0.45", "0.7");
          let phaseStr = `${phaseDeg.toFixed(1)}°`;
          if (label === "Hop B" && correction !== undefined && correction !== null) {
            const aligned = (((phaseDeg || 0) + correction + 180) % 360) - 180;
            phaseStr += ` (Aligned: ${aligned.toFixed(1)}°)`;
          }
          ctx.fillText(phaseStr, cx, topMargin - 62);
        }
        ctx.restore();
      }
    };

    if (!isStitched) {
      if (hop1_range) drawHWBlock(hop1_range[0], hop1_range[1], theme.colors.danger + "73", "Hop A", h1_phase);
      if (hop2_range) drawHWBlock(hop2_range[0], hop2_range[1], theme.colors.secondary + "73", "Hop B", h2_phase);

      if (hop1_range && hop2_range) {
        const overlapStart = hop2_range[0];
        const overlapEnd = hop1_range[1];
        if (overlapEnd > overlapStart) {
          const x0 = leftMargin + ((overlapStart - range[0]) / (range[1] - range[0])) * plotWidth;
          const x1 = leftMargin + ((overlapEnd - range[0]) / (range[1] - range[0])) * plotWidth;
          const lineY = topMargin - 35;

          ctx.strokeStyle = theme.colors.textMuted + "4d";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0, lineY); ctx.lineTo(x1, lineY);
          ctx.moveTo(x0, lineY - 3); ctx.lineTo(x0, lineY + 3);
          ctx.moveTo(x1, lineY - 3); ctx.lineTo(x1, lineY + 3);
          ctx.stroke();

          const cutFreq = data.cut_point_hz || (overlapStart + overlapEnd) / 2;
          const xMid = leftMargin + ((cutFreq - range[0]) / (range[1] - range[0])) * plotWidth;
          ctx.save();
          ctx.strokeStyle = theme.colors.success;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(xMid, topMargin); ctx.lineTo(xMid, fftAreaMax.y);
          ctx.stroke();
          ctx.fillStyle = theme.colors.success;
          ctx.font = `bold 9px ${theme.typography.mono}`;
          ctx.textAlign = "center";
          ctx.fillText("CUT POINT", xMid, fftAreaMax.y + 35);
          ctx.restore();

          const spanMHz = overlapEnd - overlapStart;
          ctx.fillStyle = theme.colors.textMuted;
          ctx.font = `bold 9px ${theme.typography.mono}`;
          ctx.textAlign = "center";
          ctx.fillText(`${formatFrequency(spanMHz)} OVERLAP`, (x0 + x1) / 2, lineY - 8);

          if (correction !== undefined) {
            const midX = (x0 + x1) / 2;
            ctx.fillStyle = theme.colors.textPrimary;
            ctx.font = `bold 10px ${theme.typography.mono}`;
            ctx.fillText(`${correction?.toFixed(1)}° PHASE SHIFT APPLIED`, midX, topMargin - 12);
            const absDev = Math.abs(fmDeviation || 0);
            const sign = (fmDeviation || 0) > 0 ? "+" : "-";
            ctx.fillText(`Deviation: Δf ≈ ${sign}${absDev.toFixed(1)} kHz`, midX, topMargin - 26);
          }
        }
      }

      if (data.timing) {
        ctx.textAlign = "center";
        ctx.font = `10px ${theme.typography.mono}`;
        ctx.fillStyle = theme.colors.textMuted;
        let timeStr = `Latency: ${data.timing.total_latency_ms.toFixed(0)}ms / Settle: ${data.timing.settle_time_ms.toFixed(0)}ms / Slice: ${data.timing.slice_duration_ms.toFixed(1)}ms / Error: ${data.overlap_rms_error?.toFixed(2)}dB / TS: ${data.timing.capture_timestamp_ms}`;
        if (fmDeviation !== undefined) timeStr += ` / FM Dev: ${fmDeviation.toFixed(1)} kHz`;
        ctx.fillText(timeStr, logicalWidth / 2, 22);
      }
    }

    ctx.strokeStyle = theme.colors.border;
    ctx.strokeRect(leftMargin, topMargin, plotWidth, fftHeight);
  }, [theme, data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let animationFrameId = 0;

    const render = () => {
      if (disposed) return;

      const result = getCanvasContext();
      if (!result) return;

      const { ctx, dpr, width, height, rect } = result;
      const logicalWidth = rect.width;
      const logicalHeight = rect.height;

      ctx.fillStyle = theme.colors.fftBackground;
      ctx.fillRect(0, 0, width, height);

      if (!data) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.font = `13px ${theme.typography.mono}`;
        ctx.fillStyle = theme.colors.textMuted;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          "Run Multi-Frame Capture to start",
          logicalWidth / 2,
          logicalHeight / 2,
        );
        ctx.restore();
        return;
      }

      const h1_range = toHz(data.hop1_freq_hz || data.hop1_freq_mhz);
      const h2_range = toHz(data.hop2_freq_hz || data.hop2_freq_mhz);
      const hs_range = toHz(data.stitched_freq_hz || data.stitched_freq_mhz);

      const globalRange =
        zoomRange ||
        (type === "raw"
          ? [Math.min(h1_range[0], h2_range[0]), Math.max(h1_range[1], h2_range[1])]
          : hs_range);

      ctx.save();
      ctx.scale(dpr, dpr);

      drawAxis(
        ctx,
        logicalWidth,
        logicalHeight,
        globalRange,
        type === "raw" ? h1_range : undefined,
        type === "raw" ? h2_range : undefined,
        data.hop1_phase_deg,
        data.hop2_phase_deg,
        data.correction_angle_deg,
        data.fm_deviation_khz,
        type === "stitched",
      );

      if (type === "raw") {
        const hop1 = decodeDbFrame(data, frameIndex, "hop1");
        const hop2 = decodeDbFrame(data, frameIndex, "hop2");
        drawTrace(
          ctx,
          logicalWidth,
          logicalHeight,
          hop1,
          h1_range,
          theme.colors.danger,
          theme.colors.danger + "33",
          globalRange,
          false,
        );
        drawTrace(
          ctx,
          logicalWidth,
          logicalHeight,
          hop2,
          h2_range,
          theme.colors.secondary,
          theme.colors.secondary + "33",
          globalRange,
          false,
        );
      } else {
        const stitched = decodeDbFrame(data, frameIndex, "stitched");
        drawTrace(
          ctx,
          logicalWidth,
          logicalHeight,
          stitched,
          hs_range,
          theme.colors.primary,
          theme.colors.primary + "33",
          globalRange,
          true,
        );
      }

      ctx.restore();
    };

    const scheduleRender = () => {
      if (disposed) return;
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(render);
    };

    scheduleRender();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleRender);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", scheduleRender);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleRender);
    };
  }, [data, frameIndex, zoomRange, type, getCanvasContext, drawAxis, drawTrace, theme]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStart || !dragCurrent || !data) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const h1_range = toHz(data.hop1_freq_hz || data.hop1_freq_mhz);
    const h2_range = toHz(data.hop2_freq_hz || data.hop2_freq_mhz);
    const hs_range = toHz(data.stitched_freq_hz || data.stitched_freq_mhz);
    const currentRange = zoomRange || (type === "raw" ? [Math.min(h1_range[0], h2_range[0]), Math.max(h1_range[1], h2_range[1])] : hs_range);

    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const leftMargin = 70;
      const rightMargin = 30;
      const plotWidth = rect.width - leftMargin - rightMargin;

      const x1 = Math.min(dragStart.x, dragCurrent.x);
      const x2 = Math.max(dragStart.x, dragCurrent.x);

      if (x2 - x1 > 5) {
        const pct1 = Math.max(0, Math.min(1, (x1 - leftMargin) / plotWidth));
        const pct2 = Math.max(0, Math.min(1, (x2 - leftMargin) / plotWidth));

        const f1 = currentRange[0] + pct1 * (currentRange[1] - currentRange[0]);
        const f2 = currentRange[0] + pct2 * (currentRange[1] - currentRange[0]);
        onZoomChange([f1, f2]);
      }
    }

    setDragStart(null);
    setDragCurrent(null);
  };

  return (
    <Card>
      <SectionHeader>
        <SectionTitle>
          {title}
          {tooltip && <Tooltip content={tooltip} />}
        </SectionTitle>
        {badgeText && <Badge>{badgeText}</Badge>}
      </SectionHeader>
      <CanvasWrapper
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          onZoomChange(null);
        }}
        style={{ position: "relative" }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", cursor: "crosshair" }}
        />
        {dragStart && dragCurrent && (
          <div
            style={{
              position: "absolute",
              border: "1px dashed rgba(255,255,255,0.8)",
              backgroundColor: "rgba(255,255,255,0.2)",
              pointerEvents: "none",
              zIndex: 100,
              left: Math.min(dragStart.x, dragCurrent.x),
              top: Math.min(dragStart.y, dragCurrent.y),
              width: Math.abs(dragCurrent.x - dragStart.x),
              height: Math.abs(dragCurrent.y - dragStart.y),
            }}
          />
        )}
      </CanvasWrapper>
    </Card>
  );
};
