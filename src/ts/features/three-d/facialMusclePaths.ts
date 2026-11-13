export type FacialMusclePoint = [number, number, number];

export type FacialMuscleShape = {
  kind: "fiber-sheet" | "ring" | "strip";
  /** Source-model-space centerlines; ring paths repeat their first point at the end. */
  paths: FacialMusclePoint[][];
  /** Suggested visible half-width in source-model units for ribbon rendering. */
  halfWidth: number;
  /** Optional filled surface boundary for broad, sheet-like muscles. */
  outline?: FacialMusclePoint[];
};

function mirrorPaths(paths: FacialMusclePoint[][]): FacialMusclePoint[][] {
  return paths.flatMap((path) => [1, -1].map((side) =>
    path.map(([x, y, z]): FacialMusclePoint => [x * side, y, z]),
  ));
}

function eyeRing(centerX: number): FacialMusclePoint[] {
  const points: FacialMusclePoint[] = [];
  const steps = 16;
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * 0.013;
    const y = 1.92 + Math.sin(angle) * 0.011;
    // Follow the slight front-to-side turn of the face around each orbit.
    const z = 0.095 + 0.02 * (1 - Math.min(1, Math.abs(x) / 0.13));
    points.push([x, y, z]);
  }
  return points;
}

function eyeRings(): FacialMusclePoint[][] {
  return [eyeRing(0.026), eyeRing(-0.026)];
}

const frontalisFibers = mirrorPaths([
  [[0.024, 1.955, 0.112], [0.024, 1.975, 0.12], [0.024, 1.995, 0.118], [0.024, 2.015, 0.105]],
  [[0.056, 1.955, 0.112], [0.056, 1.974, 0.12], [0.056, 1.992, 0.117], [0.056, 2.01, 0.103]],
]);

/**
 * Localized source-model-space outlines/fiber paths for upper-face expression muscles.
 * Coordinates follow the GLB: x is left/right, y is up, and positive z is anterior.
 * Paths are explanatory surface guides for the ghost model, not dissection geometry.
 */
export const FACIAL_MUSCLE_SHAPES: Record<string, FacialMuscleShape> = {
  Frontalis: {
    kind: "fiber-sheet",
    paths: frontalisFibers,
    halfWidth: 0.001,
    outline: [
      [-0.082, 1.952, 0.102], [-0.086, 1.975, 0.11], [-0.076, 2.004, 0.116],
      [-0.054, 2.024, 0.11], [-0.026, 2.034, 0.103], [0.026, 2.034, 0.103],
      [0.054, 2.024, 0.11], [0.076, 2.004, 0.116], [0.086, 1.975, 0.11],
      [0.082, 1.952, 0.102], [0.052, 1.96, 0.116], [0, 1.964, 0.122],
      [-0.052, 1.96, 0.116],
    ],
  },
  "Corrugator supercilii": {
    kind: "strip",
    paths: mirrorPaths([
      [[0.006, 1.935, 0.112], [0.012, 1.948, 0.12], [0.02, 1.96, 0.116], [0.028, 1.968, 0.105]],
    ]),
    halfWidth: 0.005,
  },
  "Orbicularis oculi": {
    kind: "ring",
    paths: eyeRings(),
    halfWidth: 0.0045,
  },
  Procerus: {
    kind: "strip",
    paths: [[
      [0, 1.995, 0.09],
      [0, 1.975, 0.102],
      [0, 1.955, 0.11],
      [0, 1.935, 0.108],
      [0, 1.915, 0.095],
    ]],
    halfWidth: 0.009,
  },
};
