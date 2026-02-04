/**
 * Constants for UI components
 * General styling and configuration values
 */

// Brain component constants
export const BRAIN_POSITION = [0.144, 1.17, 0.25] as const
export const BRAIN_SCALE = [0.45, 0.45, 0.45] as const

// DrawMockNAPT constants
export const DEFAULT_SPIKE_COUNT = 150
export const DEFAULT_SPIKE_WIDTH = 0.5
export const DEFAULT_CENTER_SPIKE_BOOST = 2.5
export const DEFAULT_FLOOR_AMPLITUDE = 1
export const DEFAULT_DECAY_RATE = 0.5
export const DEFAULT_BASELINE_MODULATION = 0
export const DEFAULT_ENVELOPE_WIDTH = 10.0
export const DEFAULT_NUM_POINTS = 1000

// Frequency range constants
export const DEFAULT_MIN_FREQ = 0
export const DEFAULT_MAX_FREQ = 4.75
export const DEFAULT_VISIBLE_MIN = 0
export const DEFAULT_VISIBLE_MAX = 3.2
export const NAPT_FREQUENCY_RANGE = 3.2 // MHz

// FrequencyRangeSlider constants
export const STEP_SIZE = 0.033
export const SLIDER_WRAPPER_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginBottom: "16px",
  userSelect: "none",
} as const

// HotspotEditor constants
export const HOTSPOT_SIZE_LARGE = 0.08
export const HOTSPOT_SIZE_SMALL = 0.02
export const HOTSPOT_COLOR_LARGE = "#00d4ff"
export const HOTSPOT_COLOR_SMALL = "#ffaa00"
export const HOTSPOT_COLOR_SELECTED = "#ffffff"
export const HOTSPOT_COLOR_MULTISELECT = "#ff6b6b"
export const HOTSPOT_MESH_NAME = "o_ADBody"
export const HOTSPOT_EDIT_SPHERE_SIZE = 0.02
export const HOTSPOT_EDIT_BUTTON_SIZE = 0.04
export const HOTSPOT_EDIT_PLANE_SIZE = [0.3, 0.1, 0.01] as const
export const HOTSPOT_CONTROL_PANEL_WIDTH = 300
export const HOTSPOT_CONTROL_PANEL_PADDING = 20

// HumanModelViewer constants
export const MODEL_CAMERA_POSITION = [0, 0, 5] as const
export const MODEL_FOV = 75
export const SPHERE_GEOMETRY_SEGMENTS = 16
export const SPHERE_MARKER_COLOR = "#00ffff"
export const SPHERE_MARKER_BASE_INTENSITY = 0.8
export const CONTROL_PANEL_WIDTH = "200px"

// InfoPopover constants
export const POPOVER_WIDTH = 280
export const POPOVER_PADDING = 16
export const INFO_ICON_SIZE = 16
export const POPOVER_Z_INDEX = 9999
export const POPOVER_ICON_BACKGROUND = "#2a2a2a"
export const POPOVER_ICON_BORDER = "#3a3a2a"
export const POPOVER_ICON_COLOR = "#666"
export const POPOVER_ICON_HOVER_BACKGROUND = "#00d4ff"
export const POPOVER_ICON_HOVER_COLOR = "#000"
export const POPOVER_BACKGROUND = "#1a1a1a"
export const POPOVER_BORDER = "#2a2a2a"
export const POPOVER_TITLE_COLOR = "#ccc"
export const POPOVER_TEXT_COLOR = "#888"

// Sidebar constants
export const SIDEBAR_WIDTH = 360
export const SIDEBAR_MIN_WIDTH = 360
export const SIDEBAR_PADDING = 24
export const CONNECTION_STATUS_FLEX = "0 0 70%"
export const PAUSE_BUTTON_FLEX = "0 0 25%"
export const DEFAULT_FFT_SIZE = 103432
export const DEFAULT_FFT_WINDOW = "Rectangular"
export const DEFAULT_FFT_FRAME_RATE = 60
export const FILE_INPUT_ACCEPT = ".c64"

// FFTCanvas constants
export const VISUALIZER_PADDING = 20
export const VISUALIZER_GAP = 20
// Reuse FFT dB constants for consistency
export {
  FFT_MIN_DB as WATERFALL_HISTORY_LIMIT,
  FFT_MAX_DB as WATERFALL_HISTORY_MAX,
} from "./fft"
export const SECTION_TITLE_COLOR = "#555"
export const SECTION_TITLE_AFTER_COLOR = "#444"
export const CANVAS_BORDER_COLOR = "#222"

// FrequencyRangeSlider additional constants
export const RANGE_TRACK_HEIGHT = 32
export const RANGE_TRACK_BACKGROUND = "#0f0f0f"
export const RANGE_TRACK_BORDER = "#1a1a1a"
export const RANGE_LABELS_COLOR = "#444"
export const RANGE_LABELS_PADDING = "0 12px"
export const RANGE_LABELS_FONT_SIZE = "9px"

// FFTStitcherCanvas constants
export const STITCHER_BUTTON_STYLE = {
  flex: 1,
  padding: "12px",
  backgroundColor: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: "8px",
  color: "#ccc",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "12px",
  fontWeight: "500",
  cursor: "pointer",
  textAlign: "center",
} as const

// Common color constants
export const COLORS = {
  primary: "#00d4ff",
  secondary: "#ffaa00",
  success: "#00ff00",
  warning: "#ffaa00",
  danger: "#ff4444",
  background: "#0a0a0a",
  surface: "#1a1a1a",
  surfaceHover: "#2a2a2a",
  border: "#1a1a1a",
  borderHover: "#2a2a2a",
  textPrimary: "#ccc",
  textSecondary: "#888",
  textMuted: "#666",
  textDisabled: "#444",
  activeBackground: "rgba(0, 212, 255, 0.15)",
  inactiveBackground: "rgba(128, 128, 128, 0.15)",
} as const

// Common font constants
export const FONTS = {
  mono: "'JetBrains Mono', monospace",
  sans: "system-ui, -apple-system, sans-serif",
} as const

// Common spacing constants
export const SPACING = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  xxl: "24px",
} as const
