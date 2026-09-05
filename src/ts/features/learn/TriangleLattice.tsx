// @ts-nocheck
import { useEffect, useRef } from "react";

// Bowyer-Watson Delaunay triangulation
type Point = { x: number; y: number; vx: number; vy: number };
type Triangle = [number, number, number]; // indices into points array

function circumcircle(pts: Point[], i: number, j: number, k: number) {
  const ax = pts[i].x, ay = pts[i].y;
  const bx = pts[j].x, by = pts[j].y;
  const cx = pts[k].x, cy = pts[k].y;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  const r2 = (ax - ux) ** 2 + (ay - uy) ** 2;
  return { x: ux, y: uy, r2 };
}

function delaunay(pts: Point[]): Triangle[] {
  const n = pts.length;
  if (n < 3) return [];

  // Super triangle
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX, dy = maxY - minY;
  const delta = Math.max(dx, dy) * 10;
  const superPts: Point[] = [
    ...pts,
    { x: minX - delta, y: minY - delta, vx: 0, vy: 0 },
    { x: minX + dx / 2, y: maxY + delta, vx: 0, vy: 0 },
    { x: maxX + delta, y: minY - delta, vx: 0, vy: 0 },
  ];
  const si = n, sj = n + 1, sk = n + 2;

  let triangles: Triangle[] = [[si, sj, sk]];

  for (let p = 0; p < n; p++) {
    const edges: [number, number][] = [];
    const good: Triangle[] = [];

    for (const tri of triangles) {
      const cc = circumcircle(superPts, tri[0], tri[1], tri[2]);
      if (!cc) { good.push(tri); continue; }
      const dx = superPts[p].x - cc.x;
      const dy = superPts[p].y - cc.y;
      if (dx * dx + dy * dy < cc.r2) {
        edges.push([tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]);
      } else {
        good.push(tri);
      }
    }

    // Remove duplicate edges (shared edges)
    const boundary: [number, number][] = [];
    for (let e1 = 0; e1 < edges.length; e1++) {
      let unique = true;
      for (let e2 = 0; e2 < edges.length; e2++) {
        if (e1 !== e2 &&
          ((edges[e1][0] === edges[e2][0] && edges[e1][1] === edges[e2][1]) ||
           (edges[e1][0] === edges[e2][1] && edges[e1][1] === edges[e2][0]))) {
          unique = false;
          break;
        }
      }
      if (unique) boundary.push(edges[e1]);
    }

    for (const [a, b] of boundary) {
      good.push([a, b, p]);
    }

    triangles = good;
  }

  // Remove triangles that share a vertex with super triangle
  return triangles.filter(([a, b, c]) => a < n && b < n && c < n);
}

export function TriangleLattice() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const ptsRef = useRef<Point[]>([]);
  const triRef = useRef<Triangle[]>([]);
  const lastTriRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      init();
    }

    function init() {
      const w = canvas.width;
      const h = canvas.height;
      const count = Math.floor((w * h) / 14000);
      const pts: Point[] = [];

      // Grid-jittered distribution for better triangulation
      const cols = Math.ceil(Math.sqrt(count * (w / h)));
      const rows = Math.ceil(Math.sqrt(count * (h / w)));
      const cellW = w / cols;
      const cellH = h / rows;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          pts.push({
            x: (c + 0.1 + Math.random() * 0.8) * cellW,
            y: (r + 0.1 + Math.random() * 0.8) * cellH,
            vx: (Math.random() - 0.5) * 0.15,
            vy: (Math.random() - 0.5) * 0.15,
          });
        }
      }

      ptsRef.current = pts;
      triRef.current = delaunay(pts);
      lastTriRef.current = 0;
    }

    function draw() {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const isDark = document.documentElement.classList.contains("dark");

      // Move points
      const pts = ptsRef.current;
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        p.x = Math.max(0, Math.min(w, p.x));
        p.y = Math.max(0, Math.min(h, p.y));
      }

      // Re-triangulate every ~90 frames
      lastTriRef.current++;
      if (lastTriRef.current > 90) {
        triRef.current = delaunay(pts);
        lastTriRef.current = 0;
      }

      ctx.clearRect(0, 0, w, h);

      const baseAlpha = isDark ? 0.06 : 0.07;
      ctx.strokeStyle = isDark
        ? `rgba(255,255,255,${baseAlpha})`
        : `rgba(0,0,0,${baseAlpha})`;
      ctx.lineWidth = 0.8;

      for (const [a, b, c] of triRef.current) {
        ctx.beginPath();
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
        ctx.lineTo(pts[c].x, pts[c].y);
        ctx.closePath();
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
