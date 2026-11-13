/**
 * Shallow muscle-strip guides in the source human GLB coordinate system.
 * X runs left/right, Y runs upward, and positive Z faces the anterior face.
 * Each centerline describes one ribbon; widths and thicknesses are in model units.
 */
export type FaceMusclePoint = [number, number, number];
export type FaceMuscleCenterline = FaceMusclePoint[];

export type FaceMuscleStrip = {
  centerline: FaceMuscleCenterline;
  width: number;
  thickness: number;
  closed?: boolean;
};

function bilateralStrip(
  centerline: FaceMuscleCenterline,
  width: number,
  thickness: number,
): FaceMuscleStrip[] {
  return [1, -1].map((side) => ({
    centerline: centerline.map(([x, y, z]): FaceMusclePoint => [side * x, y, z]),
    width,
    thickness,
  }));
}

/**
 * Lower facial expression muscles mapped to compact anterior ribbons instead
 * of a single spherical highlight. These are simplified surface guides, not
 * individual muscle-fiber meshes.
 */
export const LOWER_FACIAL_MUSCLE_PATHS: Record<string, FaceMuscleStrip[]> = {
  "Zygomaticus major": bilateralStrip(
    [
      [0.084, 1.88, 0.085], // zygomatic bone
      [0.068, 1.865, 0.102],
      [0.052, 1.85, 0.12],
      [0.038, 1.84, 0.14], // modiolus / mouth corner
    ],
    0.011,
    0.0028,
  ),

  "Zygomaticus minor": bilateralStrip(
    [
      [0.061, 1.89, 0.095], // infraorbital margin
      [0.049, 1.88, 0.113],
      [0.036, 1.865, 0.132],
      [0.024, 1.85, 0.14], // upper lip
    ],
    0.008,
    0.0022,
  ),

  "Risorius": bilateralStrip(
    [
      [0.112, 1.84, 0.082], // parotid-masseteric fascia
      [0.088, 1.842, 0.101],
      [0.063, 1.845, 0.121],
      [0.041, 1.85, 0.14], // mouth corner
    ],
    0.006,
    0.0018,
  ),

  "Orbicularis oris": [
    {
      centerline: [
        [-0.0286, 1.84, 0.133],
        [-0.026, 1.849, 0.14],
        [-0.0163, 1.853, 0.14],
        [0, 1.855, 0.14],
        [0.0163, 1.853, 0.14],
        [0.026, 1.849, 0.14],
        [0.0286, 1.84, 0.133],
        [0.026, 1.831, 0.14],
        [0.0163, 1.827, 0.14],
        [0, 1.825, 0.14],
        [-0.0163, 1.827, 0.14],
        [-0.026, 1.831, 0.14],
      ],
      width: 0.005,
      thickness: 0.002,
      closed: true,
    },
  ],

  "Buccinator": bilateralStrip(
    [
      [0.115, 1.81, 0.08], // posterior cheek / pterygomandibular raphe
      [0.094, 1.825, 0.098],
      [0.07, 1.835, 0.119],
      [0.047, 1.84, 0.14], // modiolus
    ],
    0.013,
    0.003,
  ),

  "Depressor anguli oris": bilateralStrip(
    [
      [0.046, 1.85, 0.14], // mouth corner
      [0.058, 1.81, 0.122],
      [0.073, 1.74, 0.103],
      [0.09, 1.67, 0.085], // mandibular border
    ],
    0.011,
    0.0028,
  ),

  "Levator labii superioris": bilateralStrip(
    [
      [0.05, 1.9, 0.105], // infraorbital margin beside the nose
      [0.039, 1.88, 0.122],
      [0.028, 1.865, 0.135],
      [0.019, 1.85, 0.14], // upper lip
    ],
    0.008,
    0.0022,
  ),

  "Depressor labii inferioris": bilateralStrip(
    [
      [0.031, 1.84, 0.14], // lower lip
      [0.042, 1.78, 0.128],
      [0.054, 1.72, 0.11],
      [0.065, 1.67, 0.09], // chin
    ],
    0.008,
    0.0022,
  ),

  "Mentalis": bilateralStrip(
    [
      [0.018, 1.84, 0.14], // lower lip
      [0.023, 1.78, 0.13],
      [0.027, 1.72, 0.113], // chin prominence
    ],
    0.007,
    0.002,
  ),

  "Levator anguli oris": bilateralStrip(
    [
      [0.05, 1.89, 0.112], // canine fossa
      [0.046, 1.87, 0.127],
      [0.043, 1.85, 0.14], // mouth corner
    ],
    0.007,
    0.002,
  ),

  "Nasalis": bilateralStrip(
    [
      [0.012, 1.9, 0.128], // lateral nasal bridge
      [0.026, 1.895, 0.135],
      [0.041, 1.885, 0.128], // alar cartilage
      [0.046, 1.87, 0.14], // nostril rim
    ],
    0.006,
    0.0018,
  ),

  "Platysma": bilateralStrip(
    [
      [0.115, 1.68, 0.082], // anterior lower neck
      [0.102, 1.72, 0.097],
      [0.083, 1.76, 0.115],
      [0.06, 1.79, 0.135], // lower jaw
    ],
    0.013,
    0.0024,
  ),
};
