import { Object3D, Vector3 } from "three";
import { MODEL_ROOT_POSITION } from "@n-apt/consts";

// Bounds from human_ghost_expressive_underwear.glb. Model3DPerson normalizes
// this asset to 1.9 units high and centers those bounds at MODEL_ROOT_POSITION.
const MODEL_SOURCE_CENTER: [number, number, number] = [0, 1.023072, 0.0397485];
const MODEL_SOURCE_HEIGHT = 2.057744;
const MODEL_DISPLAY_SCALE = 1.9 / MODEL_SOURCE_HEIGHT;

export function modelSourcePointToWorld(
  point: [number, number, number],
): [number, number, number] {
  return [
    MODEL_ROOT_POSITION[0] + (point[0] - MODEL_SOURCE_CENTER[0]) * MODEL_DISPLAY_SCALE,
    MODEL_ROOT_POSITION[1] + (point[1] - MODEL_SOURCE_CENTER[1]) * MODEL_DISPLAY_SCALE,
    MODEL_ROOT_POSITION[2] + (point[2] - MODEL_SOURCE_CENTER[2]) * MODEL_DISPLAY_SCALE,
  ];
}

/** Rig anchors in the loaded asset's coordinate space, before viewer normalization.
 * Offsets are metres: +X toward the subject's left, +Y up, +Z toward the face.
 * Apply the same parent
 * transform to the figure and its anchored objects. Center attached assets
 * before scaling them; never subtract an unscaled asset center from a target.
 */
export const MODEL_ANCHORS = {
  // The brain center sits above the head joint and behind the facial plane.
  brain: { bone: "head", offset: [0, 0.18, -0.085] },
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
