import { getUpperLimbNerveCameraFocus } from '@n-apt/three-d/upperLimbNerveCameraFocus';

describe('upper-limb nerve camera framing', () => {
  test('centers arm nerve focus and backs away to fit both arms', () => {
    const focus = getUpperLimbNerveCameraFocus('Radial nerve', [0.25, 1.3, 0.12]);

    expect(focus?.target).toEqual([0, 1.3, 0.12]);
    expect(focus?.position[0]).toBe(0);
    expect(focus?.position[1]).toBeCloseTo(1.42);
    expect(focus?.position[2]).toBeCloseTo(3.02);
    expect(focus?.fov).toBe(42);
  });

  test('leaves non-arm nerve camera focus unchanged', () => {
    expect(getUpperLimbNerveCameraFocus('Sciatic nerve', [0, 0.72, -0.2])).toBeNull();
  });
});
