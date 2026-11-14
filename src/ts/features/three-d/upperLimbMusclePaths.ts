import { modelSourcePointToWorld } from "@n-apt/three-d/modelAnchors";
import type { ModelOffset, MuscleSurface } from "@n-apt/three-d/surfaceAnchoredMusclePaths";

export type UpperLimbMusclePath = {
  points: ModelOffset[];
  surface: MuscleSurface;
  halfWidth?: number;
};

export type UpperLimbMuscleOverlay = {
  paths: UpperLimbMusclePath[];
  halfWidth: number;
  cameraSurface: "anterior" | "posterior";
  surfaceDraped?: boolean;
};

function bilateral(
  points: ModelOffset[],
  surface: MuscleSurface,
  halfWidth?: number,
): UpperLimbMusclePath[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): ModelOffset => [side * x, y, z]),
    surface,
    halfWidth,
  }));
}

function combine(...sets: UpperLimbMusclePath[][]): UpperLimbMusclePath[] {
  return sets.flat();
}

const bicepsBrachii = bilateral([
  [0.235, 1.615, 0.015], [0.285, 1.632, 0.035], [0.36, 1.632, 0.035], [0.435, 1.615, 0.015],
], "anterior", 0.018);

const tricepsBrachii = bilateral([
  [0.235, 1.615, -0.02], [0.29, 1.63, -0.045], [0.37, 1.63, -0.045], [0.445, 1.615, -0.02],
], "posterior", 0.018);

const deltoid = combine(
  bilateral([[0.105, 1.645, 0.005], [0.15, 1.67, 0.025], [0.205, 1.66, 0.03], [0.255, 1.625, 0.02]], "anterior", 0.018),
  bilateral([[0.16, 1.685, 0], [0.205, 1.665, 0], [0.245, 1.625, 0], [0.24, 1.59, 0]], "lateral", 0.016),
  bilateral([[0.105, 1.645, -0.04], [0.15, 1.67, -0.05], [0.205, 1.66, -0.05], [0.255, 1.625, -0.035]], "posterior", 0.016),
);

const forearmFlexors = combine(
  bilateral([[0.505, 1.615, 0.005], [0.56, 1.625, 0.03], [0.64, 1.625, 0.03], [0.725, 1.615, 0.005]], "anterior", 0.01),
  bilateral([[0.52, 1.605, 0.005], [0.58, 1.6, 0.028], [0.655, 1.605, 0.028], [0.72, 1.615, 0.005]], "anterior", 0.008),
  bilateral([[0.51, 1.625, 0.005], [0.565, 1.635, 0.028], [0.635, 1.632, 0.028], [0.71, 1.62, 0.005]], "anterior", 0.007),
);

const forearmExtensors = combine(
  bilateral([[0.505, 1.615, -0.055], [0.56, 1.625, -0.075], [0.64, 1.625, -0.075], [0.725, 1.615, -0.055]], "posterior", 0.01),
  bilateral([[0.52, 1.605, -0.055], [0.58, 1.6, -0.073], [0.655, 1.605, -0.073], [0.72, 1.615, -0.055]], "posterior", 0.008),
  bilateral([[0.51, 1.625, -0.055], [0.565, 1.635, -0.073], [0.635, 1.632, -0.073], [0.71, 1.62, -0.055]], "posterior", 0.007),
);

const thenarMuscles = bilateral([
  [0.775, 1.615, 0.005], [0.79, 1.63, 0.025], [0.815, 1.642, 0.03], [0.84, 1.63, 0.02], [0.845, 1.615, 0.005],
], "anterior", 0.009);

const intrinsicHandMuscles = combine(
  ...[-0.063, -0.04, -0.017, 0.006].map((z, index) => bilateral([
    [0.795, 1.635 + (index % 2) * 0.006, z],
    [0.82, 1.64 + (index % 2) * 0.006, z + 0.002],
    [0.85, 1.645 + (index % 2) * 0.006, z + 0.004],
  ], "anterior", 0.0055)),
  bilateral([[0.81, 1.635, -0.065], [0.835, 1.64, -0.045], [0.86, 1.642, -0.02]], "posterior", 0.0055),
);

