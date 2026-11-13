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
    const x = centerX + Math.cos(angle) * 0.012;
    const y = 1.92 + Math.sin(angle) * 0.009;
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
  [[0.022, 1.968, 0.112], [0.022, 1.982, 0.12], [0.022, 1.997, 0.118], [0.022, 2.009, 0.105]],
  [[0.05, 1.968, 0.112], [0.05, 1.981, 0.12], [0.05, 1.995, 0.117], [0.05, 2.006, 0.103]],
]);

/**
 * Localized source-model-space outlines/fiber paths for facial and jaw muscles.
 * Coordinates follow the GLB: x is left/right, y is up, and positive z is anterior.
 * Paths are explanatory surface guides for the ghost model, not dissection geometry.
 */
export const FACIAL_MUSCLE_SHAPES: Record<string, FacialMuscleShape> = {
  Frontalis: {
    kind: "fiber-sheet",
    paths: frontalisFibers,
    halfWidth: 0.0018,
    outline: [
      [-0.075, 1.969, 0.101], [-0.079, 1.984, 0.108], [-0.068, 2.003, 0.114],
      [-0.048, 2.016, 0.108], [-0.02, 2.022, 0.104], [0.02, 2.022, 0.104],
      [0.048, 2.016, 0.108], [0.068, 2.003, 0.114], [0.079, 1.984, 0.108],
      [0.075, 1.969, 0.101],
    ],
  },
  "Corrugator supercilii": {
    kind: "strip",
    paths: mirrorPaths([
      [[0.006, 1.935, 0.112], [0.012, 1.948, 0.12], [0.02, 1.96, 0.116], [0.028, 1.968, 0.105]],
    ]),
    halfWidth: 0.003,
  },
  "Orbicularis oculi": {
    kind: "ring",
    paths: eyeRings(),
    halfWidth: 0.0025,
  },
  Procerus: {
    kind: "strip",
    paths: [[
      [0, 1.966, 0.094],
      [0, 1.951, 0.102],
      [0, 1.938, 0.108],
      [0, 1.926, 0.104],
      [0, 1.916, 0.095],
    ]],
    halfWidth: 0.0045,
  },
  Masseter: {
    kind: "fiber-sheet",
    paths: mirrorPaths([
      // Broad superficial jaw muscle, from the zygomatic arch to the angle
      // of the mandible. Separate fibers keep the overlay striated.
      [[0.043, 1.9, 0.105], [0.048, 1.885, 0.105], [0.056, 1.855, 0.085], [0.063, 1.84, 0.055]],
      [[0.055, 1.895, 0.09], [0.06, 1.88, 0.09], [0.066, 1.855, 0.072], [0.071, 1.84, 0.042]],
      [[0.068, 1.89, 0.068], [0.07, 1.875, 0.07], [0.075, 1.85, 0.054], [0.079, 1.84, 0.03]],
    ]),
    halfWidth: 0.0022,
  },
  Temporalis: {
    kind: "fiber-sheet",
    paths: mirrorPaths([
      // The fan spreads over the temple and converges onto the coronoid process.
      [[0.034, 1.99, 0.105], [0.042, 1.96, 0.112], [0.053, 1.92, 0.107], [0.064, 1.88, 0.084]],
      [[0.047, 1.99, 0.09], [0.052, 1.96, 0.104], [0.06, 1.92, 0.099], [0.068, 1.88, 0.078]],
      [[0.061, 1.98, 0.07], [0.063, 1.95, 0.084], [0.067, 1.91, 0.082], [0.069, 1.88, 0.075]],
      [[0.073, 1.96, 0.052], [0.069, 1.93, 0.068], [0.068, 1.9, 0.076], [0.07, 1.88, 0.074]],
    ]),
    halfWidth: 0.0018,
  },
  "Medial pterygoid": {
    kind: "fiber-sheet",
    paths: mirrorPaths([
      // Deep medial fibers descend toward the inner mandibular angle.
      [[0.025, 1.87, 0.105], [0.035, 1.86, 0.106], [0.047, 1.845, 0.092], [0.058, 1.83, 0.07]],
      [[0.038, 1.868, 0.095], [0.044, 1.855, 0.096], [0.053, 1.84, 0.082], [0.061, 1.825, 0.06]],
    ]),
    halfWidth: 0.0017,
  },
  "Lateral pterygoid": {
    kind: "fiber-sheet",
    paths: mirrorPaths([
      // Short deep fibers converge near the lateral jaw joint.
      [[0.05, 1.88, 0.09], [0.056, 1.878, 0.08], [0.064, 1.876, 0.067], [0.071, 1.874, 0.055]],
      [[0.052, 1.865, 0.086], [0.058, 1.863, 0.076], [0.066, 1.861, 0.064], [0.073, 1.859, 0.052]],
    ]),
    halfWidth: 0.0015,
  },
};
