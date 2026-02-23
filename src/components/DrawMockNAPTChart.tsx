import { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { useDraw2DFFTSignal } from "@n-apt/hooks/useDraw2DFFTSignal";
import { FFT_CANVAS_BG } from "@n-apt/consts";

const ChartContainer = styled.div`
  background-color: transparent;
  padding: 20px;
  height: calc(100vh - 200px);
  min-height: 400px;
  position: relative;
`;

const SpectrumCanvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
  border: 1px solid #1f1f1f;
  border-radius: 8px;
  background-color: ${FFT_CANVAS_BG};
`;

interface DrawMockNAPTChartProps {
  spikeCount: number;
  spikeWidth: number;
  centerSpikeBoost: number;
  floorAmplitude: number;
  decayRate: number;
  envelopeWidth: number;
}

const DrawMockNAPTChart: React.FC<DrawMockNAPTChartProps> = ({
  spikeCount,
  spikeWidth,
  centerSpikeBoost,
  floorAmplitude,
  decayRate,
  envelopeWidth,
}) => {
  // Generate mock N-APT signal data using original algorithm
  const generateMockNAPTData = () => {
    const calculateX = (
      t: number,
      {
        spikeCount,
        spikeWidth,
        centerSpikeBoost,
        floorAmplitude,
        decayRate,
        envelopeWidth,
      }: {
        spikeCount: number;
        spikeWidth: number;
        centerSpikeBoost: number;
        floorAmplitude: number;
        decayRate: number;
        envelopeWidth: number;
      },
    ) => {
      // Frequency comb with sine wave spikes and exponential height decay
      // over t ∈ [-1, 1], modulated by Gaussian envelope

      const N = spikeCount;
      const half = Math.floor((N - 1) / 2);

      // Uniform tooth spacing
      const spacing = 2 / (N - 1);

      // Tooth half-width as fraction of spacing
      const halfWidth = (spikeWidth * spacing) / 2;

      let y = 0;

      for (let k = -half; k <= half; k++) {
        const centerPos = k * spacing;
        const dx = t - centerPos;

        // Finite support guarantees baseline = 0
        if (Math.abs(dx) > halfWidth) continue;

        // Sine wave tooth
        const local = dx / halfWidth;
        const tooth = Math.sin((Math.PI * (local + 1)) / 2);

        let height;

        // Center tooth (absolute dominant)
        if (k === 0) {
          height = Math.max(1 * centerSpikeBoost, 1.05);
        } else {
          const centerHeight = Math.max(1 * centerSpikeBoost, 1.05);
          const effectiveFloor = Math.min(floorAmplitude, 1, centerHeight);
          const decay = Math.exp(-Math.abs(k) * decayRate);
          height = effectiveFloor + (centerHeight - effectiveFloor) * decay;
        }

        y += height * tooth;
      }

      // Gaussian envelope
      const envelope = Math.exp(-Math.pow(t / envelopeWidth, 2));
      const signalValue = Math.max(y * envelope, 0);

      return signalValue;
    };

    const rawSamples: Array<{ t: number; freq: number; signal: number }> = [];
    let maxSignal = Number.NEGATIVE_INFINITY;
    let minSignal = Number.POSITIVE_INFINITY;
    const steps = 32768; // Match FFT resolution for smoother curve

    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps;
      const freq = ((t + 1) / 2) * 3; // 0 to 3 MHz like working version
      const signalValue = calculateX(t, {
        spikeCount,
        spikeWidth,
        centerSpikeBoost,
        floorAmplitude,
        decayRate,
        envelopeWidth,
      });

      rawSamples.push({ t: i / steps, freq, signal: signalValue });
      if (signalValue > maxSignal) {
        maxSignal = signalValue;
      }
      if (signalValue < minSignal) {
        minSignal = signalValue;
      }
    }

    // Avoid division by zero
    const safeMaxSignal = maxSignal <= 0 ? 1 : maxSignal;
    const safeMinSignal = minSignal <= 0 ? 1e-6 : minSignal;
    const rangeSignal = Math.max(safeMaxSignal - safeMinSignal, 1e-6);
    const MIN_DB = -80;

    return rawSamples.map(({ t, freq, signal }) => {
      const normalizedLinear = (signal - safeMinSignal) / rangeSignal;
      const clampedLinear = Math.max(0, Math.min(1, normalizedLinear));
      const dbValue = MIN_DB + clampedLinear * 80;
      return {
        t,
        x: dbValue,
        y: freq,
      };
    });
  };

  const [data, setData] = useState<{ x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { draw2DFFTSignal } = useDraw2DFFTSignal();

  // Update data when parameters change
  useEffect(() => {
    setData(() => generateMockNAPTData());
  }, [spikeCount, spikeWidth, centerSpikeBoost, floorAmplitude, decayRate, envelopeWidth]);

  // Draw FFT-style spectrum using Canvas2D renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.round(displayWidth * dpr)) {
      canvas.width = Math.round(displayWidth * dpr);
    }
    if (canvas.height !== Math.round(displayHeight * dpr)) {
      canvas.height = Math.round(displayHeight * dpr);
    }

    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    const waveform = data.map((point) => point.x);

    draw2DFFTSignal({
      canvas,
      waveform,
      frequencyRange: { min: 0, max: 3 },
      fftMin: -80,
      fftMax: 0,
      showGrid: true,
    });
  }, [data]);

  return (
    <ChartContainer>
      <SpectrumCanvas ref={canvasRef} />
    </ChartContainer>
  );
};

export default DrawMockNAPTChart;
