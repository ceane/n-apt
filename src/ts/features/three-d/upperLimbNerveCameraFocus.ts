export type CameraFocusPoint = [number, number, number];

export type UpperLimbNerveCameraFocus = {
  target: CameraFocusPoint;
  position: CameraFocusPoint;
  fov: number;
};

const UPPER_LIMB_NERVE_NAMES = /^(brachial plexus|radial nerve|musculocutaneous nerve|median nerve|ulnar nerve)$/i;
const CAMERA_DISTANCE = 2.9;
const CAMERA_FOV = 42;

/** Keep bilateral arm nerve views centered and wide enough to show both arms. */
export function getUpperLimbNerveCameraFocus(
  name: string,
  [, y, z]: CameraFocusPoint,
): UpperLimbNerveCameraFocus | null {
  if (!UPPER_LIMB_NERVE_NAMES.test(name)) return null;

  return {
    target: [0, y, z],
    position: [0, y + 0.12, z + CAMERA_DISTANCE],
    fov: CAMERA_FOV,
  };
}
