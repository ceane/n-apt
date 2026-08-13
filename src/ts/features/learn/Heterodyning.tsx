// @ts-nocheck
import { useEffect, useRef, useState } from "react";

function WaveCanvas({
  freqA,
  freqB,
  label,
  showEnvelope = false,
}: {
  freqA: number;
  freqB: number;
  label: string;
  showEnvelope?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = 700;
    const logicalHeight = 80;

    if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
      canvas.width = logicalWidth * dpr;
      canvas.height = logicalHeight * dpr;
    }

    const isDark = () => document.documentElement.classList.contains("dark");

    function draw() {
      const w = logicalWidth;
      const h = logicalHeight;
      const dark = isDark();
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const t = tRef.current;
      tRef.current += 0.016;

      const amp = h * 0.35;
      const cy = h / 2;

      if (showEnvelope) {
        // Draw fill between envelope bounds
        const beatFreq = Math.abs(freqA - freqB);
        ctx.beginPath();
        for (let x = 0; x <= w; x++) {
          const phase = (x / w) * Math.PI * 2 * 8;
          const env = Math.abs(Math.cos(beatFreq * phase / 2 + t * beatFreq * Math.PI));
          const y = cy - amp * env;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        for (let x = w; x >= 0; x--) {
          const phase = (x / w) * Math.PI * 2 * 8;
          const env = Math.abs(Math.cos(beatFreq * phase / 2 + t * beatFreq * Math.PI));
          const y = cy + amp * env;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
        ctx.fill();

        // Envelope outline
        ctx.beginPath();
        for (let x = 0; x <= w; x++) {
          const phase = (x / w) * Math.PI * 2 * 8;
          const env = Math.abs(Math.cos(beatFreq * phase / 2 + t * beatFreq * Math.PI));
          const y = cy - amp * env;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        for (let x = 0; x <= w; x++) {
          const phase = (x / w) * Math.PI * 2 * 8;
          const env = Math.abs(Math.cos(beatFreq * phase / 2 + t * beatFreq * Math.PI));
          const y = cy + amp * env;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw the wave
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        const phase = (x / w) * Math.PI * 2 * 8;
        let y: number;
        if (showEnvelope) {
          const beatFreq = Math.abs(freqA - freqB);
          y = cy - amp * Math.cos(beatFreq * phase / 2 + t * beatFreq * Math.PI) *
              Math.cos((freqA + freqB) / 2 * phase + t * (freqA + freqB) / 2 * Math.PI);
        } else {
          // Single transmitter wave
          y = cy - amp * Math.sin(freqA * phase + t * freqA * Math.PI);
        }
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
      ctx.restore();
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [freqA, freqB, showEnvelope]);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1 font-mono">{label}</p>
      <div className="rounded overflow-hidden bg-muted/40 border border-border">
        <canvas ref={canvasRef} width={700} height={80} className="w-full h-20" />
      </div>
    </div>
  );
}

function FreespaceViz({ freqA, freqB }: { freqA: number; freqB: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = 700;
    const logicalHeight = 160;

    if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
      canvas.width = logicalWidth * dpr;
      canvas.height = logicalHeight * dpr;
    }

    const isDark = () => document.documentElement.classList.contains("dark");

    function draw() {
      const w = logicalWidth;
      const h = logicalHeight;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const t = tRef.current;
      tRef.current += 0.012;
      const dark = isDark();

      // Tx A — left side
      const txAx = 60;
      const txBx = w - 60;
      const cy = h / 2;

      // Draw ripple rings from Tx A
      for (let i = 0; i < 5; i++) {
        const radius = ((t * 60 * freqA + i * (w / 5)) % (w * 0.7));
        ctx.beginPath();
        ctx.arc(txAx, cy, radius, 0, Math.PI * 2);
        const alpha = Math.max(0, 0.35 - radius / (w * 0.7));
        ctx.strokeStyle = dark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw ripple rings from Tx B
      for (let i = 0; i < 5; i++) {
        const radius = ((t * 60 * freqB + i * (w / 5)) % (w * 0.7));
        ctx.beginPath();
        ctx.arc(txBx, cy, radius, 0, Math.PI * 2);
        const alpha = Math.max(0, 0.35 - radius / (w * 0.7));
        ctx.strokeStyle = dark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Tx A label
      ctx.fillStyle = dark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)";
      ctx.font = "bold 11px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Tx A", txAx, cy - 8);
      ctx.fillText(`f = ${freqA}`, txAx, cy + 16);

      // Tx B label
      ctx.fillText("Tx B", txBx, cy - 8);
      ctx.fillText(`f = ${freqB}`, txBx, cy + 16);

      // Interference pattern in between (sample row)
      const numSamples = 120;
      for (let i = 0; i < numSamples; i++) {
        const x = txAx + (txBx - txAx) * (i / numSamples);
        const dA = x - txAx;
        const dB = txBx - x;
        const phaseA = dA * freqA * 0.08 - t * freqA * Math.PI;
        const phaseB = dB * freqB * 0.08 - t * freqB * Math.PI;
        const amp = (Math.cos(phaseA) + Math.cos(phaseB)) / 2;
        const intensity = (amp + 1) / 2;
        const r = i / numSamples;
        const y = cy + amp * 22;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = dark
          ? `rgba(255,255,255,${0.1 + intensity * 0.6})`
          : `rgba(0,0,0,${0.1 + intensity * 0.6})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
      ctx.restore();
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [freqA, freqB]);

  return (
    <div className="rounded overflow-hidden bg-muted/40 border border-border">
      <canvas ref={canvasRef} width={700} height={160} className="w-full" style={{ height: 160 }} />
    </div>
  );
}

export function Heterodyning() {
  const [freqA, setFreqA] = useState(3);
  const [freqB, setFreqB] = useState(4);

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Heterodyning In Free Space</h2>

      <p className="text-muted-foreground leading-relaxed">
        When two transmitters broadcast at slightly different frequencies, their electromagnetic waves
        propagate through free space and naturally superpose wherever they overlap. No mixer or circuit
        is needed — physics does it. The result is a <strong className="text-foreground">beat pattern</strong>:
        the summed field oscillates at the average frequency but its amplitude rises and falls at the
        difference frequency, tracing out a slowly-moving <strong className="text-foreground">envelope</strong>.
        That envelope is the "third wave" — an emergent structure born purely from constructive and
        destructive interference.
      </p>

      {/* Interactive controls */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Transmitter Frequencies</h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block font-mono">Tx A — f<sub>A</sub> = {freqA}</label>
            <input
              type="range" min={1} max={8} step={1} value={freqA}
              onChange={e => setFreqA(Number(e.target.value))}
              className="w-full accent-foreground"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block font-mono">Tx B — f<sub>B</sub> = {freqB}</label>
            <input
              type="range" min={1} max={8} step={1} value={freqB}
              onChange={e => setFreqB(Number(e.target.value))}
              className="w-full accent-foreground"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          Beat (envelope) frequency: |f<sub>A</sub> − f<sub>B</sub>| = {Math.abs(freqA - freqB)} &nbsp;|&nbsp;
          Carrier: (f<sub>A</sub> + f<sub>B</sub>) / 2 = {(freqA + freqB) / 2}
        </p>
      </div>

      {/* Free-space propagation visualizer */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <h3 className="text-lg font-semibold text-foreground">Free-Space Propagation</h3>
        <p className="text-sm text-muted-foreground">
          Concentric rings represent wave-fronts emanating from each transmitter. The dot swarm
          in between shows the superposed field amplitude — bright dots are constructive interference,
          dim dots are destructive.
        </p>
        <FreespaceViz freqA={freqA} freqB={freqB} />
      </div>

      {/* Wave breakdown */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Signal Breakdown</h3>

        <WaveCanvas freqA={freqA} freqB={freqB} label={`Tx A  →  cos(2π · fA · t),  fA = ${freqA}`} />
        <WaveCanvas freqA={freqB} freqB={freqB} label={`Tx B  →  cos(2π · fB · t),  fB = ${freqB}`} />

        <div className="flex items-center gap-2 text-muted-foreground text-sm pl-1">
          <span className="text-xl">+</span>
          <span>Fields add linearly in free space (superposition principle)</span>
        </div>

        <WaveCanvas
          freqA={freqA}
          freqB={freqB}
          label={`Sum  →  cos(fA·t) + cos(fB·t)  =  2·cos(Δf/2·t)·cos(f̄·t)`}
          showEnvelope
        />

        <div className="bg-muted/50 rounded p-3 text-xs font-mono text-muted-foreground space-y-1">
          <div>cos(fA·t) + cos(fB·t)</div>
          <div className="pl-4">= 2 · cos(<strong className="text-foreground">Δf/2</strong> · t) · cos(<strong className="text-foreground">f̄</strong> · t)</div>
          <div className="pt-1 text-muted-foreground/70">
            Dashed lines = amplitude envelope oscillating at the beat frequency Δf = |fA − fB|
          </div>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <h3 className="text-lg font-semibold text-foreground">Why This Matters</h3>
        <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
          <p>
            The envelope — the slow "wobble" wrapping around the high-frequency carrier — carries
            information at the beat rate. Two slightly mistuned transmitters painting the same sky
            create a standing interference pattern: nodes of silence and antinodes of doubled amplitude,
            moving through space at a velocity set by their frequency difference.
          </p>
          <p>
            A receiver tuned to either transmitter sees this as amplitude modulation. A wideband receiver
            sees both and can resolve the beat directly. Either way, the "third frequency" is not generated
            by any hardware — it exists wherever the two wave-fronts overlap in free space, a natural
            consequence of linear superposition.
          </p>
          <p>
            This is the same physics behind <strong className="text-foreground">acoustic beats</strong> (two
            slightly detuned instruments), <strong className="text-foreground">optical interference fringes</strong>,
            and <strong className="text-foreground">radio multipath fading</strong> — all superposition of
            two waves at close but unequal frequencies.
          </p>
        </div>
      </div>
    </div>
  );
}
