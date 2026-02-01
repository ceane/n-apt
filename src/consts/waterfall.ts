/**
 * Constants for waterfall display rendering
 * SDR++ style color palette and display parameters
 */

export const DEFAULT_COLOR_MAP: number[][] = [
  [0x00, 0x00, 0x20],
  [0x00, 0x00, 0x30],
  [0x00, 0x00, 0x50],
  [0x00, 0x00, 0x91],
  [0x1E, 0x90, 0xFF],
  [0xFF, 0xFF, 0xFF],
  [0xFF, 0xFF, 0x00],
  [0xFE, 0x6D, 0x16],
  [0xFF, 0x00, 0x00],
  [0xC6, 0x00, 0x00],
  [0x9F, 0x00, 0x00],
  [0x75, 0x00, 0x00],
  [0x4A, 0x00, 0x00]
]

export const WATERFALL_GRID_COLOR = 'rgba(50, 50, 50, 255)'
export const WATERFALL_TEXT_COLOR = '#666'
export const WATERFALL_MIN_DB = -80
export const WATERFALL_MAX_DB = 20

// Frequency ranges for optimal grid display
export const WATERFALL_FREQUENCY_RANGES = [
  1.0, 2.0, 2.5, 5.0,
  10.0, 20.0, 25.0, 50.0,
  100.0, 200.0, 250.0, 500.0,
  1000.0, 2000.0, 2500.0, 5000.0,
  10000.0, 20000.0, 25000.0, 50000.0,
  100000.0, 200000.0, 250000.0, 500000.0,
  1000000.0, 2000000.0, 2500000.0, 5000000.0,
  10000000.0, 20000000.0, 25000000.0, 50000000.0
]

// Canvas layout constants
export const WF_MIN = { x: 40, y: 20 }
export const WATERFALL_CANVAS_BG = '#0a0a0a'
export const WATERFALL_FONT_FAMILY = 'JetBrains Mono'
export const WATERFALL_FONT_SIZE = '16px'
