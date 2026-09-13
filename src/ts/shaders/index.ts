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
import waterfallRetuneShaderDefault from "./waterfall_retune.wgsl";
import waterfallFifoShaderDefault from "./waterfall_fifo.wgsl";
import naptClassifyShaderDefault from "./napt_classify.wgsl";
import naptDetectShaderDefault from "./napt_detect.wgsl";
import naptTemporalShaderDefault from "./napt_temporal.wgsl";
import dcSpikeComputeShaderDefault from "./dc_spike_compute.wgsl";

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
export const waterfallRetuneShader = waterfallRetuneShaderDefault || "";
export const waterfallFifoShader = waterfallFifoShaderDefault || "";
export const naptClassifyShader = naptClassifyShaderDefault || "";
export const naptDetectShader = naptDetectShaderDefault || "";
export const naptTemporalShader = naptTemporalShaderDefault || "";
export const dcSpikeComputeShader = dcSpikeComputeShaderDefault || "";

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
export const WATERFALL_RETUNE_WGSL = waterfallRetuneShader;
export const WATERFALL_FIFO_WGSL = waterfallFifoShader;
export const NAPT_CLASSIFY_WGSL = naptClassifyShader;
export const NAPT_DETECT_WGSL = naptDetectShader;
export const NAPT_TEMPORAL_WGSL = naptTemporalShader;
export const DC_SPIKE_COMPUTE_WGSL = dcSpikeComputeShader;
