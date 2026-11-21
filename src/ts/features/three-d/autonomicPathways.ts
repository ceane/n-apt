export type AutonomicPoint = [number, number, number];
export type AutonomicPath = AutonomicPoint[];

function bilateralPaths(...paths: AutonomicPath[]): AutonomicPath[] {
  return paths.flatMap((path) => [1, -1].map((side) =>
    path.map(([x, y, z]): AutonomicPoint => [side * x, y, z]),
  ));
}

function ganglionRing(x: number, y: number, z: number, radiusX = 0.008, radiusY = 0.011): AutonomicPath {
  const ring: AutonomicPath = Array.from({ length: 9 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 8;
    return [x + Math.cos(angle) * radiusX, y + Math.sin(angle) * radiusY, z];
  });
  ring[ring.length - 1] = [...ring[0]];
  return ring;
}

function pairedGanglia(yValues: number[], x: number, z: number): AutonomicPath[] {
  return yValues.flatMap((y) => bilateralPaths(ganglionRing(x, y, z)));
}

// Source GLB coordinates: +X is subject-left, +Y is up, and +Z is anterior.
// These paths sit inside the ghost body. The sympathetic trunks run beside
// the vertebral column; they are shown with their ganglia and communicating
// rami so the route reads as a chain rather than an undifferentiated arbor.
const sympatheticTrunks = bilateralPaths(
  [
    [0.068, 1.66, -0.09], [0.069, 1.6, -0.092], [0.07, 1.54, -0.095],
    [0.072, 1.49, -0.096], [0.074, 1.43, -0.098], [0.075, 1.37, -0.099],
    [0.073, 1.31, -0.099], [0.07, 1.25, -0.098], [0.066, 1.19, -0.096],
    [0.061, 1.13, -0.093], [0.055, 1.07, -0.09], [0.049, 1.01, -0.088],
    [0.042, 0.95, -0.086], [0.036, 0.89, -0.084], [0.032, 0.85, -0.082],
  ],
);

const thoracolumbarGanglia = pairedGanglia(
  [1.49, 1.455, 1.42, 1.385, 1.35, 1.315, 1.28, 1.245, 1.21, 1.175],
  0.074,
  -0.098,
);
const cervicalGanglia = pairedGanglia([1.63, 1.57, 1.51], 0.069, -0.092);
const lumbarAndSacralGanglia = pairedGanglia([1.11, 1.045, 0.98, 0.915, 0.865], 0.052, -0.09);

// White rami carry preganglionic fibers from T1–L2 spinal nerves into the
// sympathetic trunk. Gray rami return postganglionic fibers to spinal nerves
// at all levels, including cervical and sacral levels.
const whiteRamiCommunicantes = bilateralPaths(
  ...[1.49, 1.455, 1.42, 1.385, 1.35, 1.315, 1.28, 1.245, 1.21, 1.175].map((y): AutonomicPath => [
    [0.012, y, -0.072], [0.035, y - 0.004, -0.084], [0.074, y, -0.098],
  ]),
);
const grayRamiCommunicantes = bilateralPaths(
  ...[1.63, 1.57, 1.51, 1.49, 1.42, 1.35, 1.28, 1.21, 1.11, 1.01, 0.915].map((y): AutonomicPath => [
    [0.071, y, -0.096], [0.09, y - 0.006, -0.101], [0.112, y - 0.01, -0.096],
  ]),
);

const sympatheticCardiopulmonaryBranches = bilateralPaths(
  // Superior cervical ganglion to the head and upper thoracic viscera.
  [[0.069, 1.63, -0.092], [0.052, 1.68, -0.055], [0.032, 1.73, -0.025], [0.025, 1.78, -0.005]],
  // Cervical and upper thoracic cardiac branches converge on the cardiac plexus.
  [[0.069, 1.57, -0.092], [0.08, 1.55, -0.05], [0.055, 1.51, -0.005], [0.027, 1.47, 0.025]],
  [[0.074, 1.49, -0.098], [0.095, 1.47, -0.045], [0.065, 1.44, 0.005], [0.027, 1.45, 0.03]],
  // Pulmonary plexus branches pass laterally from the upper thoracic chain.
  [[0.074, 1.43, -0.098], [0.105, 1.43, -0.06], [0.13, 1.42, -0.015]],
);

