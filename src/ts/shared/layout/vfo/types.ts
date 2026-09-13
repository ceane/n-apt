export type VfoVisualState = "default" | "compact" | "snapshot";
export type VfoDrawingType = "canvas" | "dom";
export type VfoOrientation = "top" | "bottom";
export type VfoTickPrecision = "default" | "reduced";

export interface VfoOptions {
  visualState: VfoVisualState;
  drawingType: VfoDrawingType;
  orientation: VfoOrientation;
  cursorMotion: boolean;
  tickPrecision: VfoTickPrecision;
}

export const DEFAULT_VFO_OPTIONS: VfoOptions = {
  visualState: "default",
  drawingType: "canvas",
  orientation: "bottom",
  cursorMotion: false,
  tickPrecision: "default",
};

export const resolveVfoOptions = (
  options: Partial<VfoOptions> = {},
): VfoOptions => ({ ...DEFAULT_VFO_OPTIONS, ...options });
