import { FACIAL_MUSCLE_SHAPES } from '@n-apt/three-d/facialMusclePaths';

const JAW_MUSCLES = [
  'Masseter',
  'Temporalis',
  'Medial pterygoid',
  'Lateral pterygoid',
] as const;

describe('jaw muscle overlays', () => {
  test.each(JAW_MUSCLES)('%s uses bilateral fiber paths on the head', (name) => {
    const shape = FACIAL_MUSCLE_SHAPES[name];
    expect(shape).toBeDefined();
    if (!shape) return;

    const points = shape.paths.flat();

    expect(shape.kind).toBe('fiber-sheet');
    expect(shape.halfWidth).toBeLessThanOrEqual(0.005);
    expect(shape.paths.length).toBeGreaterThanOrEqual(2);
    expect(shape.paths.every((path) => path.length >= 4)).toBe(true);
    expect(points.some(([x]) => x < 0)).toBe(true);
    expect(points.some(([x]) => x > 0)).toBe(true);

    const yValues = points.map(([, y]) => y);
    expect(Math.min(...yValues)).toBeGreaterThan(1.8);
    expect(Math.max(...yValues)).toBeLessThan(2.02);
    expect(Math.max(...points.map(([x]) => Math.abs(x)))).toBeLessThanOrEqual(0.08);
  });
});
