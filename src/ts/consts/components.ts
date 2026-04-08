/**
 * Constants for UI components
 * General styling and configuration values
 */

import { THEME_TOKENS } from "./theme";

// Export THEME_TOKENS for namespace compliance
export { THEME_TOKENS };

// Shared transform constants for the human model scene
export const MODEL_ROOT_POSITION = [0, 0.95, 0] as const;

// Brain component constants
export const BRAIN_POSITION = [0.07, 0.38, 0.14] as const;
export const BRAIN_SCALE = [0.22, 0.22, 0.22] as const;

// DrawMockNAPT constants
export const DEFAULT_SPIKE_COUNT = 150;
export const DEFAULT_SPIKE_WIDTH = 0.1;
export const DEFAULT_CENTER_SPIKE_BOOST = 2.5;
export const DEFAULT_FLOOR_AMPLITUDE = 1;
export const DEFAULT_DECAY_RATE = 0.5;
export const DEFAULT_BASELINE_MODULATION = 0;
export const DEFAULT_ENVELOPE_WIDTH = 10.0;
export const DEFAULT_NUM_POINTS = 1000;

// FrequencyRangeSlider constants
export const STEP_SIZE = 0.033;
export const SLIDER_WRAPPER_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginBottom: "16px",
  userSelect: "none",
} as const;

// HotspotEditor constants
export const HOTSPOT_SIZE_LARGE = 0.08;
export const HOTSPOT_SIZE_SMALL = 0.02;
export const HOTSPOT_COLOR_LARGE = THEME_TOKENS.colors.dark.hotspotLarge;
export const HOTSPOT_COLOR_SMALL = THEME_TOKENS.colors.dark.hotspotSmall;
export const HOTSPOT_COLOR_SELECTED = THEME_TOKENS.colors.dark.hotspotSelected;
export const HOTSPOT_COLOR_MULTISELECT = THEME_TOKENS.colors.dark.hotspotMultiselect;
export const HOTSPOT_MESH_NAME = "o_ADBody";
export const HOTSPOT_EDIT_SPHERE_SIZE = 0.02;
export const HOTSPOT_EDIT_BUTTON_SIZE = 0.04;
export const HOTSPOT_EDIT_PLANE_SIZE = [0.3, 0.1, 0.01] as const;
export const HOTSPOT_CONTROL_PANEL_WIDTH = THEME_TOKENS.layout.hotspotControlPanelWidth;
export const HOTSPOT_CONTROL_PANEL_PADDING = THEME_TOKENS.layout.hotspotControlPanelPadding;

// 3D Model lighting constants
export const MODEL_AMBIENT_LIGHT_INTENSITY = 1.1;
export const MODEL_KEY_LIGHT_INTENSITY = 3.2;
export const MODEL_KEY_LIGHT_POSITION = [2.5, 3.2, 4.5] as const;
export const MODEL_FILL_LIGHT_INTENSITY = 1.6;
export const MODEL_FILL_LIGHT_POSITION = [-3, 2.2, 3.5] as const;
export const MODEL_BACK_LIGHT_INTENSITY = 2.4;
export const MODEL_BACK_LIGHT_POSITION = [0, 2.8, -4.5] as const;

// Model3D constants
export const MODEL_CAMERA_POSITION = [0, 1.05, 3.6] as const;
export const MODEL_CAMERA_TARGET = [0, 0.95, 0] as const;
export const MODEL_FOV = 36;
export const SPHERE_GEOMETRY_SEGMENTS = 16;
export const SPHERE_MARKER_COLOR = THEME_TOKENS.colors.dark.sphereMarker;
export const SPHERE_MARKER_BASE_INTENSITY = 0.8;
export const CONTROL_PANEL_WIDTH = THEME_TOKENS.layout.controlPanelWidth;

