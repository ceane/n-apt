import React, { useEffect, useRef } from "react";
import styled from "styled-components";

const GraphicCard = styled.div`
  margin: 0 0 40px;
  background: transparent;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  padding: 16px;
`;

const CanvasContainer = styled.div`
  width: 100%;
  aspect-ratio: 16 / 9;
  position: relative;
`;

const CanvasElement = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
`;

export const FFTIFFTCanvasGraphic: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const startTime = performance.now();

    const NUM_SAMPLES = 256;

    const render = (time: number) => {
      const elapsed = (time - startTime) / 1000;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const marginL = 44;
      const marginR = 24;
      const marginT = 32;
      const marginB = 32;
      const panelGap = 76; // Clean vertical separation between transform labels and panel headers

      const availableH = height - marginT - marginB - panelGap;
      const panelH = availableH / 2;
      const plotW = width - marginL - marginR;

      // -------------------------------------------------------------
      // PANEL 1: Time Domain Waveform (I & Q Samples)
      // -------------------------------------------------------------
      const p1Top = marginT;

      // Panel 1 Outline
      ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(marginL, p1Top, plotW, panelH);

      // Label: Time Domain
      ctx.font = "600 11px monospace";
      ctx.fillStyle = "#0284c7";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("TIME DOMAIN: I/Q Signal Samples s(t) = I(t) + j Q(t)", marginL, p1Top - 10);

      // Legend for Time Domain
      ctx.font = "11px monospace";
      ctx.textAlign = "right";
      ctx.fillStyle = "#0284c7";
      ctx.fillText("■ I (In-Phase)   ", marginL + plotW - 105, p1Top - 10);
      ctx.fillStyle = "#d946ef";
      ctx.fillText("■ Q (Quadrature)", marginL + plotW - 8, p1Top - 10);

      // Center zero axis
      const p1CenterY = p1Top + panelH / 2;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(marginL, p1CenterY);
      ctx.lineTo(marginL + plotW, p1CenterY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Generate animated I and Q waveforms
      const iSamples = new Float32Array(NUM_SAMPLES);
      const qSamples = new Float32Array(NUM_SAMPLES);

      for (let s = 0; s < NUM_SAMPLES; s++) {
        const tRatio = s / NUM_SAMPLES;
        const phase = elapsed * 4 + tRatio * Math.PI * 8;
        const subPhase = elapsed * 9 + tRatio * Math.PI * 24;

        iSamples[s] = Math.cos(phase) * 0.6 + Math.cos(subPhase) * 0.25;
        qSamples[s] = Math.sin(phase) * 0.6 + Math.sin(subPhase) * 0.25;
      }

      // Draw In-phase (I) line - Cyan/Blue
      ctx.beginPath();
      for (let s = 0; s < NUM_SAMPLES; s++) {
        const x = marginL + (s / (NUM_SAMPLES - 1)) * plotW;
        const y = p1CenterY - iSamples[s] * (panelH * 0.4);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Draw Quadrature (Q) line - Magenta
      ctx.beginPath();
      for (let s = 0; s < NUM_SAMPLES; s++) {
        const x = marginL + (s / (NUM_SAMPLES - 1)) * plotW;
        const y = p1CenterY - qSamples[s] * (panelH * 0.4);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#d946ef";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // -------------------------------------------------------------
      // CENTER GAP: FFT & IFFT Transform Indicators
      // Left-aligned & Right-aligned to guarantee zero horizontal collision
      // -------------------------------------------------------------
      const gapY = p1Top + panelH + 24;

      ctx.font = "600 11px monospace";
      ctx.textBaseline = "middle";

      // Left-aligned FFT indicator
      ctx.textAlign = "left";
      ctx.fillStyle = "#0284c7";
      ctx.fillText("FFT ↓ (Time → Frequency)", marginL, gapY);

      // Right-aligned IFFT indicator
      ctx.textAlign = "right";
      ctx.fillStyle = "#e11d48";
      ctx.fillText("↑ IFFT (Frequency → Time)", marginL + plotW, gapY);

      // -------------------------------------------------------------
      // PANEL 2: Frequency Domain Spectrum (FFT Output Bins)
      // -------------------------------------------------------------
      const p2Top = p1Top + panelH + panelGap;

      // Panel 2 Outline
      ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(marginL, p2Top, plotW, panelH);

      // Label: Frequency Domain - Correct mathematical magnitude notation |S(f)| = |FFT{s(t)}|
      ctx.font = "600 11px monospace";
      ctx.fillStyle = "#0284c7";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(
        "FREQUENCY DOMAIN: Spectral Magnitude |S(f)| = |FFT{s(t)}|",
        marginL,
        p2Top - 10,
      );

      // Horizontal Grid lines
      const dbLines = [0.25, 0.5, 0.75];
      dbLines.forEach((r) => {
        const y = p2Top + panelH * (1 - r);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
        ctx.beginPath();
        ctx.moveTo(marginL, y);
        ctx.lineTo(marginL + plotW, y);
        ctx.stroke();
      });

      // Generate spectrum peaks
      const NUM_BINS = 128;
      const spectrum = new Float32Array(NUM_BINS);

      for (let b = 0; b < NUM_BINS; b++) {
        const bRatio = b / NUM_BINS;
        let val = 0.08 + (Math.random() - 0.5) * 0.03;

        val += 0.75 * Math.exp(-Math.pow((bRatio - 0.25) * 40, 2));
        val += 0.55 * Math.exp(-Math.pow((bRatio - 0.75) * 40, 2));

        const animPos = 0.5 + Math.sin(elapsed * 2) * 0.15;
        val += 0.45 * Math.exp(-Math.pow((bRatio - animPos) * 60, 2));

        spectrum[b] = Math.min(1.0, val);
      }

      // Fill Spectrum Area
      ctx.beginPath();
      ctx.moveTo(marginL, p2Top + panelH);

      for (let b = 0; b < NUM_BINS; b++) {
        const x = marginL + (b / (NUM_BINS - 1)) * plotW;
        const y = p2Top + panelH * (1 - spectrum[b]);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(marginL + plotW, p2Top + panelH);
      ctx.closePath();

      const specGrad = ctx.createLinearGradient(0, p2Top, 0, p2Top + panelH);
      specGrad.addColorStop(0, "rgba(2, 132, 199, 0.25)");
      specGrad.addColorStop(1, "rgba(2, 132, 199, 0.02)");
      ctx.fillStyle = specGrad;
      ctx.fill();

      // Draw Spectrum Line
      ctx.beginPath();
      for (let b = 0; b < NUM_BINS; b++) {
        const x = marginL + (b / (NUM_BINS - 1)) * plotW;
        const y = p2Top + panelH * (1 - spectrum[b]);
        if (b === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Frequency Axis Ticks & Labels
      const axisY = p2Top + panelH;
      ctx.fillStyle = "#64748b";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const freqLabels = ["-fs/2", "-fs/4", "0 (DC)", "+fs/4", "+fs/2"];
      freqLabels.forEach((lbl, idx) => {
        const ratio = idx / (freqLabels.length - 1);
        const x = marginL + ratio * plotW;

        ctx.strokeStyle = "#94a3b8";
        ctx.beginPath();
        ctx.moveTo(x, axisY);
        ctx.lineTo(x, axisY + 4);
        ctx.stroke();

        ctx.fillText(lbl, x, axisY + 6);
      });

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <GraphicCard>
      <CanvasContainer>
        <CanvasElement ref={canvasRef} />
      </CanvasContainer>
    </GraphicCard>
  );
};

export default FFTIFFTCanvasGraphic;
