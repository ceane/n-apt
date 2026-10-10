import { computeIqToDbSpectrumScalar } from "@n-apt/spectrum/hooks/useWasmSimdMath";
import { dbToColor } from "@n-apt/capture/hooks/useSnapshot";
import { WATERFALL_COLORMAPS } from "@n-apt/consts/colormaps";

export { resolveCliSnapshotFrameCount } from "@n-apt/cli/snapshotPolicy";

export interface CliSnapshotFrame {
  iqData: Uint8Array;
  centerFrequencyHz: number;
  sampleRateHz: number;
}

export interface CliSnapshotModel {
  waveform: Float32Array;
  frequencyRange: { min: number; max: number };
  waterfallBuffer: Uint8ClampedArray | null;
  waterfallDims: { width: number; height: number } | null;
  /** One spectrum per input frame, index-aligned; the last entry is `waveform`. */
  spectra: Float32Array[];
}

/** Converts Rust IQ frames into inputs for the shared 2D snapshot renderers. */
export function buildCliSnapshotModel(
  input: CliSnapshotFrame | CliSnapshotFrame[],
  options: {
    fftSize: number;
    waterfall: boolean;
    waterfallRows?: number;
    powerScale?: "dB" | "dBm";
    dbMin?: number;
    dbMax?: number;
  },
): CliSnapshotModel {
  const frames = Array.isArray(input) ? input : [input];
  if (!frames.length) throw new Error("At least one Rust IQ frame is required");
  const spectra = frames.map((frame) =>
    computeIqToDbSpectrumScalar(frame.iqData, {
      fftSize: options.fftSize,
      offsetDb: options.powerScale === "dBm" ? 30 : 0,
      windowType: "rectangular",
    }),
  );
  const frame = frames[frames.length - 1];
  const waveform = spectra[spectra.length - 1];
  const dbMin = options.dbMin ?? -120;
  const dbMax = options.dbMax ?? 0;
  const halfSpan = frame.sampleRateHz / 2;
  const frequencyRange = {
    min: frame.centerFrequencyHz - halfSpan,
    max: frame.centerFrequencyHz + halfSpan,
  };
  if (!options.waterfall) {
    return {
      waveform,
      frequencyRange,
      waterfallBuffer: null,
      waterfallDims: null,
      spectra,
    };
  }
  const rows = Math.max(1, options.waterfallRows ?? 96);
  const width = waveform.length;
  const waterfallBuffer = new Uint8ClampedArray(width * rows * 4);
  for (let row = 0; row < rows; row++) {
    // Rust delivers frames oldest-to-newest; the UI waterfall puts newest at top.
    const historyIndex = Math.round(
      ((rows - 1 - row) / Math.max(1, rows - 1)) * (spectra.length - 1),
    );
    const rowSpectrum = spectra[historyIndex];
    for (let column = 0; column < width; column++) {
      const [red, green, blue] = dbToColor(
        rowSpectrum[column],
        dbMin,
        dbMax,
        WATERFALL_COLORMAPS.classic,
      );
      const offset = (row * width + column) * 4;
      waterfallBuffer[offset] = red;
      waterfallBuffer[offset + 1] = green;
      waterfallBuffer[offset + 2] = blue;
      waterfallBuffer[offset + 3] = 255;
    }
  }
  return {
    waveform,
    frequencyRange,
    waterfallBuffer,
    waterfallDims: { width, height: rows },
    spectra,
  };
}
