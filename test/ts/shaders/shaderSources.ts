import { readFileSync } from "node:fs";
import { join } from "node:path";

// Loads the generated shader fixtures, which are produced by
// scripts/shaders/generate-test-fixtures.mjs from the canonical WGSL sources
// in src/ts/shaders (the same files the app ships).
const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "test/ts/shaders/generated", name), "utf8");

export const FFT_COMPUTE_SHADER = fixture("fft_compute.wgsl");
export const SPECTRUM_SHADER = fixture("spectrum.wgsl");
export const WATERFALL_3D_VERTEX_SHADER = fixture("waterfall3d_vertex.wgsl");
export const WATERFALL_3D_FRAGMENT_SHADER = fixture("waterfall3d_fragment.wgsl");
export const WATERFALL_RETUNE_WGSL = fixture("waterfall_retune.wgsl");
