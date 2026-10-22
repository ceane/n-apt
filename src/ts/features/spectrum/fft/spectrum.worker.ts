import { computeIqToDbSpectrumScalar } from "./iqSpectrum";
import type { SpectrumWorkerRequest, SpectrumWorkerResponse } from "./spectrumWorkerClient";

// WASM loading and the scalar fallback both run off the browser main thread.
const processor = import("n_apt_canvas").then(async module => {
  await module.default();
  return new module.RenderingProcessor();
}).catch(() => null);

self.onmessage = async ({ data }: MessageEvent<SpectrumWorkerRequest>) => {
  try {
    const wasm = await processor;
    let spectrum: Float32Array;
    try {
      if (!wasm) throw new Error("WASM unavailable");
      spectrum = wasm.process_iq_to_dbm_spectrum(data.iq, data.offsetDb, data.fftSize, data.windowType ?? "hanning");
    } catch {
      spectrum = computeIqToDbSpectrumScalar(data.iq, data);
    }
    self.postMessage({ id: data.id, spectrum } satisfies SpectrumWorkerResponse, { transfer: [spectrum.buffer] });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) } satisfies SpectrumWorkerResponse);
  }
};
