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
  patches?: ModelOffset[][];
  volumes?: { position: ModelOffset; scale: ModelOffset; color?: string }[];
  tubes?: { points: ModelOffset[]; radius: number; closed?: boolean; color?: string; opacity?: number }[];
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

const LUNG_CENTER_X = 0.092;
const LUNG_CENTER_Y = 1.42;
const LUNG_HALF_WIDTH = 0.078;
const LUNG_HALF_HEIGHT = 0.158;
const LUNG_CENTER_Z = -0.03;
const LUNG_HALF_DEPTH = 0.075;

function lungFrontSurfacePoint(side: 1 | -1, distanceFromMidline: number, y: number, offset = 0.001): ModelOffset {
  const normalizedY = (y - LUNG_CENTER_Y) / LUNG_HALF_HEIGHT;
  const verticalRoundness = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY * 0.78));
  const apexTaper = 1 - 0.27 * Math.max(0, (normalizedY - 0.68) / 0.32);
  const baseTaper = 1 - 0.13 * Math.max(0, (-normalizedY - 0.72) / 0.28);
  const width = (0.65 + verticalRoundness * 0.35) * apexTaper * baseTaper;
  const normalizedX = (distanceFromMidline - LUNG_CENTER_X) / (LUNG_HALF_WIDTH * width);
  const depthSquared = Math.max(0, 1 - normalizedX * normalizedX - normalizedY * normalizedY);
  const surfaceDepth = Math.sqrt(depthSquared) * (0.86 + width * 0.14);
  return [side * distanceFromMidline, y, LUNG_CENTER_Z + LUNG_HALF_DEPTH * surfaceDepth + offset];
}

const airwayTreeForSide = (side: 1 | -1) => {
  const branch = (coordinates: [number, number][], radius: number, color?: string) => ({
    points: coordinates.map(([distance, y]) => distance === 0
      ? [0, y, 0.027] as ModelOffset
      : lungFrontSurfacePoint(side, distance, y, radius * 0.38)),
    radius,
    ...(color ? { color } : {}),
  });
  return [
    branch([[0, 1.51], [0.045, 1.48], [0.082, 1.445]], 0.0068, "#91484f"),
    branch([[0.06, 1.465], [0.075, 1.505], [0.112, 1.54]], 0.0042),
    branch([[0.082, 1.445], [0.12, 1.46], [0.142, 1.435]], 0.0038),
    branch([[0.078, 1.445], [0.07, 1.39], [0.105, 1.335]], 0.0043),
    branch([[0.105, 1.535], [0.13, 1.555], [0.14, 1.54]], 0.0025),
    branch([[0.105, 1.53], [0.105, 1.49], [0.132, 1.475]], 0.0024),
    branch([[0.135, 1.455], [0.148, 1.47], [0.15, 1.45]], 0.0022),
    branch([[0.135, 1.42], [0.125, 1.39], [0.145, 1.37]], 0.0023),
    branch([[0.075, 1.39], [0.05, 1.36], [0.058, 1.33]], 0.0022),
    branch([[0.102, 1.355], [0.12, 1.335], [0.14, 1.315]], 0.0021),
    branch([[0.105, 1.32], [0.09, 1.295], [0.11, 1.28]], 0.0017),
    branch([[0.13, 1.325], [0.145, 1.305], [0.147, 1.29]], 0.0017),
  ];
};

const trachea: RespiratoryMuscleOverlay["tubes"] = [
  { points: [[0, 1.76, 0.016], [0, 1.68, 0.021], [0, 1.6, 0.025], [0, 1.53, 0.027], [0, 1.5, 0.027]], radius: 0.011 },
];
const trachealCartilageRings: NonNullable<RespiratoryMuscleOverlay["tubes"]> = Array.from({ length: 12 }, (_, index) => {
  const y = 1.55 + index * 0.016;
  return {
    points: Array.from({ length: 24 }, (_, pointIndex) => {
      const angle = (pointIndex / 24) * Math.PI * 2;
      return [Math.cos(angle) * 0.013, y, 0.018 + Math.sin(angle) * 0.013] as ModelOffset;
    }),
    radius: 0.0015,
    closed: true,
    color: "#783740",
  };
});
const fissurePaths: [1 | -1, [number, number][]][] = [
  [1, [[0.065, 1.43], [0.105, 1.415], [0.145, 1.405]]],
  [1, [[0.075, 1.49], [0.11, 1.465], [0.14, 1.45]]],
  [-1, [[0.04, 1.46], [0.075, 1.41], [0.13, 1.35]]],
];
const lobarFissures: NonNullable<RespiratoryMuscleOverlay["tubes"]> = fissurePaths.map(([side, points]) => ({
  points: points.map(([distance, y]) => lungFrontSurfacePoint(side, distance, y, 0.001)),
  radius: 0.0016,
  color: "#a45e62",
}));

const esophagus: NonNullable<RespiratoryMuscleOverlay["tubes"]> = [{
  points: [
    [0.003, 1.78, -0.02], [0.006, 1.73, -0.035], [0.004, 1.68, -0.048],
    [-0.002, 1.61, -0.061], [-0.01, 1.53, -0.072], [-0.018, 1.43, -0.076],
    [-0.02, 1.33, -0.07],
  ],
  radius: 0.006,
  color: "#936c66",
  opacity: 0.26,
}];

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

/** Paired lung volumes and bronchial tree placed within the chest wall. */
export const RESPIRATORY_ORGAN_PATHS: Record<string, RespiratoryMuscleOverlay> = {
  Lungs: {
    paths: [],
    volumes: [
      { position: [LUNG_CENTER_X, LUNG_CENTER_Y, LUNG_CENTER_Z], scale: [LUNG_HALF_WIDTH, LUNG_HALF_HEIGHT, LUNG_HALF_DEPTH], color: "#c77a79" },
      { position: [-LUNG_CENTER_X, LUNG_CENTER_Y, LUNG_CENTER_Z], scale: [LUNG_HALF_WIDTH, LUNG_HALF_HEIGHT, LUNG_HALF_DEPTH], color: "#c77979" },
    ],
    patches: [],
    tubes: [
      ...(trachea ?? []),
      ...trachealCartilageRings,
      ...airwayTreeForSide(1),
      ...airwayTreeForSide(-1),
      ...lobarFissures,
      ...esophagus,
    ],
  },
};
