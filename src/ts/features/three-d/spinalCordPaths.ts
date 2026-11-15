/**
 * Internal spinal cord and root paths in the source GLB coordinate system.
 * X is left/right, Y is up, and positive Z faces anteriorly. The paths follow
 * the vertebral canal and root exits; they are intentionally kept within the
 * ghost body rather than traced over its skin.
 */
export type SpinalCordPoint = [number, number, number];
export type SpinalCordPath = SpinalCordPoint[];

function bilateralPaths(...paths: SpinalCordPath[]): SpinalCordPath[] {
  return paths.flatMap((path) => [1, -1].map((side) =>
    path.map(([x, y, z]): SpinalCordPoint => [side * x, y, z]),
  ));
}

const cervicalCord: SpinalCordPath = [
  [0, 1.72, -0.055],
  [0, 1.67, -0.07],
  [0, 1.62, -0.075],
  [0, 1.56, -0.075],
  [0, 1.5, -0.07],
];

const thoracolumbarCord: SpinalCordPath = [
  [0, 1.5, -0.07],
  [0, 1.44, -0.075],
  [0, 1.38, -0.075],
  [0, 1.32, -0.07],
  [0, 1.26, -0.065],
  [0, 1.22, -0.06],
];

const completeCord = [...cervicalCord, ...thoracolumbarCord.slice(1)];

const cervicalRootlets = bilateralPaths(
  [[0.004, 1.64, -0.075], [0.022, 1.635, -0.082], [0.05, 1.625, -0.09]],
  [[0.004, 1.59, -0.075], [0.025, 1.585, -0.082], [0.055, 1.575, -0.09]],
  [[0.004, 1.54, -0.07], [0.025, 1.535, -0.08], [0.055, 1.525, -0.088]],
);

const thoracicRootlets = bilateralPaths(
  [[0.004, 1.46, -0.075], [0.025, 1.46, -0.085], [0.06, 1.455, -0.095]],
  [[0.004, 1.405, -0.075], [0.028, 1.405, -0.085], [0.065, 1.4, -0.095]],
  [[0.004, 1.35, -0.07], [0.03, 1.35, -0.082], [0.068, 1.345, -0.092]],
);

const lumbarCaudaEquinaRoots = bilateralPaths(
  [[0.005, 1.22, -0.06], [0.009, 1.17, -0.065], [0.022, 1.11, -0.075], [0.055, 1.065, -0.085]],
  [[0.005, 1.22, -0.06], [0.012, 1.16, -0.065], [0.03, 1.09, -0.075], [0.063, 1.03, -0.085]],
  [[0.005, 1.22, -0.06], [0.015, 1.15, -0.065], [0.036, 1.07, -0.075], [0.07, 1.0, -0.085]],
);

const sacralCaudaEquinaRoots = bilateralPaths(
  [[0.005, 1.22, -0.06], [0.012, 1.14, -0.065], [0.032, 1.04, -0.075], [0.065, 0.96, -0.09]],
  [[0.005, 1.22, -0.06], [0.014, 1.13, -0.065], [0.039, 1.02, -0.078], [0.078, 0.92, -0.095]],
  [[0.005, 1.22, -0.06], [0.016, 1.12, -0.065], [0.045, 1.0, -0.08], [0.09, 0.88, -0.1]],
);

const corticospinalTracts = bilateralPaths(
  [
    [0.008, 1.72, -0.05],
    [0.012, 1.67, -0.06],
    [0.014, 1.6, -0.07],
    [0.014, 1.5, -0.07],
    [0.014, 1.4, -0.07],
    [0.012, 1.3, -0.065],
    [0.01, 1.22, -0.06],
  ],
);

const dorsalColumnMedialLemniscus = bilateralPaths(
  // First-order afferents ascend ipsilaterally in the posterior columns,
  // decussate in the caudal medulla, then continue as the medial lemniscus
  // toward the thalamus and primary somatosensory cortex.
  [
    [0.008, 1.22, -0.095],
    [0.008, 1.38, -0.098],
    [0.008, 1.55, -0.098],
    [0.01, 1.68, -0.092],
    [0.02, 1.735, -0.08],
    [0.024, 1.765, -0.065],
    [0, 1.79, -0.055],
    [-0.024, 1.765, -0.065],
    [-0.03, 1.82, -0.05],
    [-0.025, 1.86, -0.04],
    [-0.03, 1.91, -0.025],
    [-0.035, 1.95, -0.01],
    [-0.04, 1.98, 0.005],
  ],
);

