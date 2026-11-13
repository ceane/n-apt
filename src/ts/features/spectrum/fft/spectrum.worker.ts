import { computeIqToDbSpectrumScalar } from "./iqSpectrum";
import {
  WebGpuIqSpectrumProcessor,
  type WebGpuIqSpectrumOptions,
} from "./webgpuIqSpectrum";
import type { SpectrumWorkerRequest, SpectrumWorkerResponse } from "./spectrumWorkerClient";

let webGpuProcessorPromise: Promise<WebGpuIqSpectrumProcessor | null> | null = null;
const getWebGpuProcessor = () => {
  webGpuProcessorPromise ??= WebGpuIqSpectrumProcessor.create();
  return webGpuProcessorPromise;
};

self.onmessage = async ({ data }: MessageEvent<SpectrumWorkerRequest>) => {
  const startedAt = performance.now();
  let backend: "webgpu" | "wasm" | "scalar" = "scalar";
  try {
    let spectrum: Float32Array | null = null;
    const gpuProcessor = await getWebGpuProcessor();
    if (gpuProcessor) {
      try {
        spectrum = await gpuProcessor.process(data.iq, {
          fftSize: data.fftSize,
          offsetDb: data.offsetDb,
          windowType: data.windowType,
          centerFrequencyHz: data.centerFrequencyHz,
          sampleRateHz: data.sampleRateHz,
          ppm: data.ppm,
          applyPpmCorrection: data.applyPpmCorrection,
        } satisfies WebGpuIqSpectrumOptions);
        backend = "webgpu";
      } catch {
        // A device can be present but fail to compile/run a shader. In that
        // case, retire it and use the same CPU fallbacks as unsupported GPUs.
        gpuProcessor.dispose();
        webGpuProcessorPromise = Promise.resolve(null);
      }
    }

    if (!spectrum) {
      spectrum = computeIqToDbSpectrumScalar(data.iq, data);
      backend = "scalar";
    }

    self.postMessage(
      {
        id: data.id,
        stage: "complete",
        spectrum,
        backend,
        computeDurationMs: performance.now() - startedAt,
      } satisfies SpectrumWorkerResponse,
      { transfer: [spectrum.buffer] },
    );
  } catch (error) {
    self.postMessage({
      id: data.id,
      stage: "complete",
      error: String(error),
      computeDurationMs: performance.now() - startedAt,
    } satisfies SpectrumWorkerResponse);
  }
};
