/**
 * Canvas DPI scaling utilities for crisp rendering on high-DPI displays
 */

export interface CanvasDPISetup {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  devicePixelRatio: number;
  scale: number;
}

/**
 * Setup canvas for high-DPI rendering
 * @param canvas Canvas element to setup
 * @param width Logical width (CSS pixels)
 * @param height Logical height (CSS pixels)
 * @returns Setup object with scaled context
 */
export const setupCanvasForDPI = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasDPISetup => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context');
  }

  const devicePixelRatio = window.devicePixelRatio || 1;
  const scale = devicePixelRatio;

  // Set canvas size in physical pixels
  canvas.width = width * scale;
  canvas.height = height * scale;

  // Set canvas size in CSS pixels
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  // Scale the context to match device pixel ratio
  ctx.scale(scale, scale);

  return {
    canvas,
    ctx,
    devicePixelRatio,
    scale,
  };
};

/**
 * Get DPI-scaled font size
 * @param fontSize Base font size in CSS pixels
 * @param devicePixelRatio Device pixel ratio (defaults to window.devicePixelRatio)
 */
export const getDPIScaledFontSize = (
  fontSize: number,
  devicePixelRatio: number = window.devicePixelRatio || 1
): number => {
  return fontSize * devicePixelRatio;
};

/**
 * Scale coordinates for DPI
 * @param x X coordinate in CSS pixels
 * @param y Y coordinate in CSS pixels
 * @param devicePixelRatio Device pixel ratio
 */
export const scaleCoordinatesForDPI = (
  x: number,
  y: number,
  devicePixelRatio: number = window.devicePixelRatio || 1
): [number, number] => {
  return [x * devicePixelRatio, y * devicePixelRatio];
};

/**
 * Check if device has high-DPI display
 */
export const isHighDPI = (): boolean => {
  return (window.devicePixelRatio || 1) > 1;
};

/**
 * Get optimal text rendering settings for current DPI
 */
export const getOptimalTextRenderingSettings = (
  devicePixelRatio: number = window.devicePixelRatio || 1
) => {
  return {
    fontSmoothing: devicePixelRatio > 1 ? 'antialiased' as const : 'auto' as const,
    textRendering: devicePixelRatio > 1 ? 'optimizeLegibility' as const : 'auto' as const,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high' as const,
  };
};
