// Shader imports using vite-plugin-glsl
import fftComputeShaderDefault from "./fft_compute.wgsl";
import spectrumShaderDefault from "./spectrum.wgsl";
import waterfall3dVertexShaderDefault from "./waterfall3d_vertex.wgsl";
import waterfall3dFragmentShaderDefault from "./waterfall3d_fragment.wgsl";
import resampleShaderDefault from "./resample.wgsl";
import spikeComputeShaderDefault from "./spike_compute.wgsl";
import spikeRenderShaderDefault from "./spike_render.wgsl";
import floorAvgShaderDefault from "./floor_avg.wgsl";
import peakResampleShaderDefault from "./peak_resample.wgsl";

// Defensive exports to handle potential import failures
export const fftComputeShader = fftComputeShaderDefault || "";
export const spectrumShader = spectrumShaderDefault || "";
export const waterfall3dVertexShader = waterfall3dVertexShaderDefault || "";
export const waterfall3dFragmentShader = waterfall3dFragmentShaderDefault || "";
export const resampleShader = resampleShaderDefault || "";
export const spikeComputeShader = spikeComputeShaderDefault || "";
export const spikeRenderShader = spikeRenderShaderDefault || "";
export const floorAvgShader = floorAvgShaderDefault || "";
export const peakResampleShader = peakResampleShaderDefault || "";

// Legacy exports for backward compatibility
export const FFT_COMPUTE_SHADER = fftComputeShader;
export const SPECTRUM_SHADER = spectrumShader;
export const WATERFALL_3D_VERTEX_SHADER = waterfall3dVertexShader;
export const WATERFALL_3D_FRAGMENT_SHADER = waterfall3dFragmentShader;
export const RESAMPLE_WGSL = resampleShader;
export const SPIKE_COMPUTE_WGSL = spikeComputeShader;
export const SPIKE_RENDER_WGSL = spikeRenderShader;
export const FLOOR_AVG_WGSL = floorAvgShader;
export const PEAK_RESAMPLE_WGSL = peakResampleShader;
