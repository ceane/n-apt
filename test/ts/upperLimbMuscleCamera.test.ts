import { getUpperLimbMuscleCameraFocus } from '@n-apt/three-d/upperLimbMusclePaths';

test('frames the selected hand rather than both arms across the torso', () => {
  const focus = getUpperLimbMuscleCameraFocus('Thenar muscles', 0.6)!;
  expect(focus.target[0]).toBeGreaterThan(0.5);
  expect(Math.abs(focus.position[2] - focus.target[2])).toBeLessThan(1);
});

test('fits the upper arm and looks from behind for triceps', () => {
  const focus = getUpperLimbMuscleCameraFocus('Triceps brachii', 0.6)!;
  expect(focus.position[2]).toBeLessThan(focus.target[2]);
  expect(focus.target[0]).toBeGreaterThan(0.15);
});
