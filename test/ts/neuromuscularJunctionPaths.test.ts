import { NEUROMUSCULAR_JUNCTION_PATHS } from '@n-apt/three-d/neuromuscularJunctionPaths';

describe('neuromuscular junction overlay', () => {
  test('uses a compact branching motor terminal on the upper arm', () => {
    const paths = NEUROMUSCULAR_JUNCTION_PATHS['Neuromuscular junction'];

    expect(paths).toBeDefined();
    expect(paths.length).toBeGreaterThanOrEqual(4);
    expect(paths.every((path) => path.length >= 3)).toBe(true);

    const points = paths.flat();
    expect(Math.min(...points.map(([, y]) => y))).toBeGreaterThan(1.55);
    expect(Math.max(...points.map(([, y]) => y))).toBeLessThan(1.72);
    expect(Math.min(...points.map(([x]) => x))).toBeGreaterThan(0.24);
    expect(Math.max(...points.map(([x]) => x))).toBeLessThan(0.38);
  });
});