const spinothalamicTracts = bilateralPaths(
  // Second-order pain/temperature fibers cross in the anterior white
  // commissure shortly after entry, then ascend contralaterally in the
  // anterolateral spinal cord toward the thalamus and cortex.
  [
    [0.035, 1.16, -0.04],
    [0.025, 1.22, -0.045],
    [0, 1.255, -0.04],
    [-0.025, 1.28, -0.03],
    [-0.038, 1.4, -0.02],
    [-0.042, 1.55, -0.015],
    [-0.045, 1.68, -0.005],
    [-0.052, 1.77, 0.005],
    [-0.065, 1.84, 0.012],
    [-0.045, 1.9, 0.02],
    [-0.05, 1.95, 0.025],
    [-0.045, 1.98, 0.03],
  ],
);

const proprioceptiveAfferents = bilateralPaths(
  // Representative upper-limb afferent runs from the hand through the arm,
  // enters through a cervical dorsal root, and ascends to the cerebellum.
  [
    [0.89, 1.655, -0.015],
    [0.83, 1.65, -0.02],
    [0.77, 1.64, -0.035],
    [0.68, 1.63, -0.055],
    [0.57, 1.62, -0.055],
    [0.47, 1.62, -0.04],
    [0.36, 1.63, -0.035],
    [0.25, 1.64, -0.055],
    [0.15, 1.65, -0.08],
    [0.07, 1.65, -0.095],
    [0.018, 1.66, -0.095],
    [0.014, 1.73, -0.09],
    [0.035, 1.77, -0.075],
    [0.018, 1.82, -0.065],
    [0.025, 1.87, -0.06],
    [0.035, 1.92, -0.055],
    [0.04, 1.96, -0.045],
  ],
  // Representative lower-limb afferent runs from the foot through the leg,
  // enters the lumbar cord, and ascends ipsilaterally to the cerebellum.
  [
    [0.105, 0.08, -0.035],
    [0.105, 0.18, -0.06],
    [0.11, 0.31, -0.07],
    [0.13, 0.43, -0.06],
    [0.12, 0.62, -0.025],
    [0.075, 0.84, -0.07],
    [0.035, 1.05, -0.09],
    [0.014, 1.24, -0.098],
    [0.012, 1.43, -0.098],
    [0.012, 1.61, -0.095],
    [0.02, 1.72, -0.085],
    [0.045, 1.79, -0.075],
    [0.02, 1.84, -0.07],
    [0.03, 1.9, -0.06],
    [0.04, 1.96, -0.05],
  ],
);

const dorsalRoots = bilateralPaths(
  [[0.006, 1.405, -0.07], [0.025, 1.405, -0.082], [0.045, 1.41, -0.095], [0.058, 1.405, -0.098]],
);

const ventralRoots = bilateralPaths(
  [[0.006, 1.405, -0.07], [0.025, 1.4, -0.057], [0.045, 1.395, -0.04], [0.06, 1.39, -0.025]],
);

export const SPINAL_CORD_PATHS: Record<string, SpinalCordPath[]> = {
  "Central nervous system": [completeCord],
  "Spinal cord": [completeCord],
  "Corticospinal tract": corticospinalTracts,
  "Cervical spinal cord (C1–C8)": [cervicalCord, ...cervicalRootlets],
  "Thoracic spinal cord (T1–T12)": [
    [[0, 1.5, -0.07], ...thoracolumbarCord.slice(1, 4)],
    ...thoracicRootlets,
  ],
  "Lumbar spinal cord (L1–L5)": [
    [[0, 1.32, -0.07], [0, 1.26, -0.065], [0, 1.22, -0.06]],
    ...lumbarCaudaEquinaRoots,
  ],
  "Sacral spinal cord (S1–S5)": sacralCaudaEquinaRoots,
  "Dorsal root and sensory ganglion": dorsalRoots,
  "Ventral root": ventralRoots,
  "Dorsal column–medial lemniscus pathway": dorsalColumnMedialLemniscus,
  "Spinothalamic pathway": spinothalamicTracts,
  Proprioception: proprioceptiveAfferents,
};

export const SENSORY_PATHWAY_VIEWS: Record<
  "Dorsal column–medial lemniscus pathway" | "Spinothalamic pathway" | "Proprioception",
  { cameraSurface: "anterior" | "posterior"; cameraDistance: number; cameraFov: number; cameraTargetOffsetY?: number }
> = {
  "Dorsal column–medial lemniscus pathway": { cameraSurface: "posterior", cameraDistance: 1.75, cameraFov: 40 },
  "Spinothalamic pathway": { cameraSurface: "anterior", cameraDistance: 1.75, cameraFov: 40 },
  Proprioception: { cameraSurface: "posterior", cameraDistance: 3.9, cameraFov: 44, cameraTargetOffsetY: -0.25 },
};
