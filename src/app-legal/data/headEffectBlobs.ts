export const HEAD_EFFECT_BRAIN_SCALE = 0.4365;
export const HEAD_EFFECT_BRAIN_POSITION = [0.139593, 0.242673, 0.226651] as const;
export const HEAD_EFFECT_BRAIN_OPACITY = 0.72;
export const HEAD_EFFECT_INACTIVE_COLOR = '#9ca3af';
export const HEAD_EFFECT_BLOB_POSITION = [0, 1.01, 0.045] as const;
export const HEAD_EFFECT_BLOB_RADIUS = 0.052;
export const HEAD_EFFECT_APPEARANCE_STYLES = ['Soft tissue', 'Neural glow', 'Color wash'] as const;

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