const brachialis = bilateral([
  [0.27, 1.615, 0.015], [0.31, 1.63, 0.038], [0.37, 1.628, 0.04], [0.425, 1.615, 0.018],
], "anterior", 0.011);
const brachioradialis = bilateral([
  [0.465, 1.625, -0.005], [0.52, 1.63, 0.018], [0.61, 1.625, 0.035], [0.72, 1.615, 0.012],
], "anterior", 0.012);
const pronatorTeres = bilateral([
  [0.47, 1.63, 0.008], [0.51, 1.615, 0.03], [0.56, 1.6, 0.038], [0.61, 1.605, 0.025],
], "anterior", 0.009);
const supinator = bilateral([
  [0.465, 1.62, -0.045], [0.49, 1.635, -0.07], [0.535, 1.63, -0.078], [0.575, 1.615, -0.05],
], "posterior", 0.008);
const flexorDigitorumSuperficialis = bilateral([
  [0.51, 1.615, 0.008], [0.57, 1.625, 0.032], [0.66, 1.625, 0.032], [0.735, 1.62, 0.01], [0.81, 1.635, 0.018], [0.875, 1.65, 0.015],
], "anterior", 0.009);
const flexorDigitorumProfundus = bilateral([
  [0.52, 1.605, 0.004], [0.59, 1.612, 0.025], [0.68, 1.615, 0.026], [0.75, 1.625, 0.014], [0.82, 1.64, 0.006], [0.88, 1.65, 0.005],
], "anterior", 0.008);
const extensorDigitorum = bilateral([
  [0.51, 1.615, -0.055], [0.58, 1.625, -0.077], [0.67, 1.625, -0.077], [0.74, 1.62, -0.055], [0.81, 1.637, -0.05], [0.875, 1.65, -0.045],
], "posterior", 0.009);
const extensorIndicis = bilateral([
  [0.66, 1.61, -0.07], [0.72, 1.62, -0.065], [0.79, 1.635, -0.035], [0.86, 1.65, -0.018], [0.89, 1.655, -0.015],
], "posterior", 0.0055);
const flexorPollicisLongus = bilateral([
  [0.55, 1.605, 0.01], [0.62, 1.61, 0.03], [0.7, 1.615, 0.03], [0.765, 1.625, 0.025], [0.81, 1.615, 0.035], [0.85, 1.595, 0.05],
], "anterior", 0.006);
const extensorPollicisLongus = bilateral([
  [0.64, 1.605, -0.075], [0.71, 1.615, -0.075], [0.765, 1.625, -0.06], [0.8, 1.625, -0.018], [0.83, 1.61, 0.02], [0.855, 1.595, 0.048],
], "posterior", 0.0055);
const extensorPollicisBrevis = bilateral([
  [0.69, 1.61, -0.07], [0.75, 1.62, -0.065], [0.79, 1.625, -0.025], [0.825, 1.61, 0.015], [0.85, 1.6, 0.04],
], "posterior", 0.005);
const abductorPollicisLongus = bilateral([
  [0.62, 1.61, -0.07], [0.69, 1.615, -0.075], [0.75, 1.625, -0.06], [0.8, 1.62, -0.018], [0.835, 1.61, 0.025],
], "posterior", 0.006);

const lumbricals = combine(...[-0.045, -0.02, 0.005, 0.03].map((z, index) => bilateral([
  [0.79, 1.636 + (index % 2) * 0.003, z], [0.83, 1.642 + (index % 2) * 0.003, z + 0.003], [0.88, 1.65 + (index % 2) * 0.003, z + 0.005],
], "anterior", 0.004)));
const dorsalInterossei = combine(...[-0.05, -0.025, 0].map((z, index) => bilateral([
  [0.795, 1.637, z], [0.83, 1.645, z + 0.01], [0.87, 1.65, z + 0.018],
], "posterior", 0.005 + (index === 1 ? 0.001 : 0))));
const palmarInterossei = combine(...[-0.045, -0.01, 0.025].map((z) => bilateral([
  [0.8, 1.637, z], [0.835, 1.644, z + 0.006], [0.87, 1.65, z + 0.008],
], "anterior", 0.0045)));
const hypothenar = bilateral([
  [0.78, 1.625, -0.055], [0.8, 1.638, -0.06], [0.835, 1.646, -0.055], [0.86, 1.642, -0.04],
], "anterior", 0.008);
const adductorPollicis = bilateral([
  [0.83, 1.645, -0.005], [0.82, 1.635, 0.018], [0.825, 1.62, 0.035], [0.85, 1.61, 0.045],
], "anterior", 0.007);
const flexorPollicisBrevis = bilateral([
  [0.79, 1.625, 0.005], [0.81, 1.635, 0.03], [0.835, 1.63, 0.047], [0.85, 1.615, 0.05],
], "anterior", 0.007);
const abductorPollicisBrevis = bilateral([
  [0.78, 1.62, 0.012], [0.795, 1.635, 0.04], [0.82, 1.635, 0.052], [0.84, 1.62, 0.052],
], "anterior", 0.007);
const opponensPollicis = bilateral([
  [0.785, 1.625, 0.008], [0.8, 1.64, 0.035], [0.825, 1.642, 0.05], [0.85, 1.625, 0.048],
], "anterior", 0.0065);

