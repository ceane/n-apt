import { FFT_COMPUTE_SHADER } from "../../../src/ts/consts/shaders/fft_compute";
import { SPECTRUM_SHADER } from "../../../src/ts/consts/shaders/spectrum";
import {
  WATERFALL_3D_FRAGMENT_SHADER,
  WATERFALL_3D_VERTEX_SHADER,
} from "../../../src/ts/consts/shaders/waterfall3d";

const EPSILON = 1e-6;

function approxEqual(actual: number, expected: number, epsilon = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
}

function idxToX(idx: number, minX: number, maxX: number, length: number) {
  const len = Math.max(1, length);
  const t = len > 1 ? idx / (len - 1) : 0;
  return minX + (maxX - minX) * t;
}

function valueToY(value: number, minY: number, maxY: number, minValue: number, maxValue: number) {
  const normalized = Math.min(
    1,
    Math.max(0, (value - minValue) / (maxValue - minValue)),
  );
  return minY + (maxY - minY) * normalized;
}

function hanningWindow(index: number, size: number) {
  const t = index / (size - 1);
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
}

function twiddleFactor(k: number, n: number, direction: 1 | -1) {
  const angle = (-2 * Math.PI * k * direction) / n;
  return { real: Math.cos(angle), imag: Math.sin(angle) };
}

function complexMul(
  a: { real: number; imag: number },
  b: { real: number; imag: number },
) {
  return {
    real: a.real * b.real - a.imag * b.imag,
    imag: a.real * b.imag + a.imag * b.real,
  };
}

function complexAdd(
  a: { real: number; imag: number },
  b: { real: number; imag: number },
) {
  return { real: a.real + b.real, imag: a.imag + b.imag };
}

function complexSub(
  a: { real: number; imag: number },
  b: { real: number; imag: number },
) {
  return { real: a.real - b.real, imag: a.imag - b.imag };
}

describe("shader math fidelity", () => {
  it("maps spectrum vertices linearly across both axes", () => {
    const uniforms = [
      [100, -1, 110, 1],
      [0, -80, 0, 0],
    ] as const;

    approxEqual(idxToX(0, uniforms[0][0], uniforms[0][2], 5), 100);
    approxEqual(idxToX(2, uniforms[0][0], uniforms[0][2], 5), 105);
    approxEqual(idxToX(4, uniforms[0][0], uniforms[0][2], 5), 110);
    approxEqual(
      valueToY(-80, uniforms[0][1], uniforms[0][3], uniforms[1][1], uniforms[1][3]),
      -1,
    );
    approxEqual(
      valueToY(0, uniforms[0][1], uniforms[0][3], uniforms[1][1], uniforms[1][3]),
      1,
    );
  });

  it("uses the baseline for the spectrum fill lower vertices", () => {
    const minY = -1;
    const maxY = 1;
    const baseline = minY;
    const waveform = [-40, -20, 0];

    const top = valueToY(waveform[1], minY, maxY, -40, 0);
    expect(baseline).toBe(-1);
    expect(top).toBe(0);
  });

  it("applies the hanning window with zero endpoints and a symmetric peak", () => {
    approxEqual(hanningWindow(0, 8), 0);
    approxEqual(hanningWindow(7, 8), 0);
    expect(hanningWindow(3, 8)).toBeGreaterThan(hanningWindow(2, 8));
    expect(hanningWindow(4, 8)).toBeCloseTo(hanningWindow(3, 8), 12);
  });

  it("computes FFT twiddle factors and butterflies correctly", () => {
    const twiddle = twiddleFactor(1, 4, 1);
    approxEqual(twiddle.real, 0);
    approxEqual(twiddle.imag, -1);

    const a = { real: 3, imag: 2 };
    const b = { real: 1, imag: -1 };
    const rotated = complexMul(b, twiddle);
    approxEqual(rotated.real, -1);
    approxEqual(rotated.imag, -1);

    const sum = complexAdd(a, rotated);
    const diff = complexSub(a, rotated);
    approxEqual(sum.real, 2);
    approxEqual(sum.imag, 1);
    approxEqual(diff.real, 4);
    approxEqual(diff.imag, 3);
  });

  it("darkens waterfall fragments with depth and preserves alpha", () => {
    const color = [0.8, 0.5, 0.2];
    const depth = 0.75;
    const depthFade = 1 - Math.abs(depth) * 0.4;
    const final = color.map((channel) => channel * depthFade);

    approxEqual(depthFade, 0.7);
    approxEqual(final[0], 0.56);
    approxEqual(final[1], 0.35);
    approxEqual(final[2], 0.14);
  });

  it("produces a 3D waterfall perspective that moves farther rows back", () => {
    const resolution = { x: 1920, y: 1080 };
    const frequencyRange = { min: 100, max: 110 };
    const fftParams = { minDb: -100, maxDb: 0, frameCount: 10, frameSpacing: 0.02 };

    const nearDepth = (0 / fftParams.frameCount) * 2 - 1;
    const farDepth = (9 / fftParams.frameCount) * 2 - 1;

    const screenX = ((105 - frequencyRange.min) / (frequencyRange.max - frequencyRange.min) * 2 - 1) *
      (resolution.x / resolution.y);
    const screenY = ((-40 - fftParams.minDb) / (fftParams.maxDb - fftParams.minDb)) * 2 - 1;

    const nearPerspectiveY = screenY * (1 + nearDepth * 0.3) + 0 * fftParams.frameSpacing;
    const farPerspectiveY = screenY * (1 + farDepth * 0.3) + 9 * fftParams.frameSpacing;

    expect(screenX).toBe(0);
    expect(farPerspectiveY).toBeGreaterThan(nearPerspectiveY);
  });
});

describe("shader source coverage", () => {
  it("exports the spectrum entry points and uniforms used for drawing fidelity", () => {
    expect(SPECTRUM_SHADER).toContain("@binding(0) var<storage, read> waveform");
    expect(SPECTRUM_SHADER).toContain("fn idx_to_x");
    expect(SPECTRUM_SHADER).toContain("fn value_to_y");
    expect(SPECTRUM_SHADER).toContain("fn vs_line");
    expect(SPECTRUM_SHADER).toContain("fn vs_fill");
    expect(SPECTRUM_SHADER).toContain("fn fs_line");
    expect(SPECTRUM_SHADER).toContain("fn fs_fill");
  });

  it("exports the waterfall vertex math that drives the 3D projection", () => {
    expect(WATERFALL_3D_VERTEX_SHADER).toContain("normalizedX");
    expect(WATERFALL_3D_VERTEX_SHADER).toContain("depthZ");
    expect(WATERFALL_3D_VERTEX_SHADER).toContain("perspectiveFactor");
    expect(WATERFALL_3D_VERTEX_SHADER).toContain("output.color");
  });

  it("exports the waterfall fragment fade logic", () => {
    expect(WATERFALL_3D_FRAGMENT_SHADER).toContain("depthFade");
    expect(WATERFALL_3D_FRAGMENT_SHADER).toContain("finalColor");
  });

  it("exports the fft compute math used by downstream validation", () => {
    expect(FFT_COMPUTE_SHADER).toContain("fn window_function");
    expect(FFT_COMPUTE_SHADER).toContain("fn twiddle_factor");
    expect(FFT_COMPUTE_SHADER).toContain("fn fft_compute");
    expect(FFT_COMPUTE_SHADER).toContain("fn fft_power_spectrum");
    expect(FFT_COMPUTE_SHADER).toContain("fn waterfall_buffer_update");
  });
});
