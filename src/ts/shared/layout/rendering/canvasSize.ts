/**
 * Backing-store sizing only: callers own their own DPR rounding (floor vs
 * round), CSS size sync, context transforms and logical clears. Assigning
 * canvas.width/height clears the drawing buffer, so the joint compare exists
 * to avoid clearing when nothing changed; per-dimension guards stay with
 * callers that must not reassign an unchanged dimension.
 */
export function resizeCanvasBackingStore(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): boolean {
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}
