import React, { useEffect, useRef } from "react";
import styled from "styled-components";

const TooltipBody = styled.div`
  display: grid;
  gap: 8px;
  width: 100%;
`;

const Diagram = styled.canvas`
  display: block;
  width: 100%;
  height: 142px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 6px;
  background: ${(props) => props.theme.surface};
`;

const Status = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 10px;
  line-height: 1.4;
`;

const Placeholder = styled.div`
  min-height: 38px;
  display: grid;
  align-content: center;
  gap: 3px;
  padding: 7px 9px;
  border: 1px dashed ${(props) => props.theme.borderHover};
  border-radius: 6px;
  color: ${(props) => props.theme.textSecondary};
  font-size: 9px;
  line-height: 1.3;
`;

const PlaceholderTitle = styled.strong`
  color: ${(props) => props.theme.textPrimary};
  font-size: 10px;
  font-weight: 600;
`;

function drawDiagram(canvas: HTMLCanvasElement, time: number) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const w = rect.width;
  const h = rect.height;
  const ink = getComputedStyle(canvas).color || "#d9e2f2";
  const muted = "#8b99ad";
  const accent = "#40c9ff";
  const green = "#8be28b";
  const border = "rgba(139, 153, 173, 0.38)";
  const gap = 10;
  const left = 8;
  const right = w - 8;
  const usable = right - left;
  const hardwareW = usable * 0.25;
  const graphW = (usable - hardwareW - gap * 2) / 2;
  const boxY = 26;
  const boxH = h - 37;
  const hardwareX = left;
  const imaginaryX = hardwareX + hardwareW + gap;
  const fftX = imaginaryX + graphW + gap;

  ctx.font = "600 9px system-ui, sans-serif";
  ctx.fillStyle = muted;
  ctx.fillText("TUNER + ADC", hardwareX, 15);
  ctx.fillText("Q (IMAGINARY)", imaginaryX, 15);
  ctx.fillText("MAGNITUDE FFT", fftX, 15);

  ctx.lineWidth = 1;
  ctx.strokeStyle = border;
  for (const [x, boxW] of [[hardwareX, hardwareW], [imaginaryX, graphW], [fftX, graphW]]) {
    ctx.beginPath();
    ctx.roundRect(x, boxY, boxW, boxH, 5);
    ctx.stroke();
  }

  // Hardware block: represent the crystal reference correction and incoming samples.
  ctx.fillStyle = "rgba(64, 201, 255, 0.12)";
  ctx.beginPath();
  ctx.roundRect(hardwareX + 8, boxY + 10, hardwareW - 16, 29, 4);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = "600 9px system-ui, sans-serif";
  ctx.fillText("RTL-SDR", hardwareX + 14, boxY + 22);
  ctx.fillStyle = muted;
  ctx.font = "8px system-ui, sans-serif";
  ctx.fillText("crystal offset", hardwareX + 14, boxY + 33);
  const dialX = hardwareX + hardwareW / 2;
  const dialY = boxY + 61;
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.arc(dialX, dialY, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(dialX, dialY);
  ctx.lineTo(dialX + Math.cos(-Math.PI / 2 + Math.sin(time * 1.4) * 0.5) * 8,
    dialY + Math.sin(-Math.PI / 2 + Math.sin(time * 1.4) * 0.5) * 8);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = "8px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PPM", dialX, boxY + 82);
  ctx.fillText("corrects tuning", dialX, boxY + 94);
  ctx.textAlign = "left";
  for (let i = 0; i < 5; i += 1) {
    const dotX = hardwareX + 12 + ((time * 24 + i * 13) % Math.max(20, hardwareW - 27));
    ctx.fillStyle = i % 2 ? green : accent;
    ctx.beginPath();
    ctx.arc(dotX, boxY + boxH - 9, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Flow arrows between acquisition and the two views.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  for (const x of [hardwareX + hardwareW + 2, imaginaryX + graphW + 2]) {
    const y = boxY + boxH / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x + 3, y - 2.5);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 3, y + 2.5);
    ctx.stroke();
  }

  // Q is the imaginary component of each complex I/Q sample.
  const plotY = boxY + 47;
  const plotH = boxH - 60;
  const midY = plotY + plotH / 2;
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.moveTo(imaginaryX + 7, midY);
  ctx.lineTo(imaginaryX + graphW - 7, midY);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  for (let i = 0; i <= graphW - 16; i += 1) {
    const x = imaginaryX + 8 + i;
    const y = midY - Math.sin(i * 0.12 - time * 4) * (plotH * 0.34);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Magnitude FFT: animated bins form a peak whose apparent position is corrected.
  const fftPlotX = fftX + 8;
  const fftPlotW = graphW - 16;
  const fftBaseY = boxY + boxH - 15;
  const peak = fftPlotW * (0.5 + Math.sin(time * 0.55) * 0.11);
  const shift = Math.sin(time * 0.55 + 0.8) * fftPlotW * 0.09;
  const barGap = 2;
  const bars = Math.max(9, Math.floor(fftPlotW / 5));
  const barW = Math.max(1, (fftPlotW - (bars - 1) * barGap) / bars);
  for (let i = 0; i < bars; i += 1) {
    const x = fftPlotX + i * (barW + barGap);
    const dx = i * (barW + barGap) - peak - shift;
    const envelope = Math.exp(-(dx * dx) / Math.max(100, fftPlotW * fftPlotW * 0.018));
    const ripple = 0.18 + 0.18 * (0.5 + 0.5 * Math.sin(i * 1.7 + time * 3));
    const barH = 5 + envelope * (plotH * (0.55 + ripple));
    ctx.fillStyle = envelope > 0.5 ? green : accent;
    ctx.fillRect(x, fftBaseY - barH, barW, barH);
  }
  const markerX = fftPlotX + Math.max(1, Math.min(fftPlotW - 1, peak + shift));
  ctx.strokeStyle = green;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(markerX, plotY + 1);
  ctx.lineTo(markerX, fftBaseY + 1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = muted;
  ctx.font = "8px system-ui, sans-serif";
  ctx.fillText("frequency bins", fftX + 8, boxY + boxH - 4);
}

export const PpmCorrectionTooltipContent: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame = 0;
    let start = 0;
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const animate = (now: number) => {
      if (!active) return;
      if (!start) start = now;
      drawDiagram(canvas, (now - start) / 1000);
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <TooltipBody>
      <Diagram
        ref={canvasRef}
        role="img"
        aria-label="Looping illustration of RTL-SDR hardware applying PPM correction, producing imaginary Q samples, and forming a magnitude FFT plot"
      />
      <Status>Signal analysis not decrypted.</Status>
      <Placeholder>
        <PlaceholderTitle>Decrypted signal analysis</PlaceholderTitle>
        <span>Encrypted module visualization placeholder</span>
      </Placeholder>
    </TooltipBody>
  );
};
