import {
  computeIqToDbSpectrumPreview,
  computeIqToDbSpectrumScalar,
} from "@n-apt/spectrum/fft/iqSpectrum";

test("computes a coarse preview from the newest samples without changing FFT ownership", () => {
  const iq = new Uint8Array(8192 * 2);
  for (let i = 0; i < iq.length; i++) iq[i] = i % 251;

  const preview = computeIqToDbSpectrumPreview(iq, {
    fftSize: 16384,
    offsetDb: -12,
    windowType: "hamming",
  });
  const expected = computeIqToDbSpectrumScalar(iq.subarray(iq.length - 4096 * 2), {
    fftSize: 4096,
    offsetDb: -12,
    windowType: "hamming",
  });

  expect(preview).toHaveLength(4096);
  expect(Array.from(preview ?? [])).toEqual(Array.from(expected));
});

test("skips preview work when the requested transform already fits the fast path", () => {
  expect(
    computeIqToDbSpectrumPreview(new Uint8Array(4096 * 2), {
      fftSize: 4096,
      offsetDb: 0,
    }),
  ).toBeNull();
});

test("skips preview work when the frame has too few samples to fill it", () => {
  expect(
    computeIqToDbSpectrumPreview(new Uint8Array(2048 * 2), {
      fftSize: 8192,
      offsetDb: 0,
    }),
  ).toBeNull();
});
