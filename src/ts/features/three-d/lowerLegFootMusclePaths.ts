export type LowerLegMusclePoint = [number, number, number];
export type LowerLegMuscleSurface = "anterior" | "posterior" | "lateral" | "medial" | "dorsal" | "plantar";

export type LowerLegMusclePath = {
  points: LowerLegMusclePoint[];
  surface: LowerLegMuscleSurface;
  halfWidth?: number;
};

export type LowerLegFootMuscleOverlay = {
  paths: LowerLegMusclePath[];
  halfWidth: number;
  cameraSurface: "anterior" | "posterior" | "lateral" | "plantar";
};

function bilateral(
  points: LowerLegMusclePoint[],
  surface: LowerLegMuscleSurface,
  halfWidth?: number,
): LowerLegMusclePath[] {
  return [1, -1].map((side) => ({
    points: points.map(([x, y, z]): LowerLegMusclePoint => [side * x, y, z]),
    surface,
    halfWidth,
  }));
}

function combine(...sets: LowerLegMusclePath[][]): LowerLegMusclePath[] {
  return sets.flat();
}

const gastrocnemiusMedialHead = bilateral([
  [0.075, 0.445, -0.055], [0.075, 0.37, -0.068], [0.082, 0.285, -0.078], [0.092, 0.205, -0.065], [0.1, 0.145, -0.05],
], "posterior");
const gastrocnemiusLateralHead = bilateral([
  [0.135, 0.43, -0.05], [0.132, 0.36, -0.067], [0.12, 0.28, -0.078], [0.11, 0.205, -0.065], [0.1, 0.145, -0.05],
], "posterior");
const soleus = bilateral([
  [0.085, 0.32, -0.058], [0.09, 0.255, -0.073], [0.095, 0.19, -0.072], [0.1, 0.125, -0.052], [0.1, 0.08, -0.035],
], "posterior");

const tibialisAnterior = bilateral([
  [0.105, 0.425, 0.045], [0.095, 0.345, 0.062], [0.09, 0.25, 0.058], [0.08, 0.16, 0.05], [0.075, 0.085, 0.055],
], "anterior");
const tibialisPosteriorLeg = bilateral([
  [0.06, 0.345, -0.025], [0.06, 0.265, -0.032], [0.065, 0.18, -0.035], [0.065, 0.105, -0.03], [0.065, 0.065, -0.02],
], "medial");
const tibialisPosteriorFoot = bilateral([
  [0.065, 0.065, -0.02], [0.052, 0.04, 0.015], [0.04, 0.027, 0.065], [0.025, 0.022, 0.11],
], "plantar", 0.0055);

const fibularisLongusLeg = bilateral([
  [0.145, 0.405, -0.005], [0.155, 0.32, -0.012], [0.16, 0.235, -0.02], [0.155, 0.15, -0.03], [0.145, 0.075, -0.035],
], "lateral");
const fibularisLongusFoot = bilateral([
  [0.12, 0.04, -0.035], [0.105, 0.03, -0.055], [0.075, 0.024, -0.075], [0.045, 0.02, -0.075],
], "plantar", 0.0045);
const fibularisBrevisLeg = bilateral([
  [0.15, 0.39, 0.005], [0.16, 0.3, 0.0], [0.165, 0.21, -0.015], [0.16, 0.125, -0.03], [0.15, 0.075, -0.035],
], "lateral");
const fibularisBrevisFoot = bilateral([
  [0.15, 0.075, -0.035], [0.17, 0.055, 0.005], [0.19, 0.045, 0.055], [0.19, 0.04, 0.105],
], "dorsal", 0.004);

const extensorDigitorumLongusBelly = bilateral([
  [0.12, 0.41, 0.04], [0.13, 0.32, 0.055], [0.125, 0.23, 0.05], [0.12, 0.14, 0.048], [0.12, 0.085, 0.055],
], "anterior");
const extensorDigitorumLongusTendons = [0.075, 0.105, 0.145, 0.18].flatMap((toeX) => bilateral([
  [0.12, 0.085, 0.055], [toeX * 0.8 + 0.12 * 0.2, 0.055, 0.085], [toeX, 0.04, 0.135],
], "dorsal", 0.0035));
const extensorHallucisLongus = bilateral([
  [0.085, 0.385, 0.045], [0.08, 0.29, 0.06], [0.075, 0.195, 0.055], [0.07, 0.105, 0.06], [0.055, 0.065, 0.095], [0.04, 0.04, 0.155],
], "anterior");

