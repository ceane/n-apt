import type { LiveFrameData } from "@n-apt/consts/schemas/websocket";

export type SpectrumPpmCorrection = {
  correctionHz: number;
  inputPerOutput: number;
  sourceOffset: number;
};

export type PreparedSpectrumIqWindow = {
  iq: Uint8Array;
  correction?: SpectrumPpmCorrection;
};

const newestWindow = (iq: Uint8Array, fftSize: number): Uint8Array =>
  iq.subarray(Math.max(0, iq.length - fftSize * 2));

/**
 * Selects the raw source samples for the newest output-time FFT window. The
 * backend keeps `iq_data` corrected for demodulation/audio/capture, while this
 * optional sibling payload lets WebGPU apply the same nominal shift and clock
 * correction in its pre-FFT stage.
 */
export function prepareSpectrumIqWindow(
  frame: Pick<LiveFrameData, "iq_data"> & {
    spectrum_iq_data?: Uint8Array | null;
    spectrum_ppm_correction?: {
      correction_hz: number;
      input_per_output: number;
      source_offset: number;
    } | null;
  },
  fftSize: number,
): PreparedSpectrumIqWindow {
  const correctedIq = frame.iq_data ?? new Uint8Array();
  const rawIq = frame.spectrum_iq_data;
  const model = frame.spectrum_ppm_correction;
  const inputPerOutput = model?.input_per_output;
  const sourceOffset = model?.source_offset;
  if (
    !rawIq ||
    !model ||
    !Number.isFinite(model.correction_hz) ||
    typeof inputPerOutput !== "number" ||
    !Number.isFinite(inputPerOutput) ||
    inputPerOutput <= 0 ||
    typeof sourceOffset !== "number" ||
    !Number.isFinite(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset >= 1
  ) {
    return { iq: newestWindow(correctedIq, fftSize) };
  }

  const outputSampleCount = Math.floor(correctedIq.length / 2);
  const windowSampleCount = Math.min(Math.max(fftSize, 0), outputSampleCount);
  if (windowSampleCount === 0 || windowSampleCount < fftSize) {
    return { iq: newestWindow(correctedIq, fftSize) };
  }

  const firstOutputSample = outputSampleCount - windowSampleCount;
  const sourcePosition = sourceOffset + firstOutputSample * inputPerOutput;
  const sourceIndex = Math.floor(sourcePosition);
  const windowSourceOffset = sourcePosition - sourceIndex;
  const lastSourcePosition =
    windowSourceOffset + (windowSampleCount - 1) * inputPerOutput;
  const sourceSampleCount = Math.floor(lastSourcePosition) + 2;
  const rawSampleCount = Math.floor(rawIq.length / 2);
  if (sourceIndex + sourceSampleCount > rawSampleCount) {
    // A stale or truncated raw payload must never replace known-corrected IQ
    // with a partially resampled display window.
    return { iq: newestWindow(correctedIq, fftSize) };
  }

  return {
    iq: rawIq.subarray(
      sourceIndex * 2,
      (sourceIndex + sourceSampleCount) * 2,
    ),
    correction: {
      correctionHz: model.correction_hz,
      inputPerOutput,
      sourceOffset: windowSourceOffset,
    },
  };
}

export function withSpectrumPpmCorrection<T extends {
  applyPpmCorrection: boolean;
}>(
  options: T,
  correction?: SpectrumPpmCorrection,
): T & {
  ppmCorrectionHz?: number;
  ppmInputPerOutput?: number;
  ppmSourceOffset?: number;
} {
  if (!correction) return options;
  return {
    ...options,
    applyPpmCorrection: true,
    ppmCorrectionHz: correction.correctionHz,
    ppmInputPerOutput: correction.inputPerOutput,
    ppmSourceOffset: correction.sourceOffset,
  };
}
