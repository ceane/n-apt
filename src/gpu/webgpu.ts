export type WebGPUContext = {
  device: GPUDevice
  format: GPUTextureFormat
}

let devicePromise: Promise<GPUDevice | null> | null = null

export function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator
}

export async function getWebGPUDevice(): Promise<GPUDevice | null> {
  if (!isWebGPUSupported()) {
    return null
  }
  if (!devicePromise) {
    devicePromise = (async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) {
          return null
        }
        const device = await adapter.requestDevice()
        return device
      } catch (error) {
        return null
      }
    })()
  }
  return devicePromise
}

export function getPreferredCanvasFormat(): GPUTextureFormat {
  return navigator.gpu.getPreferredCanvasFormat()
}

export function configureWebGPUCanvas(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  format: GPUTextureFormat,
  width: number,
  height: number,
  dpr: number,
  alphaMode: GPUCanvasAlphaMode = "premultiplied",
): GPUCanvasContext {
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext("webgpu")
  if (!ctx) {
    throw new Error("WebGPU context not available")
  }
  ctx.configure({
    device,
    format,
    alphaMode,
  })
  return ctx
}

export function parseCssColorToRgba(color: string): [number, number, number, number] {
  const trimmed = color.trim()
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1)
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      return [r / 255, g / 255, b / 255, 1]
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      return [r / 255, g / 255, b / 255, 1]
    }
  }

  const rgbaMatch = trimmed.match(/rgba?\(([^)]+)\)/i)
  if (rgbaMatch) {
    const parts = rgbaMatch[1]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    const r = Number(parts[0] ?? 0)
    const g = Number(parts[1] ?? 0)
    const b = Number(parts[2] ?? 0)
    const a = parts.length > 3 ? Number(parts[3]) : 1
    return [r / 255, g / 255, b / 255, Math.max(0, Math.min(1, a))]
  }

  return [0, 0, 0, 1]
}

export function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}
