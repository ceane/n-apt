export const HEAD_EFFECT_BRAIN_SCALE = 0.4365;
export const HEAD_EFFECT_BRAIN_POSITION = [0.139593, 0.242673, 0.226651] as const;
export const HEAD_EFFECT_BRAIN_OPACITY = 0.72;
export const HEAD_EFFECT_INACTIVE_COLOR = '#9ca3af';
export const HEAD_EFFECT_BLOB_POSITION = [0, 1.01, 0.045] as const;
export const HEAD_EFFECT_BLOB_RADIUS = 0.052;
export const HEAD_EFFECT_APPEARANCE_STYLES = ['Fur dot', 'Vortex clouds', 'Magic carpet', 'Scraggles', 'C-clamp', 'Water pipe', 'Rusty pistons', 'Evil ghost', 'Peeking ghost'] as const;
export const HEAD_EFFECT_FUR_CORE_RADIUS = 0.034;
export const HEAD_EFFECT_FUR_LENGTH = 0.012;

export function scraggleStrokePoint(progress: number): [number, number, number] {
  const turn = progress * Math.PI * 11;
  const radius = 0.12 + (1 - progress) * 0.54;
  return [
    Math.cos(turn) * radius + Math.sin(progress * 58) * 0.025,
    0.68 - progress * 1.38 + Math.sin(turn) * 0.055,
    0.17 + Math.sin(turn) * 0.08,
  ];
}

export function scraggleEmissionPoint(stroke: number, progress: number): [number, number, number] {
  const angle = stroke * 2.39996323;
  const height = 0.42 - (stroke % 5) * 0.21;
  const coreRadius = 0.21 + (height + 0.42) * 0.23;
  const radius = coreRadius + progress * 0.26;
  return [
    Math.cos(angle) * radius,
    height + progress * 0.08 + Math.sin(progress * Math.PI) * 0.04,
    0.16 + Math.sin(angle) * 0.07 + progress * 0.02,
  ];
}

export function organicBlobRadius(angle: number, seed: number, elapsed: number): number {
  const phase = seed * 1.37;
  const breathe = Math.sin(elapsed * 2.1 + phase);
  return 1
    + Math.sin(angle * 2 + phase) * (0.16 + breathe * 0.018)
    + Math.cos(angle * 3 - phase * 0.7) * (0.09 + breathe * 0.012);
}

export const HEAD_EFFECT_BLOB_DEFINITIONS = [
  { name: 'Perceptual', seed: 1, position: HEAD_EFFECT_BLOB_POSITION, radius: HEAD_EFFECT_BLOB_RADIUS, colors: ['#4f8dff', '#72d6ff', '#9b83ff'] },
  { name: 'Compressed', seed: 2, position: HEAD_EFFECT_BLOB_POSITION, radius: HEAD_EFFECT_BLOB_RADIUS, colors: ['#8269ee', '#ba82ff', '#607df2'] },
  { name: 'Chemical', seed: 3, position: HEAD_EFFECT_BLOB_POSITION, radius: HEAD_EFFECT_BLOB_RADIUS, colors: ['#27b89a', '#8ad96f', '#3bbfe0'] },
  { name: 'Somatic (sensations, pressure, jolts)', seed: 4, position: HEAD_EFFECT_BLOB_POSITION, radius: HEAD_EFFECT_BLOB_RADIUS, colors: ['#ff8169', '#ffbd62', '#e76fb0'] },
  { name: 'Autonomic (manipulating involuntary functions of your body)', seed: 5, position: HEAD_EFFECT_BLOB_POSITION, radius: HEAD_EFFECT_BLOB_RADIUS, colors: ['#e06f9c', '#ff9b78', '#b783ef'] },
] as const;
