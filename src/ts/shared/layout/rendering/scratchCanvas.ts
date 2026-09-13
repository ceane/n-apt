/**
 * Reusable scratch canvases for hot rendering paths.
 *
 * Snapshot recording rebuilds several full-size canvases on every animation
 * frame. Allocating them per frame dominates the frame budget and thrashes GC,
 * so callers that fully consume a canvas before the next frame borrow one from
 * a pool instead of creating a new element.
 *
 * Only use a pool when the borrowed canvas is drawn/encoded before the next
 * acquire of the same key. Anything that retains frames (for example building
 * an array of frames to encode later) must keep allocating.
 */
export class ScratchCanvasPool {
  private canvases = new Map<string, HTMLCanvasElement>();

  acquire(key: string, width: number, height: number): HTMLCanvasElement {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    let canvas = this.canvases.get(key);
    if (!canvas) {
      canvas = document.createElement("canvas");
      this.canvases.set(key, canvas);
    }

    const ctx = canvas.getContext("2d");
    if (canvas.width !== w || canvas.height !== h) {
      // Assigning a dimension also resets the backing store to transparent.
      canvas.width = w;
      canvas.height = h;
      if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }

    if (ctx) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.setLineDash([]);
    }

    return canvas;
  }

  dispose(): void {
    for (const canvas of this.canvases.values()) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.canvases.clear();
  }
}

/**
 * Acquire from `pool` when present, otherwise allocate a fresh canvas.
 */
export function acquireCanvas(
  pool: ScratchCanvasPool | null | undefined,
  key: string,
  width: number,
  height: number,
): HTMLCanvasElement {
  if (pool) return pool.acquire(key, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}