const celiacPlexus: AutonomicPath[] = [
  ...pairedGanglia([1.225, 1.205], 0.036, 0.025),
  [[-0.05, 1.215, 0.02], [-0.025, 1.2, 0.036], [0, 1.195, 0.04], [0.025, 1.2, 0.036], [0.05, 1.215, 0.02]] as AutonomicPath,
];
const superiorMesentericPlexus: AutonomicPath[] = [
  ...pairedGanglia([1.145, 1.125], 0.03, 0.035),
  [[-0.045, 1.13, 0.03], [-0.02, 1.12, 0.045], [0, 1.115, 0.05], [0.02, 1.12, 0.045], [0.045, 1.13, 0.03]] as AutonomicPath,
];
const inferiorMesentericAndHypogastricPlexuses: AutonomicPath[] = [
  ...pairedGanglia([0.99, 0.97], 0.024, 0.03),
  [[-0.025, 0.96, 0.03], [-0.012, 0.92, 0.045], [0, 0.9, 0.05], [0.012, 0.92, 0.045], [0.025, 0.96, 0.03]] as AutonomicPath,
  [[-0.035, 0.86, 0.045], [0, 0.84, 0.055], [0.035, 0.86, 0.045]] as AutonomicPath,
];

const thoracicSplanchnicNerves = bilateralPaths(
  // Greater splanchnic nerves (T5–T9) to the celiac ganglia.
  [[0.075, 1.385, -0.098], [0.065, 1.34, -0.05], [0.048, 1.29, -0.005], [0.036, 1.225, 0.025]],
  [[0.075, 1.315, -0.099], [0.065, 1.275, -0.05], [0.048, 1.245, -0.005], [0.036, 1.205, 0.025]],
  // Lesser and least splanchnic nerves reach the aorticorenal and
  // superior-mesenteric plexuses.
  [[0.073, 1.245, -0.098], [0.061, 1.205, -0.045], [0.046, 1.17, 0.005], [0.03, 1.145, 0.035]],
  [[0.07, 1.21, -0.096], [0.059, 1.18, -0.045], [0.045, 1.15, 0.005], [0.03, 1.125, 0.035]],
);
const lumbarSplanchnicNerves = bilateralPaths(
  [[0.061, 1.13, -0.093], [0.052, 1.09, -0.045], [0.039, 1.04, 0.005], [0.024, 0.99, 0.03]],
  [[0.055, 1.07, -0.09], [0.047, 1.035, -0.04], [0.035, 1.0, 0.005], [0.024, 0.97, 0.03]],
  [[0.049, 1.01, -0.088], [0.04, 0.975, -0.04], [0.027, 0.94, 0.005], [0.015, 0.91, 0.04]],
);

const sympatheticDivision = [
  ...sympatheticTrunks,
  ...cervicalGanglia,
  ...thoracolumbarGanglia,
  ...lumbarAndSacralGanglia,
  ...whiteRamiCommunicantes,
  ...grayRamiCommunicantes,
  ...sympatheticCardiopulmonaryBranches,
  ...thoracicSplanchnicNerves,
  ...lumbarSplanchnicNerves,
  ...celiacPlexus,
  ...superiorMesentericPlexus,
  ...inferiorMesentericAndHypogastricPlexuses,
];

