import type { ModelOffset, MuscleSurface } from "@n-apt/three-d/surfaceAnchoredMusclePaths";

export type SkinSensationPath = {
  points: ModelOffset[];
  surface: MuscleSurface;
};

export type SkinSensationOverlay = {
  paths: SkinSensationPath[];
  cameraSurface: "anterior" | "posterior";
  cameraDistance: number;
  cameraFov: number;
  cameraTargetOffsetX: number;
};

function bilateral(points: ModelOffset[], surface: MuscleSurface): SkinSensationPath[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): ModelOffset => [side * x, y, z]),
    surface,
  }));
}

function combine(...pathSets: SkinSensationPath[][]): SkinSensationPath[] {
  return pathSets.flat();
}

function map(
  paths: SkinSensationPath[],
  cameraSurface: SkinSensationOverlay["cameraSurface"],
  cameraDistance = 0.78,
  cameraTargetOffsetX = 0,
): SkinSensationOverlay {
  return { paths, cameraSurface, cameraDistance, cameraFov: 42, cameraTargetOffsetX };
}

const intercostalNerveLevels = [1.5, 1.46, 1.42, 1.38, 1.3, 1.22, 1.17, 1.11, 1.05, 0.99, 0.93];
const intercostalNervePaths: SkinSensationPath[] = intercostalNerveLevels.flatMap((y) =>
  ([1, -1] as const).flatMap((side) => [
    {
      points: [
        [side * 0.015, y, -0.1],
        [side * 0.08, y - 0.006, -0.105],
        [side * 0.16, y - 0.012, -0.09],
      ] as ModelOffset[],
      surface: "posterior" as const,
    },
    {
      points: [
        [side * 0.16, y - 0.012, -0.09],
        [side * 0.22, y - 0.018, -0.065],
        [side * 0.27, y - 0.024, -0.02],
      ] as ModelOffset[],
      surface: "lateral" as const,
    },
    {
      points: [
        [side * 0.27, y - 0.024, -0.02],
        [side * 0.245, y - 0.024, 0.045],
        [side * 0.18, y - 0.02, 0.09],
        [side * 0.07, y - 0.016, 0.115],
      ] as ModelOffset[],
      surface: "anterior" as const,
    },
  ]),
);

