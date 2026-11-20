import { NERVOUS_SYSTEM_CARDS } from '@n-apt/learn/sidebar/AnatomyCardsSection';
import { AUTONOMIC_PATHWAYS, AUTONOMIC_PATHWAY_VIEWS } from '@n-apt/three-d/autonomicPathways';
import { CRANIAL_NERVE_PATHS } from '@n-apt/three-d/cranialNervePaths';
import { SKIN_SENSATION_PATHS } from '@n-apt/three-d/skinSensationPaths';

describe('nasal and respiratory anatomy routes', () => {
  test('keeps a single selectable intercostal-nerve card', () => {
    const cards = NERVOUS_SYSTEM_CARDS.filter((card) => card.name === 'Intercostal nerves');

    expect(cards).toHaveLength(1);
    expect(cards[0].tags).toEqual(expect.arrayContaining(['lungs', 'breathing', 'T1-T11']));
  });

  test('draws paired nasal sensory branches within the face', () => {
    const paths = CRANIAL_NERVE_PATHS['Nasal sensory nerves (V1/V2)'];
    const sides = new Set(paths.map((path) => Math.sign(path[0][0])));
    const points = paths.flat();

    expect(paths).toHaveLength(8);
    expect(paths.every((path) => path.length >= 3)).toBe(true);
    expect(sides).toEqual(new Set([-1, 1]));
    expect(Math.min(...points.map(([, y]) => y))).toBeGreaterThan(1.65);
    expect(Math.max(...points.map(([, y]) => y))).toBeLessThan(1.82);
  });

  test('draws bilateral pulmonary plexus routes and focuses the chest', () => {
    const paths = AUTONOMIC_PATHWAYS['Pulmonary autonomic plexus'];
    const sides = new Set(paths.map((path) => Math.sign(path[0][0])));
    const points = paths.flat();

    expect(paths).toHaveLength(8);
    expect(sides).toEqual(new Set([-1, 1]));
    expect(Math.min(...points.map(([, y]) => y))).toBeGreaterThan(1.35);
    expect(Math.max(...points.map(([, y]) => y))).toBeLessThan(1.55);
    expect(AUTONOMIC_PATHWAY_VIEWS['Pulmonary autonomic plexus'].cameraSurface).toBe('anterior');
  });

  test('traces intercostal nerves across posterior, lateral, and anterior chest surfaces', () => {
    const paths = SKIN_SENSATION_PATHS['Intercostal nerves'].paths;
    const surfaces = new Set(paths.map((path) => path.surface));

    expect(paths).toHaveLength(66);
    expect(surfaces).toEqual(new Set(['anterior', 'lateral', 'posterior']));
  });
});
