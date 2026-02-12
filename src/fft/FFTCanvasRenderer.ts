/*
 * FFTCanvasRenderer.ts
 *
 * FFT Canvas - Visualizes radio signals as frequency spectrum
 *
 * Raw signal (sine wave, one cycle):
 *
 *                  ⌄ peak
 *                 .--.
 *                /    \    /
 *                      \__/
 *                        ^
 *                        trough
 *
 * FFT output:   [3.2, 0.1, ...]  ← amplitude at each frequency
 *
 * Think of radio signals like music - they're made of many notes (frequencies)
 * playing at once. Fast Fourier Transform (FFT) is like a musical ear that
 * separates all the notes and tells you how loud each one is.
 *
 * FFT extracts the y-points (amplitude) of signal peaks and troughs
 * (ups and downs) for each frequency, transforming raw radio wave data into a
 * spectrum display showing signal strength at each frequency,
 * just like a music equalizer.
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
 * Rendering options for spectrum display
 */
export interface SpectrumRenderOptions {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D
  /** Canvas width in pixels */
  width: number
  /** Canvas height in pixels */
  height: number
  /** Power spectrum data array in dB */
  waveform: number[]
  /** Frequency range to display */
  frequencyRange: FrequencyRange
  /** Minimum dB level for spectrum display (default: -80) */
  fftMin?: number
  /** Maximum dB level for spectrum display (default: 20) */
  fftMax?: number
}

export interface SpectrumGridOptions {
  /** Canvas 2D rendering context */
  ctx: CanvasRenderingContext2D
  /** Canvas width in pixels */
  width: number
  /** Canvas height in pixels */
  height: number
  /** Frequency range to display */
  frequencyRange: FrequencyRange
  /** Minimum dB level for spectrum display (default: -80) */
  fftMin?: number
  /** Maximum dB level for spectrum display (default: 20) */
  fftMax?: number
  /** Whether to clear background before drawing (default: true) */
  clearBackground?: boolean
  /** If set, hide axis frequency labels whose pixel position is within this many px of the given x coordinate */
  skipFreqLabelsNearX?: number
}

export interface SpectrumMarkersOptions {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  frequencyRange: FrequencyRange
  centerFrequencyMHz: number
}

import {
  FFT_GRID_COLOR,
  LINE_COLOR,
  SHADOW_COLOR,
  FFT_TEXT_COLOR,
  FFT_MIN_DB,
  FFT_MAX_DB,
  VERTICAL_RANGE,
  FFT_AREA_MIN,
  FFT_CANVAS_BG,
  formatFrequency as formatFreq,
  findBestFrequencyRange as findBestRange,
} from "@n-apt/consts"

/**
 * Draws spectrum analyzer display with SDR++ style rendering
 * @param options - Rendering options including canvas context, dimensions, and data
 */
export function drawSpectrum(options: SpectrumRenderOptions): void {
  drawSpectrumGrid({
    ctx: options.ctx,
    width: options.width,
    height: options.height,
    frequencyRange: options.frequencyRange,
    fftMin: options.fftMin,
    fftMax: options.fftMax,
    clearBackground: true,
  })
  drawSpectrumTrace(options)
}

