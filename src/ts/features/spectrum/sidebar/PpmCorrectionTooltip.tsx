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

type TooltipVariant = "ppm" | "gain";

function drawTravelingWave(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  phase: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = 0; px <= width; px += 1) {
    const envelope = Math.min(1, px / 4, (width - px) / 4);
    const py = y + Math.sin((px / Math.max(width, 1)) * Math.PI * 6 - phase) * 3 * envelope;
    if (px === 0) ctx.moveTo(x + px, py);
    else ctx.lineTo(x + px, py);
  }
  ctx.stroke();
}

function drawTravelingWaveVertical(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  phase: number,
) {
  ctx.strokeStyle = "#40c9ff";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let py = 0; py <= height; py += 1) {
    const envelope = Math.min(1, py / 3, (height - py) / 3);
    const px = x + Math.sin((py / Math.max(height, 1)) * Math.PI * 4 - phase) * 2.5 * envelope;
    if (py === 0) ctx.moveTo(px, y + py);
    else ctx.lineTo(px, y + py);
  }
  ctx.stroke();
}

function drawPathPulse(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  progress: number,
  color: string,
) {
  const lengths = points.slice(1).map(([x, y], index) => {
    const [startX, startY] = points[index];
    return Math.hypot(x - startX, y - startY);
  });
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = progress * totalLength;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i];
    if (remaining <= length || i === lengths.length - 1) {
      const ratio = length === 0 ? 0 : Math.min(1, remaining / length);
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    remaining -= length;
  }
}

