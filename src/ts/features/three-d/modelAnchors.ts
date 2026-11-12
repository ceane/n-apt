import { Object3D, Vector3 } from "three";

/** Rig anchors in the loaded asset's coordinate space, before viewer normalization.
 * Offsets are metres: +X right, +Y up, +Z forward. Apply the same parent
 * transform to the figure and its anchored objects. Center attached assets
 * before scaling them; never subtract an unscaled asset center from a target.
 */
export const MODEL_ANCHORS = {
  // The head joint starts near the base of the skull. The brain center sits
  // higher in the cranial cavity, slightly forward of that joint.
  brain: { bone: "head", offset: [0, 0.16, 0.025] },
  head: { bone: "head", offset: [0, 0, 0] },
  pelvis: { bone: "pelvis", offset: [0, 0, 0] },
  neck: { bone: "neck", offset: [0, 0, 0] },
  chest: { bone: "chest", offset: [0, 0, 0] },
  abdomen: { bone: "spine.01", offset: [0, 0, 0] },
  leftShoulder: { bone: "upper_arm.L", offset: [0, 0, 0] },
  rightShoulder: { bone: "upper_arm.R", offset: [0, 0, 0] },
  leftElbow: { bone: "forearm.L", offset: [0, 0, 0] },
  rightElbow: { bone: "forearm.R", offset: [0, 0, 0] },
  leftHand: { bone: "hand.L", offset: [0, 0, 0] },
  rightHand: { bone: "hand.R", offset: [0, 0, 0] },
  leftHip: { bone: "thigh.L", offset: [0, 0, 0] },
  rightHip: { bone: "thigh.R", offset: [0, 0, 0] },
  leftKnee: { bone: "shin.L", offset: [0, 0, 0] },
  rightKnee: { bone: "shin.R", offset: [0, 0, 0] },
  leftAnkle: { bone: "foot.L", offset: [0, 0, 0] },
  rightAnkle: { bone: "foot.R", offset: [0, 0, 0] },
  leftToes: { bone: "toes.L", offset: [0, 0, 0] },
  rightToes: { bone: "toes.R", offset: [0, 0, 0] },
} as const;

export type ModelAnchorName = keyof typeof MODEL_ANCHORS;

export function resolveModelAnchor(
  scene: Object3D,
  name: ModelAnchorName,
): [number, number, number] | null {
  const anchor = MODEL_ANCHORS[name];
  scene.updateWorldMatrix(true, true);
  const bone = scene.getObjectByName(anchor.bone);
  if (!bone) return null;
  const point = bone.getWorldPosition(new Vector3());
  if (scene.parent) scene.parent.worldToLocal(point);
  point.add(new Vector3(...anchor.offset));
  return [point.x, point.y, point.z];
}
