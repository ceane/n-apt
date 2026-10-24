import {
  computeIqToDbSpectrumPreview,
  computeIqToDbSpectrumScalar,
} from "./iqSpectrum";
import type { SpectrumWorkerRequest, SpectrumWorkerResponse } from "./spectrumWorkerClient";

// WASM loading and the scalar fallback both run off the browser main thread.
const processor = import("n_apt_canvas").then(async module => {
  await module.default();
  return new module.RenderingProcessor();
}).catch(() => null);

self.onmessage = async ({ data }: MessageEvent<SpectrumWorkerRequest>) => {
  try {
    // Large transforms take long enough for a viewport to expose an edge
    // before the full result is ready. Quickly publish a coarse spectrum from
    // the same IQ frame and acquisition axis, then replace it with the full
    // resolution transform. This is display-only; it never enters capture,
    // waterfall history, or temporal averaging.
    if (data.fftSize > 4096) {
      const previewStartedAt = performance.now();
      try {
        const preview = computeIqToDbSpectrumPreview(data.iq, data);
        if (preview) {
          self.postMessage({
            id: data.id,
            stage: "preview",
            spectrum: preview,
            computeDurationMs: performance.now() - previewStartedAt,
          } satisfies SpectrumWorkerResponse, { transfer: [preview.buffer] });
        }
      } catch {
        // A preview is an optimization. Preserve the authoritative full FFT if
        // its optional lower-resolution calculation cannot be produced.
      }
    }

    const startedAt = performance.now();
    const wasm = await processor;
    let spectrum: Float32Array;
    try {
      if (!wasm) throw new Error("WASM unavailable");
      spectrum = wasm.process_iq_to_dbm_spectrum(data.iq, data.offsetDb, data.fftSize, data.windowType ?? "hanning");
    } catch {
      spectrum = computeIqToDbSpectrumScalar(data.iq, data);
    }
    const computeDurationMs = performance.now() - startedAt;
    self.postMessage({
      id: data.id,
      stage: "complete",
      spectrum,
      computeDurationMs,
    } satisfies SpectrumWorkerResponse, { transfer: [spectrum.buffer] });
  } catch (error) {
    self.postMessage({
      id: data.id,
      stage: "complete",
      error: String(error),
    } satisfies SpectrumWorkerResponse);
  }
};
