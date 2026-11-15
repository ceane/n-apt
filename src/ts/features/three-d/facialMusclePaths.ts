export type FacialMusclePoint = [number, number, number];

export type FacialMuscleShape = {
  kind: "fiber-sheet" | "ring" | "strip";
  /** Source-model-space centerlines; ring paths repeat their first point at the end. */
  paths: FacialMusclePoint[][];
  /** Suggested visible half-width in source-model units for ribbon rendering. */
  halfWidth: number;
  /** Project the paths onto this body surface before rendering. */
  surface?: "anterolateral";
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
  const steps = 24;
  const halfWidth = 0.019;
  const halfHeight = 0.013;
  const side = Math.sign(centerX);
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const horizontal = Math.cos(angle);
    const x = centerX + horizontal * halfWidth;
    // The outer canthus sits slightly higher than the inner canthus.
    const y = 1.92 + Math.sin(angle) * halfHeight + horizontal * side * 0.002;
    // Follow the slight front-to-side turn of the face around each orbit.
    const z = 0.095 + 0.02 * (1 - Math.min(1, Math.abs(x) / 0.13));
    points.push([x, y, z]);
  }
  return points;
}

function eyeRings(): FacialMusclePoint[][] {
  return [eyeRing(0.026), eyeRing(-0.026)];
}

function orbitalStrip(centerline: FacialMusclePoint[], halfWidth: number): FacialMuscleShape {
  return {
    kind: "strip",
    paths: mirrorPaths([centerline]),
    halfWidth,
    surface: "anterolateral",
  };
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
    surface: "anterolateral",
  },
  "Levator palpebrae superioris": orbitalStrip(
    [[0.012, 1.958, 0.06], [0.019, 1.951, 0.079], [0.026, 1.942, 0.102], [0.026, 1.938, 0.113]],
    0.0017,
  ),
  "Superior tarsal muscle": orbitalStrip(
    [[0.01, 1.94, 0.108], [0.018, 1.947, 0.116], [0.03, 1.947, 0.116], [0.042, 1.94, 0.108]],
    0.0012,
  ),
  "Superior rectus": orbitalStrip(
    [[0.008, 1.94, 0.09], [0.018, 1.948, 0.108], [0.032, 1.949, 0.11], [0.044, 1.941, 0.095]],
    0.0012,
  ),
  "Inferior rectus": orbitalStrip(
    [[0.026, 1.92, 0.052], [0.026, 1.911, 0.074], [0.026, 1.901, 0.097]],
    0.0015,
  ),
  "Medial rectus": orbitalStrip(
    [[0.027, 1.92, 0.052], [0.016, 1.92, 0.074], [0.007, 1.92, 0.097]],
    0.0015,
  ),
  "Lateral rectus": orbitalStrip(
    [[0.025, 1.92, 0.052], [0.037, 1.92, 0.074], [0.047, 1.92, 0.097]],
    0.0015,
  ),
  "Superior oblique": orbitalStrip(
    [[0.006, 1.951, 0.075], [0.008, 1.961, 0.094], [0.02, 1.957, 0.108], [0.042, 1.941, 0.098]],
    0.0014,
  ),
  "Inferior oblique": orbitalStrip(
    [[0.006, 1.899, 0.098], [0.015, 1.89, 0.11], [0.031, 1.89, 0.11], [0.046, 1.902, 0.092]],
    0.0014,
  ),
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
