// Shader imports using vite-plugin-glsl
import fftComputeShaderDefault from './fft_compute.wgsl';
import spectrumShaderDefault from './spectrum.wgsl';
import waterfall3dVertexShaderDefault from './waterfall3d_vertex.wgsl';
import waterfall3dFragmentShaderDefault from './waterfall3d_fragment.wgsl';
import resampleShaderDefault from './resample.wgsl';

// Defensive exports to handle potential import failures
export const fftComputeShader = fftComputeShaderDefault || '';
export const spectrumShader = spectrumShaderDefault || '';
export const waterfall3dVertexShader = waterfall3dVertexShaderDefault || '';
export const waterfall3dFragmentShader = waterfall3dFragmentShaderDefault || '';
export const resampleShader = resampleShaderDefault || '';

// Legacy exports for backward compatibility
export const FFT_COMPUTE_SHADER = fftComputeShader;
export const SPECTRUM_SHADER = spectrumShader;
export const WATERFALL_3D_VERTEX_SHADER = waterfall3dVertexShader;
export const WATERFALL_3D_FRAGMENT_SHADER = waterfall3dFragmentShader;
export const RESAMPLE_WGSL = resampleShader;
