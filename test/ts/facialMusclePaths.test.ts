import { FACIAL_MUSCLE_SHAPES } from '@n-apt/three-d/facialMusclePaths';
import { LOWER_FACIAL_MUSCLE_PATHS } from '@n-apt/three-d/lowerFacialMusclePaths';

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

describe('orbicularis oculi overlay', () => {
  test('forms an elongated closed ring around each eye', () => {
    const shape = FACIAL_MUSCLE_SHAPES['Orbicularis oculi'];

    expect(shape.kind).toBe('ring');
    expect(shape.paths).toHaveLength(2);

    shape.paths.forEach((path) => {
      const xs = path.map(([x]) => x);
      const ys = path.map(([, y]) => y);
      const xSpan = Math.max(...xs) - Math.min(...xs);
      const ySpan = Math.max(...ys) - Math.min(...ys);
      const firstPoint = path[0];
      const lastPoint = path[path.length - 1];

      expect(xSpan).toBeGreaterThanOrEqual(0.036);
      expect(ySpan).toBeGreaterThanOrEqual(0.025);
      expect(xSpan / ySpan).toBeGreaterThan(1.3);
      expect(lastPoint).toEqual(firstPoint);
    });
  });

  test('anchors the orbital ring to the modeled face surface', () => {
    expect(FACIAL_MUSCLE_SHAPES['Orbicularis oculi'].surface).toBe('anterolateral');
  });
});

describe('zygomaticus major overlay', () => {
  test('anchors both cheek paths to the modeled face surface', () => {
    const paths = LOWER_FACIAL_MUSCLE_PATHS['Zygomaticus major'];

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
  });
});

describe('risorius overlay', () => {
  test('anchors both cheek paths to the modeled face surface', () => {
    const paths = LOWER_FACIAL_MUSCLE_PATHS.Risorius;

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
  });
});

describe('buccinator overlay', () => {
  test('anchors both cheek paths to the modeled face surface', () => {
    const paths = LOWER_FACIAL_MUSCLE_PATHS.Buccinator;

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
  });
});

describe('levator labii superioris overlay', () => {
  test('anchors both upper-lip paths to the modeled face surface', () => {
    const paths = LOWER_FACIAL_MUSCLE_PATHS['Levator labii superioris'];

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
  });
});

describe.each([
  ['Depressor anguli oris', LOWER_FACIAL_MUSCLE_PATHS['Depressor anguli oris']],
  ['Depressor labii inferioris', LOWER_FACIAL_MUSCLE_PATHS['Depressor labii inferioris']],
])('%s overlay', (_name, paths) => {
  test('stays on the lower face and anchors to the modeled surface', () => {
    const points = paths.flatMap(({ centerline }) => centerline);

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
    expect(Math.min(...points.map(([, y]) => y))).toBeGreaterThanOrEqual(1.74);
  });
});

describe('mentalis overlay', () => {
  test('stays on the chin and anchors to the modeled face surface', () => {
    const paths = LOWER_FACIAL_MUSCLE_PATHS.Mentalis;
    const points = paths.flatMap(({ centerline }) => centerline);

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
    expect(Math.min(...points.map(([, y]) => y))).toBeGreaterThanOrEqual(1.78);
  });
});

describe('levator anguli oris overlay', () => {
  test('anchors both mouth-corner paths to the modeled face surface', () => {
    const paths = LOWER_FACIAL_MUSCLE_PATHS['Levator anguli oris'];

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
  });
});

describe('platysma overlay', () => {
  test('anchors both neck paths to the modeled body surface', () => {
    const paths = LOWER_FACIAL_MUSCLE_PATHS.Platysma;

    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.surface === 'anterolateral')).toBe(true);
  });
});
