export type HipMusclePoint = [number, number, number];

export type HipMuscleOverlay = {
  /** Centerlines sampled on the ghost model surface in source GLB coordinates. */
  paths: HipMusclePoint[][];
  /** Visible ribbon half-width in source-model units. */
  halfWidth: number;
  /** Posterior paths are viewed from behind when focused. */
  surface: "anterior" | "posterior";
};

function bilateral(path: HipMusclePoint[]): HipMusclePoint[][] {
  return [1, -1].map((side) => path.map(([x, y, z]): HipMusclePoint => [x * side, y, z]));
}

function combine(...pathSets: HipMusclePoint[][][]): HipMusclePoint[][] {
  return pathSets.flat();
}

const rectusFemoris = bilateral([
  [0.1, 0.99, 0.12], [0.1, 0.88, 0.125], [0.1, 0.72, 0.115], [0.1, 0.55, 0.075],
]);
const vastusLateralis = bilateral([
  [0.13, 0.94, 0.122], [0.14, 0.82, 0.12], [0.14, 0.68, 0.095], [0.13, 0.54, 0.07],
]);
const vastusMedialis = bilateral([
  [0.07, 0.86, 0.112], [0.075, 0.75, 0.108], [0.08, 0.63, 0.085], [0.09, 0.52, 0.062],
]);
const vastusIntermedius = bilateral([
  [0.1, 0.94, 0.105], [0.1, 0.82, 0.108], [0.1, 0.68, 0.088], [0.1, 0.55, 0.06],
]);
const bicepsFemoris = bilateral([
  [0.14, 0.95, -0.091], [0.14, 0.82, -0.084], [0.135, 0.68, -0.065], [0.12, 0.54, -0.081],
]);
const semitendinosus = bilateral([
  [0.09, 0.94, -0.11], [0.09, 0.82, -0.097], [0.09, 0.68, -0.074], [0.085, 0.54, -0.08],
]);
const semimembranosus = bilateral([
  [0.065, 0.92, -0.104], [0.08, 0.8, -0.095], [0.09, 0.67, -0.072], [0.09, 0.55, -0.077],
]);
const adductorMagnus = bilateral([
  [0.055, 0.93, -0.102], [0.075, 0.82, -0.095], [0.1, 0.68, -0.073], [0.11, 0.57, -0.074],
]);
const gracilis = bilateral([
  [0.065, 0.98, 0.105], [0.065, 0.83, 0.106], [0.07, 0.67, 0.092], [0.075, 0.51, 0.044],
]);
const adductorLongus = bilateral([
  [0.045, 0.97, 0.097], [0.06, 0.86, 0.106], [0.08, 0.72, 0.107], [0.09, 0.62, 0.086],
]);
const sartorius = bilateral([
  [0.145, 0.99, 0.112], [0.12, 0.86, 0.126], [0.095, 0.72, 0.112], [0.075, 0.58, 0.067], [0.065, 0.51, 0.028],
]);
const iliopsoas = bilateral([
  [0.04, 1.12, 0.075], [0.065, 1.04, 0.09], [0.09, 0.96, 0.108], [0.105, 0.88, 0.115],
]);

const gluteusMaximus = bilateral([
  [0.035, 1.02, -0.09], [0.075, 0.99, -0.125], [0.12, 0.94, -0.14], [0.16, 0.88, -0.12],
]);
const gluteusMedius = bilateral([
  [0.035, 1.055, -0.075], [0.075, 1.04, -0.11], [0.12, 1.0, -0.13], [0.155, 0.95, -0.12],
]);
const gluteusMinimus = bilateral([
  [0.04, 1.02, -0.065], [0.075, 1.0, -0.095], [0.11, 0.96, -0.115], [0.14, 0.92, -0.105],
]);
const tensorFasciaeLatae = bilateral([
  [0.16, 1.02, 0.075], [0.16, 0.98, 0.105], [0.15, 0.92, 0.11], [0.145, 0.86, 0.105],
]);
const piriformis = bilateral([
  [0.025, 0.98, -0.085], [0.06, 0.96, -0.115], [0.1, 0.93, -0.13],
]);

/**
 * Compact bilateral surface guides for the hip and thigh cards. These are
 * explanatory overlays on the ghost mesh, not anatomical muscle meshes.
 */
export const HIP_THIGH_MUSCLE_PATHS: Record<string, HipMuscleOverlay> = {
  "Rectus femoris": { paths: rectusFemoris, halfWidth: 0.023, surface: "anterior" },
  "Vastus lateralis": { paths: vastusLateralis, halfWidth: 0.022, surface: "anterior" },
  "Vastus medialis": { paths: vastusMedialis, halfWidth: 0.019, surface: "anterior" },
  "Vastus intermedius": { paths: vastusIntermedius, halfWidth: 0.013, surface: "anterior" },
  "Quadriceps group": {
    paths: combine(rectusFemoris, vastusLateralis, vastusMedialis, vastusIntermedius),
    halfWidth: 0.014,
    surface: "anterior",
  },
  "Biceps femoris": { paths: bicepsFemoris, halfWidth: 0.02, surface: "posterior" },
  "Semitendinosus": { paths: semitendinosus, halfWidth: 0.014, surface: "posterior" },
  "Semimembranosus": { paths: semimembranosus, halfWidth: 0.018, surface: "posterior" },
  "Hamstring group": {
    paths: combine(bicepsFemoris, semitendinosus, semimembranosus),
    halfWidth: 0.012,
    surface: "posterior",
  },
  "Adductor magnus": { paths: adductorMagnus, halfWidth: 0.025, surface: "posterior" },
  Gracilis: { paths: gracilis, halfWidth: 0.007, surface: "anterior" },
  "Adductor longus": { paths: adductorLongus, halfWidth: 0.016, surface: "anterior" },
  Sartorius: { paths: sartorius, halfWidth: 0.009, surface: "anterior" },
  Iliopsoas: { paths: iliopsoas, halfWidth: 0.018, surface: "anterior" },
  "Gluteus maximus": { paths: gluteusMaximus, halfWidth: 0.028, surface: "posterior" },
  "Gluteus medius": { paths: gluteusMedius, halfWidth: 0.022, surface: "posterior" },
  "Gluteus minimus": { paths: gluteusMinimus, halfWidth: 0.016, surface: "posterior" },
  "Tensor fasciae latae": { paths: tensorFasciaeLatae, halfWidth: 0.012, surface: "anterior" },
  Piriformis: { paths: piriformis, halfWidth: 0.012, surface: "posterior" },
};
