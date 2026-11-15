/**
 * Simplified cranial-nerve centerlines in the source coordinates of
 * `human_ghost_expressive_underwear.glb` (X left/right, Y up, +Z anterior).
 * They are interior teaching guides rather than dissection-level anatomy.
 */
export type CranialNervePoint = [number, number, number];
export type CranialNervePath = CranialNervePoint[];

function bilateralPaths(...paths: CranialNervePath[]): CranialNervePath[] {
  return paths.flatMap((path) => [1, -1].map((side) =>
    path.map(([x, y, z]): CranialNervePoint => [x * side, y, z]),
  ));
}

/** Exact card-name keys consumed by the anatomy view. */
export const CRANIAL_NERVE_PATHS: Record<string, CranialNervePath[]> = {
  "Cranial nerve I Olfactory": bilateralPaths(
    // Olfactory fila pass from the superior nasal cavity through the
    // cribriform region to the olfactory bulb at the frontal base.
    [[0.012, 1.79, 0.045], [0.018, 1.83, 0.025], [0.024, 1.87, -0.005], [0.03, 1.9, -0.025]],
  ),
  "Cranial nerve II Optic": bilateralPaths(
    // Posterior orbit -> optic canal -> midline optic chiasm.
    [[0.068, 1.78, 0.045], [0.045, 1.79, 0.005], [0.022, 1.8, -0.035], [0, 1.805, -0.05]],
  ),
  "Cranial nerve III Oculomotor": bilateralPaths(
    // Ventral midbrain through the cavernous sinus toward the orbital apex.
    [[0.012, 1.72, -0.055], [0.024, 1.735, -0.025], [0.043, 1.76, 0.005], [0.064, 1.785, 0.035]],
  ),
  "Cranial nerve IV Trochlear": bilateralPaths(
    // Dorsal midbrain nerve that wraps around the brainstem before entering
    // the orbit to reach the superior oblique muscle.
    [[0.012, 1.735, -0.085], [0.025, 1.73, -0.07], [0.042, 1.745, -0.025], [0.06, 1.77, 0.025]],
  ),
  "Cranial nerve V Trigeminal": bilateralPaths(
    // Root from the lateral pons to the trigeminal ganglion, then V1/V2/V3
    // branches. The faceward segments sit beneath the facial surface.
    [[0.025, 1.715, -0.06], [0.05, 1.71, -0.03], [0.074, 1.69, 0.005]],
    [[0.074, 1.69, 0.005], [0.075, 1.735, 0.045], [0.063, 1.79, 0.075], [0.045, 1.86, 0.085]],
    [[0.074, 1.69, 0.005], [0.088, 1.71, 0.045], [0.073, 1.75, 0.085], [0.05, 1.78, 0.1]],
    [[0.074, 1.69, 0.005], [0.083, 1.66, 0.04], [0.065, 1.635, 0.075], [0.043, 1.625, 0.095]],
  ),
  "Cranial nerve VI Abducens": bilateralPaths(
    // Pontomedullary junction to the lateral rectus in the orbit.
    [[0.012, 1.7, -0.055], [0.022, 1.725, -0.015], [0.04, 1.755, 0.02], [0.064, 1.78, 0.045]],
  ),
  "Cranial nerve VII Facial": bilateralPaths(
    // Internal acoustic canal -> facial canal -> stylomastoid foramen ->
    // parotid plexus -> temporal facial-expression branches.
    [[0.025, 1.71, -0.065], [0.055, 1.7, -0.045], [0.078, 1.68, -0.015], [0.09, 1.665, 0.025], [0.092, 1.68, 0.05], [0.073, 1.725, 0.075], [0.05, 1.78, 0.09]],
    // Zygomatic branches to the lateral orbit and upper cheek.
    [[0.025, 1.71, -0.065], [0.055, 1.7, -0.045], [0.078, 1.68, -0.015], [0.09, 1.665, 0.025], [0.09, 1.69, 0.06], [0.07, 1.73, 0.09], [0.052, 1.765, 0.105]],
    // Buccal branches across the deep cheek toward the mouth corner.
    [[0.025, 1.71, -0.065], [0.055, 1.7, -0.045], [0.078, 1.68, -0.015], [0.09, 1.665, 0.025], [0.085, 1.665, 0.065], [0.063, 1.67, 0.1], [0.042, 1.68, 0.115]],
    // Marginal mandibular branch follows the inner contour of the jaw.
    [[0.025, 1.71, -0.065], [0.055, 1.7, -0.045], [0.078, 1.68, -0.015], [0.09, 1.665, 0.025], [0.088, 1.635, 0.045], [0.065, 1.615, 0.075], [0.045, 1.62, 0.095]],
    // Cervical branch descends from the parotid region into the upper neck.
    [[0.025, 1.71, -0.065], [0.055, 1.7, -0.045], [0.078, 1.68, -0.015], [0.09, 1.665, 0.025], [0.092, 1.63, 0.015], [0.085, 1.59, 0.005], [0.075, 1.55, 0]],
  ),
  "Cranial nerve VIII Vestibulocochlear": bilateralPaths(
    // Cochlear and vestibular root from the inner ear to the cerebellopontine
    // angle. It remains confined to the skull.
    [[0.105, 1.735, -0.045], [0.08, 1.73, -0.06], [0.052, 1.72, -0.07], [0.025, 1.705, -0.065]],
  ),
  "Cranial nerve IX Glossopharyngeal": bilateralPaths(
    // Jugular foramen to the upper pharynx and posterior third of the tongue.
    [[0.025, 1.69, -0.06], [0.05, 1.665, -0.03], [0.068, 1.625, 0.005], [0.072, 1.59, 0.04]],
    // Pharyngeal and tonsillar branches stay in the deep pharyngeal wall.
    [[0.068, 1.625, 0.005], [0.085, 1.61, 0.025], [0.09, 1.59, 0.055]],
  ),
  "Cranial nerve X Vagus": [
    // Right vagus: skull base through the carotid sheath into the upper
    // mediastinum, with pharyngeal and recurrent laryngeal branches.
    [[-0.025, 1.69, -0.06], [-0.05, 1.66, -0.035], [-0.05, 1.59, -0.025], [-0.045, 1.49, -0.025], [-0.04, 1.39, -0.02], [-0.035, 1.3, -0.015], [-0.025, 1.21, -0.02]],
    [[-0.05, 1.59, -0.025], [-0.075, 1.585, 0.015], [-0.085, 1.56, 0.045]],
    [[-0.045, 1.49, -0.025], [-0.065, 1.52, 0.005], [-0.075, 1.55, 0.035]],
    // Left recurrent laryngeal branch loops beneath the aortic arch before
    // ascending back to the larynx; the main trunk continues into the chest.
    [[0.05, 1.69, -0.06], [0.055, 1.65, -0.035], [0.05, 1.58, -0.025], [0.045, 1.49, -0.025], [0.04, 1.39, -0.02], [0.035, 1.3, -0.015], [0.025, 1.21, -0.02]],
    [[0.045, 1.49, -0.025], [0.055, 1.42, -0.04], [0.06, 1.33, -0.045], [0.05, 1.3, -0.035], [0.045, 1.39, -0.005], [0.06, 1.48, 0.025]],
    [[0.05, 1.58, -0.025], [0.075, 1.58, 0.015], [0.085, 1.55, 0.045]],
  ],
  "Cranial nerve XI Accessory": bilateralPaths(
    // Spinal rootlets ascend from upper cervical cord to the jugular foramen;
    // the extracranial trunk descends along deep SCM, crosses the posterior
    // triangle, and reaches the upper trapezius at the shoulder.
    [[0.012, 1.49, -0.065], [0.022, 1.56, -0.075], [0.035, 1.63, -0.08], [0.05, 1.69, -0.065], [0.067, 1.64, -0.045], [0.08, 1.56, -0.035], [0.095, 1.52, -0.04], [0.12, 1.49, -0.055], [0.13, 1.465, -0.065]],
    // A short motor branch enters the sternocleidomastoid muscle.
    [[0.05, 1.69, -0.065], [0.067, 1.64, -0.045], [0.082, 1.57, -0.015], [0.105, 1.51, 0.005]],
  ),
  "Cranial nerve XII Hypoglossal": bilateralPaths(
    // Hypoglossal canal, deep floor of mouth, then intralingual motor course.
    [[0.022, 1.69, -0.06], [0.045, 1.655, -0.035], [0.055, 1.625, 0.005], [0.045, 1.61, 0.05], [0.03, 1.625, 0.09], [0.015, 1.645, 0.115]],
    // Branches fan within tongue musculature instead of extending outside the
    // mouth or down the neck.
    [[0.045, 1.61, 0.05], [0.055, 1.625, 0.085], [0.05, 1.65, 0.11]],
  ),
};
