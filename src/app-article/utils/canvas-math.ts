export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const logNormalize = (value: number, maxAbs: number) => {
  const safeMax = Math.max(maxAbs, 0.0001);
  const normalized = clamp(Math.abs(value) / safeMax, 0, 1);
  return Math.log1p(normalized * 8) / Math.log1p(8);
};

export const toEndpointADistanceCm = (
  x: number,
  sceneLeft: number,
  sceneRight: number,
  minDistance: number,
  maxDistance: number,
  clampMin: number,
  clampMax: number
) => {
  const response = logNormalize(x, Math.max(Math.abs(sceneLeft), Math.abs(sceneRight)));
  return clamp(minDistance + response * (maxDistance - minDistance), clampMin, clampMax);
};

export const toEndpointBDistanceCm = (
  y: number,
  sceneBottom: number,
  sceneTop: number,
  minDistance: number,
  maxDistance: number,
  clampMin: number,
  clampMax: number
) => {
  const response = logNormalize(y, Math.max(Math.abs(sceneBottom), Math.abs(sceneTop)));
  return clamp(minDistance + response * (maxDistance - minDistance), clampMin, clampMax);
};

export function formatPiLabel(i: number, f: number) {
  let n = Math.round(i * 10);
  let d = Math.round(4 * f * 10);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.abs(n), Math.abs(d));
  n = n / divisor;
  d = d / divisor;

  if (n === 0) return '0';

  let numStr = '';
  if (n === 1) numStr = 'π';
  else if (n === -1) numStr = '-π';
  else numStr = `${n}π`;

  if (d === 1) return numStr;
  return `${numStr}/${d}`;
}

export const generateBinaryString = (length: number = 8, separator: string = ''): string => {
  return Array.from({ length }, () => (Math.random() > 0.5 ? '1' : '0')).join(separator);
};

export const generateHexString = (length: number = 8, separator: string = ''): string => {
  const hexChars = '0123456789ABCDEF';
  return Array.from({ length }, () => hexChars[Math.floor(Math.random() * 16)]).join(separator);
}