const flexorDigitorumLongusLeg = bilateral([
  [0.065, 0.34, -0.045], [0.07, 0.25, -0.055], [0.075, 0.16, -0.05], [0.075, 0.09, -0.035], [0.07, 0.06, -0.025],
], "posterior");
const flexorDigitorumLongusTendons = [0.075, 0.105, 0.145, 0.18].flatMap((toeX) => bilateral([
  [0.07, 0.06, -0.025], [toeX * 0.8 + 0.07 * 0.2, 0.035, 0.015], [toeX, 0.02, 0.11],
], "plantar", 0.003));
const flexorHallucisLongusLeg = bilateral([
  [0.09, 0.35, -0.05], [0.095, 0.25, -0.062], [0.095, 0.16, -0.05], [0.085, 0.085, -0.035], [0.07, 0.055, -0.025],
], "posterior");
const flexorHallucisLongusFoot = bilateral([
  [0.07, 0.055, -0.025], [0.06, 0.035, 0.02], [0.05, 0.025, 0.085], [0.04, 0.02, 0.16],
], "plantar", 0.004);

const intrinsicFoot = combine(
  bilateral([[0.04, 0.022, -0.065], [0.045, 0.02, -0.015], [0.05, 0.018, 0.04], [0.06, 0.02, 0.105]], "plantar", 0.007),
  bilateral([[0.08, 0.023, -0.055], [0.09, 0.02, 0.0], [0.105, 0.018, 0.045], [0.12, 0.02, 0.09]], "plantar", 0.007),
  bilateral([[0.05, 0.045, 0.025], [0.085, 0.042, 0.055], [0.12, 0.04, 0.07], [0.155, 0.038, 0.075]], "dorsal", 0.006),
);

export const LOWER_LEG_FOOT_MUSCLE_PATHS: Record<string, LowerLegFootMuscleOverlay> = {
  "Gastrocnemius and soleus": { paths: combine(gastrocnemiusMedialHead, gastrocnemiusLateralHead, soleus), halfWidth: 0.021, cameraSurface: "posterior" },
  Gastrocnemius: { paths: combine(gastrocnemiusMedialHead, gastrocnemiusLateralHead), halfWidth: 0.022, cameraSurface: "posterior" },
  Soleus: { paths: soleus, halfWidth: 0.024, cameraSurface: "posterior" },
  "Tibialis anterior": { paths: tibialisAnterior, halfWidth: 0.017, cameraSurface: "anterior" },
  "Tibialis posterior": { paths: combine(tibialisPosteriorLeg, tibialisPosteriorFoot), halfWidth: 0.012, cameraSurface: "lateral" },
  "Fibularis longus": { paths: combine(fibularisLongusLeg, fibularisLongusFoot), halfWidth: 0.014, cameraSurface: "lateral" },
  "Fibularis brevis": { paths: combine(fibularisBrevisLeg, fibularisBrevisFoot), halfWidth: 0.013, cameraSurface: "lateral" },
  "Extensor digitorum longus": { paths: combine(extensorDigitorumLongusBelly, extensorDigitorumLongusTendons), halfWidth: 0.011, cameraSurface: "anterior" },
  "Extensor hallucis longus": { paths: extensorHallucisLongus, halfWidth: 0.009, cameraSurface: "anterior" },
  "Flexor digitorum longus": { paths: combine(flexorDigitorumLongusLeg, flexorDigitorumLongusTendons), halfWidth: 0.009, cameraSurface: "plantar" },
  "Flexor hallucis longus": { paths: combine(flexorHallucisLongusLeg, flexorHallucisLongusFoot), halfWidth: 0.01, cameraSurface: "plantar" },
  "Intrinsic foot muscles": { paths: intrinsicFoot, halfWidth: 0.013, cameraSurface: "plantar" },
};
