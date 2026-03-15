/**
 * WebGPU Utility Functions
 */

/**
 * Configure a canvas for WebGPU rendering
 */
export function configureWebGPUCanvas(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  format: GPUTextureFormat,
  alphaMode: GPUCanvasAlphaMode = "premultiplied",
): GPUCanvasContext {
  const ctx = canvas.getContext("webgpu");
  if (!ctx) {
    throw new Error("WebGPU context not available");
  }
  ctx.configure({
    device,
    format,
    alphaMode,
  });
  return ctx;
}

/**
 * Parse a CSS color string into an RGBA array normalized to [0, 1]
 */
export function parseCssColorToRgba(color: string): [number, number, number, number] {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r / 255, g / 255, b / 255, 1];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r / 255, g / 255, b / 255, 1];
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return [r / 255, g / 255, b / 255, a / 255];
    }
  }

  const rgbaMatch = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    const r = Number(parts[0] ?? 0);
    const g = Number(parts[1] ?? 0);
    const b = Number(parts[2] ?? 0);
    const a = parts.length > 3 ? Number(parts[3]) : 1;
    return [r / 255, g / 255, b / 255, Math.max(0, Math.min(1, a))];
  }

  return [0, 0, 0, 1];
}
