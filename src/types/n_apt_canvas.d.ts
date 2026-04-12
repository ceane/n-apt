declare module 'n_apt_canvas' {
  const initWasm: () => Promise<void>;
  export default initWasm;

  class RenderingProcessor {
    resample_spectrum(input: Float32Array, output: Float32Array, outLen: number): void;
    resample_spectrum_enhanced(input: Float32Array, output: Float32Array, outLen: number, algorithm: string): void;
    process_iq_to_dbm_spectrum(input: Uint8Array, offsetDb: number): Float32Array;
    shift_waterfall_buffer(buffer: Uint8ClampedArray, width: number, height: number): void;
    apply_color_mapping(amplitudes: Float32Array, output: Uint8ClampedArray, intensity: number): void;
    get_zoomed_data(waveform: Float32Array, rangeMin: number, rangeMax: number, zoom: number, pan: number): {
      slicedWaveform: Float32Array;
      visualRange: [number, number];
      clampedPan: number;
    };
    transform_to_screen_coords(coords: Float32Array, canvasWidth: number, canvasHeight: number, fftX: number, fftY: number, dbMin: number, dbMax: number): Float32Array;
  }
  export { RenderingProcessor };
  export function test_wasm_simd_availability(): void;
}
