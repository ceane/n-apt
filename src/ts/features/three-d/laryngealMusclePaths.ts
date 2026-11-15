import type { ModelOffset } from "@n-apt/three-d/surfaceAnchoredMusclePaths";

export type LaryngealMuscleSurface = "anterior" | "posterior";

export type LaryngealMusclePath = {
  points: ModelOffset[];
  surface: LaryngealMuscleSurface;
  halfWidth: number;
};

export type LaryngealMuscleOverlay = {
  paths: LaryngealMusclePath[];
  cameraSurface: LaryngealMuscleSurface;
  cameraDistance: number;
  surfaceDraped: boolean;
};

function bilateral(
  points: ModelOffset[],
  surface: LaryngealMuscleSurface,
  halfWidth: number,
): LaryngealMusclePath[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): ModelOffset => [side * x, y, z]),
    surface,
    halfWidth,
  }));
}

function combine(...pathSets: LaryngealMusclePath[][]): LaryngealMusclePath[] {
  return pathSets.flat();
}

export const LARYNGEAL_MUSCLE_PATHS: Record<string, LaryngealMuscleOverlay> = {
  Cricothyroid: {
    paths: combine(
      // Pars recta and pars obliqua fan from the cricoid arch to the thyroid.
      bilateral([[0.012, 1.688, 0.105], [0.014, 1.704, 0.114], [0.018, 1.723, 0.119]], "anterior", 0.0055),
      bilateral([[0.019, 1.689, 0.105], [0.025, 1.703, 0.114], [0.031, 1.72, 0.119]], "anterior", 0.006),
    ),
    cameraSurface: "anterior",
    cameraDistance: 0.34,
    surfaceDraped: true,
  },
  "Posterior cricoarytenoid": {
    paths: bilateral([[0.026, 1.69, 0.02], [0.019, 1.703, 0.015], [0.007, 1.716, 0.01]], "posterior", 0.0065),
    cameraSurface: "posterior",
    cameraDistance: 0.34,
    surfaceDraped: true,
  },
  "Lateral cricoarytenoid": {
    paths: bilateral([[0.027, 1.69, 0.105], [0.019, 1.7, 0.099], [0.009, 1.711, 0.09]], "anterior", 0.0055),
    cameraSurface: "anterior",
    cameraDistance: 0.34,
    surfaceDraped: true,
  },
  "Thyroarytenoid and vocalis": {
    paths: combine(
      // A parallel pair on each vocal fold: the broader thyroarytenoid and
      // the narrower vocalis along its medial edge.
      bilateral([[0.03, 1.708, 0.115], [0.019, 1.709, 0.105], [0.008, 1.711, 0.095]], "anterior", 0.005),
      bilateral([[0.027, 1.713, 0.115], [0.017, 1.714, 0.105], [0.007, 1.714, 0.095]], "anterior", 0.0035),
    ),
    cameraSurface: "anterior",
    cameraDistance: 0.32,
    surfaceDraped: true,
  },
  "Interarytenoid muscles": {
    paths: bilateral([[0.011, 1.718, 0.02], [0.006, 1.72, 0.015], [0.001, 1.715, 0.01]], "posterior", 0.0045),
    cameraSurface: "posterior",
    cameraDistance: 0.32,
    surfaceDraped: true,
  },
};
