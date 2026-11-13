import { CRANIAL_NERVE_PATHS } from '@n-apt/three-d/cranialNervePaths';
import { insetNervePathPoint } from '@n-apt/three-d/nervePathDepth';

describe('nerve path depth placement', () => {
  test('moves posterior and anterior points toward the model interior', () => {
    const posterior = insetNervePathPoint([0.1, 1.5, -0.12]);
    const anterior = insetNervePathPoint([0.1, 1.5, 0.16]);

    expect(posterior[0]).toBe(0.1);
    expect(posterior[1]).toBe(1.5);
    expect(posterior[2]).toBeGreaterThan(-0.1);
    expect(anterior[2]).toBeLessThan(0.14);
  });

  test('keeps the accessory nerve within the neck and shoulder outline', () => {
    const points = CRANIAL_NERVE_PATHS['Cranial nerve XI Accessory'].flat();

    expect(Math.max(...points.map(([x]) => Math.abs(x)))).toBeLessThanOrEqual(0.14);
    expect(Math.min(...points.map(([, y]) => y))).toBeGreaterThan(1.4);
    expect(Math.max(...points.map(([, y]) => y))).toBeLessThan(1.72);
  });
});