// Tooltip constants
export const POPOVER_WIDTH = THEME_TOKENS.layout.tooltipWidth;
export const POPOVER_PADDING = THEME_TOKENS.layout.tooltipPadding;
export const INFO_ICON_SIZE = THEME_TOKENS.layout.infoIconSize;
export const POPOVER_Z_INDEX = THEME_TOKENS.layout.tooltipZIndex;
export const POPOVER_ICON_BACKGROUND = THEME_TOKENS.colors.dark.popoverIconBackground;
export const POPOVER_ICON_BORDER = THEME_TOKENS.colors.dark.popoverIconBorder;
export const POPOVER_ICON_COLOR = THEME_TOKENS.colors.dark.popoverIconColor;
export const POPOVER_ICON_HOVER_BACKGROUND = THEME_TOKENS.colors.dark.popoverIconHoverBackground;
export const POPOVER_ICON_HOVER_COLOR = THEME_TOKENS.colors.dark.popoverIconHoverColor;
export const POPOVER_BACKGROUND = THEME_TOKENS.colors.dark.popoverBackground;
export const POPOVER_BORDER = THEME_TOKENS.colors.dark.popoverBorder;
export const POPOVER_TITLE_COLOR = THEME_TOKENS.colors.dark.popoverTitle;
export const POPOVER_TEXT_COLOR = THEME_TOKENS.colors.dark.popoverText;

// Sidebar constants
export const SIDEBAR_WIDTH = THEME_TOKENS.layout.sidebarWidth;
export const SIDEBAR_MIN_WIDTH = THEME_TOKENS.layout.sidebarMinWidth;
export const SIDEBAR_PADDING = THEME_TOKENS.layout.sidebarPadding;
export const CONNECTION_STATUS_FLEX = "0 0 70%";
export const PAUSE_BUTTON_FLEX = "0 0 25%";
export const DEFAULT_FFT_SIZE = 103432;
export const DEFAULT_FFT_WINDOW = "Rectangular";
export const DEFAULT_FFT_FRAME_RATE = 60;
export const FILE_INPUT_ACCEPT = ".napt,.wav,.c64";

// FFTCanvas constants
export const VISUALIZER_PADDING = THEME_TOKENS.layout.canvasPadding;
export const VISUALIZER_GAP = THEME_TOKENS.layout.canvasGap;
// Reuse FFT dB constants for consistency
export {
  FFT_MIN_DB as WATERFALL_HISTORY_LIMIT,
  FFT_MAX_DB as WATERFALL_HISTORY_MAX,
} from "@n-apt/consts/fft";
export const SECTION_TITLE_COLOR = THEME_TOKENS.colors.dark.sectionTitle;
export const SECTION_TITLE_AFTER_COLOR = THEME_TOKENS.colors.dark.sectionTitleAccent;
export const CANVAS_BORDER_COLOR = THEME_TOKENS.colors.dark.canvasBorder;

// FrequencyRangeSlider additional constants
export const RANGE_TRACK_HEIGHT = 32;
export const RANGE_TRACK_BACKGROUND = THEME_TOKENS.colors.dark.rangeTrackBackground;
export const RANGE_TRACK_BORDER = THEME_TOKENS.colors.dark.rangeTrackBorder;
export const RANGE_LABELS_COLOR = THEME_TOKENS.colors.dark.rangeLabels;
export const RANGE_LABELS_PADDING = "0 12px";
export const RANGE_LABELS_FONT_SIZE = THEME_TOKENS.layout.rangeLabelsFontSize;

// FFTPlaybackCanvas constants
export const STITCHER_BUTTON_STYLE = {
  flex: 1,
  padding: "12px",
  backgroundColor: THEME_TOKENS.colors.dark.stitcherButtonBackground,
  border: `1px solid ${THEME_TOKENS.colors.dark.stitcherButtonBorder}`,
  borderRadius: "8px",
  color: THEME_TOKENS.colors.dark.stitcherButtonText,
  fontFamily: THEME_TOKENS.typography.mono,
  fontSize: "12px",
  fontWeight: "500",
  cursor: "pointer",
  textAlign: "center",
} as const;

// Common color constants
export const COLORS = THEME_TOKENS.colors.dark;

// Common font constants
export const FONTS = {
  mono: THEME_TOKENS.typography.mono,
  sans: THEME_TOKENS.typography.sans,
} as const;

// Common spacing constants
export const SPACING = THEME_TOKENS.spacing;
