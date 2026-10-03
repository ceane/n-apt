import { computeIqToDbSpectrumScalar } from "@n-apt/spectrum/hooks/useWasmSimdMath";
import { computeIqToPhaseSpectrum } from "@n-apt/spectrum/fft/phaseSpectrum";

const clampByte = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)));

function buildToneIqSamples(
  sampleCount: number,
  cycles: number,
  phaseOffset = 0,
  amplitude = 100,
): Uint8Array {
  const out = new Uint8Array(sampleCount * 2);

  for (let i = 0; i < sampleCount; i++) {
    const phase = (2 * Math.PI * cycles * i) / sampleCount + phaseOffset;
    out[i * 2] = clampByte(128 + amplitude * Math.cos(phase));
    out[i * 2 + 1] = clampByte(128 + amplitude * Math.sin(phase));
  }

  return out;
}

/** fftshift maps unshifted bin `k` onto output index (k + fftLen/2) % fftLen. */
const shiftedIndex = (bin: number, fftLen: number) =>
  (bin + fftLen / 2) % fftLen;

const peakIndex = (values: Float32Array) =>
  values.indexOf(Math.max(...Array.from(values)));

describe("computeIqToPhaseSpectrum", () => {
  it("returns one phase per FFT bin, matching the magnitude path", () => {
    const iq = buildToneIqSamples(64, 5);

    const magnitude = computeIqToDbSpectrumScalar(iq, {
      fftSize: 64,
      offsetDb: 0,
    });
    const phase = computeIqToPhaseSpectrum(iq, { fftSize: 64 });

    expect(phase).toHaveLength(magnitude.length);
    expect(phase).toHaveLength(64);
  });

  it("shares the magnitude path's fftshifted bin layout", () => {
    const fftLen = 64;
    const bin = 5;
    const iq = buildToneIqSamples(fftLen, bin);

    const magnitude = computeIqToDbSpectrumScalar(iq, {
      fftSize: fftLen,
      offsetDb: 0,
    });
    const phase = computeIqToPhaseSpectrum(iq, { fftSize: fftLen });

    // The tone's peak must land on the same index in both arrays.
    const expectedIndex = shiftedIndex(bin, fftLen);
    expect(peakIndex(magnitude)).toBe(expectedIndex);
    expect(expectedIndex).toBe(37);
    // A zero-phase tone keeps a ~0 degree phase at its own bin.
    expect(Math.abs(phase[expectedIndex])).toBeLessThan(5);
  });

  it("reports the tone's phase offset at its bin", () => {
    const fftLen = 64;
    const index = shiftedIndex(5, fftLen);

    const inPhase = computeIqToPhaseSpectrum(buildToneIqSamples(fftLen, 5, 0), {
      fftSize: fftLen,
    });
    const quadrature = computeIqToPhaseSpectrum(
      buildToneIqSamples(fftLen, 5, Math.PI / 2),
      { fftSize: fftLen },
    );
    const inverted = computeIqToPhaseSpectrum(
      buildToneIqSamples(fftLen, 5, Math.PI),
      { fftSize: fftLen },
    );

    expect(Math.abs(inPhase[index])).toBeLessThan(5);
    expect(Math.abs(quadrature[index] - 90)).toBeLessThan(5);
    // ±180 are the same angle; allow either side of the wrap.
    expect(Math.abs(Math.abs(inverted[index]) - 180)).toBeLessThan(5);
  });

  it("is independent of amplitude", () => {
    const fftLen = 64;
    const index = shiftedIndex(5, fftLen);

    const strong = computeIqToPhaseSpectrum(
      buildToneIqSamples(fftLen, 5, 0.7, 100),
      { fftSize: fftLen },
    );
    const weak = computeIqToPhaseSpectrum(
      buildToneIqSamples(fftLen, 5, 0.7, 20),
      { fftSize: fftLen },
    );

    expect(Math.abs(strong[index] - weak[index])).toBeLessThan(1);
  });

  it("keeps every bin inside the cyclic -180..180 range", () => {
    const phase = computeIqToPhaseSpectrum(buildToneIqSamples(256, 9), {
      fftSize: 256,
    });

    for (const value of phase) {
      expect(value).toBeGreaterThanOrEqual(-180);
      expect(value).toBeLessThanOrEqual(180);
    }
  });

  it("reuses a correctly sized output buffer and allocates otherwise", () => {
    const iq = buildToneIqSamples(64, 5);

    const reusable = new Float32Array(64);
    expect(computeIqToPhaseSpectrum(iq, { fftSize: 64 }, reusable)).toBe(
      reusable,
    );

    const tooSmall = new Float32Array(8);
    expect(computeIqToPhaseSpectrum(iq, { fftSize: 64 }, tooSmall)).not.toBe(
      tooSmall,
    );
  });
});
