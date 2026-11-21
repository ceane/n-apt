import type { ModelOffset, MuscleSurface } from "./surfaceAnchoredMusclePaths";

export type NasalAnatomyRibbon = {
  points: ModelOffset[];
  halfWidth: number;
  closed?: boolean;
  surface?: MuscleSurface;
  surfaceDraped?: boolean;
  surfaceLift?: number;
};

export type NasalAnatomyOverlay = {
  paths: NasalAnatomyRibbon[];
};

function bilateralPath(
  points: ModelOffset[],
  halfWidth: number,
  closed = false,
  surface?: MuscleSurface,
  surfaceDraped = false,
): NasalAnatomyRibbon[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): ModelOffset => [side * x, y, z]),
    halfWidth,
    closed,
    ...(surface ? { surface } : {}),
    surfaceDraped,
  }));
}

function ellipse(center: ModelOffset, radiusX: number, radiusY: number, count = 18): ModelOffset[] {
  const points = Array.from({ length: count }, (_, index): ModelOffset => {
    const angle = (Math.PI * 2 * index) / count;
    return [
      center[0] + Math.cos(angle) * radiusX,
      center[1] + Math.sin(angle) * radiusY,
      center[2] + 0.0015 * Math.sin(angle),
    ];
  });
  return points;
}

const alarRims = bilateralPath([
  [0.006, 1.899, 0.13],
  [0.013, 1.894, 0.138],
  [0.021, 1.887, 0.144],
  [0.026, 1.879, 0.148],
  [0.022, 1.87, 0.15],
], 0.002, false, "anterolateral", true);

const nostrilRings: NasalAnatomyRibbon[] = [-1, 1].map((side) => ({
  points: ellipse([side * 0.014, 1.873, 0.15], 0.0045, 0.0032),
  halfWidth: 0.00045,
  closed: true,
  surface: "anterolateral",
  surfaceLift: 0.00045,
}));

const vestibulePaths = [
  ...nostrilRings,
  ...bilateralPath([
    [0.014, 1.872, 0.143],
    [0.012, 1.875, 0.138],
    [0.009, 1.88, 0.133],
    [0.006, 1.883, 0.128],
  ], 0.001),
];

const septumAndConchaePaths: NasalAnatomyRibbon[] = [
  {
    points: [[0, 1.86, 0.127], [0, 1.878, 0.138], [0, 1.899, 0.139], [0, 1.917, 0.128]],
    halfWidth: 0.0017,
  },
  ...bilateralPath([
    [0.004, 1.874, 0.127], [0.011, 1.875, 0.136], [0.017, 1.88, 0.14], [0.017, 1.885, 0.137], [0.011, 1.888, 0.13],
  ], 0.0014),
  ...bilateralPath([
    [0.004, 1.891, 0.125], [0.01, 1.893, 0.133], [0.016, 1.898, 0.137], [0.016, 1.903, 0.134], [0.01, 1.906, 0.128],
  ], 0.0013),
  ...bilateralPath([
    [0.004, 1.907, 0.121], [0.009, 1.909, 0.129], [0.014, 1.914, 0.133], [0.014, 1.919, 0.13], [0.009, 1.922, 0.124],
  ], 0.0012),
];

const nasalCavityContext: NasalAnatomyOverlay = {
  paths: septumAndConchaePaths,
};

/** Surface and internal nasal landmarks shown with the selected nerve or region. */
export const NASAL_ANATOMY_OVERLAYS: Record<string, NasalAnatomyOverlay> = {
  "Nasal alae (nostril wings)": { paths: alarRims },
  "Nasal vestibule and nares": { paths: vestibulePaths },
  "Nasal septum and conchae": nasalCavityContext,
  "Nasal sensory nerves (V1/V2)": nasalCavityContext,
  "Cranial nerve I Olfactory": nasalCavityContext,
};
