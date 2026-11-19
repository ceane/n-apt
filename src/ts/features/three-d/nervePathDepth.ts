export type NervePathPoint = [number, number, number];

const MODEL_CENTER: NervePathPoint = [0, 1.023072, 0.0397485];
const NERVE_PATH_INSET = 0.025;

/** Pull a nerve centerline slightly beneath the ghost body's outer surface. */
export function insetNervePathPoint([x, y, z]: NervePathPoint): NervePathPoint {
  const inset = Math.min(Math.abs(MODEL_CENTER[2] - z), NERVE_PATH_INSET);
  const direction = Math.sign(MODEL_CENTER[2] - z);
  return [x, y, z + direction * inset];
}
