import {
  computeIqToDbSpectrumScalar,
} from "../../src/ts/hooks/useWasmSimdMath";

function buildToneIqSamples(sampleCount: number, cycles: number): Uint8Array {
  const out = new Uint8Array(sampleCount * 2);

  for (let i = 0; i < sampleCount; i++) {
    const phase = (2 * Math.PI * cycles * i) / sampleCount;
    const iVal = Math.round(128 + 100 * Math.cos(phase));
    const qVal = Math.round(128 + 100 * Math.sin(phase));
    out[i * 2] = Math.max(0, Math.min(255, iVal));
    out[i * 2 + 1] = Math.max(0, Math.min(255, qVal));
  }

  return out;
}

describe("computeIqToDbSpectrumScalar", () => {
  it("uses the requested FFT window instead of always falling back to hanning", () => {
    const iq = buildToneIqSamples(64, 5);

    const rectangular = computeIqToDbSpectrumScalar(iq, {
      fftSize: 64,
      offsetDb: 0,
      windowType: "rectangular",
    });
    const hanning = computeIqToDbSpectrumScalar(iq, {
      fftSize: 64,
      offsetDb: 0,
      windowType: "hanning",
    });

    expect(rectangular).toHaveLength(64);
    expect(hanning).toHaveLength(64);
    expect(Array.from(rectangular)).not.toEqual(Array.from(hanning));
  });
});
