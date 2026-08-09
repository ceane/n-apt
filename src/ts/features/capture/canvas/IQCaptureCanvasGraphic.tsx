import React, { useEffect, useRef } from "react";
import styled from "styled-components";

const GraphicCard = styled.div`
  margin: 0 0 40px;
  background: rgba(240, 244, 250, 0.04);
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
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

export const IQCaptureCanvasGraphic: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const startTime = performance.now();

    const NUM_BINS = 512;
    // Generate synthetic spectrum baseline (uint8 values 0 - 255)
    const baseBytes = new Uint8Array(NUM_BINS);
    for (let i = 0; i < NUM_BINS; i++) {
      const xRatio = i / NUM_BINS;
      // Base noise around ~20-40 uint8 value (-92 to -84 dB)
      let val = 30 + Math.sin(i * 0.05) * 4 + (Math.random() - 0.5) * 6;

      // Add peaks at specific relative positions
      val += 80 * Math.exp(-Math.pow((xRatio - 0.15) * 80, 2));
      val += 140 * Math.exp(-Math.pow((xRatio - 0.35) * 120, 2));
      val += 220 * Math.exp(-Math.pow((xRatio - 0.495) * 160, 2));
      val += 175 * Math.exp(-Math.pow((xRatio - 0.66) * 100, 2));
      val += 215 * Math.exp(-Math.pow((xRatio - 0.74) * 180, 2));
      val += 130 * Math.exp(-Math.pow((xRatio - 0.86) * 110, 2));
      val += 90 * Math.exp(-Math.pow((xRatio - 0.95) * 140, 2));

      baseBytes[i] = Math.min(255, Math.max(0, Math.round(val)));
    }

    const render = (time: number) => {
      const elapsed = (time - startTime) / 1000;

      // Handle dpr resize
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

      // Layout margins
      const marginTop = 32;
      const marginBottom = 56;
      const marginLeft = 80;
      const marginRight = 28;

      const plotW = width - marginLeft - marginRight;
      const plotH = height - marginTop - marginBottom;

      // Background card plot area
      ctx.fillStyle = "rgba(240, 244, 250, 0.45)";
      ctx.fillRect(marginLeft, marginTop, plotW, plotH);

      // Y-Axis Title Label: "Relative Power (dB)"
      ctx.save();
      ctx.font = "11px monospace";
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "left";
      ctx.fillText("Relative Power (dB)", 16, marginTop - 14);
      ctx.restore();

      // Draw Grid & Y-Axis Labels (dB)
      // Mapping 0-255 uint8 -> -100dB to 0dB
      const dbTicks = [
        { db: "0dB", ratio: 1.0 },
        { db: "-20dB", ratio: 0.8 },
        { db: "-40dB", ratio: 0.6 },
        { db: "-60dB", ratio: 0.4 },
        { db: "-80dB", ratio: 0.2 },
        { db: "-100dB", ratio: 0.0 },
      ];

      ctx.lineWidth = 1;
      ctx.font = "12px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      dbTicks.forEach(({ db, ratio }) => {
        const y = marginTop + plotH * (1 - ratio);
        // Grid line
        ctx.strokeStyle = "rgba(200, 210, 225, 0.5)";
        ctx.beginPath();
        ctx.moveTo(marginLeft, y);
        ctx.lineTo(marginLeft + plotW, y);
        ctx.stroke();

        // Label
        ctx.fillStyle = "#5c6b73";
        ctx.fillText(db, marginLeft - 12, y);
      });

      // Vertical grid lines for frequency markers (0Hz to 3.2MHz, clean 800kHz step)
      interface FreqMarker {
        align?: CanvasTextAlign;
        isCenter?: boolean;
        label: string;
        ratio: number;
      }

      const freqMarkers: FreqMarker[] = [
        { align: "left", label: "0Hz", ratio: 0.0 },
        { align: "center", label: "800kHz", ratio: 0.25 },
        { isCenter: true, label: "1.6MHz", ratio: 0.5 },
        { align: "center", label: "2.4MHz", ratio: 0.75 },
        { align: "right", label: "3.2MHz", ratio: 1.0 },
      ];

      freqMarkers.forEach(({ ratio }) => {
        const x = marginLeft + plotW * ratio;
        ctx.strokeStyle = "rgba(200, 210, 225, 0.4)";
        ctx.beginPath();
        ctx.moveTo(x, marginTop);
        ctx.lineTo(x, marginTop + plotH);
        ctx.stroke();
      });

      // Plot Signal Curve (uint8 byte values 0-255 mapped to plotH)
      ctx.beginPath();
      ctx.moveTo(marginLeft, marginTop + plotH);

      const frameBytes = new Float32Array(NUM_BINS);
      for (let i = 0; i < NUM_BINS; i++) {
        // Add animated variation over time
        const noise = (Math.random() - 0.5) * 5;
        const wave = Math.sin(elapsed * 3 + i * 0.1) * 3;
        const rawByte = Math.min(
          255,
          Math.max(0, baseBytes[i] + noise + wave),
        );
        frameBytes[i] = rawByte;

        const x = marginLeft + (i / (NUM_BINS - 1)) * plotW;
        // byte 0 -> bottom (ratio 0), byte 255 -> top (ratio 1)
        const y = marginTop + plotH * (1 - rawByte / 255);
        if (i === 0) {
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.lineTo(marginLeft + plotW, marginTop + plotH);
      ctx.closePath();

      // Fill signal area
      const fillGrad = ctx.createLinearGradient(
        0,
        marginTop,
        0,
        marginTop + plotH,
      );
      fillGrad.addColorStop(0, "rgba(59, 130, 246, 0.35)");
      fillGrad.addColorStop(1, "rgba(59, 130, 246, 0.08)");
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // Draw signal stroke line
      ctx.beginPath();
      for (let i = 0; i < NUM_BINS; i++) {
        const x = marginLeft + (i / (NUM_BINS - 1)) * plotW;
        const y = marginTop + plotH * (1 - frameBytes[i] / 255);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw bottom X Axis ticks and labels
      const axisY = marginTop + plotH;

      // Ticks
      const numTicks = 32;
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1;
      for (let t = 0; t <= numTicks; t++) {
        const tx = marginLeft + (t / numTicks) * plotW;
        const tickH = t % 8 === 0 ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(tx, axisY);
        ctx.lineTo(tx, axisY + tickH);
        ctx.stroke();
      }

      // X-Axis Frequency Labels with proper spacing
      ctx.fillStyle = "#334155";
      ctx.font = "12px monospace";
      ctx.textBaseline = "top";

      freqMarkers.forEach(({ label, ratio, align, isCenter }) => {
        const x = marginLeft + plotW * ratio;
        if (isCenter) {
          ctx.save();
          // Draw indicator circle for center frequency
          ctx.beginPath();
          ctx.arc(x - 30, axisY + 20, 4, 0, Math.PI * 2);
          ctx.strokeStyle = "#1e293b";
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = "bold 13px monospace";
          ctx.fillStyle = "#0f172a";
          ctx.textAlign = "left";
          ctx.fillText(label, x - 18, axisY + 14);
          ctx.restore();
        } else {
          ctx.textAlign = align || "center";
          ctx.fillText(label, x, axisY + 14);
        }
      });

      // X-Axis Title Label: "Frequency"
      ctx.save();
      ctx.font = "11px monospace";
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      ctx.fillText("Frequency", marginLeft + plotW / 2, axisY + 36);
      ctx.restore();

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

export default IQCaptureCanvasGraphic;
