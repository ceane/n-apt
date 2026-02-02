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
  /** Array of waterfall line data (ImageData) */
  waterfallData: ImageData[]
  /** Frequency range to display */
  frequencyRange: FrequencyRange
  /** Minimum dB level for waterfall display (default: -80) */
  waterfallMin?: number
  /** Maximum dB level for waterfall display (default: 20) */
  waterfallMax?: number
}

import { 
  DEFAULT_COLOR_MAP,
  WATERFALL_GRID_COLOR,
  WATERFALL_TEXT_COLOR,
  WATERFALL_MIN_DB,
  WATERFALL_MAX_DB,
  WATERFALL_FREQUENCY_RANGES,
  WF_MIN,
  WATERFALL_CANVAS_BG,
  WATERFALL_FONT_FAMILY,
  WATERFALL_FONT_SIZE,
  formatFrequency as formatFreq,
  findBestFrequencyRange as findBestRange
} from '../consts'


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
 * Draws waterfall display with SDR++ style color mapping
 * @param options - Rendering options including canvas context, dimensions, and data
 */
export function drawWaterfall(options: WaterfallRenderOptions): void {
  const { ctx, width, height, waterfallData, frequencyRange, waterfallMin = WATERFALL_MIN_DB, waterfallMax = WATERFALL_MAX_DB } = options

  // Clear waterfall canvas
  ctx.fillStyle = WATERFALL_CANVAS_BG
  ctx.fillRect(0, 0, width, height)

  if (waterfallData.length === 0) {
    return
  }

  const dpr = window.devicePixelRatio || 1
  const scaledWfMin = { x: Math.round(40 * dpr), y: Math.round(20 * dpr) }
  const scaledWfMax = { x: width - Math.round(40 * dpr), y: height - Math.round(20 * dpr) }
  const waterfallHeight = scaledWfMax.y - scaledWfMin.y

  // Draw waterfall lines
  waterfallData.forEach((lineData, index) => {
    if (index < waterfallHeight) {
      ctx.putImageData(lineData, scaledWfMin.x, scaledWfMax.y - index - 1)
    }
  })

  // Draw frequency grid on top
  const minFreq = frequencyRange?.min ?? 0
  const maxFreq = frequencyRange?.max ?? 3.2
  const viewBandwidth = maxFreq - minFreq
  const range = findBestRange(viewBandwidth, 10)
  const lowerFreq = Math.ceil(minFreq / range) * range
  const upperFreq = maxFreq

  ctx.strokeStyle = WATERFALL_GRID_COLOR
  ctx.fillStyle = WATERFALL_TEXT_COLOR
  ctx.font = `${WATERFALL_FONT_SIZE} ${WATERFALL_FONT_FAMILY}`
  ctx.textAlign = 'center'

  for (let freq = lowerFreq; freq < upperFreq; freq += range) {
    const xPos = scaledWfMin.x + ((freq - minFreq) / viewBandwidth) * (scaledWfMax.x - scaledWfMin.x)
    
    ctx.beginPath()
    ctx.moveTo(Math.round(xPos), scaledWfMin.y)
    ctx.lineTo(Math.round(xPos), scaledWfMax.y)
    ctx.stroke()
  }
}

/**
 * Creates a single waterfall line from spectrum data
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
