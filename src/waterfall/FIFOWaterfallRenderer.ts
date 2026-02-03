/**
 * FIFOWaterfallRenderer.ts
 * 
 * This is the waterfall canvas functionality, it is supposed
 * to be static (meaning it doesn't shift left or right like
 * the FFT canvas) and it operates first-in-first-out (FIFO),
 * meaning the oldest data is at the bottom and the newest data
 * is at the top.
 * 
 */

/**
 * Frequency range configuration for spectrum and waterfall displays
 */
export interface FrequencyRange {
  /** Minimum frequency in MHz */
  min: number
  /** Maximum frequency in MHz */
  max: number
}

/**
 * Rendering options for waterfall display
 */
export interface WaterfallRenderOptions {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D
  /** Canvas width in pixels */
  width: number
  /** Canvas height in pixels */
  height: number
  /** RGBA buffer for waterfall data */
  waterfallBuffer: Uint8ClampedArray
  /** Frequency range to display */
  frequencyRange: FrequencyRange
  /** Minimum dB level for waterfall display (default: -80) */
  waterfallMin?: number
  /** Maximum dB level for waterfall display (default: 20) */
  waterfallMax?: number
  /** Drift amount for horizontal smear (default: 0) */
  driftAmount?: number
  /** Drift direction: 1 = right, -1 = left (default: 1) */
  driftDirection?: number
}

import { 
  DEFAULT_COLOR_MAP,
  WATERFALL_MIN_DB,
  WATERFALL_MAX_DB,
  WATERFALL_CANVAS_BG
} from '@n-apt/consts'


/**
 * Converts dB value to RGB color using SDR++ color palette
 * @param db - dB value to convert
 * @param minDb - Minimum dB value for color mapping
 * @param maxDb - Maximum dB value for color mapping
 * @returns RGB color tuple [r, g, b]
 */
function dbToColor(db: number, minDb: number, maxDb: number): [number, number, number] {
  const normalized = (db - minDb) / (maxDb - minDb)
  const index = Math.max(0, Math.min(DEFAULT_COLOR_MAP.length - 1, normalized * (DEFAULT_COLOR_MAP.length - 1)))
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.min(DEFAULT_COLOR_MAP.length - 1, lowerIndex + 1)
  const fraction = index - lowerIndex
  
  const lower = DEFAULT_COLOR_MAP[lowerIndex]
  const upper = DEFAULT_COLOR_MAP[upperIndex]
  
  return [
    lower[0] + (upper[0] - lower[0]) * fraction,
    lower[1] + (upper[1] - lower[1]) * fraction,
    lower[2] + (upper[2] - lower[2]) * fraction
  ]
}

/**
 * Draws waterfall display with SDR++ style color mapping using RGBA buffer
 * @param options - Rendering options including canvas context, dimensions, and buffer
 */
export function drawWaterfall(options: WaterfallRenderOptions): void {
  const { ctx, width, height, waterfallBuffer, frequencyRange, waterfallMin = WATERFALL_MIN_DB, waterfallMax = WATERFALL_MAX_DB } = options

  // Calculate centered position
  const dpr = window.devicePixelRatio || 1
  const marginX = Math.round(40 * dpr)
  const marginY = Math.round(20 * dpr)
  
  // Calculate the actual waterfall display area
  const waterfallWidth = Math.max(1, Math.round(width - marginX * 2))
  const waterfallHeight = Math.max(1, Math.round(height - marginY * 2))
  
  // Center the waterfall horizontally
  const centeredX = Math.round((width - waterfallWidth) / 2)
  const centeredY = marginY

  // Clear canvas with background
  ctx.fillStyle = WATERFALL_CANVAS_BG
  ctx.fillRect(0, 0, width, height)

  // Draw updated buffer to canvas at centered position
  const imageData = new ImageData(waterfallBuffer, waterfallWidth, waterfallHeight)
  ctx.putImageData(imageData, centeredX, centeredY)
}

/**
 * Updates waterfall buffer with new FFT frame data
 * @param waterfallBuffer - RGBA buffer to update
 * @param fftFrame - New FFT frame data (normalized 0-1)
 * @param width - Buffer width in pixels
 * @param height - Buffer height in pixels
 * @param driftAmount - Amount of horizontal drift (0-3)
 * @param driftDirection - Direction of drift: 1 = right, -1 = left
 */
export function addWaterfallFrame(
  waterfallBuffer: Uint8ClampedArray,
  fftFrame: number[],
  width: number,
  height: number,
  driftAmount: number = 0,
  driftDirection: number = 1
): void {
  // 1️⃣ Shift all old pixels down by 1 row (FIFO)
  for (let y = height - 1; y > 0; y--) {
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4
      const src = ((y - 1) * width + x) * 4
      waterfallBuffer[dst] = waterfallBuffer[src]
      waterfallBuffer[dst + 1] = waterfallBuffer[src + 1]
      waterfallBuffer[dst + 2] = waterfallBuffer[src + 2]
      waterfallBuffer[dst + 3] = 255
    }
  }

  // 2️⃣ Insert new FFT frame at top row
  for (let x = 0; x < width; x++) {
    const amplitude = Math.min(fftFrame[x] || 0, 1) // normalize
    const color = amplitude * 255

    // Apply drift as horizontal smear
    for (let dx = 0; dx <= driftAmount; dx++) {
      const xi = Math.min(width - 1, x + dx * driftDirection)
      const i = xi * 4
      waterfallBuffer[i] = color      // R
      waterfallBuffer[i + 1] = color    // G
      waterfallBuffer[i + 2] = color    // B
      waterfallBuffer[i + 3] = 255      // alpha
    }
  }
}

/**
 * Creates a single waterfall line from spectrum data (legacy compatibility)
 * @param spectrum - Power spectrum data array in dB
 * @param width - Width of the waterfall line in pixels
 * @param minDb - Minimum dB level for color mapping
 * @param maxDb - Maximum dB level for color mapping
 * @returns ImageData object containing the waterfall line
 */
export function createWaterfallLine(spectrum: number[], width: number, minDb: number, maxDb: number): ImageData {
  const imageData = new ImageData(width, 1)
  const data = imageData.data

  for (let i = 0; i < spectrum.length && i < width; i++) {
    const [r, g, b] = dbToColor(spectrum[i], minDb, maxDb)
    const pixelIndex = i * 4
    data[pixelIndex] = r
    data[pixelIndex + 1] = g
    data[pixelIndex + 2] = b
    data[pixelIndex + 3] = 255
  }

  return imageData
}

/**
 * Converts dB spectrum to normalized amplitude (0-1)
 * @param spectrum - Power spectrum data array in dB
 * @param minDb - Minimum dB level for normalization
 * @param maxDb - Maximum dB level for normalization
 * @returns Normalized amplitude array
 */
export function spectrumToAmplitude(spectrum: number[], minDb: number, maxDb: number): number[] {
  return spectrum.map(db => {
    const normalized = (db - minDb) / (maxDb - minDb)
    return Math.max(0, Math.min(1, normalized))
  })
}
