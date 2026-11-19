import type { ModelOffset } from "@n-apt/three-d/surfaceAnchoredMusclePaths";

export type TongueMusclePath = {
  points: ModelOffset[];
  halfWidth: number;
};

export type TongueMuscleOverlay = {
  paths: TongueMusclePath[];
  cameraDistance: number;
  cameraFov: number;
};

function bilateral(points: ModelOffset[], halfWidth: number): TongueMusclePath[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): ModelOffset => [side * x, y, z]),
    halfWidth,
  }));
}

function combine(...pathSets: TongueMusclePath[][]): TongueMusclePath[] {
  return pathSets.flat();
}

export const TONGUE_MUSCLE_PATHS: Record<string, TongueMuscleOverlay> = {
  Genioglossus: {
    // Paired genioglossus fibers fan from the inner midline of the mandible
    // posteriorly through the tongue instead of following the chin surface.
    paths: combine(
      bilateral([[0.003, 1.852, 0.09], [0.005, 1.848, 0.04], [0.009, 1.842, -0.015]], 0.0028),
      bilateral([[0.003, 1.852, 0.09], [0.009, 1.847, 0.035], [0.016, 1.84, -0.02]], 0.0028),
    ),
    cameraDistance: 0.52,
    cameraFov: 34,
  },
  Hyoglossus: {
    paths: bilateral([[0.01, 1.835, -0.025], [0.014, 1.85, 0.01], [0.012, 1.86, 0.045]], 0.0022),
    cameraDistance: 0.52,
    cameraFov: 34,
  },
  Styloglossus: {
    paths: bilateral([[0.032, 1.87, -0.09], [0.022, 1.855, -0.025], [0.012, 1.842, 0.045]], 0.0025),
    cameraDistance: 0.52,
    cameraFov: 34,
  },
  "Intrinsic tongue muscles": {
    // Longitudinal and transverse fibers are shown as fine internal strands,
    // not as a single mass covering the mouth and chin.
    paths: combine(
      bilateral([[0.012, 1.87, 0.09], [0.018, 1.86, 0.055], [0.02, 1.85, 0.02]], 0.0016),
      bilateral([[0.03, 1.87, 0.085], [0.035, 1.86, 0.05], [0.038, 1.85, 0.015]], 0.0016),
      bilateral([[0.04, 1.86, 0.075], [0.045, 1.85, 0.045], [0.048, 1.84, 0.01]], 0.0016),
      [{ points: [[-0.035, 1.855, 0.055], [0, 1.855, 0.06], [0.035, 1.855, 0.055]], halfWidth: 0.0016 }],
      [{ points: [[-0.03, 1.842, 0.04], [0, 1.842, 0.045], [0.03, 1.842, 0.04]], halfWidth: 0.0016 }],
    ),
    cameraDistance: 0.52,
    cameraFov: 34,
  },
  Palatoglossus: {
    paths: bilateral([[0.02, 1.87, -0.075], [0.026, 1.855, -0.015], [0.04, 1.84, 0.045]], 0.0025),
    cameraDistance: 0.52,
    cameraFov: 34,
  },
};
