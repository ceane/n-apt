// @ts-nocheck
import { useEffect, useRef, useState } from "react";

// ── Shared types ─────────────────────────────────────────────────────────────
type V2 = { x: number; y: number };
type Triangle = [number, number, number];

// ── Minimal Bowyer-Watson Delaunay ───────────────────────────────────────────
function circumcircle(pts: V2[], i: number, j: number, k: number) {
  const ax = pts[i].x, ay = pts[i].y;
  const bx = pts[j].x, by = pts[j].y;
  const cx = pts[k].x, cy = pts[k].y;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return null;
  const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
  const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
  return { x: ux, y: uy, r2: (ax-ux)**2 + (ay-uy)**2 };
}

function delaunay(pts: V2[]): Triangle[] {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.x<minX) minX=p.x; if (p.y<minY) minY=p.y; if (p.x>maxX) maxX=p.x; if (p.y>maxY) maxY=p.y; }
  const delta = Math.max(maxX-minX, maxY-minY) * 10;
  const sup: V2[] = [...pts,
    {x: minX-delta, y: minY-delta},
    {x: minX+(maxX-minX)/2, y: maxY+delta},
    {x: maxX+delta, y: minY-delta},
  ];
  let tris: Triangle[] = [[n, n+1, n+2]];
  for (let p = 0; p < n; p++) {
    const edges: [number,number][] = [];
    const good: Triangle[] = [];
    for (const tri of tris) {
      const cc = circumcircle(sup, tri[0], tri[1], tri[2]);
      if (!cc) { good.push(tri); continue; }
      const dx = sup[p].x - cc.x, dy = sup[p].y - cc.y;
      if (dx*dx + dy*dy < cc.r2) { edges.push([tri[0],tri[1]],[tri[1],tri[2]],[tri[2],tri[0]]); }
      else good.push(tri);
    }
    const boundary: [number,number][] = [];
    for (let e1=0; e1<edges.length; e1++) {
      let unique = true;
      for (let e2=0; e2<edges.length; e2++) {
        if (e1!==e2 && ((edges[e1][0]===edges[e2][0]&&edges[e1][1]===edges[e2][1])||(edges[e1][0]===edges[e2][1]&&edges[e1][1]===edges[e2][0]))) { unique=false; break; }
      }
      if (unique) boundary.push(edges[e1]);
    }
    for (const [a,b] of boundary) good.push([a,b,p]);
    tris = good;
  }
  return tris.filter(([a,b,c]) => a<n && b<n && c<n);
}

// Barycentric coordinates of P inside triangle (A, B, C)
// Returns [λA, λB, λC]; all > 0 means inside; < 0 means outside
function bary(p: V2, a: V2, b: V2, c: V2): [number, number, number] {
  const denom = (b.y - c.y)*(a.x - c.x) + (c.x - b.x)*(a.y - c.y);
  if (Math.abs(denom) < 1e-9) return [-1, -1, -1];
  const la = ((b.y - c.y)*(p.x - c.x) + (c.x - b.x)*(p.y - c.y)) / denom;
  const lb = ((c.y - a.y)*(p.x - c.x) + (a.x - c.x)*(p.y - c.y)) / denom;
  const lc = 1 - la - lb;
  return [la, lb, lc];
}

// ── Spatial aperture / barycentric-hysteresis canvas ─────────────────────────
const TOWERS: V2[] = [
  { x: 90,  y: 70  },
  { x: 310, y: 50  },
  { x: 570, y: 80  },
  { x: 150, y: 230 },
  { x: 430, y: 210 },
  { x: 80,  y: 380 },
  { x: 330, y: 370 },
  { x: 590, y: 360 },
];

const TOWER_COLORS = ["#e55","#3a3","#55e","#e93","#c3c","#3cc","#ca3","#37b"];
const HYSTERESIS = 0.12; // must be this far outside current triangle to trigger a switch

function SpatialApertureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  // User position — mutable refs so canvas loop can read/write without re-renders
  const userRef   = useRef<V2>({ x: 330, y: 210 });
  const velRef    = useRef<V2>({ x: 0.6, y: 0.4 });
  const isDragging = useRef(false);

  // Target for wandering (changes periodically)
  const wanderTarget = useRef<V2>({ x: 330, y: 210 });
  const wanderTimer  = useRef(0);

  // Active triangle index (hysteresis)
  const activeTri = useRef<number>(-1);

  // Pre-compute triangulation (static towers)
  const tris = useRef<Triangle[]>(delaunay(TOWERS));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;
    const allTris = tris.current;

    // ── Find which triangle contains user with hysteresis ──────────────────
    function resolveTriangle(u: V2): number {
      const cur = activeTri.current;
      // Check if still comfortably inside current triangle
      if (cur >= 0 && cur < allTris.length) {
        const [a,b,c] = allTris[cur];
        const [la,lb,lc] = bary(u, TOWERS[a], TOWERS[b], TOWERS[c]);
        if (la > -HYSTERESIS && lb > -HYSTERESIS && lc > -HYSTERESIS) return cur;
      }
      // Find new triangle (must be clearly inside)
      let best = cur;
      let bestMin = -Infinity;
      for (let i = 0; i < allTris.length; i++) {
        const [a,b,c] = allTris[i];
        const [la,lb,lc] = bary(u, TOWERS[a], TOWERS[b], TOWERS[c]);
        const mn = Math.min(la, lb, lc);
        if (mn > bestMin) { bestMin = mn; best = i; }
      }
      return best;
    }

    function pickWanderTarget(w: number, h: number) {
      wanderTarget.current = {
        x: 60 + Math.random() * (w - 120),
        y: 60 + Math.random() * (h - 120),
      };
      wanderTimer.current = 180 + Math.random() * 240;
    }

    function draw() {
      const isDark = document.documentElement.classList.contains("dark");
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const fgAlpha = isDark ? 0.85 : 0.82;
      const dimAlpha = isDark ? 0.18 : 0.14;

      // ── Wander ──────────────────────────────────────────────────────────
      if (!isDragging.current) {
        wanderTimer.current--;
        if (wanderTimer.current <= 0) pickWanderTarget(w, h);
        const u  = userRef.current;
        const tg = wanderTarget.current;
        const dx = tg.x - u.x, dy = tg.y - u.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        const speed = 1.1;
        if (len > 2) {
          u.x += (dx / len) * speed;
          u.y += (dy / len) * speed;
        }
        // gentle soft-bounce at edges
        u.x = Math.max(20, Math.min(w-20, u.x));
        u.y = Math.max(20, Math.min(h-20, u.y));
      }

      const u = userRef.current;
      activeTri.current = resolveTriangle(u);
      const curTri = activeTri.current;

      // ── Draw grid ───────────────────────────────────────────────────────
      ctx.strokeStyle = isDark ? `rgba(255,255,255,${dimAlpha*0.5})` : `rgba(0,0,0,${dimAlpha*0.4})`;
      ctx.lineWidth = 0.5;
      const gStep = 60;
      for (let x = 0; x < w; x += gStep) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
      for (let y = 0; y < h; y += gStep) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

      // ── Draw all Delaunay edges (dim) ──────────────────────────────────
      ctx.strokeStyle = isDark ? `rgba(255,255,255,${dimAlpha})` : `rgba(0,0,0,${dimAlpha})`;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 4]);
      for (const [a,b,c] of allTris) {
        const pts = [[a,b],[b,c],[c,a]] as [number,number][];
        for (const [i,j] of pts) {
          ctx.beginPath();
          ctx.moveTo(TOWERS[i].x, TOWERS[i].y);
          ctx.lineTo(TOWERS[j].x, TOWERS[j].y);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // ── Draw active triangle (highlighted fill + solid edges) ──────────
      if (curTri >= 0) {
        const [a,b,c] = allTris[curTri];
        const ta = TOWERS[a], tb = TOWERS[b], tc = TOWERS[c];

        // Fill
        ctx.beginPath();
        ctx.moveTo(ta.x, ta.y);
        ctx.lineTo(tb.x, tb.y);
        ctx.lineTo(tc.x, tc.y);
        ctx.closePath();
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
        ctx.fill();

        // Edges
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Beam lines from each active tower to user
        const [la, lb, lc] = bary(u, ta, tb, tc);
        const baryCoords = [la, lb, lc];
        [ta, tb, tc].forEach((t, idx) => {
          const tIdx = [a,b,c][idx];
          const weight = Math.max(0, baryCoords[idx]);
          const alpha = 0.3 + weight * 0.55;
          ctx.beginPath();
          ctx.moveTo(t.x, t.y);
          ctx.lineTo(u.x, u.y);
          ctx.strokeStyle = TOWER_COLORS[tIdx] + Math.round(alpha * 255).toString(16).padStart(2,"0");
          ctx.lineWidth = 1 + weight * 2.5;
          ctx.stroke();
        });

        // Barycentric weight labels on edges
        [ta, tb, tc].forEach((t, idx) => {
          const weight = Math.max(0, baryCoords[idx]);
          const mx = (t.x + u.x) / 2;
          const my = (t.y + u.y) / 2;
          ctx.fillStyle = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";
          ctx.font = "9px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(weight.toFixed(2), mx, my);
        });
        ctx.textAlign = "start";
      }

      // ── Draw towers ─────────────────────────────────────────────────────
      const activeSet = curTri >= 0
        ? new Set(allTris[curTri] as unknown as number[])
        : new Set<number>();

      TOWERS.forEach((t, i) => {
        const isActive = activeSet.has(i);
        const col = TOWER_COLORS[i];

        // Outer ring for active
        if (isActive) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = col + "55";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(t.x, t.y, isActive ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? col : (isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)");
        ctx.fill();

        // Tower label
        ctx.fillStyle = isDark ? `rgba(255,255,255,${isActive ? 0.8 : 0.35})` : `rgba(0,0,0,${isActive ? 0.75 : 0.3})`;
        ctx.font = `${isActive ? "bold " : ""}10px Inter, sans-serif`;
        ctx.fillText(`T${i+1}`, t.x + 10, t.y + 4);
      });

      // ── Draw user dot ───────────────────────────────────────────────────
      // Outer glow
      ctx.beginPath();
      ctx.arc(u.x, u.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(u.x, u.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? `rgba(255,255,255,${fgAlpha})` : `rgba(0,0,0,${fgAlpha})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(u.x, u.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
      ctx.font = "9px Inter, sans-serif";
      ctx.fillText("UE", u.x + 10, u.y + 4);

      rafRef.current = requestAnimationFrame(draw);
    }

    // Seed wander
    pickWanderTarget(canvas.width, canvas.height);
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Pointer interaction ───────────────────────────────────────────────────
  function canvasPos(e: React.PointerEvent): V2 {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvasRef.current!.height / rect.height),
    };
  }

  return (
    <canvas
      ref={canvasRef}
      width={660}
      height={440}
      className="w-full rounded border border-border bg-muted/30 touch-none cursor-crosshair"
      onPointerDown={e => {
        isDragging.current = true;
        userRef.current = canvasPos(e);
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (isDragging.current) userRef.current = canvasPos(e);
      }}
      onPointerUp={e => {
        isDragging.current = false;
        // Set new wander target near where they dropped
        wanderTarget.current = canvasPos(e);
        wanderTimer.current = 60;
      }}
      onPointerCancel={() => { isDragging.current = false; }}
    />
  );
}

// ── Antenna aperture visualizer ──────────────────────────────────────────────
function AntennaApertureCanvas({ apertureD }: { apertureD: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    function draw() {
      const isDark = document.documentElement.classList.contains("dark");
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const cx = 80, cy = h / 2;
      const lambda = 30;
      const D = apertureD;
      const halfBW = lambda / D;

      ctx.fillStyle = isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)";
      ctx.fillRect(cx - 4, cy - D / 2, 8, D);
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText(`D = ${Math.round(D)}`, cx - 16, cy + D / 2 + 16);

      const maxR = w - cx - 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, -halfBW, halfBW);
      ctx.closePath();
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      grad.addColorStop(0, isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)");
      grad.addColorStop(1, "rgba(128,128,128,0)");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const sideAng = halfBW * 2.8;
        ctx.arc(cx, cy, maxR * 0.35, sign*(sideAng-halfBW*0.8), sign*(sideAng+halfBW*0.8));
        ctx.closePath();
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
        ctx.fill();
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+(w-cx-10)*Math.cos(-halfBW), cy+(w-cx-10)*Math.sin(-halfBW)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+(w-cx-10)*Math.cos(halfBW),  cy+(w-cx-10)*Math.sin(halfBW));  ctx.stroke();
      ctx.restore();

      ctx.fillStyle = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(`HPBW ≈ ${(halfBW*2*180/Math.PI).toFixed(1)}°`, cx+20, cy - D/2 - 12);

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [apertureD]);

  return <canvas ref={canvasRef} width={560} height={260} className="w-full rounded border border-border bg-muted/30" />;
}

// ── Main export ───────────────────────────────────────────────────────────────
export function Aperture() {
  const [tab, setTab] = useState<"cell" | "antenna">("cell");
  const [apertureD, setApertureD] = useState(80);

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-foreground">Aperture</h2>

      <p className="text-muted-foreground leading-relaxed">
        Aperture describes the <em>geometric zone</em> an endpoint owns — the bounded region of space
        it is responsible for covering. Rather than broadcasting uniformly in all directions, a
        well-designed network carves the field into non-overlapping geometric zones and assigns each
        one to the endpoint best positioned to serve it. Coverage then becomes a tiling problem:
        define the zones, hold them stable as targets move, and hand off cleanly at boundaries.
        The same concept applies from a single antenna element up to a city-scale base-station mesh.
      </p>

      <div className="flex gap-2 border-b border-border">
        {([
          ["cell",    "Spatial / Cell Aperture"],
          ["antenna", "Antenna Aperture (Tx/Rx)"],
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

      {tab === "cell" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5 space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Coverage Mesh with Barycentric Handoff</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Each Delaunay triangle in the mesh is a <em>geometric zone</em> — a defined region of
              space owned by its three corner towers. When the user enters a zone, those towers become
              the active aperture and collectively point their beams at the target. Line weight shows
              each tower's barycentric share: the numerically dominant tower carries the most signal.
              A hysteresis margin keeps the zone stable when the user hovers near an edge, preventing
              thrash between adjacent zones. Drag the dot or let it wander.
            </p>
            <SpatialApertureCanvas />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Barycentric Handoff & Hysteresis</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A naive nearest-tower assignment causes rapid ping-pong when a user sits on a
                Voronoi boundary. Barycentric hysteresis holds the current triangle active until
                the user is clearly outside by a margin ε — trading a small coverage overlap
                for dramatically fewer handoffs. The same principle governs LTE A3 event
                thresholds and 5G NR conditional handover.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Delaunay Tessellation as Coverage Geometry</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Delaunay triangulation maximises the minimum angle of all triangles, which in
                coverage terms means no tower is "squeezed out" of a triangle by two closer
                neighbours. This makes it a natural choice for distributed aperture assignment:
                every point in the field is covered by exactly three towers, balancing load
                and link budget.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Sectorised vs Omni Apertures</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                An omni tower covers its full Voronoi cell with equal gain in all directions.
                A sectorised tower splits its aperture into wedges (typically 3 × 120°), concentrating
                gain in each direction. This narrows the spatial aperture per sector, reducing
                inter-cell interference and allowing tighter frequency reuse across the mesh.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Coordinated Multipoint (CoMP)</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                LTE/5G CoMP explicitly uses the Delaunay-triangle intuition: multiple towers jointly
                serve a UE at a cell edge, combining signals coherently (JT-CoMP) or coordinating
                to suppress interference (CS/CB-CoMP). The active aperture set is chosen by the
                network based on reference-signal measurements — a real-time barycentric weighting.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Fresnel Zones</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A Fresnel zone is the ellipsoidal geometric zone around a line-of-sight path within
                which reflections and diffractions arrive within half a wavelength of the direct
                signal — close enough to add constructively. The first Fresnel zone radius at the
                midpoint is <code className="text-foreground text-xs">r₁ = √(λd/2)</code> (d = link
                distance). Obstructions inside this zone degrade the link even when the geometric
                line-of-sight is clear; a tower's effective spatial aperture must keep the first
                Fresnel zone unobstructed to maintain its rated link budget.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "antenna" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Physical Aperture & Beamwidth</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The physical aperture of an antenna element — its effective capture area — directly
              controls how narrowly it can target a region of space. A wider aperture concentrates
              the same total radiated power into a tighter beam, increasing gain in the target
              direction while reducing energy wasted on uncovered areas. This is the per-element
              analogue of the spatial partitioning the mesh above performs at network scale.
              HPBW ≈ λ/D radians; drag the slider.
            </p>
            <div className="flex items-center gap-4">
              <label className="text-sm text-muted-foreground whitespace-nowrap font-mono">D = {apertureD}</label>
              <input type="range" min={20} max={200} step={4} value={apertureD}
                onChange={e => setApertureD(Number(e.target.value))}
                className="w-48 accent-foreground" />
            </div>
            <AntennaApertureCanvas apertureD={apertureD} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Gain, Aperture & Coverage Trade-off</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                <code className="text-foreground text-xs">G = 4π · A_eff / λ²</code><br />
                Doubling aperture diameter quadruples gain (+6 dB) but halves the angular coverage.
                A system that needs to cover a wide spatial aperture with high gain must either use
                a large physical aperture, an array, or active beam steering — each is a different
                solution to the same aperture-versus-coverage tension.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Phased Arrays: Programmable Aperture</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A phased array steers its aperture electronically, dynamically pointing its narrow
                beam at whichever spatial region contains the target — the antenna-level equivalent
                of the mesh reassigning active towers as a user moves. The projected aperture
                decreases as ∝ cos θ off boresight, widening the beam at steep scan angles.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Friis & the Link Budget</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                <code className="text-foreground text-xs">P_r = P_t · G_t · G_r · (λ/4πd)²</code><br />
                Both Tx and Rx apertures appear symmetrically. A large receive dish can compensate
                for a small transmit antenna — the spatial coverage problem is bilateral, and
                aperture at either end improves the link.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2">Side Lobes & Spatial Leakage</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Any finite aperture leaks energy into side lobes — spatial aliases of the main beam.
                In a coverage network, side lobes are interference: they illuminate towers or users
                outside the intended aperture region. Tapering (Hann, Taylor weighting) trades
                peak gain for lower side-lobe levels, tightening spatial containment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
