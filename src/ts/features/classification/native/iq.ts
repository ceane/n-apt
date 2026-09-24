import type { WindowKind } from './core';
/** Interleaved normalized I/Q; actual samples determine window and next-power-of-two FFT. */
export function spectrumFromIq(iq: Float32Array, requestedFftSize: number, window: WindowKind) {
  if (!Number.isInteger(requestedFftSize) || requestedFftSize < 2 || requestedFftSize > 1048576 || (requestedFftSize & (requestedFftSize - 1)) !== 0 || iq.length % 2 || iq.some(v => !Number.isFinite(v))) throw new Error('Invalid I/Q or FFT size');
  const validSamples = Math.min(requestedFftSize, iq.length / 2);
  if (validSamples < 2) throw new Error('At least two complex samples are required');
  const fftSize = 2 ** Math.ceil(Math.log2(validSamples));
  const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
  let energy = 0;
  for (let i = 0; i < validSamples; i++) {
    const t = 2 * Math.PI * i / (validSamples - 1);
    let w: number;
    switch (window) {
      case 'rectangular': w = 1; break;
      case 'hann': w = 0.5 - 0.5 * Math.cos(t); break;
      case 'hamming': w = 0.54 - 0.46 * Math.cos(t); break;
      case 'blackman': w = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t); break;
      case 'blackman-harris': w = 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t); break;
      case 'nuttall': w = 0.355768 - 0.487396 * Math.cos(t) + 0.144232 * Math.cos(2 * t) - 0.012604 * Math.cos(3 * t); break;
      default: throw new Error('Unsupported FFT window');
    }
    w = Math.fround(w); energy += w * w; re[i] = iq[2 * i] * w; im[i] = iq[2 * i + 1] * w;
  }
  for (let i = 1, j = 0; i < fftSize; i++) {
    let bit = fftSize >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= fftSize; size *= 2) {
    const angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < fftSize; start += size) {
      let r = 1, q = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2, br = re[b] * r - im[b] * q, bi = re[b] * q + im[b] * r;
        re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
        const nr = r * wr - q * wi; q = r * wi + q * wr; r = nr;
      }
    }
  }
  const normSq = Math.max(1e-15, validSamples * energy);
  const spectrum = Float32Array.from({ length: fftSize }, (_, i) => {
    const j = (i + fftSize / 2) % fftSize;
    return 10 * Math.log10((re[j] * re[j] + im[j] * im[j]) / normSq + 1e-15);
  });
  return { spectrum, fftSize, validSamples };
}
