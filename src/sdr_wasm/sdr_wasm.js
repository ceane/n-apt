// Stub WASM module - replace with actual built WASM from packages/sdr_wasm
// This stub allows the app to load without the WASM module being built

export default async function init() {
  console.warn('WASM module not built. Run `wasm-pack build` in packages/sdr_wasm to build the actual module.');
  return Promise.resolve();
}

export class SpectrumStitcher {
  constructor(fftSize, sampleRate, noiseFloor) {
    console.warn('Using stub SpectrumStitcher - WASM module not built');
    this.fftSize = fftSize;
    this.sampleRate = sampleRate;
    this.noiseFloor = noiseFloor;
    this.frequencies = new Float64Array(0);
    this.powerDb = new Float32Array(0);
  }

  add_capture(iqData, centerFreq) {
    console.warn('add_capture called on stub - no actual processing');
  }

  get_frequencies() {
    return this.frequencies;
  }

  get_power_db() {
    return this.powerDb;
  }

  get_frequency_range() {
    return [0, 0];
  }
}