const supraspinatus = bilateral([
  [0.035, 1.675, -0.055], [0.08, 1.67, -0.065], [0.14, 1.655, -0.055], [0.205, 1.635, -0.035],
], "posterior", 0.011);
const infraspinatus = bilateral([
  [0.035, 1.61, -0.065], [0.08, 1.595, -0.085], [0.14, 1.605, -0.075], [0.205, 1.625, -0.045],
], "posterior", 0.018);
const teresMinor = bilateral([
  [0.105, 1.565, -0.07], [0.14, 1.585, -0.075], [0.18, 1.605, -0.06], [0.215, 1.625, -0.04],
], "posterior", 0.008);
const subscapularis = bilateral([
  [0.035, 1.61, 0.005], [0.08, 1.595, 0.025], [0.14, 1.605, 0.035], [0.205, 1.625, 0.025],
], "anterior", 0.016);

const trapezius = combine(
  bilateral([[0.015, 1.78, -0.035], [0.08, 1.73, -0.08], [0.17, 1.69, -0.105], [0.27, 1.64, -0.06]], "posterior", 0.02),
  bilateral([[0.015, 1.53, -0.12], [0.08, 1.56, -0.15], [0.17, 1.6, -0.135], [0.27, 1.64, -0.06]], "posterior", 0.026),
  bilateral([[0.015, 1.25, -0.09], [0.06, 1.38, -0.13], [0.13, 1.52, -0.135], [0.24, 1.62, -0.07]], "posterior", 0.02),
);
const pectoralisMajor = combine(
  bilateral([[0.025, 1.65, 0.035], [0.1, 1.68, 0.065], [0.2, 1.67, 0.08], [0.29, 1.645, 0.025]], "anterior", 0.012),
  bilateral([[0.025, 1.56, 0.075], [0.1, 1.59, 0.105], [0.2, 1.62, 0.085], [0.29, 1.635, 0.025]], "anterior", 0.014),
  bilateral([[0.025, 1.45, 0.065], [0.11, 1.5, 0.1], [0.21, 1.57, 0.08], [0.29, 1.62, 0.025]], "anterior", 0.011),
);
const latissimusDorsi = combine(
  bilateral([[0.025, 0.98, -0.09], [0.055, 1.08, -0.12], [0.105, 1.2, -0.14], [0.16, 1.32, -0.14]], "posterior", 0.034),
  bilateral([[0.035, 1.13, -0.12], [0.075, 1.18, -0.14], [0.12, 1.25, -0.145], [0.16, 1.32, -0.14]], "posterior", 0.022),
);