// Cranial parasympathetic fibers reach their named peripheral ganglia:
// ciliary (CN III), pterygopalatine and submandibular (CN VII), and otic
// (CN IX). The short postganglionic legs end at their target regions.
const cranialParasympatheticRoutes = bilateralPaths(
  [[0.014, 1.72, -0.055], [0.03, 1.745, -0.005], [0.052, 1.775, 0.04]],
  [[0.052, 1.775, 0.04], [0.066, 1.79, 0.075]],
  [[0.024, 1.69, -0.06], [0.045, 1.715, -0.015], [0.075, 1.755, 0.045]],
  [[0.075, 1.755, 0.045], [0.092, 1.78, 0.07]],
  [[0.075, 1.755, 0.045], [0.055, 1.68, 0.075]],
  [[0.024, 1.69, -0.06], [0.045, 1.665, -0.015], [0.078, 1.645, 0.025]],
  [[0.078, 1.645, 0.025], [0.095, 1.65, 0.055]],
);

const vagalParasympatheticRoutes: AutonomicPath[] = [
  // Vagal trunks descend from the medulla through the neck, then follow the
  // esophagus through the thorax to the foregut and midgut.
  ...bilateralPaths(
    [[0.026, 1.72, -0.06], [0.04, 1.67, -0.045], [0.047, 1.59, -0.04], [0.05, 1.5, -0.035], [0.052, 1.41, -0.025], [0.045, 1.32, -0.01], [0.035, 1.24, 0.02], [0.028, 1.17, 0.04]],
    [[0.047, 1.59, -0.04], [0.07, 1.56, -0.005], [0.085, 1.53, 0.03]],
    [[0.05, 1.5, -0.035], [0.075, 1.48, -0.005], [0.09, 1.45, 0.03]],
    [[0.045, 1.32, -0.01], [0.025, 1.29, 0.025], [0, 1.27, 0.045]],
    [[0.028, 1.17, 0.04], [0.055, 1.15, 0.045], [0.075, 1.12, 0.04]],
  ),
  // The vagal esophageal plexus reforms as anterior and posterior vagal trunks.
  [[0, 1.37, 0.005], [0, 1.32, 0.025], [-0.015, 1.27, 0.04], [-0.02, 1.2, 0.045]],
  [[0.012, 1.37, -0.005], [0.015, 1.32, 0.02], [0.02, 1.27, 0.035], [0.025, 1.2, 0.045]],
];

const pelvicParasympatheticRoutes = bilateralPaths(
  // Pelvic splanchnic nerves arise from S2–S4, join the inferior hypogastric
  // plexus, then distribute to hindgut, bladder, and reproductive organs.
  [[0.014, 0.9, -0.08], [0.035, 0.875, -0.035], [0.045, 0.85, 0.015], [0.035, 0.835, 0.045]],
  [[0.035, 0.835, 0.045], [0.01, 0.88, 0.055], [-0.01, 0.94, 0.045]],
  [[0.035, 0.835, 0.045], [0.025, 0.79, 0.065], [0.015, 0.75, 0.075]],
  [[0.035, 0.835, 0.045], [0.065, 0.81, 0.055], [0.08, 0.77, 0.055]],
);

const parasympatheticDivision = [
  ...cranialParasympatheticRoutes,
  ...vagalParasympatheticRoutes,
  ...pelvicParasympatheticRoutes,
];

const pulmonaryAutonomicPlexus = bilateralPaths(
  // Vagal parasympathetic branches reach the pulmonary root from the thorax.
  [[0.05, 1.5, -0.035], [0.075, 1.48, -0.022], [0.1, 1.445, -0.012], [0.12, 1.42, -0.006]],
  // Sympathetic cardiopulmonary fibers pass from the upper thoracic chain.
  [[0.074, 1.43, -0.078], [0.1, 1.43, -0.052], [0.12, 1.42, -0.028]],
  // Branches form a small schematic network around the lung root and bronchi.
  [[0.12, 1.42, -0.006], [0.135, 1.445, -0.002], [0.14, 1.43, 0], [0.14, 1.4, 0.002], [0.12, 1.42, -0.006]],
  [[0.12, 1.42, -0.006], [0.14, 1.4, 0], [0.145, 1.375, 0]],
);

