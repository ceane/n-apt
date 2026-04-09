import React, { useState, useRef, useEffect } from "react";
import styled from "styled-components";
import {
  LINE_COLOR,
  SHADOW_COLOR,
  FFT_MIN_DB,
  FFT_MAX_DB,
  FFT_GRID_COLOR,
  FFT_TEXT_COLOR
} from "@n-apt/consts";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { formatFrequency } from "@n-apt/utils/frequency";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  color: #fff;
  font-family: "Outfit", sans-serif;
  padding: 20px;
  overflow-y: auto;

  /* Custom Scrollbar */
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
`;


const VisualizerGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-right: 8px;
`;

const Card = styled.div`
  padding: 0;
  margin-bottom: 0;
  border: 1px solid #222;
  background: rgba(0, 0, 0, 0.1);

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
  aspect-ratio: ${props => props.$aspectRatio || "21 / 11"};
`;

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.02);
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: "/";
    color: #333;
  }
`;

const Badge = styled.div<{ color?: string }>`
  background: ${props => props.color || "#3b82f6"};
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
`;


export const StitchTestRoute: React.FC = () => {
  const { state, dispatch } = useSpectrumStore();
  const [result, setResult] = useState<any>(null);
  const [frameIndex, setFrameIndex] = useState(0);

  // Zoom / Interaction
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number, y: number } | null>(null);

  const rawCanvasRef = useRef<HTMLCanvasElement>(null);
  const stitchedCanvasRef = useRef<HTMLCanvasElement>(null);

  const lastTriggerRef = useRef(state.diagnosticTrigger);

  const runDiagnostic = async () => {
    dispatch({ type: "SET_DIAGNOSTIC_RUNNING", running: true });
    dispatch({ type: "SET_DIAGNOSTIC_STATUS", status: "Capturing 60 frames..." });

    // Compute center_hz from the current frequency range so the backend
    // tunes to whichever channel the user has selected in the sidebar.
    const range = state.frequencyRange;
    const center_hz = range
      ? Math.round(((range.min + range.max) / 2) * 1_000_000)
      : undefined;

    try {
      const response = await fetch("/api/debug/stitch-diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          center_hz,
          signal_area: state.activeSignalArea
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || "Failed to run diagnostic");
      }

      const data = await response.json();
      setResult(data);
      setFrameIndex(0);
      dispatch({ type: "SET_DIAGNOSTIC_STATUS", status: "Capture complete" });
    } catch (e: any) {
      dispatch({ type: "SET_DIAGNOSTIC_STATUS", status: `Error: ${e.message}` });
    } finally {
      dispatch({ type: "SET_DIAGNOSTIC_RUNNING", running: false });
    }
  };

  useEffect(() => {
    if (state.diagnosticTrigger > lastTriggerRef.current) {
      lastTriggerRef.current = state.diagnosticTrigger;
      runDiagnostic();
    }
  }, [state.diagnosticTrigger]);

  /** Max-pooling decimation to extract signal envelope when points > pixels */
  const decimateWaveform = (waveform: number[], targetWidth: number): number[] => {
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

  // Draw empty state on canvas when no result yet
  useEffect(() => {
    if (result) return; // real data will take over
    const drawEmptyState = (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.font = "13px JetBrains Mono";
      ctx.fillStyle = "#444";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Run Multi-Frame Capture to start", rect.width / 2, rect.height / 2);
      ctx.restore();
    };
    drawEmptyState(rawCanvasRef.current);
    drawEmptyState(stitchedCanvasRef.current);
  }, [result]);

  useEffect(() => {
    let animationFrameId: number;

    const render = () => {
      if (result) {
        [rawCanvasRef, stitchedCanvasRef].forEach(ref => {
          if (!ref.current) return;
          const canvas = ref.current;
          const rect = canvas.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;

          if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
            canvas.width = Math.floor(rect.width * dpr);
            canvas.height = Math.floor(rect.height * dpr);
          }
        });
        drawData(result, frameIndex);
      }
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [result, frameIndex, zoomRange]);

  const drawData = (data: any, index: number) => {
    const {
      hop1_frames,
      hop2_frames,
      stitched_frames,
      hop1_freq_mhz,
      hop2_freq_mhz,
      stitched_freq_mhz,
      hop1_phase_deg,
      hop2_phase_deg,
      correction_angle_deg,
      fm_deviation_khz,
      timing
    } = data;
    const hop1 = hop1_frames[index] || [];
    const hop2 = hop2_frames[index] || [];
    const stitched = stitched_frames[index] || [];

    const drawAxis = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      range: [number, number],
      hop1_range?: [number, number],
      hop2_range?: [number, number],
      h1_phase?: number,
      h2_phase?: number,
      correction?: number,
      fmDeviation?: number,
      isStitched?: boolean
    ) => {
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);

      const logicalWidth = width / dpr;
      const logicalHeight = height / dpr;

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

      // Draw Grid & dB Axis
      ctx.strokeStyle = FFT_GRID_COLOR;
      ctx.fillStyle = FFT_TEXT_COLOR;
      ctx.font = "11px JetBrains Mono";
      ctx.textAlign = "right";
      ctx.lineWidth = 1;

      // dB Labels (Draw every 20dB to reduce squish)
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

      // Frequency Axis
      ctx.textAlign = "center";
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const x = leftMargin + (i / steps) * plotWidth;
        const val = range[0] + (i / steps) * (range[1] - range[0]);

        ctx.strokeStyle = FFT_TEXT_COLOR;
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
            ctx.moveTo(x1, topMargin);
            ctx.lineTo(x1, fftAreaMax.y);
            ctx.stroke();
          }

          if (endFreq <= range[1]) {
            ctx.beginPath();
            ctx.moveTo(x2, topMargin);
            ctx.lineTo(x2, fftAreaMax.y);
            ctx.stroke();
          }

          const cx = Math.max(x1 + 60, Math.min(x2 - 60, (x1 + x2) / 2));
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.font = `bold 13px JetBrains Mono`;
          ctx.fillText(label, cx, topMargin - 80);

          // Phase label (one line below)
          if (phaseDeg !== undefined) {
            ctx.font = `10px JetBrains Mono`;
            ctx.fillStyle = color.replace("0.45", "0.7");

            let phaseStr = `${phaseDeg.toFixed(1)}°`;
            if (label === "Hop B" && correction !== undefined) {
              const aligned = ((phaseDeg + correction + 180) % 360) - 180;
              phaseStr += ` (Aligned: ${aligned.toFixed(1)}°)`;
            }
            ctx.fillText(phaseStr, cx, topMargin - 62);
          }

          ctx.restore();
        }
      };

      if (hop1_range) drawHWBlock(hop1_range[0], hop1_range[1], "rgba(255, 68, 68, 0.45)", "Hop A", h1_phase);
      if (hop2_range) drawHWBlock(hop2_range[0], hop2_range[1], "rgba(68, 68, 255, 0.45)", "Hop B", h2_phase);

      // Overlap Span Annotation
      if (hop1_range && hop2_range) {
        const overlapStart = hop2_range[0];
        const overlapEnd = hop1_range[1];
        if (overlapEnd > overlapStart) {
          const x0 = leftMargin + ((overlapStart - range[0]) / (range[1] - range[0])) * plotWidth;
          const x1 = leftMargin + ((overlapEnd - range[0]) / (range[1] - range[0])) * plotWidth;

          ctx.save();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
          ctx.lineWidth = 1;

          // Horizontal line over overlap area
          const lineY = topMargin - 35;
          ctx.beginPath();
          ctx.moveTo(x0, lineY);
          ctx.lineTo(x1, lineY);
          ctx.stroke();

          // Vertical ticks for overlap
          ctx.beginPath();
          ctx.moveTo(x0, lineY - 3); ctx.lineTo(x0, lineY + 3);
          ctx.moveTo(x1, lineY - 3); ctx.lineTo(x1, lineY + 3);
          ctx.stroke();

          // Midpoint Cut Line
          const midFreq = (overlapStart + overlapEnd) / 2;
          const xMid = leftMargin + ((midFreq - range[0]) / (range[1] - range[0])) * plotWidth;

          ctx.save();
          ctx.strokeStyle = "#10b981"; // Emerald green for the "keep" boundary
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(xMid, topMargin);
          ctx.lineTo(xMid, fftAreaMax.y);
          ctx.stroke();

          // Label the cut
          ctx.fillStyle = "#10b981";
          ctx.font = "bold 9px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.fillText("CUT POINT", xMid, fftAreaMax.y + 35);
          ctx.restore();

          // Overlap Label
          const spanMHz = overlapEnd - overlapStart;
          ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
          ctx.font = "bold 9px JetBrains Mono";
          ctx.textAlign = "center";
          ctx.fillText(`${formatFrequency(spanMHz)} OVERLAP`, (x0 + x1) / 2, lineY - 8);
          ctx.restore();

          // Phase correction display
          if (correction !== undefined) {
            const midX = (x0 + x1) / 2;
            ctx.fillStyle = "#fff";
            ctx.font = "bold 10px JetBrains Mono";
            ctx.fillText(`${correction?.toFixed(1)}° PHASE SHIFT APPLIED`, midX, topMargin - 12);

            const absDev = Math.abs(fmDeviation || 0);
            const sign = (fmDeviation || 0) > 0 ? "+" : "-";
            ctx.fillText(`Deviation: Δf ≈ ${sign}${absDev.toFixed(1)} kHz`, midX, topMargin - 26);
          }
        }
      }


      // Timing metadata overlay (Top Canvas only)
      if (!isStitched && timing) {
        ctx.textAlign = "center";
        ctx.font = "10px JetBrains Mono";
        ctx.fillStyle = "#666";
        let timeStr = `Latency: ${timing.total_latency_ms.toFixed(0)}ms / Settle: ${timing.settle_time_ms.toFixed(0)}ms / Slice: ${timing.slice_duration_ms.toFixed(1)}ms / TS: ${timing.capture_timestamp_ms}`;
        if (fmDeviation !== undefined) {
          timeStr += ` / FM Dev: ${fmDeviation.toFixed(1)} kHz`;
        }
        ctx.fillText(timeStr, logicalWidth / 2, 22);

        // ELI5 Strategy Overlay
        ctx.textAlign = "right";
        ctx.font = "italic 10px JetBrains Mono";
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.fillText("Strategy: Sub-sample fractional delay tracking. We precisely offset", logicalWidth - rightMargin, 20);
        ctx.fillText("time differences in the overlap, align their sine waves smoothly,", logicalWidth - rightMargin, 34);
        ctx.fillText("and perform a hard midpoint cut to eliminate spectral artifacts.", logicalWidth - rightMargin, 48);
      }

      // Box Border
      ctx.strokeStyle = "#222";
      ctx.strokeRect(leftMargin, topMargin, plotWidth, fftHeight);

      // Cleanup
      ctx.restore();
    };

    const drawTrace = (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      data: number[],
      range: [number, number],
      color: string,
      fill: string,
      globalRange: [number, number],
      isStitched?: boolean
    ) => {
      if (!data || data.length === 0) return;

      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);

      const logicalWidth = width / dpr;
      const logicalHeight = height / dpr;

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

      const x0 = leftMargin + ((range[0] - globalRange[0]) / (globalRange[1] - globalRange[0])) * plotWidth;
      const x1 = leftMargin + ((range[1] - globalRange[0]) / (globalRange[1] - globalRange[0])) * plotWidth;
      const w = x1 - x0;

      // Decimate to maintain peaks on sparse canvas
      const decimated = decimateWaveform(data, Math.ceil(w));

      const getY = (db: number) => {
        return fftAreaMax.y - (db - dbMin) * scaleFactor;
      };

      const clampY = (y: number) => Math.max(topMargin, Math.min(fftAreaMax.y, y));

      // Gradient Fill (Premium look)
      const gradient = ctx.createLinearGradient(0, topMargin, 0, fftAreaMax.y);
      gradient.addColorStop(0, fill);
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      // Fill
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

      // Line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      for (let i = 0; i < decimated.length; i++) {
        const x = x0 + (i / (decimated.length - 1)) * w;
        const y = clampY(getY(decimated[i]));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.restore();
    };

    // Draw Raw Hops
    if (rawCanvasRef.current) {
      const ctx = rawCanvasRef.current.getContext("2d");
      if (ctx) {
        const { width, height } = rawCanvasRef.current;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);

        const fullRange: [number, number] = [Math.min(hop1_freq_mhz[0], hop2_freq_mhz[0]), Math.max(hop1_freq_mhz[1], hop2_freq_mhz[1])];
        const activeRange = zoomRange || fullRange;
        drawAxis(ctx, width, height, activeRange, hop1_freq_mhz, hop2_freq_mhz, hop1_phase_deg, hop2_phase_deg, correction_angle_deg, fm_deviation_khz, false);

        drawTrace(ctx, width, height, hop1, hop1_freq_mhz, "#ff4444", "rgba(255, 68, 68, 0.15)", activeRange, false);
        drawTrace(ctx, width, height, hop2, hop2_freq_mhz, "#4444ff", "rgba(68, 68, 255, 0.15)", activeRange, false);
      }
    }

    // Draw Stitched
    if (stitchedCanvasRef.current) {
      const ctx = stitchedCanvasRef.current.getContext("2d");
      if (ctx) {
        const { width, height } = stitchedCanvasRef.current;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);

        const fullRange = stitched_freq_mhz;
        const activeRange = zoomRange || fullRange;
        drawAxis(ctx, width, height, activeRange, hop1_freq_mhz, hop2_freq_mhz, undefined, undefined, undefined, undefined, true);
        drawTrace(ctx, width, height, stitched, stitched_freq_mhz, LINE_COLOR, SHADOW_COLOR, activeRange, true);
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      setZoomRange(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDragStart({ x, y });
    setDragCurrent({ x, y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart) {
      const rect = e.currentTarget.getBoundingClientRect();
      setDragCurrent({ x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)) });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart || !dragCurrent) return;

    const width = Math.abs(dragCurrent.x - dragStart.x);
    if (width > 5 && result) {
      const rect = e.currentTarget.getBoundingClientRect();
      const leftMargin = 70;
      const rightMargin = 30;
      const plotWidth = rect.width - leftMargin - rightMargin;

      const xLeft = Math.min(dragStart.x, dragCurrent.x);
      const xRight = Math.max(dragStart.x, dragCurrent.x);

      const normLeft = Math.max(0, Math.min(1, (xLeft - leftMargin) / plotWidth));
      const normRight = Math.max(0, Math.min(1, (xRight - leftMargin) / plotWidth));

      const { hop1_freq_mhz, hop2_freq_mhz } = result;
      const fullRange: [number, number] = [Math.min(hop1_freq_mhz[0], hop2_freq_mhz[0]), Math.max(hop1_freq_mhz[1], hop2_freq_mhz[1])];
      const baseRange = zoomRange || fullRange;
      const freqSpan = baseRange[1] - baseRange[0];

      const minMhz = baseRange[0] + normLeft * freqSpan;
      const maxMhz = baseRange[0] + normRight * freqSpan;

      if (maxMhz > minMhz + 0.001) {
        setZoomRange([minMhz, maxMhz]);
      }
    }

    setDragStart(null);
    setDragCurrent(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <Container>
      <header style={{ marginBottom: "24px" }}>
        <h1 style={{ margin: "0" }}>Interleaved Capture (TDMS) Diagnostic</h1>
      </header>

      <VisualizerGrid>
        <Card>
          <SectionHeader>
            <SectionTitle>Raw Hops (A/B Overlap)</SectionTitle>
            <Badge>Time-Divided (interleaved)</Badge>
          </SectionHeader>
          <CanvasWrapper
            $aspectRatio="21 / 11"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={(e) => { e.preventDefault(); setZoomRange(null); }}
            style={{ position: 'relative' }}
          >
            <canvas ref={rawCanvasRef} style={{ width: "100%", height: "100%", cursor: "crosshair" }} />
            {dragStart && dragCurrent && (
              <div style={{
                position: "absolute",
                border: "1px dashed rgba(255,255,255,0.8)",
                backgroundColor: "rgba(255,255,255,0.2)",
                pointerEvents: "none",
                zIndex: 100,
                left: Math.min(dragStart.x, dragCurrent.x),
                top: Math.min(dragStart.y, dragCurrent.y),
                width: Math.abs(dragCurrent.x - dragStart.x),
                height: Math.abs(dragCurrent.y - dragStart.y),
              }} />
            )}
          </CanvasWrapper>
        </Card>

        {result && (
          <Card style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: "24px" }}>
            <input
              type="range"
              min="0"
              max={(result.hop1_frames?.length || 1) - 1}
              value={frameIndex}
              onChange={(e) => setFrameIndex(parseInt(e.target.value))}
              style={{ flex: 1, height: "32px", cursor: "pointer" }}
            />
            <span style={{
              fontFamily: "JetBrains Mono",
              fontSize: "13px",
              color: "#3b82f6",
              whiteSpace: "nowrap",
              fontWeight: "bold",
              background: "rgba(59, 130, 246, 0.1)",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "1px solid rgba(59, 130, 246, 0.2)"
            }}>
              FRAME {(frameIndex + 1).toString().padStart(2, '0')} / {result.hop1_frames?.length || 60}
            </span>
          </Card>
        )}

        <Card>
          <SectionHeader>
            <SectionTitle>Stitched Magnitude Output</SectionTitle>
            <Badge color="#10b981">Midpoint Cut</Badge>
          </SectionHeader>
          <CanvasWrapper
            $aspectRatio="21 / 9"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={(e) => { e.preventDefault(); setZoomRange(null); }}
            style={{ position: 'relative' }}
          >
            <canvas ref={stitchedCanvasRef} style={{ width: "100%", height: "100%", cursor: "crosshair" }} />
            {dragStart && dragCurrent && (
              <div style={{
                position: "absolute",
                border: "1px dashed rgba(255,255,255,0.8)",
                backgroundColor: "rgba(255,255,255,0.2)",
                pointerEvents: "none",
                zIndex: 100,
                left: Math.min(dragStart.x, dragCurrent.x),
                top: Math.min(dragStart.y, dragCurrent.y),
                width: Math.abs(dragCurrent.x - dragStart.x),
                height: Math.abs(dragCurrent.y - dragStart.y),
              }} />
            )}
          </CanvasWrapper>
        </Card>
      </VisualizerGrid>
    </Container>
  );
};

export default StitchTestRoute;