export const SKIN_SENSATION_PATHS: Record<string, SkinSensationOverlay> = {
  "Dermatome C2": map(bilateral([[0.015, 1.94, -0.045], [0.055, 1.91, -0.075], [0.085, 1.87, -0.055]], "posterior"), "posterior", 0.58),
  "Dermatome C3": map(bilateral([[0.075, 1.82, -0.02], [0.085, 1.79, -0.015], [0.09, 1.76, 0]], "lateral"), "anterior", 0.9),
  "Dermatome C4": map(bilateral([[0.06, 1.69, -0.065], [0.12, 1.68, -0.085], [0.19, 1.66, -0.08], [0.255, 1.63, -0.06]], "posterior"), "posterior", 0.88, 0.16),
  "Dermatome C5": map(bilateral([[0.235, 1.64, 0.015], [0.29, 1.62, 0.025], [0.35, 1.6, 0.02], [0.41, 1.59, 0.005]], "anterior"), "anterior", 0.9, 0.32),
  "Dermatome C6": map(combine(
    bilateral([[0.48, 1.62, 0.005], [0.57, 1.625, 0.025], [0.68, 1.63, 0.03], [0.79, 1.64, 0.025]], "anterior"),
    bilateral([[0.79, 1.64, 0.025], [0.835, 1.65, 0.04], [0.88, 1.66, 0.045]], "anterior"),
  ), "anterior", 0.98, 0.63),
  "Dermatome C7": map(bilateral([[0.5, 1.615, -0.055], [0.6, 1.625, -0.075], [0.7, 1.63, -0.075], [0.8, 1.64, -0.065], [0.89, 1.66, -0.045]], "posterior"), "posterior", 0.98, 0.65),
  "Dermatome C8": map(bilateral([[0.49, 1.61, -0.055], [0.58, 1.615, -0.075], [0.68, 1.625, -0.075], [0.78, 1.64, -0.065], [0.87, 1.655, -0.045]], "posterior"), "posterior", 0.98, 0.65),
  "Dermatome T1": map(bilateral([[0.47, 1.62, 0.01], [0.39, 1.62, 0.02], [0.31, 1.63, 0.01], [0.24, 1.64, 0.005]], "anterior"), "anterior", 0.9, 0.34),
  "Dermatome T4": map(bilateral([[0.015, 1.38, 0.105], [0.11, 1.38, 0.095], [0.22, 1.38, 0.065], [0.28, 1.38, 0.005], [0.24, 1.38, -0.06]], "anterolateral"), "anterior", 0.95),
  "Dermatome T6": map(bilateral([[0.015, 1.22, 0.115], [0.11, 1.22, 0.105], [0.22, 1.22, 0.07], [0.27, 1.22, 0.005], [0.23, 1.22, -0.065]], "anterolateral"), "anterior", 0.92),
  "Dermatome T10": map(bilateral([[0.015, 0.99, 0.11], [0.105, 0.99, 0.1], [0.2, 0.99, 0.065], [0.25, 0.99, 0.005], [0.21, 0.99, -0.065]], "anterolateral"), "anterior", 0.92),
  "Dermatome L1": map(bilateral([[0.025, 0.82, 0.095], [0.09, 0.81, 0.105], [0.16, 0.79, 0.085], [0.2, 0.77, 0.045]], "anterior"), "anterior", 0.62),
  "Dermatome L2": map(bilateral([[0.09, 0.77, 0.075], [0.12, 0.68, 0.095], [0.14, 0.58, 0.085], [0.16, 0.49, 0.055]], "anterior"), "anterior", 0.72),
  "Dermatome L3": map(bilateral([[0.08, 0.55, 0.015], [0.075, 0.48, 0.04], [0.07, 0.41, 0.035]], "medial"), "anterior", 0.65),
  "Dermatome L4": map(bilateral([[0.075, 0.39, 0.015], [0.065, 0.27, 0.035], [0.055, 0.16, 0.03], [0.045, 0.075, 0.055]], "medial"), "anterior", 0.78),
  "Dermatome L5": map(combine(
    bilateral([[0.15, 0.41, -0.015], [0.17, 0.29, -0.005], [0.16, 0.17, 0.01]], "lateral"),
    bilateral([[0.16, 0.17, 0.01], [0.13, 0.105, 0.045], [0.095, 0.055, 0.06]], "dorsal"),
  ), "anterior", 0.78),
  "Dermatome S1": map(combine(
    bilateral([[0.12, 0.42, -0.07], [0.13, 0.29, -0.08], [0.13, 0.16, -0.075]], "posterior"),
    bilateral([[0.13, 0.16, -0.075], [0.17, 0.09, -0.045], [0.17, 0.045, 0.005]], "lateral"),
  ), "posterior", 0.78),
  "Dermatome S2": map(bilateral([[0.09, 0.86, -0.085], [0.11, 0.74, -0.09], [0.12, 0.61, -0.085], [0.12, 0.5, -0.065]], "posterior"), "posterior", 0.76),
  "Dermatome S3–S5": map(bilateral([[0.018, 0.83, -0.075], [0.045, 0.8, -0.09], [0.065, 0.77, -0.075]], "posterior"), "posterior", 0.62),
  "Supraclavicular nerves": map(combine(
    bilateral([[0.075, 1.72, 0.005], [0.12, 1.68, 0.035], [0.18, 1.65, 0.055], [0.23, 1.62, 0.045]], "anterolateral"),
    bilateral([[0.095, 1.715, -0.005], [0.12, 1.66, 0.02], [0.14, 1.62, 0.055]], "anterior"),
    bilateral([[0.085, 1.71, 0.005], [0.16, 1.68, 0.005], [0.22, 1.65, 0.015]], "lateral"),
  ), "anterior", 0.72),
  "Intercostal nerves": map(intercostalNervePaths, "anterior", 1.0),
  "Lateral femoral cutaneous nerve": map(bilateral([[0.13, 0.9, 0.045], [0.18, 0.81, 0.065], [0.22, 0.7, 0.06], [0.23, 0.59, 0.045], [0.21, 0.5, 0.02]], "lateral"), "anterior", 1.05),
  "Saphenous nerve": map(bilateral([[0.075, 0.51, 0.005], [0.065, 0.39, 0.015], [0.055, 0.26, 0.025], [0.045, 0.13, 0.035], [0.04, 0.075, 0.06]], "medial"), "anterior", 0.78),
  "Sural nerve": map(combine(
    bilateral([[0.12, 0.42, -0.07], [0.14, 0.3, -0.08], [0.15, 0.18, -0.075]], "posterior"),
    bilateral([[0.15, 0.18, -0.075], [0.18, 0.1, -0.045], [0.18, 0.05, 0]], "lateral"),
  ), "posterior", 0.78),
  "Superficial fibular nerve": map(combine(
    bilateral([[0.15, 0.4, -0.005], [0.16, 0.29, 0.005], [0.15, 0.18, 0.015]], "lateral"),
    bilateral([[0.15, 0.18, 0.015], [0.12, 0.11, 0.045], [0.09, 0.055, 0.06]], "dorsal"),
    bilateral([[0.15, 0.18, 0.015], [0.18, 0.12, 0.04], [0.2, 0.07, 0.055]], "dorsal"),
  ), "anterior", 0.78),
  "Ilioinguinal nerve": map(bilateral([[0.04, 0.88, 0.06], [0.09, 0.84, 0.085], [0.14, 0.8, 0.08], [0.18, 0.75, 0.06]], "anterior"), "anterior", 0.64),
  "Posterior femoral cutaneous nerve": map(bilateral([[0.08, 0.91, -0.075], [0.1, 0.79, -0.09], [0.115, 0.66, -0.09], [0.12, 0.53, -0.07]], "posterior"), "posterior", 0.76),
  "Cutaneous receptors": map(combine(
    bilateral([[0.08, 1.42, 0.11], [0.12, 1.42, 0.125], [0.16, 1.42, 0.11]], "anterior"),
    bilateral([[0.12, 1.39, 0.115], [0.12, 1.42, 0.125], [0.12, 1.45, 0.115]], "anterior"),
    bilateral([[0.095, 1.395, 0.115], [0.12, 1.42, 0.125], [0.145, 1.445, 0.115]], "anterior"),
  ), "anterior", 0.95),
};