function drawDiagram(
  canvas: HTMLCanvasElement,
  time: number,
  variant: TooltipVariant,
) {
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
  const hardwareW = usableW * 0.45;
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

  // A is a small isometric board view: the crystal is a clock reference, not a
  // component whose physical oscillation is changed by the PPM setting.
  const centerX = hardwareX + hardwareW / 2;
  const boardX = hardwareX + 7;
  const boardW = hardwareW - 14;
  const boardTop = panelY + 15;
  const boardBottom = panelY + panelH - 7;
  const bevel = 7;
  const loopTime = time % 8;
  const ppmUpdateActive = variant === "ppm" && loopTime > 3.1 && loopTime < 5.1;
  const pllSettling = variant === "ppm" && loopTime >= 5.1 && loopTime < 5.9;
  ctx.fillStyle = "#183b34";
  ctx.strokeStyle = "#4b8e72";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(boardX + bevel, boardTop + 7);
  ctx.lineTo(boardX + boardW, boardTop);
  ctx.lineTo(boardX + boardW, boardBottom - 7);
  ctx.lineTo(boardX + boardW - bevel, boardBottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#102a26";
  ctx.beginPath();
  ctx.moveTo(boardX + boardW - bevel, boardBottom);
  ctx.lineTo(boardX + boardW, boardBottom - 7);
  ctx.lineTo(boardX + boardW, boardBottom - 2);
  ctx.lineTo(boardX + boardW - bevel, boardBottom + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#12312c";
  ctx.beginPath();
  ctx.moveTo(boardX + bevel, boardTop + 7);
  ctx.lineTo(boardX + boardW - bevel, boardBottom);
  ctx.lineTo(boardX + boardW - bevel, boardBottom + 5);
  ctx.lineTo(boardX + bevel, boardTop + 12);
  ctx.closePath();
  ctx.fill();

  // PCB traces and plated holes make the board read as a physical assembly.
  ctx.fillStyle = "#b3c9a8";
  for (const [x, y] of [
    [boardX + 9, boardTop + 15],
    [boardX + boardW - 10, boardTop + 13],
    [boardX + 8, boardBottom - 12],
    [boardX + boardW - 10, boardBottom - 14],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(131, 194, 143, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(boardX + 14, boardTop + 23);
  ctx.lineTo(boardX + boardW - 12, boardTop + 20);
  ctx.lineTo(boardX + boardW - 15, boardBottom - 22);
  ctx.moveTo(boardX + 12, boardBottom - 25);
  ctx.lineTo(boardX + boardW - 17, boardBottom - 22);
  ctx.stroke();

  ctx.fillStyle = ppmUpdateActive ? "#f08acb" : green;
  ctx.font = "600 6px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    variant === "gain"
      ? "TUNER GAIN STAGE"
      : ppmUpdateActive
        ? "DRIVER WRITES PPM SETTINGS"
        : pllSettling
          ? "TUNER PLL RETUNES / SETTLES"
          : "XTAL CLOCK RUNS CONTINUOUSLY",
    centerX,
    panelY + 10,
  );

  // Metal crystal package and pins. Dashed gold traces are its reference path.
  const crystalX = centerX - 24;
  const crystalY = panelY + 23;
  const crystalW = 48;
  const crystalH = 16;
  const crystalGradient = ctx.createLinearGradient(
    crystalX,
    crystalY,
    crystalX,
    crystalY + crystalH,
  );
  crystalGradient.addColorStop(0, "#e4e8df");
  crystalGradient.addColorStop(0.45, "#9ea9a4");
  crystalGradient.addColorStop(1, "#586660");
  ctx.fillStyle = "#26332f";
  ctx.beginPath();
  ctx.roundRect(crystalX + 2, crystalY + 3, crystalW, crystalH, 4);
  ctx.fill();
  ctx.fillStyle = crystalGradient;
  ctx.strokeStyle = "#d4ddd5";
  ctx.beginPath();
  ctx.roundRect(crystalX, crystalY, crystalW, crystalH, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#26332f";
  ctx.font = "600 6px system-ui, sans-serif";
  ctx.fillText("XTAL REF", centerX, crystalY + 10);
  ctx.strokeStyle = "#c6a65c";
  ctx.lineWidth = 1;
  for (const pinX of [crystalX + 10, crystalX + crystalW - 10]) {
    ctx.beginPath();
    ctx.moveTo(pinX, crystalY + crystalH);
    ctx.lineTo(pinX, crystalY + crystalH + 4);
    ctx.stroke();
  }

  const tunerY = panelY + 59;
  const tunerH = 27;
  const demodY = panelY + 104;
  const demodH = 27;
  const deviceX = boardX + 17;
  const deviceW = boardW - 30;
  const drawChip = (
    x: number,
    y: number,
    chipW: number,
    chipH: number,
    fill: string,
    title: string,
    detail: string,
  ) => {
    ctx.fillStyle = "#0a1717";
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 3, chipW, chipH, 3);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.strokeStyle = ppmUpdateActive
      ? "#f08acb"
      : pllSettling && title.startsWith("R820T")
        ? "#ffc857"
        : "#657d7a";
    ctx.beginPath();
    ctx.roundRect(x, y, chipW, chipH, 3);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#b8a76b";
    ctx.lineWidth = 0.8;
    for (let pin = 0; pin < 4; pin += 1) {
      const py = y + 5 + pin * 5;
      ctx.beginPath();
      ctx.moveTo(x - 3, py);
      ctx.lineTo(x, py);
      ctx.moveTo(x + chipW, py);
      ctx.lineTo(x + chipW + 3, py);
      ctx.stroke();
    }
    ctx.fillStyle = "#e3ece8";
    ctx.font = "600 6px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(title, x + chipW / 2, y + 11);
    ctx.fillStyle = "#aabbb4";
    ctx.font = "5px system-ui, sans-serif";
    ctx.fillText(detail, x + chipW / 2, y + 20);
  };
  drawChip(
    deviceX,
    tunerY,
    deviceW,
    tunerH,
    variant === "gain" ? "#315c53" : "#233d46",
    "R820T / R828D",
    variant === "gain" ? "LNA · tuner gain · PLL" : "tuner PLL · RF / LO",
  );
  drawChip(
    deviceX,
    demodY,
    deviceW,
    demodH,
    "#293b42",
    "RTL2832U",
    "ADC + digital correction",
  );

  // The crystal reference feeds both circuits. PPM changes programmed values,
  // not the physical crystal or its oscillation.
  ctx.strokeStyle = "#ffc857";
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 2]);
  ctx.beginPath();
  ctx.moveTo(crystalX + 10, crystalY + crystalH + 4);
  ctx.lineTo(deviceX - 4, crystalY + crystalH + 4);
  ctx.lineTo(deviceX - 4, tunerY + 8);
  ctx.lineTo(deviceX, tunerY + 8);
  ctx.moveTo(deviceX - 4, tunerY + 8);
  ctx.lineTo(deviceX - 4, demodY + 8);
  ctx.lineTo(deviceX, demodY + 8);
  ctx.stroke();
  ctx.setLineDash([]);

  // Visible clock pulses travel from the crystal along the separate reference path.
  const tunerReferencePath: Array<[number, number]> = [
    [crystalX + 10, crystalY + crystalH + 4],
    [deviceX - 4, crystalY + crystalH + 4],
    [deviceX - 4, tunerY + 8],
    [deviceX, tunerY + 8],
  ];
  const demodReferencePath: Array<[number, number]> = [
    [deviceX - 4, tunerY + 8],
    [deviceX - 4, demodY + 8],
    [deviceX, demodY + 8],
  ];
  for (let pulse = 0; pulse < 3; pulse += 1) {
    const progress = (time * 0.48 + pulse / 3) % 1;
    drawPathPulse(ctx, tunerReferencePath, progress, "#ffd36a");
    drawPathPulse(ctx, demodReferencePath, progress, "#ffd36a");
  }

  // Animated cyan pulses show fresh RF moving through the receiver stages.
  const tunerMidY = tunerY + tunerH / 2;
  const demodMidY = demodY + demodH / 2;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(hardwareX + 2, tunerMidY);
  ctx.lineTo(deviceX, tunerMidY);
  ctx.moveTo(centerX, tunerY + tunerH);
  ctx.lineTo(centerX, demodY);
  ctx.moveTo(deviceX + deviceW, demodMidY);
  ctx.lineTo(hardwareX + hardwareW - 2, demodMidY);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = "5px system-ui, sans-serif";
  ctx.fillText("RF", hardwareX + 8, tunerMidY - 5);
  drawTravelingWave(
    ctx,
    hardwareX + 2,
    tunerMidY,
    Math.max(8, deviceX - hardwareX - 2),
    time * 5,
    accent,
  );
  drawTravelingWaveVertical(
    ctx,
    centerX,
    tunerY + tunerH,
    demodY - tunerY - tunerH,
    time * 2.2,
  );
  for (let i = 0; i < 4; i += 1) {
    const t = (time * 0.65 + i / 4) % 1;
    let x = hardwareX + 2;
    let y = tunerMidY;
    if (t < 0.3) {
      x += (deviceX - hardwareX - 2) * (t / 0.3);
    } else if (t < 0.62) {
      x = centerX;
      y = tunerY + tunerH + ((t - 0.3) / 0.32) * (demodY - tunerY - tunerH);
    } else {
      x = deviceX + deviceW + ((t - 0.62) / 0.38) * (hardwareX + hardwareW - deviceX - deviceW - 2);
      y = demodMidY;
    }
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.arc(x, y, variant === "gain" && t > 0.3 ? 2.4 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  if (ppmUpdateActive) {
    const updateProgress = Math.min(1, (loopTime - 3.1) / 2);
    const rtlRight = deviceX + deviceW + 3;
    const controlPath: Array<[number, number]> = [
      [hardwareX + hardwareW - 5, panelY + panelH - 9],
      [hardwareX + hardwareW - 5, demodMidY],
      [rtlRight, demodMidY],
      [rtlRight, tunerMidY],
      [deviceX + deviceW, tunerMidY],
    ];
    ctx.strokeStyle = "#f08acb";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    controlPath.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    drawPathPulse(ctx, controlPath, updateProgress, "#ffb7e5");
  }
  if (ppmUpdateActive || pllSettling) {
    ctx.fillStyle = ppmUpdateActive ? "#f08acb" : "#ffc857";
    ctx.font = "600 5px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      ppmUpdateActive ? "PLL + RTL2832U UPDATE" : "PLL LOCK / SETTLE",
      centerX,
      boardBottom - 3,
    );
  }
  ctx.fillStyle = muted;
  ctx.font = "7px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("USB · live I/Q", centerX, panelY + panelH - 1);
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
  ctx.fillText(
    variant === "gain" ? "Q · imaginary · higher gain" : "Q · imaginary component",
    plotX,
    panelY + 12,
  );
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
    const amplitude = variant === "gain" ? 16 : 11;
    const y = qMid - Math.sin(px * 0.13 - time * 3) * amplitude;
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
    const distance = i - bins * 0.75;
    const peak = Math.exp(-(distance * distance) / 7.5);
    const gainScale = variant === "gain" ? 1.16 : 0.88;
    const barHeight = 3 + peak * (fftH - 15) * gainScale;
    ctx.fillStyle = peak > 0.45 ? green : accent;
    ctx.fillRect(x, baseY - barHeight, barW, barHeight);
  }

  if (variant === "ppm") {
    // Schematic marker; its plotted spacing is not a frequency scale.
    const nominalX = plotX + 5 + bins * 0.43 * (barW + barGap);
    const updateProgress = loopTime < 3.1
      ? 0
      : loopTime < 5.1
        ? (loopTime - 3.1) / 2
        : 1;
    const correctedX = nominalX + bins * 0.12 * updateProgress * (barW + barGap);
    ctx.strokeStyle = "#ffc857";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([1, 2]);
    ctx.beginPath();
    ctx.moveTo(nominalX, fftY + 3);
    ctx.lineTo(nominalX, baseY + 1);
    if (updateProgress > 0.03) {
      ctx.moveTo(correctedX, fftY + 3);
      ctx.lineTo(correctedX, baseY + 1);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffc857";
    ctx.font = "6px system-ui, sans-serif";
    ctx.fillText("nominal → corrected tuning ref", plotX, panelY + panelH - 4);
  } else {
    ctx.fillStyle = muted;
    ctx.font = "6px system-ui, sans-serif";
    ctx.fillText("higher gain raises signal + noise", plotX, panelY + panelH - 4);
  }
}

const SignalFlowTooltipContent: React.FC<{ variant: TooltipVariant }> = ({
  variant,
}) => {
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
      drawDiagram(canvas, (now - start) / 1000, variant);
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [variant]);

  return (
    <TooltipBody>
      <Diagram
        ref={canvasRef}
        role="img"
        aria-label={
          variant === "ppm"
            ? "Looping two-column illustration: A shows a reference crystal on an RTL-SDR board and RF passing through the tuner and RTL2832U with hardware PPM correction; B shows an imaginary Q trace and magnitude FFT from I and Q with a dotted corrected-frequency marker. Example: 1 ppm at 40.2 MHz equals 40.2 Hz."
            : "Looping two-column illustration: A shows a reference crystal and RF passing through the RTL-SDR tuner gain stage and RTL2832U; B shows a larger imaginary Q trace and magnitude FFT as gain increases."
        }
      />
      {variant === "ppm" && (
        <>
          <Status>
            Cutaway timing is slowed and exaggerated: cyan is the RF/IF path;
            gold pulses are the separate crystal reference. The magenta driver
            update changes programmed correction settings, not the crystal.
          </Status>
          <Status>
            The loop illustrates a 0 → +1 ppm update. Dotted lines show nominal
            and corrected tuning reference (schematic, not a signal peak): at
            40.2 MHz, +1 ppm corresponds to +40.2 Hz.
          </Status>
          <Status>Signal analysis not decrypted.</Status>
          <Placeholder>
            <PlaceholderTitle>Decrypted signal analysis</PlaceholderTitle>
            <span>Encrypted module visualization placeholder</span>
          </Placeholder>
        </>
      )}
    </TooltipBody>
  );
};

export const PpmCorrectionTooltipContent: React.FC = () => (
  <SignalFlowTooltipContent variant="ppm" />
);

export const GainTooltipContent: React.FC = () => (
  <SignalFlowTooltipContent variant="gain" />
);