export function drawSpectrumGrid(options: SpectrumGridOptions): void {
  const {
    ctx,
    width,
    height,
    frequencyRange,
    fftMin = FFT_MIN_DB,
    fftMax = FFT_MAX_DB,
    clearBackground = true,
  } = options

  if (clearBackground) {
    ctx.fillStyle = FFT_CANVAS_BG
    ctx.fillRect(0, 0, width, height)
  }

  // SDR++ style layout constants
  const fftAreaMax = { x: width - 40, y: height - 40 }
  const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x

  // Calculate scaling factors (SDR++ style)
  const startLine = Math.floor(fftMax / VERTICAL_RANGE) * VERTICAL_RANGE
  const vertRange = fftMax - fftMin
  const scaleFactor = fftHeight / vertRange

  const minFreq = frequencyRange?.min ?? 0
  const maxFreq = frequencyRange?.max ?? 3.2
  const viewBandwidth = maxFreq - minFreq
  const range = findBestRange(viewBandwidth, 10)
  const lowerFreq = Math.ceil(minFreq / range) * range
  const upperFreq = maxFreq
  const freqToX = (freq: number) =>
    FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth

  // Draw vertical grid lines and labels (SDR++ style)
  ctx.strokeStyle = FFT_GRID_COLOR
  ctx.fillStyle = FFT_TEXT_COLOR
  ctx.font = "12px JetBrains Mono" // Smaller font
  ctx.textAlign = "right"

  // Add "0dB" marker at 0dB position
  const zeroDbY = fftAreaMax.y - (0 - fftMin) * scaleFactor
  ctx.fillText("0dB", FFT_AREA_MIN.x - 10, Math.round(zeroDbY + 3))

  for (let line = startLine; line > fftMin; line -= VERTICAL_RANGE) {
    // Skip 0dB line since we already draw "0dB" marker
    if (line === 0) continue

    const yPos = fftAreaMax.y - (line - fftMin) * scaleFactor
    ctx.beginPath()
    ctx.moveTo(FFT_AREA_MIN.x, Math.round(yPos))
    ctx.lineTo(fftAreaMax.x, Math.round(yPos))
    ctx.stroke()

    ctx.fillText(line.toString(), FFT_AREA_MIN.x - 10, Math.round(yPos + 3))
  }

  // Draw horizontal grid lines and frequency labels (SDR++ style)
  ctx.textAlign = "center"
  ctx.font = "12px JetBrains Mono" // Smaller font for frequency labels too

  for (let freq = lowerFreq; freq < upperFreq; freq += range) {
    const xPos = freqToX(freq)

    // Grid line - extend to full canvas height
    ctx.beginPath()
    ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y)
    ctx.lineTo(Math.round(xPos), fftAreaMax.y)
    ctx.stroke()

    // Frequency tick
    ctx.beginPath()
    ctx.moveTo(Math.round(xPos), fftAreaMax.y)
    ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7)
    ctx.stroke()

    // Frequency label — skip if too close to center-frequency overlay
    if (options.skipFreqLabelsNearX === undefined || Math.abs(xPos - options.skipFreqLabelsNearX) > 50) {
      ctx.fillText(formatFreq(freq), Math.round(xPos), fftAreaMax.y + 25)
    }
  }

  // Always draw an explicit right-edge max frequency tick/label
  // Only if it's not too close to the last grid label to prevent collision
  {
    const xPos = fftAreaMax.x
    const lastGridFreq = Math.floor((upperFreq - 1e-6) / range) * range
    const lastGridX = freqToX(lastGridFreq)
    const minDistance = 50 // Minimum pixels between labels to prevent collision

    if (xPos - lastGridX > minDistance) {
      const skipNear = options.skipFreqLabelsNearX
      const tooClose = skipNear !== undefined && Math.abs(xPos - skipNear) <= 50

      ctx.beginPath()
      ctx.moveTo(Math.round(xPos), FFT_AREA_MIN.y)
      ctx.lineTo(Math.round(xPos), fftAreaMax.y)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(Math.round(xPos), fftAreaMax.y)
      ctx.lineTo(Math.round(xPos), fftAreaMax.y + 7)
      ctx.stroke()

      if (!tooClose) {
        ctx.fillText(formatFreq(maxFreq), Math.round(xPos), fftAreaMax.y + 25)
      }
    }
  }

  // Draw axes
  ctx.strokeStyle = FFT_TEXT_COLOR
  ctx.lineWidth = 1.0

  // X-axis
  ctx.beginPath()
  ctx.moveTo(FFT_AREA_MIN.x, fftAreaMax.y)
  ctx.lineTo(fftAreaMax.x, fftAreaMax.y)
  ctx.stroke()

  // Y-axis
  ctx.beginPath()
  ctx.moveTo(FFT_AREA_MIN.x, FFT_AREA_MIN.y)
  ctx.lineTo(FFT_AREA_MIN.x, fftAreaMax.y - 1)
  ctx.stroke()
}