/** Surface guides for the upper-limb cards in the Muscles and movement group. */
export const UPPER_LIMB_MUSCLE_PATHS: Record<string, UpperLimbMuscleOverlay> = {
  "Biceps brachii": { paths: bicepsBrachii, halfWidth: 0.018, cameraSurface: "anterior" },
  "Triceps brachii": { paths: tricepsBrachii, halfWidth: 0.018, cameraSurface: "posterior" },
  Deltoid: { paths: deltoid, halfWidth: 0.018, cameraSurface: "anterior" },
  Trapezius: { paths: trapezius, halfWidth: 0.022, cameraSurface: "posterior" },
  "Pectoralis major": { paths: pectoralisMajor, halfWidth: 0.024, cameraSurface: "anterior", surfaceDraped: true },
  "Latissimus dorsi": { paths: latissimusDorsi, halfWidth: 0.026, cameraSurface: "posterior" },
  Brachialis: { paths: brachialis, halfWidth: 0.011, cameraSurface: "anterior" },
  Brachioradialis: { paths: brachioradialis, halfWidth: 0.012, cameraSurface: "anterior" },
  "Pronator teres": { paths: pronatorTeres, halfWidth: 0.009, cameraSurface: "anterior" },
  Supinator: { paths: supinator, halfWidth: 0.008, cameraSurface: "posterior" },
  "Flexor digitorum superficialis": { paths: flexorDigitorumSuperficialis, halfWidth: 0.009, cameraSurface: "anterior" },
  "Flexor digitorum profundus": { paths: flexorDigitorumProfundus, halfWidth: 0.008, cameraSurface: "anterior" },
  "Extensor digitorum": { paths: extensorDigitorum, halfWidth: 0.009, cameraSurface: "posterior" },
  "Extensor indicis": { paths: extensorIndicis, halfWidth: 0.0055, cameraSurface: "posterior" },
  "Flexor pollicis longus": { paths: flexorPollicisLongus, halfWidth: 0.006, cameraSurface: "anterior" },
  "Extensor pollicis longus": { paths: extensorPollicisLongus, halfWidth: 0.0055, cameraSurface: "posterior" },
  "Extensor pollicis brevis": { paths: extensorPollicisBrevis, halfWidth: 0.005, cameraSurface: "posterior" },
  "Abductor pollicis longus": { paths: abductorPollicisLongus, halfWidth: 0.006, cameraSurface: "posterior" },
  "Lumbricals of the hand": { paths: lumbricals, halfWidth: 0.004, cameraSurface: "anterior" },
  "Dorsal interossei of the hand": { paths: dorsalInterossei, halfWidth: 0.005, cameraSurface: "posterior" },
  "Palmar interossei of the hand": { paths: palmarInterossei, halfWidth: 0.0045, cameraSurface: "anterior" },
  "Hypothenar muscles": { paths: hypothenar, halfWidth: 0.008, cameraSurface: "anterior" },
  "Adductor pollicis": { paths: adductorPollicis, halfWidth: 0.007, cameraSurface: "anterior" },
  "Flexor pollicis brevis": { paths: flexorPollicisBrevis, halfWidth: 0.007, cameraSurface: "anterior" },
  "Abductor pollicis brevis": { paths: abductorPollicisBrevis, halfWidth: 0.007, cameraSurface: "anterior" },
  "Opponens pollicis": { paths: opponensPollicis, halfWidth: 0.0065, cameraSurface: "anterior" },
  Supraspinatus: { paths: supraspinatus, halfWidth: 0.011, cameraSurface: "posterior" },
  Infraspinatus: { paths: infraspinatus, halfWidth: 0.018, cameraSurface: "posterior" },
  "Teres minor": { paths: teresMinor, halfWidth: 0.008, cameraSurface: "posterior" },
  Subscapularis: { paths: subscapularis, halfWidth: 0.016, cameraSurface: "anterior" },
  "Forearm flexor group": { paths: forearmFlexors, halfWidth: 0.01, cameraSurface: "anterior" },
  "Forearm extensor group": { paths: forearmExtensors, halfWidth: 0.01, cameraSurface: "posterior" },
  "Thenar muscles": { paths: thenarMuscles, halfWidth: 0.009, cameraSurface: "anterior" },
  "Intrinsic hand muscles": { paths: intrinsicHandMuscles, halfWidth: 0.0055, cameraSurface: "anterior" },
};

/** Frame one anatomical side so small muscles remain readable on narrow canvases. */
export function getUpperLimbMuscleCameraFocus(name: string, aspect: number) {
  const overlay = UPPER_LIMB_MUSCLE_PATHS[name];
  if (!overlay) return null;
  const points = overlay.paths.flatMap(path => path.points.filter(point => point[0] > 0));
  const world = points.map(modelSourcePointToWorld);
  const min = [0, 1, 2].map(axis => Math.min(...world.map(point => point[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...world.map(point => point[axis])));
  const target = min.map((value, axis) => (value + max[axis]) / 2) as ModelOffset;
  const fov = 38;
  const padding = .09;
  const distance = Math.max(.35, (max[0] - min[0] + padding) / Math.max(aspect, .25), max[1] - min[1] + padding)
    / (2 * Math.tan(fov * Math.PI / 360)) + (max[2] - min[2]) / 2;
  const position: ModelOffset = [target[0], target[1], target[2] + distance * (overlay.cameraSurface === "posterior" ? -1 : 1)];
  return { target, position, fov };
}
