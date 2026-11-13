export type NeuromuscularJunctionPoint = [number, number, number];

/** Simplified motor-axon terminal branches in the source human GLB coordinates. */
export const NEUROMUSCULAR_JUNCTION_PATHS: Record<string, NeuromuscularJunctionPoint[][]> = {
  "Neuromuscular junction": [
    [
      [0.27, 1.7, 0.095],
      [0.287, 1.674, 0.108],
      [0.304, 1.648, 0.12],
      [0.322, 1.625, 0.128],
    ],
    [[0.322, 1.625, 0.128], [0.33, 1.636, 0.132], [0.34, 1.645, 0.128]],
    [[0.322, 1.625, 0.128], [0.337, 1.626, 0.13], [0.35, 1.626, 0.124]],
    [[0.322, 1.625, 0.128], [0.33, 1.614, 0.132], [0.34, 1.604, 0.128]],
  ],
};
