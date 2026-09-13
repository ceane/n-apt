/**
 * Shared canvas bindings used when a parent component owns the waterfall
 * canvas elements rendered by FFTCanvas.
 */
export interface FFTCanvasWaterfallBindings {
  waterfallGpuCanvasNode: HTMLCanvasElement | null;
  waterfallOverlayCanvasNode: HTMLCanvasElement | null;
  setWaterfallGpuCanvasNode: (node: HTMLCanvasElement | null) => void;
  setWaterfallOverlayCanvasNode: (node: HTMLCanvasElement | null) => void;
}
