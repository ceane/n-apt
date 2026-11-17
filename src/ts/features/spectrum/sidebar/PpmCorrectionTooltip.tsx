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
  height: 176px;
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
  const margin = 8;
  const gap = 9;
  const panelY = 24;
  const panelH = h - panelY - 7;
  const usableW = w - margin * 2;
  const hardwareX = margin;
  const hardwareW = usableW * 0.39;
  const analysisX = hardwareX + hardwareW + gap;
  const analysisW = w - margin - analysisX;

  ctx.font = "600 9px system-ui, sans-serif";
  ctx.fillStyle = ink;
  ctx.fillText("A · HARDWARE", hardwareX, 15);
  ctx.fillText("B · SIGNAL ANALYSIS", analysisX, 15);
  ctx.lineWidth = 1;
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.roundRect(hardwareX, panelY, hardwareW, panelH, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(analysisX, panelY, analysisW, panelH, 5);
  ctx.stroke();

  // The RF path passes through the tuner and RTL2832U before IQ reaches USB.
  const centerX = hardwareX + hardwareW / 2;
  const tunerY = panelY + 26;
  const tunerH = 35;
  const demodY = panelY + 82;
  const demodH = 38;
  const deviceX = hardwareX + 8;
  const deviceW = hardwareW - 16;
  ctx.fillStyle = "rgba(64, 201, 255, 0.1)";
  ctx.beginPath();
  ctx.roundRect(deviceX, tunerY, deviceW, tunerH, 4);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.font = "600 8px system-ui, sans-serif";
  ctx.fillText("R820T / R828D", centerX, tunerY + 14);
  ctx.fillStyle = muted;
  ctx.font = "7px system-ui, sans-serif";
  ctx.fillText("tuner PLL · RF / LO", centerX, tunerY + 26);

  ctx.fillStyle = "rgba(139, 226, 139, 0.1)";
  ctx.beginPath();
  ctx.roundRect(deviceX, demodY, deviceW, demodH, 4);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = "600 8px system-ui, sans-serif";
  ctx.fillText("RTL2832U", centerX, demodY + 13);
  ctx.fillStyle = muted;
  ctx.font = "7px system-ui, sans-serif";
  ctx.fillText("ADC + digital correction", centerX, demodY + 25);

  // PPM configures tuner reference and RTL2832U sample-frequency correction.
  ctx.fillStyle = green;
  ctx.font = "600 7px system-ui, sans-serif";
  ctx.fillText("PPM: PLL ref + sample correction", centerX, panelY + 12);
  ctx.textAlign = "left";

  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(hardwareX + 4, tunerY + tunerH / 2);
  ctx.lineTo(deviceX, tunerY + tunerH / 2);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = "7px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("RF in", hardwareX + 14, tunerY + tunerH / 2 - 5);
  ctx.textAlign = "left";

  // Animated dots show new signal data moving through hardware, not old IQ replay.
  for (let i = 0; i < 4; i += 1) {
    const t = (time * 0.8 + i / 4) % 1;
    let x = centerX;
    let y = tunerY + tunerH + t * (demodY - tunerY - tunerH);
    if (t > 0.88) {
      x = centerX + ((t - 0.88) / 0.12) * (hardwareW / 2 - 5);
      y = demodY + demodH / 2;
    }
    ctx.fillStyle = t > 0.88 ? green : accent;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = muted;
  ctx.font = "7px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("USB · live I/Q", centerX, panelY + panelH - 8);
  ctx.textAlign = "left";

  // B shows the Q trace and then the spectrum computed from complex I/Q.
  const plotX = analysisX + 7;
  const plotW = analysisW - 14;
  const qY = panelY + 20;
  const qH = 39;
  const fftY = panelY + 91;
  const fftH = 42;
  ctx.fillStyle = muted;
  ctx.font = "7px system-ui, sans-serif";
  ctx.fillText("Q · imaginary component", plotX, panelY + 12);
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.roundRect(plotX, qY, plotW, qH, 3);
  ctx.stroke();
  const qMid = qY + qH / 2;
  ctx.beginPath();
  ctx.moveTo(plotX + 4, qMid);
  ctx.lineTo(plotX + plotW - 4, qMid);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = 0; px <= plotW - 10; px += 1) {
    const x = plotX + 5 + px;
    const y = qMid - Math.sin(px * 0.13 - time * 3) * 13;
    if (px === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Arrow is a visual sequence; the FFT uses both I and Q, not Q alone.
  const arrowX = analysisX + analysisW / 2;
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(arrowX, qY + qH + 2);
  ctx.lineTo(arrowX, fftY - 10);
  ctx.lineTo(arrowX - 3, fftY - 14);
  ctx.moveTo(arrowX, fftY - 10);
  ctx.lineTo(arrowX + 3, fftY - 14);
  ctx.stroke();

  ctx.fillStyle = muted;
  ctx.font = "7px system-ui, sans-serif";
  ctx.fillText("|FFT(I + jQ)|", plotX, fftY - 3);
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.roundRect(plotX, fftY, plotW, fftH, 3);
  ctx.stroke();
  const baseY = fftY + fftH - 6;
  const bins = Math.max(8, Math.floor(plotW / 5));
  const barGap = 2;
  const barW = Math.max(1, (plotW - 10 - (bins - 1) * barGap) / bins);
  for (let i = 0; i < bins; i += 1) {
    const x = plotX + 5 + i * (barW + barGap);
    const distance = i - bins * 0.61;
    const peak = Math.exp(-(distance * distance) / 7.5);
    const barHeight = 3 + peak * (fftH - 15);
    ctx.fillStyle = peak > 0.45 ? green : accent;
    ctx.fillRect(x, baseY - barHeight, barW, barHeight);
  }
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
        aria-label="Looping two-column illustration: A shows RF passing through the RTL-SDR tuner and RTL2832U hardware PPM correction; B shows an imaginary Q trace followed by magnitude FFT computed from I and Q"
      />
      <Status>Signal analysis not decrypted.</Status>
      <Placeholder>
        <PlaceholderTitle>Decrypted signal analysis</PlaceholderTitle>
        <span>Encrypted module visualization placeholder</span>
      </Placeholder>
    </TooltipBody>
  );
};
