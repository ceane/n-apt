type OrbitRotationControls = {
  getAzimuthalAngle: () => number;
  setAzimuthalAngle: (angle: number) => void;
  update: () => void;
};

type ModelWheelEvent = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'preventDefault' | 'stopImmediatePropagation'>;

const WHEEL_ROTATION_RADIANS_PER_PIXEL = 0.01;
const LINE_HEIGHT_PIXELS = 16;

/** Rotates the camera around the model for ordinary wheel movement. Ctrl+wheel is left to OrbitControls for pinch zoom. */
export function rotateModelFromWheel(controls: OrbitRotationControls | null, event: ModelWheelEvent): boolean {
  if (!controls || event.ctrlKey) return false;

  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (rawDelta === 0) return false;

  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? LINE_HEIGHT_PIXELS
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? window.innerHeight
      : 1;

  event.preventDefault();
  event.stopImmediatePropagation();
  controls.setAzimuthalAngle(controls.getAzimuthalAngle() + rawDelta * scale * WHEEL_ROTATION_RADIANS_PER_PIXEL);
  controls.update();
  return true;
}

/** Capture at the canvas wrapper so OrbitControls cannot handle regular scroll as dolly zoom first. */
export function attachModelWheelRotation(
  canvas: HTMLCanvasElement,
  getControls: () => OrbitRotationControls | null,
): () => void {
  const target = canvas.parentElement ?? canvas;
  const handleWheel = (event: WheelEvent) => {
    rotateModelFromWheel(getControls(), event);
  };
  target.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  return () => target.removeEventListener('wheel', handleWheel, true);
}
