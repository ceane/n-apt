import type { ModelOffset, MuscleSurface } from "@n-apt/three-d/surfaceAnchoredMusclePaths";

export type ThroatSwallowingMusclePath = {
  points: ModelOffset[];
  surface: MuscleSurface;
  halfWidth: number;
};

export type ThroatSwallowingMuscleOverlay = {
  paths: ThroatSwallowingMusclePath[];
  cameraSurface: "anterior";
  cameraDistance: number;
  cameraFov: number;
  cameraVerticalOffset: number;
  surfaceDraped: boolean;
};

function bilateral(
  points: ModelOffset[],
  surface: MuscleSurface,
  halfWidth: number,
): ThroatSwallowingMusclePath[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): ModelOffset => [side * x, y, z]),
    surface,
    halfWidth,
  }));
}

function combine(...pathSets: ThroatSwallowingMusclePath[][]): ThroatSwallowingMusclePath[] {
  return pathSets.flat();
}

export const THROAT_SWALLOWING_MUSCLE_PATHS: Record<string, ThroatSwallowingMuscleOverlay> = {
  "Suprahyoid muscle group": {
    paths: combine(
      // The anterior and posterior digastric bellies descend from the mandible
      // and mastoid region to their shared tendon at the hyoid.
      bilateral([[0.045, 1.82, 0.14], [0.032, 1.78, 0.105], [0.012, 1.745, 0.075]], "anterior", 0.0038),
      bilateral([[0.105, 1.805, -0.015], [0.066, 1.777, 0.022], [0.028, 1.742, 0.06]], "anterolateral", 0.0031),
      // Mylohyoid forms the broad floor of the mouth, converging toward the hyoid.
      bilateral([[0.072, 1.81, 0.13], [0.045, 1.775, 0.105], [0.012, 1.742, 0.075]], "anterior", 0.0055),
      // Geniohyoid lies medial to mylohyoid and runs from chin to hyoid.
      bilateral([[0.012, 1.82, 0.14], [0.01, 1.78, 0.105], [0.01, 1.742, 0.075]], "anterior", 0.0027),
      // Stylohyoid runs beside the posterior digastric belly toward the hyoid.
      bilateral([[0.095, 1.81, 0.005], [0.062, 1.777, 0.035], [0.027, 1.742, 0.065]], "anterolateral", 0.003),
    ),
    cameraSurface: "anterior",
    cameraDistance: 0.5,
    cameraFov: 44,
    cameraVerticalOffset: -0.025,
    surfaceDraped: true,
  },
  "Infrahyoid muscle group": {
    paths: combine(
      // Sternohyoid is the medial strap from the sternum to the hyoid.
      bilateral([[0.006, 1.45, 0.08], [0.006, 1.56, 0.075], [0.006, 1.66, 0.067], [0.006, 1.74, 0.06]], "anterior", 0.0033),
      // Sternothyroid runs deeper and slightly lateral, from sternum to thyroid cartilage.
      bilateral([[0.04, 1.46, 0.075], [0.032, 1.55, 0.075], [0.023, 1.63, 0.07], [0.018, 1.68, 0.065]], "anterior", 0.0038),
      // Thyrohyoid is the short continuation between thyroid and hyoid.
      bilateral([[0.018, 1.68, 0.07], [0.014, 1.71, 0.075], [0.011, 1.74, 0.07]], "anterior", 0.003),
      // Omohyoid crosses the lower lateral neck before ascending to the hyoid.
      bilateral([[0.18, 1.52, 0.005], [0.11, 1.62, 0.035], [0.03, 1.74, 0.07]], "anterolateral", 0.003),
    ),
    cameraSurface: "anterior",
    cameraDistance: 0.8,
    cameraFov: 44,
    cameraVerticalOffset: 0.005,
    surfaceDraped: true,
  },
};
