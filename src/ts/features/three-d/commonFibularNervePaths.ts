/**
 * Source-GLB centerlines for the common fibular (peroneal) nerve and its
 * terminal branches. Coordinates are in model-local units: x is left/right,
 * y is up, and positive z faces the anterior surface.
 *
 * The trunk curves around the posterolateral fibular head before dividing.
 * The deep branch continues over the anterior shin; the superficial branch
 * follows the anterolateral compartment. These are bilateral surface guides,
 * sampled to stay within the lower-leg silhouette rather than extending past
 * its lateral edge.
 */
export type CommonFibularPoint = [number, number, number];
export type CommonFibularPath = CommonFibularPoint[];

function mirrorPath(path: CommonFibularPath): CommonFibularPath[] {
  return [1, -1].map((side) =>
    path.map(([x, y, z]): CommonFibularPoint => [side * x, y, z]),
  );
}

const trunk: CommonFibularPath = [
  [0.115, 0.455, -0.095], // lateral sciatic division behind the knee
  [0.13, 0.43, -0.085],
  [0.14, 0.405, -0.055], // wraps around the fibular neck
  [0.138, 0.38, -0.015],
  [0.125, 0.355, 0.03],
  [0.12, 0.335, 0.05], // fibular head, anterior-lateral side
];

const deepFibularBranch: CommonFibularPath = [
  [0.12, 0.335, 0.05],
  [0.112, 0.29, 0.06],
  [0.105, 0.235, 0.057],
  [0.098, 0.18, 0.048],
  [0.09, 0.12, 0.032],
  [0.085, 0.07, 0.012], // toward the first dorsal web space
];

const superficialFibularBranch: CommonFibularPath = [
  [0.12, 0.335, 0.05],
  [0.13, 0.29, 0.047],
  [0.132, 0.235, 0.04],
  [0.125, 0.18, 0.032],
  [0.115, 0.125, 0.02],
  [0.105, 0.085, 0.005], // superficial division approaching the dorsum
];

export const COMMON_FIBULAR_NERVE_PATHS: CommonFibularPath[] = [
  ...mirrorPath(trunk),
  ...mirrorPath(deepFibularBranch),
  ...mirrorPath(superficialFibularBranch),
];
