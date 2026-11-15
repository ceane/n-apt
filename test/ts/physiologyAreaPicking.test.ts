import { resolvePhysiologyAreaAtPoint } from '@n-apt/three-d/physiologyAreaPicking';

const areas = [
  { name: 'Head', position: [0, 1.9, 0] as [number, number, number] },
  { name: 'Face', position: [0, 1.86, 0.1] as [number, number, number] },
  { name: 'Eyes', position: [0, 1.92, 0.105] as [number, number, number] },
  { name: 'Ears (Left)', position: [-0.095, 1.91, 0.005] as [number, number, number] },
  { name: 'Ears (Right)', position: [0.095, 1.91, 0.005] as [number, number, number] },
  { name: 'Arms (Left)', position: [-0.22, 1.65, 0.08] as [number, number, number] },
  { name: 'Arms (Right)', position: [0.22, 1.65, 0.08] as [number, number, number] },
  { name: 'Hands (Left)', position: [-0.8, 1.65, 0.08] as [number, number, number] },
  { name: 'Hands (Right)', position: [0.8, 1.65, 0.08] as [number, number, number] },
  { name: 'Torso', position: [0.08, 1.72, 0.01] as [number, number, number] },
];

describe('physiology body picking', () => {
  test('maps eye clicks to Eyes and nearby cheek clicks to Face', () => {
    expect(resolvePhysiologyAreaAtPoint([-0.026, 1.92, 0.11], areas)?.name).toBe('Eyes');
    expect(resolvePhysiologyAreaAtPoint([0.026, 1.92, 0.11], areas)?.name).toBe('Eyes');
    expect(resolvePhysiologyAreaAtPoint([0.08, 1.87, 0.07], areas)?.name).toBe('Face');
  });

  test('keeps clicks on either ear mapped to that side', () => {
    expect(resolvePhysiologyAreaAtPoint([-0.095, 1.91, 0.005], areas)?.name).toBe('Ears (Left)');
    expect(resolvePhysiologyAreaAtPoint([0.095, 1.91, 0.005], areas)?.name).toBe('Ears (Right)');
    expect(resolvePhysiologyAreaAtPoint([-0.095, 1.90, 0.06], areas)?.name).toBe('Ears (Left)');
  });

  test('keeps ear hits local and does not capture the shoulder or torso', () => {
    expect(resolvePhysiologyAreaAtPoint([-0.22, 1.65, 0.08], areas)?.name).toBe('Arms (Left)');
    expect(resolvePhysiologyAreaAtPoint([0.22, 1.65, 0.08], areas)?.name).toBe('Arms (Right)');
    expect(resolvePhysiologyAreaAtPoint([0.20, 1.76, 0.09], areas)?.name).toBe('Arms (Right)');
    expect(resolvePhysiologyAreaAtPoint([0.08, 1.72, 0.01], areas)?.name).toBe('Torso');
    expect(resolvePhysiologyAreaAtPoint([-0.095, 1.91, -0.15], areas)?.name).not.toBe('Ears (Left)');
  });

  test('maps upper arm and hand clicks to their own body areas', () => {
    expect(resolvePhysiologyAreaAtPoint([-0.32, 1.65, 0.08], areas)?.name).toBe('Arms (Left)');
    expect(resolvePhysiologyAreaAtPoint([0.82, 1.65, 0.08], areas)?.name).toBe('Hands (Right)');
  });
});
