import { renderHook, waitFor } from "@testing-library/react";
import { computeIqToDbSpectrumScalar } from "../../src/ts/hooks/useWasmSimdMath";
import { useWasmSimdMath } from "../../src/ts/hooks/useWasmSimdMath";

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

  it("honors larger FFT sizes when the caller requests them", () => {
    const iq = buildToneIqSamples(128, 11);

    const spectrum = computeIqToDbSpectrumScalar(iq, {
      fftSize: 128,
      offsetDb: 0,
      windowType: "hann",
    });

    expect(spectrum).toHaveLength(128);
  });
});

describe("useWasmSimdMath", () => {
  it("does not let SIMD bypass the requested non-rectangular window", async () => {
    const iq = buildToneIqSamples(64, 5);

    const { result } = renderHook(() =>
      useWasmSimdMath({
        fftSize: 64,
        enableSimd: true,
        fallbackToScalar: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.isWasmLoaded).toBe(true);
    });

    const rectangular = result.current.processIqToDbmSpectrum(
      iq,
      0,
      64,
      "rectangular",
    );
    const nuttall = result.current.processIqToDbmSpectrum(iq, 0, 64, "Nuttall");

    expect(Array.from(rectangular)).not.toEqual(Array.from(nuttall));
  });
});