// Enteric plexuses are drawn within the abdominal cavity. The larger outer
// contour follows the colon; the inner closed loops show interconnected
// myenteric and submucosal circuits around the small bowel.
const entericNetworks: AutonomicPath[] = [
  // Stomach and proximal duodenum.
  [[-0.085, 1.27, 0.035], [-0.12, 1.25, 0.04], [-0.13, 1.21, 0.045], [-0.11, 1.17, 0.05], [-0.065, 1.145, 0.055], [-0.02, 1.15, 0.055], [0.015, 1.18, 0.05], [0.02, 1.22, 0.045], [-0.015, 1.255, 0.04], [-0.06, 1.27, 0.035], [-0.085, 1.27, 0.035]],
  // Small bowel: two winding loops with a finer inner circuit.
  [[-0.095, 1.105, 0.05], [-0.055, 1.14, 0.055], [-0.01, 1.105, 0.06], [0.04, 1.14, 0.055], [0.09, 1.105, 0.05], [0.05, 1.07, 0.055], [0.005, 1.1, 0.06], [-0.045, 1.065, 0.055], [-0.095, 1.105, 0.05]],
  [[-0.075, 1.025, 0.05], [-0.035, 1.06, 0.055], [0.01, 1.025, 0.06], [0.055, 1.055, 0.055], [0.085, 1.015, 0.05], [0.045, 0.985, 0.055], [0, 1.015, 0.06], [-0.04, 0.985, 0.055], [-0.075, 1.025, 0.05]],
  // Colon: cecum and ascending, transverse, descending, sigmoid, then rectum.
  [[-0.095, 1.045, 0.035], [-0.11, 1.085, 0.035], [-0.11, 1.15, 0.035], [-0.095, 1.205, 0.035], [-0.055, 1.22, 0.035], [0, 1.22, 0.035], [0.055, 1.22, 0.035], [0.095, 1.205, 0.035], [0.11, 1.15, 0.035], [0.11, 1.085, 0.035], [0.095, 1.025, 0.035], [0.08, 0.985, 0.04], [0.045, 0.965, 0.045], [0.015, 0.93, 0.05], [0.005, 0.89, 0.05]],
];

export const AUTONOMIC_PATHWAYS: Record<string, AutonomicPath[]> = {
  'Autonomic pathways': [...sympatheticDivision, ...parasympatheticDivision, ...entericNetworks],
  'Autonomic nervous system': [...sympatheticDivision, ...parasympatheticDivision, ...entericNetworks],
  'Sympathetic division': sympatheticDivision,
  'Parasympathetic division': parasympatheticDivision,
  'Enteric nervous system': entericNetworks,
  'Pulmonary autonomic plexus': pulmonaryAutonomicPlexus,
};

type AutonomicPathwayView = {
  cameraSurface: 'anterior' | 'posterior';
  cameraDistance: number;
  cameraFov: number;
  cameraTargetOffsetY?: number;
};

export const AUTONOMIC_PATHWAY_VIEWS: Record<string, AutonomicPathwayView> = {
  'Autonomic pathways': { cameraSurface: 'anterior', cameraDistance: 2.25, cameraFov: 40 },
  'Autonomic nervous system': { cameraSurface: 'anterior', cameraDistance: 2.25, cameraFov: 40 },
  'Sympathetic division': { cameraSurface: 'posterior', cameraDistance: 1.8, cameraFov: 40 },
  'Parasympathetic division': { cameraSurface: 'anterior', cameraDistance: 1.95, cameraFov: 40 },
  'Enteric nervous system': { cameraSurface: 'anterior', cameraDistance: 1.45, cameraFov: 42 },
  'Pulmonary autonomic plexus': { cameraSurface: 'anterior', cameraDistance: 1.05, cameraFov: 42 },
};
