import type { ModelOffset, MuscleSurface } from "@n-apt/three-d/surfaceAnchoredMusclePaths";

export type RespiratoryMuscleRibbon = {
  points: ModelOffset[];
  halfWidth: number;
  closed?: boolean;
  surface?: MuscleSurface;
  surfaceNormal?: ModelOffset;
};

export type RespiratoryMuscleOverlay = {
  paths: RespiratoryMuscleRibbon[];
  surfaceDraped?: boolean;
};

function bilateral(
  points: ModelOffset[],
  surface: MuscleSurface,
  halfWidth: number,
): RespiratoryMuscleRibbon[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): ModelOffset => [side * x, y, z]),
    halfWidth,
    surface,
  }));
}

const intercostalBands: RespiratoryMuscleRibbon[] = [1.52, 1.47, 1.42, 1.37, 1.32, 1.27].flatMap((y) => [
  ...bilateral([
    [0.012, y + 0.014, 0.09],
    [0.055, y + 0.004, 0.112],
    [0.105, y - 0.008, 0.112],
    [0.155, y - 0.018, 0.092],
  ], "anterior", 0.008),
  ...bilateral([
    [0.155, y - 0.018, 0.092],
    [0.195, y - 0.024, 0.064],
    [0.225, y - 0.028, 0.025],
    [0.24, y - 0.03, -0.01],
  ], "lateral", 0.008),
]);

function ringAround(
  center: ModelOffset,
  axis: Vector3Like,
  radius: number,
  halfWidth: number,
): RespiratoryMuscleRibbon {
  const normal = normalize(axis);
  const reference: ModelOffset = Math.abs(normal[1]) > 0.85 ? [1, 0, 0] : [0, 1, 0];
  const tangent = normalize(cross(normal, reference));
  const bitangent = cross(normal, tangent);
  const points: ModelOffset[] = Array.from({ length: 17 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 16;
    return [0, 1, 2].map((coordinate) =>
      center[coordinate]
      + radius * (Math.cos(angle) * tangent[coordinate] + Math.sin(angle) * bitangent[coordinate]),
    ) as ModelOffset;
  });
  return { points, halfWidth, closed: true, surfaceNormal: normal };
}

type Vector3Like = ModelOffset;

function cross(a: ModelOffset, b: ModelOffset): ModelOffset {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector: ModelOffset): ModelOffset {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function airwayRings(
  start: ModelOffset,
  end: ModelOffset,
  radius: number,
  count: number,
): RespiratoryMuscleRibbon[] {
  const axis: ModelOffset = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / (count + 1);
    const center: ModelOffset = [
      start[0] + axis[0] * t,
      start[1] + axis[1] * t,
      start[2] + axis[2] * t,
    ];
    const taper = 1 - 0.18 * t;
    return ringAround(center, axis, radius * taper, 0.0035 * taper);
  });
}

const bronchialRings = [
  ...airwayRings([0, 1.61, 0.025], [0, 1.48, 0.035], 0.013, 5),
  ...airwayRings([0, 1.48, 0.035], [0.12, 1.42, 0.045], 0.009, 4),
  ...airwayRings([0, 1.48, 0.035], [-0.12, 1.42, 0.045], 0.009, 4),
  ...airwayRings([0.08, 1.44, 0.045], [0.18, 1.48, 0.035], 0.0065, 3),
  ...airwayRings([0.09, 1.43, 0.045], [0.19, 1.37, 0.035], 0.0065, 3),
  ...airwayRings([-0.08, 1.44, 0.045], [-0.18, 1.48, 0.035], 0.0065, 3),
  ...airwayRings([-0.09, 1.43, 0.045], [-0.19, 1.37, 0.035], 0.0065, 3),
];

/** Simplified visible teaching overlays for chest-wall and airway muscles. */
export const RESPIRATORY_MUSCLE_PATHS: Record<string, RespiratoryMuscleOverlay> = {
  "Intercostal muscles": {
    paths: intercostalBands,
    surfaceDraped: true,
  },
  "Bronchial smooth muscle": {
    paths: bronchialRings,
  },
};
