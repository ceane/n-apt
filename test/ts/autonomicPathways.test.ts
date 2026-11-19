import { NERVOUS_SYSTEM_CARDS } from '@n-apt/learn/sidebar/AnatomyCardsSection';
import { AUTONOMIC_PATHWAYS, AUTONOMIC_PATHWAY_VIEWS } from '@n-apt/three-d/autonomicPathways';

describe('autonomic pathway cards', () => {
  test('provides a selectable overview in the Autonomic pathways group', () => {
    const card = NERVOUS_SYSTEM_CARDS.find((entry) => entry.name === 'Autonomic pathways');

    expect(card).toBeDefined();
    expect(card?.group).toBe('Autonomic pathways');
    expect(card?.function.toLowerCase()).toContain('sympathetic');
    expect(card?.function.toLowerCase()).toContain('parasympathetic');
    expect(card?.function.toLowerCase()).toContain('enteric');
  });

  test('models sympathetic outflow on both sides from thoracolumbar cord to visceral ganglia', () => {
    const paths = AUTONOMIC_PATHWAYS['Sympathetic division'];
    const sides = new Set(paths.flatMap((path) => path.map(([x]) => Math.sign(x)).filter(Boolean)));

    expect(paths.length).toBeGreaterThanOrEqual(8);
    expect(sides).toEqual(new Set([-1, 1]));
    expect(paths.some((path) => path.some(([, y]) => y >= 1.45) && path.some(([, y]) => y <= 1.2))).toBe(true);
  });

  test('models craniosacral parasympathetic routes and a separate enteric gut network', () => {
    const parasympathetic = AUTONOMIC_PATHWAYS['Parasympathetic division'];
    const enteric = AUTONOMIC_PATHWAYS['Enteric nervous system'];
    const vagalPath = parasympathetic.some((path) => Math.max(...path.map(([, y]) => y)) >= 1.7 && Math.min(...path.map(([, y]) => y)) <= 1.3);
    const pelvicPath = parasympathetic.some((path) => Math.min(...path.map(([, y]) => y)) <= 0.9 && Math.max(...path.map(([, y]) => y)) >= 0.78);
    const closedEntericLoops = enteric.filter((path) => {
      const first = path[0];
      const last = path[path.length - 1];
      return Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 0.03;
    });

    expect(vagalPath).toBe(true);
    expect(pelvicPath).toBe(true);
    expect(enteric.length).toBeGreaterThanOrEqual(4);
    expect(closedEntericLoops.length).toBeGreaterThanOrEqual(2);
  });

  test('provides pathway-specific camera views for the trunk and gut routes', () => {
    expect(AUTONOMIC_PATHWAY_VIEWS['Sympathetic division'].cameraSurface).toBe('posterior');
    expect(AUTONOMIC_PATHWAY_VIEWS['Parasympathetic division'].cameraSurface).toBe('anterior');
    expect(AUTONOMIC_PATHWAY_VIEWS['Enteric nervous system'].cameraSurface).toBe('anterior');
  });
});
