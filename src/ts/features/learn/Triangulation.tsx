// @ts-nocheck
import { useEffect, useRef, useState, useCallback } from "react";

type Vec2 = { x: number; y: number };

function dist(a: Vec2, b: Vec2) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Trilaterate position from 3 known station positions + distances
function trilaterate(s: Vec2[], d: number[]): Vec2 | null {
  // Using algebraic method: subtract eq1 from eq2 and eq3
  const [p1, p2, p3] = s;
  const [r1, r2, r3] = d;
  const A = 2 * (p2.x - p1.x);
  const B = 2 * (p2.y - p1.y);
  const C = r1 * r1 - r2 * r2 - p1.x * p1.x + p2.x * p2.x - p1.y * p1.y + p2.y * p2.y;
  const D = 2 * (p3.x - p2.x);
  const E = 2 * (p3.y - p2.y);
  const F = r2 * r2 - r3 * r3 - p2.x * p2.x + p3.x * p3.x - p2.y * p2.y + p3.y * p3.y;
  const det = A * E - B * D;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (C * E - F * B) / det, y: (A * F - D * C) / det };
}

const STATION_COLORS = ["#e55", "#3a3", "#55e"];

function TrilaterationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [receiver, setReceiver] = useState<Vec2>({ x: 320, y: 200 });
  const [stations] = useState<Vec2[]>([
    { x: 100, y: 80 },
    { x: 540, y: 100 },
    { x: 300, y: 340 },
  ]);
  const dragging = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = 640;
    const logicalHeight = 400;

    if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
      canvas.width = logicalWidth * dpr;
      canvas.height = logicalHeight * dpr;
    }

    const w = logicalWidth, h = logicalHeight;
    const isDark = document.documentElement.classList.contains("dark");
    const fg = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)";
    const fgDim = isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)";

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dists = stations.map(s => dist(s, receiver));

    // Draw range circles
    stations.forEach((s, i) => {
      ctx.beginPath();
      ctx.arc(s.x, s.y, dists[i], 0, Math.PI * 2);
      ctx.strokeStyle = STATION_COLORS[i] + (isDark ? "88" : "66");
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw lines from stations to receiver
    stations.forEach((s, i) => {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(receiver.x, receiver.y);
      ctx.strokeStyle = STATION_COLORS[i] + "99";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Distance label at midpoint
      const mx = (s.x + receiver.x) / 2 + 8;
      const my = (s.y + receiver.y) / 2;
      ctx.fillStyle = STATION_COLORS[i];
      ctx.font = "11px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(`d${i + 1} = ${Math.round(dists[i])}`, mx, my);
    });

    // Trilaterate and draw computed position
    const computed = trilaterate(stations, dists);
    if (computed) {
      ctx.beginPath();
      ctx.arc(computed.x, computed.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(computed.x, computed.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = fg;
      ctx.fill();
    }

    // Draw stations
    stations.forEach((s, i) => {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = STATION_COLORS[i];
      ctx.fill();
      ctx.fillStyle = isDark ? "#000" : "#fff";
      ctx.font = "bold 9px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`T${i + 1}`, s.x, s.y);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    });

    // Draw draggable receiver
    ctx.beginPath();
    ctx.arc(receiver.x, receiver.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(receiver.x, receiver.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = fg;
    ctx.fill();

    ctx.fillStyle = fgDim;
    ctx.font = "11px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    ctx.fillText("← drag receiver", receiver.x + 14, receiver.y + 4);
    ctx.restore();
  }, [receiver, stations]);

  useEffect(() => {
    draw();
  }, [draw]);

  function toCanvas(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={400}
      className="w-full rounded border border-border bg-muted/30 cursor-crosshair"
      onMouseDown={() => { dragging.current = true; }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onMouseMove={e => { if (dragging.current) setReceiver(toCanvas(e)); }}
      onClick={e => setReceiver(toCanvas(e))}
    />
  );
}

function TDOACanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = 640;
    const logicalHeight = 400;

    if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
      canvas.width = logicalWidth * dpr;
      canvas.height = logicalHeight * dpr;
    }

    // Two receivers, one transmitter (unknown)
    const tx = { x: 320, y: 130 };
    const rx1 = { x: 100, y: 320 };
    const rx2 = { x: 540, y: 320 };
    const d1 = dist(tx, rx1);
    const d2 = dist(tx, rx2);
    const tdoa = d1 - d2; // pixels as proxy for time

    function draw() {
      const isDark = document.documentElement.classList.contains("dark");
      const t = tRef.current;
      tRef.current += 0.018;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      const fg = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)";

      // Draw expanding wavefront rings from Tx
      for (let i = 0; i < 4; i++) {
        const r = ((t * 55 + i * 80) % 350);
        const alpha = Math.max(0, 0.5 - r / 350);
        ctx.beginPath();
        ctx.arc(tx.x, tx.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = isDark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Hyperbola of equal TDOA (approximate by drawing a few candidate source points)
      ctx.beginPath();
      for (let x = 20; x <= 620; x += 2) {
        for (let y = 20; y <= 380; y += 2) {
          const dd = dist({ x, y }, rx1) - dist({ x, y }, rx2);
          if (Math.abs(dd - tdoa) < 4) {
            ctx.rect(x, y, 1.5, 1.5);
          }
        }
      }
      ctx.fillStyle = isDark ? "rgba(255,200,100,0.5)" : "rgba(160,100,0,0.5)";
      ctx.fill();

      // Stations
      [[rx1, "Rx 1", "#3a3"], [rx2, "Rx 2", "#55e"]].forEach(([pos, label, color]) => {
        const p = pos as Vec2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = color as string;
        ctx.fill();
        ctx.fillStyle = fg;
        ctx.font = "11px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
        ctx.fillText(label as string, p.x + 12, p.y + 4);
      });

      // Unknown Tx
      ctx.beginPath();
      ctx.arc(tx.x, tx.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = "#e55";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.font = "11px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText("? Tx", tx.x + 10, tx.y - 4);

      // TDOA legend
      ctx.fillStyle = isDark ? "rgba(255,200,100,0.8)" : "rgba(120,80,0,0.9)";
      ctx.font = "11px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(`TDOA hyperbola  (d₁−d₂ = ${Math.round(tdoa)}px)`, 12, 18);

      rafRef.current = requestAnimationFrame(draw);
      ctx.restore();
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} width={640} height={400} className="w-full rounded border border-border bg-muted/30" />;
}

function CellTowerCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = 640;
    const logicalHeight = 400;

    if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
      canvas.width = logicalWidth * dpr;
      canvas.height = logicalHeight * dpr;
    }

    const towers = [
      { x: 160, y: 180, range: 160, color: "#e55" },
      { x: 420, y: 120, range: 140, color: "#3a3" },
      { x: 500, y: 310, range: 150, color: "#55e" },
    ];

    // UE path: smooth wandering
    const path: Vec2[] = [];
    for (let i = 0; i <= 200; i++) {
      const a = i / 200;
      path.push({
        x: 200 + Math.sin(a * Math.PI * 3) * 120 + a * 200,
        y: 220 + Math.cos(a * Math.PI * 2.5) * 80,
      });
    }

    function draw() {
      const isDark = document.documentElement.classList.contains("dark");
      const t = tRef.current;
      tRef.current = (tRef.current + 0.003) % 1;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      const fg = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)";

      // Coverage circles
      towers.forEach(tw => {
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, tw.range, 0, Math.PI * 2);
        ctx.fillStyle = tw.color + "12";
        ctx.fill();
        ctx.strokeStyle = tw.color + "55";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Draw path
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (const p of path) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // UE position
      const pi = Math.floor(t * (path.length - 1));
      const ue = path[pi];

      // Signal lines to each tower (thicker = stronger)
      towers.forEach(tw => {
        const d = dist(ue, tw);
        const strength = Math.max(0, 1 - d / (tw.range * 1.3));
        if (strength > 0.05) {
          ctx.beginPath();
          ctx.moveTo(ue.x, ue.y);
          ctx.lineTo(tw.x, tw.y);
          ctx.strokeStyle = tw.color + Math.round(strength * 200).toString(16).padStart(2, "0");
          ctx.lineWidth = strength * 2.5;
          ctx.stroke();
        }
      });

      // Towers
      towers.forEach((tw, i) => {
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = tw.color;
        ctx.fill();
        ctx.fillStyle = fg;
        ctx.font = "10px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
        ctx.fillText(`Cell ${i + 1}`, tw.x + 10, tw.y - 4);
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)";
        const d = Math.round(dist(ue, tw));
        ctx.fillText(`${d}px`, tw.x + 10, tw.y + 10);
      });

      // UE
      ctx.beginPath();
      ctx.arc(ue.x, ue.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";
      ctx.font = "10px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText("UE", ue.x + 9, ue.y + 4);

      rafRef.current = requestAnimationFrame(draw);
      ctx.restore();
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} width={640} height={400} className="w-full rounded border border-border bg-muted/30" />;
}

export function Triangulation() {
  const [tab, setTab] = useState<"trilateration" | "tdoa" | "cell">("trilateration");

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Triangulation</h2>

      <p className="text-muted-foreground leading-relaxed">
        Triangulation is the family of techniques for locating an unknown point using angle or distance
        measurements from known reference positions. In radio systems the same physics that governs
        signal propagation can be run in reverse — if you know the geometry of your transmitters or
        receivers, you can pinpoint a source or target.
      </p>

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-border">
        {([
          ["trilateration", "Trilateration (RSS/ToA)"],
          ["tdoa", "TDOA / Hyperbolic"],
          ["cell", "Cell-Tower Fix"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "trilateration" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5 space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Trilateration — Range Circles</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Each transmitter (T1–T3) broadcasts a signal. The receiver measures the propagation delay
              to each — converting delay to distance via <code className="text-foreground">d = c·τ</code>. Each distance
              defines a circle of possible locations. The intersection of three circles resolves to
              a unique point. Click or drag anywhere to reposition the receiver and watch the circles adapt.
            </p>
            <TrilaterationCanvas />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">GPS / GNSS</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                GPS satellites broadcast precise timestamps. The receiver computes four time-of-arrival
                measurements (four to solve for x, y, z + clock offset) and solves the resulting system
                of sphere equations. Typical accuracy: 3–5 m civilian, &lt;1 m with WAAS corrections.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">RSSI-Based Ranging</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Instead of time, received signal strength (RSS) is used to estimate distance via the
                path-loss model: <code className="text-foreground">d ∝ (P_tx/P_rx)^(1/n)</code>. Less precise
                than ToA — multipath and shadowing corrupt the model — but requires no synchronisation
                between nodes. Common in Wi-Fi and BLE indoor positioning.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "tdoa" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5 space-y-3">
            <h3 className="text-lg font-semibold text-foreground">TDOA — Hyperbolic Positioning</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Time Difference of Arrival (TDOA) does not require synchronisation between the transmitter
              and receivers — only between the receivers themselves. The constant time difference between
              two receivers traces a <strong className="text-foreground">hyperbola</strong> of candidate
              source positions. A second pair adds another hyperbola; their intersection is the fix.
              The amber curve shows the TDOA hyperbola for the two receivers below.
            </p>
            <TDOACanvas />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Lightning Detection</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Networks like BLITZORTUNG use TDOA across distributed receiver stations to locate
                lightning strikes to within hundreds of meters. The sharp RF pulse of a return stroke
                lets stations time-stamp arrivals very precisely.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">E-911 / E-112 Location</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Cellular emergency-call mandates require network-based location. TDOA across base
                stations can locate a handset without GPS. Accuracy degrades in urban canyons where
                multipath spreads the apparent arrival time.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "cell" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5 space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Cell-Tower Triangulation</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              A mobile UE (user equipment) continuously measures signal strength from surrounding base
              stations. The network combines those RSS reports — or timing advance values — to estimate
              the device's position. Line thickness below represents signal strength; the UE is served
              by its strongest cell at each moment.
            </p>
            <CellTowerCanvas />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Timing Advance (TA)</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                In GSM/LTE the base station instructs the UE to advance its uplink burst so it arrives
                in the right timeslot. The TA value (0–63 in GSM → 0–550 m resolution) gives a radial
                distance ring. Combining TA with sector angle yields a coarse position fix.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Observed Time Difference (OTD)</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                OTD and its LTE successor E-CID (Enhanced Cell ID) extend the cell fix by measuring
                reference signal timing from multiple cells. 5G NR adds angle-of-arrival (AoA) from
                massive MIMO arrays, pushing network-side positioning into the sub-meter range.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Shared accuracy table */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h3 className="text-lg font-semibold text-foreground mb-3">Technique Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Technique</th>
                <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Needs sync</th>
                <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Typical accuracy</th>
                <th className="text-left py-2 text-muted-foreground font-medium">Use case</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ["GPS ToA", "Tx only", "3–5 m", "Navigation"],
                ["RSSI trilateration", "None", "2–10 m", "Indoor Wi-Fi / BLE"],
                ["TDOA", "Rx network", "50–300 m", "E-911, lightning"],
                ["Cell ID + TA", "None", "100 m–5 km", "LTE E-CID"],
                ["5G NR AoA", "None", "<1 m", "Indoor 5G positioning"],
              ].map(([tech, sync, acc, use]) => (
                <tr key={tech} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-foreground font-mono text-xs">{tech}</td>
                  <td className="py-2 pr-4">{sync}</td>
                  <td className="py-2 pr-4">{acc}</td>
                  <td className="py-2">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
