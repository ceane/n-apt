import {
  VISION_PRESETS,
  visionStimulusSchema,
  type VisionStimulus,
  type VisionPair,
} from "./visionModel";

const linear = (x: number) =>
  x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
const encoded = (x: number) =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
// Fixed linear-sRGB -> LMS approximation; its numerical matrix defines v1.
// Versioned coordinate system, not measured monitor spectra or isolated cone responses.
const LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
];
const RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
];
const multiply = (matrix: number[][], v: readonly number[]) =>
  matrix.map((row) => row.reduce((sum, x, i) => sum + x * v[i], 0));
const triple = (v: readonly number[]) => {
  if (v.length !== 3 || !v.every(Number.isFinite))
    throw new Error("Expected three finite coordinates");
};
export function rgbToOpponent(rgb: readonly number[]): number[] {
  triple(rgb);
  if (rgb.some((x) => x < 0 || x > 255)) throw new Error("Expected RGB bytes");
  const [l, m, s] = multiply(
    LMS,
    rgb.map((x) => linear(x / 255)),
  );
  return [l + m, l - m, s - l - m];
}
export function opponentToRgb(value: readonly number[]): number[] {
  triple(value);
  const [y, rg, by] = value;
  return multiply(RGB, [(y + rg) / 2, (y - rg) / 2, by + y]).map((x) =>
    Math.min(255, Math.max(0, encoded(x) * 255)),
  );
}

/** Pure v1 generator: packed 16x16 sRGB bytes, excluding presentation chrome. */
export function generateVisionReference(
  stimulus: VisionStimulus,
  frameIndex: number,
): Uint8Array {
  visionStimulusSchema.parse(stimulus);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex > 599)
    throw new Error("Invalid frame index");
  const output = new Uint8Array(768);
  if (stimulus.kind === "solid") {
    for (let i = 0; i < 256; i++)
      output.set(VISION_PRESETS[stimulus.preset], i * 3);
    return output;
  }
  let state = (stimulus.seed ^ Math.imul(frameIndex + 1, 0x9e3779b1)) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const palette = [
    ...Object.values(VISION_PRESETS),
    [0, 0, 0],
    [128, 128, 128],
    [255, 255, 255],
  ];
  const mode = next() % 4;
  const cell = [1, 2, 4, 8][next() % 4];
  const patchX = next() % (17 - cell),
    patchY = next() % (17 - cell);
  const colors = new Map<string, number[]>();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const key =
        mode === 0
          ? `${Math.floor(x / cell)}`
          : mode === 1
            ? `${Math.floor(y / cell)}`
            : mode === 2
              ? `${Math.floor(x / cell)},${Math.floor(y / cell)}`
              : `${x >= patchX && x < patchX + cell && y >= patchY && y < patchY + cell}`;
      if (!colors.has(key)) {
        const color = palette[next() % palette.length];
        const gain = [0.25, 0.5, 0.75, 1][next() % 4];
        colors.set(
          key,
          color.map((v) => Math.round(v * gain)),
        );
      }
      output.set(colors.get(key)!, (y * 16 + x) * 3);
    }
  return output;
}

/** Guard transition edges by measured clock uncertainty plus 25 ms presentation
 * allowance. This is not a measurement of physical display latency. */
export function visionTargetAt(
  pair: VisionPair,
  timestampBackendMs: number,
): Uint8Array | null {
  if (pair.status !== "complete" || !Number.isFinite(timestampBackendMs))
    return null;
  const guard = pair.config.clock.uncertaintyMs + 25;
  for (let i = 0; i < pair.timeline.length; i++) {
    const start = pair.timeline[i].onsetBackendMs;
    const end = pair.timeline[i + 1]?.onsetBackendMs ?? pair.endBackendMs;
    if (
      timestampBackendMs >= start + guard &&
      timestampBackendMs < end - guard
    ) {
      return generateVisionReference(
        pair.config.stimulus,
        pair.timeline[i].frameIndex,
      );
    }
  }
  return null;
}