export function drawSpectrumTrace(options: SpectrumRenderOptions): void {
  const {
    ctx,
    width,
    height,
    waveform,
    fftMin = FFT_MIN_DB,
    fftMax = FFT_MAX_DB,
  } = options

  if (!waveform || !Array.isArray(waveform) || waveform.length === 0) {
    return
  }

  const fftAreaMax = { x: width - 40, y: height - 40 }
  const fftHeight = fftAreaMax.y - FFT_AREA_MIN.y
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x
  const dataWidth = waveform.length

  const vertRange = fftMax - fftMin
  const scaleFactor = fftHeight / vertRange

  const idxToX = (idx: number) => {
    if (dataWidth <= 1) return FFT_AREA_MIN.x
    return FFT_AREA_MIN.x + (idx / (dataWidth - 1)) * plotWidth
  }

  const clampY = (dbVal: number) => {
    const y = fftAreaMax.y - (dbVal - fftMin) * scaleFactor
    return Math.max(FFT_AREA_MIN.y + 1, Math.min(fftAreaMax.y, y))
  }

  // Draw fill: single path tracing the line, then closing along the bottom
  ctx.fillStyle = SHADOW_COLOR
  ctx.beginPath()
  ctx.moveTo(Math.round(idxToX(0)), fftAreaMax.y)
  for (let i = 0; i < dataWidth; i++) {
    ctx.lineTo(Math.round(idxToX(i)), Math.round(clampY(waveform[i])))
  }
  ctx.lineTo(Math.round(idxToX(dataWidth - 1)), fftAreaMax.y)
  ctx.closePath()
  ctx.fill()

  // Draw trace line on top
  ctx.strokeStyle = LINE_COLOR
  ctx.lineWidth = width < 700 ? 0.5 : 1.5
  ctx.lineJoin = "round"
  ctx.lineCap = "round"

  ctx.beginPath()
  for (let i = 0; i < dataWidth; i++) {
    const x = Math.round(idxToX(i))
    const y = Math.round(clampY(waveform[i]))
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

/**
 * Draws spectrum overlay markers: red limit lines with labels, yellow center line, center frequency label.
 * Should be called AFTER drawSpectrumGrid on the same 2D context.
 */
export function drawSpectrumMarkers(options: SpectrumMarkersOptions): void {
  const { ctx, width, height, frequencyRange, centerFrequencyMHz } = options

  const fftAreaMax = { x: width - 40, y: height - 40 }
  const plotWidth = fftAreaMax.x - FFT_AREA_MIN.x
  const minFreq = frequencyRange?.min ?? 0
  const maxFreq = frequencyRange?.max ?? 3.2
  const viewBandwidth = maxFreq - minFreq
  if (viewBandwidth <= 0) return

  const freqToX = (freq: number) =>
    FFT_AREA_MIN.x + ((freq - minFreq) / viewBandwidth) * plotWidth

  // --- Red limit markers ---
  const markers: { freq: number; label: string }[] = [
    { freq: 0.5, label: "500kHz / RTL-SDR v4 lower limit" },
    { freq: 28.8, label: "28.8MHz / Potential hardware spur" },
  ]

  for (const m of markers) {
    if (m.freq < minFreq || m.freq > maxFreq) continue
    const x = Math.round(freqToX(m.freq)) + 0.5

    ctx.save()
    ctx.strokeStyle = "rgba(220, 38, 38, 0.55)"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, FFT_AREA_MIN.y)
    ctx.lineTo(x, fftAreaMax.y)
    ctx.stroke()
    ctx.restore()

    // Top label
    ctx.save()
    ctx.font = "11px JetBrains Mono"
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    const tw = ctx.measureText(m.label).width
    const lx = Math.max(FFT_AREA_MIN.x + tw / 2 + 4, Math.min(fftAreaMax.x - tw / 2 - 4, x))
    ctx.fillStyle = "rgba(10, 10, 10, 0.75)"
    ctx.fillRect(lx - tw / 2 - 4, FFT_AREA_MIN.y + 4, tw + 8, 18)
    ctx.fillStyle = "#fca5a5"
    ctx.fillText(m.label, lx, FFT_AREA_MIN.y + 7)
    ctx.restore()
  }

  // --- Yellow center frequency line ---
  if (centerFrequencyMHz >= minFreq && centerFrequencyMHz <= maxFreq) {
    const cx = Math.round(freqToX(centerFrequencyMHz)) + 0.5
    ctx.save()
    ctx.strokeStyle = "rgba(234, 179, 8, 0.35)"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, FFT_AREA_MIN.y)
    ctx.lineTo(cx, fftAreaMax.y)
    ctx.stroke()
    ctx.restore()
  }

  // --- Center frequency label (bottom center, with background mask) ---
  const centerLabel =
    centerFrequencyMHz < 1
      ? `${Math.round(centerFrequencyMHz * 1000)} kHz`
      : `${centerFrequencyMHz.toFixed(3)} MHz`

  ctx.save()
  ctx.font = "12px JetBrains Mono"
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  const labelW = ctx.measureText(centerLabel).width
  const labelX = width / 2
  const labelY = fftAreaMax.y + 25
  // Background mask to cover axis labels underneath
  ctx.fillStyle = "rgba(10, 10, 10, 0.9)"
  ctx.fillRect(labelX - labelW / 2 - 6, labelY - 13, labelW + 12, 17)
  ctx.fillStyle = "#ffffff"
  ctx.fillText(centerLabel, labelX, labelY)
  ctx.restore()
}

/**
 * Applies zoom to FFT data (SDR++ style implementation)
 * @param input - Input FFT data array
 * @param offset - Starting offset for zoom
 * @param width - Width of zoomed region
 * @param outputSize - Size of output array
 * @returns Zoomed FFT data array
 */
export function zoomFFT(
  input: number[],
  offset: number,
  width: number,
  outputSize: number,
): number[] {
  if (offset < 0) offset = 0
  if (width > 524288) width = 524288

  const output: number[] = new Array(outputSize)
  const factor = width / outputSize
  const sFactor = Math.ceil(factor)

  let id = offset
  for (let i = 0; i < outputSize; i++) {
    let maxVal = -Infinity
    const sId = Math.floor(id)
    const uFactor =
      sId + sFactor > input.length
        ? sFactor - (sId + sFactor - input.length)
        : sFactor

    for (let j = 0; j < uFactor; j++) {
      if (input[sId + j] > maxVal) {
        maxVal = input[sId + j]
      }
    }
    output[i] = maxVal
    id += factor
  }

  return output
}
