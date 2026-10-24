/*
 *
 * useDrawWebGPUFFTSignal - Visualizes radio signals as frequency spectrum
 *
 * Raw signal (SINE WAVE, ONE CYCLE):
 *
 *                  ⌄ peak
 *                 .--.
 *                /    \    /
 *                      \__/
 *                        ^
 *                        trough
 *
 * FFT output:   [3.2, 0.1, ...]  ← amplitude at each frequency
 * (yes, just numbers, floats)
 *
 * NOTE: The FFT rendered is based on
 *  ✔ MAGNITUDE FFT
 *      (0 → Fs/2, signal rises ↑ from noise as y = 0 as floor),
 *  ✗ TWO-SIDED, ZERO-CENTERED FFT of complex (I/Q) data
 *      (-Fs/2 → +Fs/2, signal as ± with y = 0 as center).
 * This is a simplified view of the signal's frequency, the
 * conversion happens on the backend from zero-centered to magnitude.
 *
 *
 * Think of radio signals like music - they're made of many notes (frequencies)
 * playing at once. Fast Fourier Transform (FFT) is like a musical ear that
 * separates all the notes and tells you how loud each one is.
 *
 * FFT extracts the Y-POINTS (amplitude) of signal peaks and troughs
 * (ups and downs) for each frequency, transforming raw radio wave data into a
 * spectrum display showing signal strength at each frequency,
 * just like a music equalizer.
 *
 */
import { useCallback, useRef } from "react";
import { readCssColor as readUncachedCssColor } from "@n-apt/layout/rendering/cssColor";
import { OverlayTextureRenderer } from "@n-apt/spectrum/hooks/useWebGPUInit";
import { LINE_COLOR, SHADOW_COLOR, FFT_AREA_MIN } from "@n-apt/consts";
import {
  SPECTRUM_SHADER,
  RESAMPLE_WGSL,
  SPIKE_COMPUTE_WGSL,
  SPIKE_RENDER_WGSL,
  FLOOR_AVG_WGSL,
  NAPT_CLASSIFY_WGSL,
  NAPT_DETECT_WGSL,
  NAPT_TEMPORAL_WGSL,
  DC_SPIKE_COMPUTE_WGSL,
} from "@n-apt/shaders";
import {
  configureWebGPUCanvas,
  parseCssColorToRgba,
} from "@n-apt/app/infrastructure/visualization/webgpu";
import { browserPipelineMetrics } from "@n-apt/app/infrastructure/performance/pipelineMetrics";
import {
  shouldAcceptSpectrumSpikeAnalysisResult,
  shouldResetSpectrumSpikeHistory,
} from "@n-apt/spectrum/fft/frameProcessing";
import { writeResampleEdgeCoverageParams } from "@n-apt/spectrum/fft/resampleParams";

// Cached CSS color reads — avoids getComputedStyle per render frame.
// Invalidated on theme changes via MutationObserver.
const cssColorCache = new Map<string, string>();
let cssObserverInstalled = false;

const installCssObserver = () => {
  if (
    cssObserverInstalled ||
    typeof MutationObserver === "undefined" ||
    typeof document === "undefined"
  )
    return;
  cssObserverInstalled = true;
  const observer = new MutationObserver(() => {
    cssColorCache.clear();
  });
  const observeTarget = (target: HTMLElement | null) => {
    if (!target) return;
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
      childList: true,
      subtree: true,
    });
  };

  observeTarget(document.documentElement);
  observeTarget(document.head);
};

const readCssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined" || typeof document === "undefined")
    return fallback;
  const cached = cssColorCache.get(name);
  if (cached !== undefined) return cached;
  installCssObserver();
  const result = readUncachedCssColor(name, fallback);
  cssColorCache.set(name, result);
  return result;
};

// Cached parseCssColorToRgba results — avoids repeated CSS string parsing
const parsedColorCache = new Map<string, [number, number, number, number]>();
const MAX_GPU_SPIKES = 1024;
const NAPT_TEMPORAL_HISTORY_LENGTH = 32;
const SPIKE_CLASSIFIER_RESULT_OFFSET = 0;
const SPIKE_CLASSIFIER_RESULT_BYTES = 160;
const SPIKE_DECISION_RESULT_OFFSET = SPIKE_CLASSIFIER_RESULT_BYTES;
const SPIKE_DECISION_RESULT_BYTES = 8;
const SPIKE_TEMPORAL_RESULT_OFFSET =
  SPIKE_DECISION_RESULT_OFFSET + SPIKE_DECISION_RESULT_BYTES;
const SPIKE_TEMPORAL_RESULT_BYTES = 64;
const SPIKE_METRICS_RESULT_OFFSET =
  SPIKE_TEMPORAL_RESULT_OFFSET + SPIKE_TEMPORAL_RESULT_BYTES;
const SPIKE_METRICS_RESULT_BYTES = MAX_GPU_SPIKES * 16;
const SPIKE_COUNT_RESULT_OFFSET =
  SPIKE_METRICS_RESULT_OFFSET + SPIKE_METRICS_RESULT_BYTES;
const SPIKE_RESULTS_READBACK_BYTES = SPIKE_COUNT_RESULT_OFFSET + 4;
const cachedParseCssColor = (
  color: string,
): [number, number, number, number] => {
  const cached = parsedColorCache.get(color);
  if (cached) return cached;
  const result = parseCssColorToRgba(color);
  parsedColorCache.set(color, result);
  return result;
};

// Fast-refresh can preserve the React hook state while replacing the imported
// WGSL string. GPU pipelines are immutable, so the existing pipeline would
// otherwise continue executing the previous shader until a full page reload.
const shaderFingerprint = (source: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}:${hash >>> 0}`;
};

const NAPT_CLASSIFIER_SHADER_FINGERPRINT =
  shaderFingerprint(NAPT_CLASSIFY_WGSL);

// Shaders imported from @n-apt/shaders/

export type SpectrumRenderParams = {
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  dbMin: number;
  dbMax: number;
  lineColor: string;
  fillColor: string;
  backgroundColor: string;
};

export interface SpikeAnalysis {
  isNapt: boolean;
  confidence: number;
  baselineIsNapt: boolean;
  baselineConfidence: number;
  multiFrameIsNapt: boolean;
  multiFrameConfidence: number;
  multiFramePersistence: number;
  multiFrameFrameCount: number;
  multiFrameBridgeScore: number;
  multiFrameUDipScore: number;
  multiFrameUnimodalBridgeScore?: number;
  multiFramePartialBridgeScore?: number;
  multiFrameApexProminenceScore?: number;
  multiFrameShoulderSymmetryScore?: number;
  multiFrameSincPenaltyScore?: number;
  multiFrameCoalescingScore?: number;
  aboveFloorFraction: number;
  floorDbm: number;
  spikes: Array<{ frequencyHz: number; powerDbm: number; index: number }>;
  spacingHz?: number | null;
  spacingToleranceHz?: number | null;
  spacingScore?: number;
  spacingSupport?: number;
  floorStabilityScore?: number | null;
  floorStabilityFrames?: number;
  spikeValleyFillScore?: number | null;
  broadFloorVariationScore?: number;
  interferenceScore?: number | null;
  frameInterferenceScore?: number | null;
  interferenceEvidenceFrames?: number;
  interferenceMissingFrames?: number;
  spikePresenceScore?: number;
  suspensionBridgeScore: number;
  clumpCount: number;
  bridgeWidthScore: number;
  bridgeShoulderScore: number;
  uDipScore: number;
  floorRelativePowerScore: number;
  temporalStability: number;
  bandwidthPrior: number;
  envelopeFitScore: number;
  envelopeResidualScore: number;
  envelopeSupportCount: number;
  sincPenaltyScore: number;
  unimodalBridgeScore: number;
  partialBridgeScore: number;
  apexProminenceScore: number;
  shoulderSymmetryScore: number;
  captureQualityScore: number;
}

// Inlined FFTWebGPU class as internal state
type FFTWebGPUState = {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  ctx: GPUCanvasContext;
  uniformBuffer: GPUBuffer;
  dummyWaveformBuffer: GPUBuffer;
  pipelineLine: GPURenderPipeline;
  pipelineFill: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  bindGroupLayout: GPUBindGroupLayout;
  uniformValues: Float32Array;
  // Compute resample state: GPU-side waveform downsampling before render
  resamplePipeline: GPUComputePipeline;
  resampleBindGroupLayout: GPUBindGroupLayout;
  resampleInputBuffer: GPUBuffer | null; // Raw waveform data (variable length)
  resampleOutputBuffer: GPUBuffer | null; // Resampled to display width (fixed)
  resamplePeakIndexBuffer: GPUBuffer | null; // Raw argmax index for each display bucket
  resampleParamsBuffer: GPUBuffer;
  resampleBindGroup: GPUBindGroup | null;
  resampleInputLength: number;
  resampleOutputLength: number;
  /** Skip re-uploading the acquisition on mirror pans — only display uniforms change. */
  lastUploadedWaveform: Float32Array | Uint8Array | null;
  lastUploadedByteOffset: number;
  lastUploadedByteLength: number;
  // Optional compute pass that removes the centered DC bin before resampling.
  dcSpikeComputePipeline: GPUComputePipeline;
  dcSpikeBindGroupLayout: GPUBindGroupLayout;
  dcSpikeOutputBuffer: GPUBuffer | null;
  dcSpikeParamsBuffer: GPUBuffer;
  dcSpikeBindGroup: GPUBindGroup | null;
  dcSpikeInputLength: number;
  removeDcSpike: boolean;
  // Spikes compute/render state
  spikeComputePipeline: GPUComputePipeline;
  spikeComputeBindGroupLayout: GPUBindGroupLayout;
  spikeRenderLinePipeline: GPURenderPipeline;
  spikeRenderCirclePipeline: GPURenderPipeline;
  spikeRenderBindGroupLayout: GPUBindGroupLayout;
  spikeBuffer: GPUBuffer | null;
  spikeCountBuffer: GPUBuffer | null;
  spikeResultsReadbackBuffer: GPUBuffer;
  spikeResultsReadbackInFlight: boolean;
  lastSpikeResultsReadbackMs: number;
  lastReportedSpikeCount: number;
  spikeParamsBuffer: GPUBuffer;
  spikeRecoveryParamsBuffer: GPUBuffer;
  spikeComputeBindGroup: GPUBindGroup | null;
  spikeRecoveryBindGroup: GPUBindGroup | null;
  spikeRenderBindGroup: GPUBindGroup | null;
  spikeWaveformLength: number;
  floorAvgResultBuffer: GPUBuffer;
  floorAvgScratch: Uint32Array;
  floorAvgPipeline: GPUComputePipeline;
  floorAvgFinalizePipeline: GPUComputePipeline;
  floorAvgBindGroupLayout: GPUBindGroupLayout;
  floorAvgBindGroup: GPUBindGroup | null;
  naptClassifyPipeline: GPUComputePipeline;
  naptClassifyFinalizePipeline: GPUComputePipeline;
  naptClassifyBindGroupLayout: GPUBindGroupLayout;
  naptClassifyBindGroup: GPUBindGroup | null;
  naptClassifyParamsBuffer: GPUBuffer;
  naptClassifyResultBuffer: GPUBuffer;
  spikeMetricsBuffer: GPUBuffer;
  naptDetectPipeline: GPUComputePipeline;
  naptDetectBindGroupLayout: GPUBindGroupLayout;
  naptDetectBindGroup: GPUBindGroup | null;
  naptDecisionBuffer: GPUBuffer;
  naptTemporalPipeline: GPUComputePipeline;
  naptTemporalBindGroupLayout: GPUBindGroupLayout;
  naptTemporalBindGroup: GPUBindGroup | null;
  naptTemporalHistoryBuffer: GPUBuffer;
  naptTemporalParamsBuffer: GPUBuffer;
  naptTemporalDecisionBuffer: GPUBuffer;
  naptTemporalHistoryIndex: number;
  naptTemporalHistoryCount: number;
  naptTemporalFrequencyMin: number;
  naptTemporalFrequencyMax: number;
  naptTemporalAnalysisScope: string | null;
  naptClassifierShaderFingerprint: string;
  // Persistent scratch buffers — allocated once, reused every frame
  scratchSpikeParamsAB: ArrayBuffer;
  scratchSpikeParamsU32: Uint32Array;
  scratchSpikeParamsF32: Float32Array;
  scratchResampleParamsAB: ArrayBuffer;
  scratchResampleParamsView: DataView;
  scratchDcSpikeParams: Uint32Array;
  scratchNaptClassifyParamsAB: ArrayBuffer;
  scratchNaptClassifyParamsView: DataView;
  scratchNaptTemporalParams: Uint32Array;
  scratchZeroCount: Uint32Array;
  lastFrameCanvas?: HTMLCanvasElement;
  cacheCanvas?: HTMLCanvasElement;
  cacheCtx?: CanvasRenderingContext2D | null;
};

export interface WebGPUFFTSignalOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  waveform: Float32Array | Uint8Array;
  /** True when the source array contents changed since the last draw. */
  waveformDirty?: boolean;
  frequencyRange: { min: number; max: number };
  /** Acquisition window the waveform covers. Required when mirrorEnabled. */
  sourceFrequencyRange?: { min: number; max: number };
  /** Map negative display bands in resample.wgsl instead of a CPU preprocess. */
  mirrorEnabled?: boolean;
  /** Reuse the uploaded acquisition while only viewport uniforms change. */
  reuseWaveformUpload?: boolean;
  fftMin?: number;
  fftMax?: number;
  gridOverlayRenderer?: OverlayTextureRenderer;
  markersOverlayRenderer?: OverlayTextureRenderer;
  spikesOverlayRenderer?: OverlayTextureRenderer;
  centerFrequencyHz?: number;
  isDeviceConnected?: boolean;
  showGrid?: boolean;
  lineColor?: string;
  fillColor?: string;
  nodePreview?: boolean;
  showSpikeOverlay?: boolean;
  /** Recompute classifier/spike results only when source data or settings change. */
  analyzeSpikeOverlay?: boolean;
  /** Append to temporal classifier history only for a new eligible frame. */
  advanceSpikeHistory?: boolean;
  /** Stable source and processing-settings identity for classifier history. */
  analysisScope?: string;
  onSpikeCount?: (count: number) => void;
  onSpikeAnalysis?: (analysis: SpikeAnalysis) => void;
  reservedBottomPx?: number;
  isStandby?: boolean;
  isDotted?: boolean;
  removeDcSpike?: boolean;
}

export function useDrawWebGPUFFTSignal() {
  const rendererRef = useRef<FFTWebGPUState | null>(null);
  const retiredBuffersRef = useRef<GPUBuffer[]>([]);
  const initializationRef = useRef<{ device: GPUDevice; format: GPUTextureFormat; promise: Promise<FFTWebGPUState | null> } | null>(null);
  const rendererGenerationRef = useRef(0);
  const drawRevisionRef = useRef(0);
  const lastDataRef = useRef<{
    waveform: Float32Array;
    frequencyRange: any;
  } | null>(null);

  const flushRetiredBuffers = useCallback(() => {
    const buffers = retiredBuffersRef.current;
    retiredBuffersRef.current = [];
    for (const buffer of buffers) {
      buffer.destroy();
    }
  }, []);

  const destroyRendererResources = useCallback((state: FFTWebGPUState) => {
    state.uniformBuffer?.destroy();
    state.dummyWaveformBuffer?.destroy();
    state.resampleInputBuffer?.destroy();
    state.resampleOutputBuffer?.destroy();
    state.resamplePeakIndexBuffer?.destroy();
    state.resampleParamsBuffer?.destroy();
    state.dcSpikeOutputBuffer?.destroy();
    state.dcSpikeParamsBuffer?.destroy();
    state.spikeBuffer?.destroy();
    state.spikeCountBuffer?.destroy();
    state.spikeResultsReadbackBuffer?.destroy();
    state.spikeParamsBuffer?.destroy();
    state.spikeRecoveryParamsBuffer?.destroy();
    state.floorAvgResultBuffer?.destroy();
    state.naptClassifyParamsBuffer?.destroy();
    state.naptClassifyResultBuffer?.destroy();
    state.spikeMetricsBuffer?.destroy();
    state.naptDecisionBuffer?.destroy();
    state.naptTemporalHistoryBuffer?.destroy();
    state.naptTemporalParamsBuffer?.destroy();
    state.naptTemporalDecisionBuffer?.destroy();
  }, []);

  const retireBuffer = useCallback((buffer: GPUBuffer | null | undefined) => {
    if (!buffer) return;
    retiredBuffersRef.current.push(buffer);
  }, []);

  const createFFTWebGPUState = useCallback(
    async (
      canvas: HTMLCanvasElement,
      device: GPUDevice,
      format: GPUTextureFormat,
    ): Promise<FFTWebGPUState | null> => {
      const ctx = configureWebGPUCanvas(canvas, device, format);
      if (!ctx) {
        return null;
      }

      const allocatedBuffers: GPUBuffer[] = [];
      const createBuffer = (descriptor: GPUBufferDescriptor) => {
        const buffer = device.createBuffer(descriptor);
        allocatedBuffers.push(buffer);
        return buffer;
      };
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
        ],
      });

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      device.pushErrorScope("validation");
      const module = device.createShaderModule({ code: SPECTRUM_SHADER });

      const pipelineLineTask = device.createRenderPipelineAsync({
        layout: pipelineLayout,
        vertex: { module, entryPoint: "vs_line" },
        fragment: {
          module,
          entryPoint: "fs_line",
          targets: [{ format }],
        },
        primitive: {
          topology: "line-strip",
        },
      });

      const pipelineFillTask = device.createRenderPipelineAsync({
        layout: pipelineLayout,
        vertex: { module, entryPoint: "vs_fill" },
        fragment: {
          module,
          entryPoint: "fs_fill",
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        primitive: {
          topology: "triangle-strip",
        },
      });

      device.popErrorScope().then((error) => {
        if (error) {
          console.error("FFTWebGPU pipeline error:", error.message);
        }
      });

      // Uniform buffer holds 24 floats: the original 16 plot/color values,
      // acquisition and viewport ranges, mirror flag, and padding.
      const uniformValues = new Float32Array(24);
      const uniformBuffer = createBuffer({
        size: uniformValues.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // Dummy buffer for initial bind group creation - replaced with actual resampled data later
      const dummyWaveformBuffer = createBuffer({
        size: Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: dummyWaveformBuffer } },
          { binding: 1, resource: { buffer: uniformBuffer } },
        ],
      });

      // --- Compute resample pipeline: downsample high-res waveform to display pixels ---
      const resampleBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform" },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
        ],
      });

      const resampleModule = device.createShaderModule({ code: RESAMPLE_WGSL });
      const resamplePipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [resampleBindGroupLayout],
        }),
        compute: { module: resampleModule, entryPoint: "main" },
      });

      // Resample params: 12 x 4 bytes (mirror fold + frequency ranges)
      const resampleParamsBuffer = createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const dcSpikeBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform" },
          },
        ],
      });
      const dcSpikeModule = device.createShaderModule({
        code: DC_SPIKE_COMPUTE_WGSL,
      });
      const dcSpikeComputePipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [dcSpikeBindGroupLayout],
        }),
        compute: { module: dcSpikeModule, entryPoint: "remove_dc_spike" },
      });
      const dcSpikeParamsBuffer = createBuffer({
        size: 4 * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // --- Compute spikes pipeline ---
      device.pushErrorScope("validation");
      const spikeComputeBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 4,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 5,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
        ],
      });
      const spikeComputeModule = device.createShaderModule({
        code: SPIKE_COMPUTE_WGSL,
      });
      const spikeComputePipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [spikeComputeBindGroupLayout],
        }),
        compute: { module: spikeComputeModule, entryPoint: "main" },
      });
      device.popErrorScope().then((error) => {
        if (error)
          console.error("Spike Compute Pipeline Error:", error.message);
      });

      // --- Render spikes pipeline ---
      device.pushErrorScope("validation");
      const spikeRenderBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "uniform" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "read-only-storage" },
          },
        ],
      });
      const spikeRenderModule = device.createShaderModule({
        code: SPIKE_RENDER_WGSL,
      });

      const spikeRenderLinePipelineTask = device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [spikeRenderBindGroupLayout],
        }),
        vertex: { module: spikeRenderModule, entryPoint: "vs_line" },
        fragment: {
          module: spikeRenderModule,
          entryPoint: "fs_line",
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        primitive: { topology: "line-list" },
      });

      const spikeRenderCirclePipelineTask = device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [spikeRenderBindGroupLayout],
        }),
        vertex: { module: spikeRenderModule, entryPoint: "vs_circle" },
        fragment: {
          module: spikeRenderModule,
          entryPoint: "fs_circle",
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      });
      device.popErrorScope().then((error) => {
        if (error) console.error("Spike Render Pipeline Error:", error.message);
      });

      const spikeParamsBuffer = createBuffer({
        size: 16,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.UNIFORM |
          GPUBufferUsage.COPY_DST,
      });
      const spikeRecoveryParamsBuffer = createBuffer({
        size: 16,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.UNIFORM |
          GPUBufferUsage.COPY_DST,
      });

      const floorAvgResultBuffer = createBuffer({
        size: 12,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC,
      });
      const floorAvgScratch = new Uint32Array(3);

      // Floor Avg Pipelines
      const floorAvgModule = device.createShaderModule({
        code: FLOOR_AVG_WGSL,
      });
      const floorAvgBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform" },
          },
        ],
      });
      const floorAvgPipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [floorAvgBindGroupLayout],
        }),
        compute: { module: floorAvgModule, entryPoint: "reduce" },
      });
      const floorAvgFinalizePipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [floorAvgBindGroupLayout],
        }),
        compute: { module: floorAvgModule, entryPoint: "finalize" },
      });

      const naptClassifyParamsBuffer = createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const naptClassifyResultBuffer = createBuffer({
        size: 160,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC,
      });
      const spikeMetricsBuffer = createBuffer({
        size: MAX_GPU_SPIKES * 16,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      });
      const naptClassifyModule = device.createShaderModule({
        code: NAPT_CLASSIFY_WGSL,
      });
      const naptClassifyBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 4,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 5,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
        ],
      });
      const naptClassifyPipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [naptClassifyBindGroupLayout],
        }),
        compute: { module: naptClassifyModule, entryPoint: "classify" },
      });
      const naptClassifyFinalizePipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [naptClassifyBindGroupLayout],
        }),
        compute: { module: naptClassifyModule, entryPoint: "finalize" },
      });
      const naptDecisionBuffer = createBuffer({
        size: 8,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      });
      const naptDetectModule = device.createShaderModule({
        code: NAPT_DETECT_WGSL,
      });
      const naptDetectBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
        ],
      });
      const naptDetectPipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [naptDetectBindGroupLayout],
        }),
        compute: { module: naptDetectModule, entryPoint: "main" },
      });
      const naptTemporalHistoryBuffer = createBuffer({
        size: NAPT_TEMPORAL_HISTORY_LENGTH * 40,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(
        naptTemporalHistoryBuffer,
        0,
        new Uint32Array(NAPT_TEMPORAL_HISTORY_LENGTH * 10),
      );
      const naptTemporalParamsBuffer = createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const naptTemporalDecisionBuffer = createBuffer({
        size: 64,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      });
      const spikeResultsReadbackBuffer = createBuffer({
        size: SPIKE_RESULTS_READBACK_BYTES,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const naptTemporalModule = device.createShaderModule({
        code: NAPT_TEMPORAL_WGSL,
      });
      const naptTemporalBindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform" },
          },
          {
            binding: 4,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
        ],
      });
      const naptTemporalPipelineTask = device.createComputePipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [naptTemporalBindGroupLayout],
        }),
        compute: { module: naptTemporalModule, entryPoint: "main" },
      });

      // Persistent scratch buffers — allocated once, reused every frame to avoid GC
      const scratchSpikeParamsAB = new ArrayBuffer(16);
      const scratchSpikeParamsU32 = new Uint32Array(scratchSpikeParamsAB);
      const scratchSpikeParamsF32 = new Float32Array(scratchSpikeParamsAB);
      const scratchResampleParamsAB = new ArrayBuffer(48);
      const scratchResampleParamsView = new DataView(scratchResampleParamsAB);
      const scratchDcSpikeParams = new Uint32Array(4);
      const scratchNaptClassifyParamsAB = new ArrayBuffer(16);
      const scratchNaptClassifyParamsView = new DataView(
        scratchNaptClassifyParamsAB,
      );
      const scratchNaptTemporalParams = new Uint32Array(4);
      const scratchZeroCount = new Uint32Array([0]);

      // Start independent compilations together; await readiness before the
      // first submission so compilation cannot block GPU execution mid-frame.
      const [
        pipelineLine,
        pipelineFill,
        resamplePipeline,
        dcSpikeComputePipeline,
        spikeComputePipeline,
        spikeRenderLinePipeline,
        spikeRenderCirclePipeline,
        floorAvgPipeline,
        floorAvgFinalizePipeline,
        naptClassifyPipeline,
        naptClassifyFinalizePipeline,
        naptDetectPipeline,
        naptTemporalPipeline,
      ] = await Promise.all([
        pipelineLineTask,
        pipelineFillTask,
        resamplePipelineTask,
        dcSpikeComputePipelineTask,
        spikeComputePipelineTask,
        spikeRenderLinePipelineTask,
        spikeRenderCirclePipelineTask,
        floorAvgPipelineTask,
        floorAvgFinalizePipelineTask,
        naptClassifyPipelineTask,
        naptClassifyFinalizePipelineTask,
        naptDetectPipelineTask,
        naptTemporalPipelineTask,
      ]).catch(error => {
        for (const buffer of allocatedBuffers) buffer.destroy();
        throw error;
      });

      return {
        canvas,
        device,
        format,
        ctx,
        uniformBuffer,
        dummyWaveformBuffer,
        pipelineLine,
        pipelineFill,
        bindGroup,
        bindGroupLayout,
        uniformValues,
        resamplePipeline,
        resampleBindGroupLayout,
        resampleInputBuffer: null,
        resampleOutputBuffer: null,
        resamplePeakIndexBuffer: null,
        resampleParamsBuffer,
        resampleBindGroup: null,
        resampleInputLength: 0,
        resampleOutputLength: 0,
        lastUploadedWaveform: null,
        lastUploadedByteOffset: -1,
        lastUploadedByteLength: -1,
        dcSpikeComputePipeline,
        dcSpikeBindGroupLayout,
        dcSpikeOutputBuffer: null,
        dcSpikeParamsBuffer,
        dcSpikeBindGroup: null,
        dcSpikeInputLength: 0,
        removeDcSpike: false,
        spikeComputePipeline,
        spikeComputeBindGroupLayout,
        spikeRenderLinePipeline,
        spikeRenderCirclePipeline,
        spikeRenderBindGroupLayout,
        spikeBuffer: null,
        spikeCountBuffer: null,
        spikeResultsReadbackBuffer,
        spikeResultsReadbackInFlight: false,
        lastSpikeResultsReadbackMs: 0,
        lastReportedSpikeCount: 0,
        spikeParamsBuffer,
        spikeRecoveryParamsBuffer,
        spikeComputeBindGroup: null,
        spikeRecoveryBindGroup: null,
        spikeRenderBindGroup: null,
        spikeWaveformLength: 0,
        floorAvgResultBuffer,
        floorAvgScratch,
        floorAvgPipeline,
        floorAvgFinalizePipeline,
        floorAvgBindGroupLayout,
        floorAvgBindGroup: null,
        naptClassifyPipeline,
        naptClassifyFinalizePipeline,
        naptClassifyBindGroupLayout,
        naptClassifyBindGroup: null,
        naptClassifyParamsBuffer,
        naptClassifyResultBuffer,
        spikeMetricsBuffer,
        naptDetectPipeline,
        naptDetectBindGroupLayout,
        naptDetectBindGroup: null,
        naptDecisionBuffer,
        naptTemporalPipeline,
        naptTemporalBindGroupLayout,
        naptTemporalBindGroup: null,
        naptTemporalHistoryBuffer,
        naptTemporalParamsBuffer,
        naptTemporalDecisionBuffer,
        naptTemporalHistoryIndex: 0,
        naptTemporalHistoryCount: 0,
        naptTemporalFrequencyMin: Number.NaN,
        naptTemporalFrequencyMax: Number.NaN,
        naptTemporalAnalysisScope: null,
        naptClassifierShaderFingerprint: NAPT_CLASSIFIER_SHADER_FINGERPRINT,
        scratchSpikeParamsAB,
        scratchSpikeParamsU32,
        scratchSpikeParamsF32,
        scratchResampleParamsAB,
        scratchResampleParamsView,
        scratchDcSpikeParams,
        scratchNaptClassifyParamsAB,
        scratchNaptClassifyParamsView,
        scratchNaptTemporalParams,
        scratchZeroCount,
      };
    },
    [],
  );

  const drawWebGPUFFTSignal = useCallback(
    async (options: WebGPUFFTSignalOptions) => {
      const {
        canvas,
        device,
        format,
        waveform,
        waveformDirty = true,
        frequencyRange,
        sourceFrequencyRange,
        mirrorEnabled = false,
        reuseWaveformUpload = false,
        fftMin = -80,
        fftMax = 20,
        gridOverlayRenderer,
        markersOverlayRenderer,
        spikesOverlayRenderer,
        showGrid = true,
        lineColor = LINE_COLOR,
        fillColor = SHADOW_COLOR,
        nodePreview = false,
        showSpikeOverlay = false,
        analyzeSpikeOverlay = showSpikeOverlay,
        advanceSpikeHistory = analyzeSpikeOverlay,
        analysisScope,
        onSpikeCount,
        onSpikeAnalysis,
        reservedBottomPx = 0,
        isStandby = false,
        isDotted = false,
        removeDcSpike = false,
      } = options;

      // Background color from CSS variable - not configurable per-call to ensure
      // snapshot consistency (snapshots capture waveform data, not background)
      const backgroundColor = readCssColor("--color-fft-background", "#0a0a0a");

      // Rebuild immutable GPU pipelines when Vite replaces the WGSL module
      // during development. This prevents a preserved React hook state from
      // continuing to report metrics from an older shader revision.
      if (
        rendererRef.current &&
        rendererRef.current.naptClassifierShaderFingerprint !==
          NAPT_CLASSIFIER_SHADER_FINGERPRINT
      ) {
        const staleState = rendererRef.current;
        rendererRef.current = null;
        initializationRef.current = null;
        rendererGenerationRef.current++;
        destroyRendererResources(staleState);
      }

      // A backgrounded tab can lose its WebGPU device while React preserves
      // this hook's refs. Never submit work through resources owned by the
      // previous device; rebuild the renderer on the first frame from the
      // replacement device.
      if (
        rendererRef.current &&
        (rendererRef.current.device !== device ||
          rendererRef.current.format !== format)
      ) {
        const staleState = rendererRef.current;
        rendererRef.current = null;
        initializationRef.current = null;
        rendererGenerationRef.current++;
        destroyRendererResources(staleState);
        lastDataRef.current = null;
      }

      if (!rendererRef.current) {
        if (!canvas || !device || !format) return false;

        try {
          const drawRevision = ++drawRevisionRef.current;
          const generation = rendererGenerationRef.current;
          let initialization = initializationRef.current;
          if (!initialization || initialization.device !== device || initialization.format !== format) {
            const promise = createFFTWebGPUState(canvas, device, format);
            initialization = { device, format, promise };
            initializationRef.current = initialization;
            // Cleanup or device replacement may happen while compilation is pending.
            void promise.then(state => {
              if (state && (rendererGenerationRef.current !== generation || initializationRef.current !== initialization)) {
                destroyRendererResources(state);
              }
            }).catch(() => {});
          }
          const nextState = await initialization.promise;
          if (!nextState || generation !== rendererGenerationRef.current || initializationRef.current !== initialization) return false;
          rendererRef.current = nextState;
          if (drawRevision !== drawRevisionRef.current) return false;
        } catch (error) {
          console.error("Failed to create WebGPU FFT renderer:", error);
          return false;
        }
      }

      const state = rendererRef.current;
      if (!state) return false;

      // A disabled overlay starts a fresh temporal window. The one-frame
      // classifier remains stateless; only the higher-order history is reset.
      if (!showSpikeOverlay && state.naptTemporalHistoryCount > 0) {
        state.naptTemporalHistoryIndex = 0;
        state.naptTemporalHistoryCount = 0;
        state.device.queue.writeBuffer(
          state.naptTemporalHistoryBuffer,
          0,
          new Uint32Array(NAPT_TEMPORAL_HISTORY_LENGTH * 10),
        );
      }

      // Handle canvas remounts (e.g. when paginating away and back)
      if (state.canvas !== canvas) {
        const newCtx = configureWebGPUCanvas(canvas, device, format);
        if (!newCtx) return false;
        state.canvas = canvas;
        state.ctx = newCtx;
      }

      const waveformData =
        waveform instanceof Uint8Array ? Float32Array.from(waveform) : waveform;

      if (waveformData.length === 0) return false;

      try {
        // Calculate target display width using offsetWidth (unaffected by CSS
        // transforms like React Flow's viewport zoom).
        const parentWidth =
          canvas.parentElement?.offsetWidth ?? canvas.offsetWidth ?? 1;
        const marginPx = nodePreview ? 0 : 40;
        const displayWidth = Math.max(1, Math.floor(parentWidth - marginPx));

        const srcLen = waveformData.length;
        const sourceRange = sourceFrequencyRange ?? frequencyRange;
        let buffersChanged = false;

        if (state.removeDcSpike !== removeDcSpike) {
          state.removeDcSpike = removeDcSpike;
          buffersChanged = true;
        }

        // A retune changes the normalized capture span. Do not let history
        // from the previous span vote on the new one; the one-frame baseline
        // remains available immediately while the new temporal window warms.
        if (shouldResetSpectrumSpikeHistory({
          previousScope: state.naptTemporalAnalysisScope,
          nextScope: analysisScope ?? "",
          previousRange: {
            min: state.naptTemporalFrequencyMin,
            max: state.naptTemporalFrequencyMax,
          },
          nextRange: sourceRange,
        })) {
          state.naptTemporalHistoryIndex = 0;
          state.naptTemporalHistoryCount = 0;
          state.device.queue.writeBuffer(
            state.naptTemporalHistoryBuffer,
            0,
            new Uint32Array(NAPT_TEMPORAL_HISTORY_LENGTH * 10),
          );
          state.naptTemporalFrequencyMin = sourceRange.min;
          state.naptTemporalFrequencyMax = sourceRange.max;
          state.naptTemporalAnalysisScope = analysisScope ?? "";
        }

        // --- Resample input buffer: recreate when waveform length changes ---
        if (!state.resampleInputBuffer || srcLen > state.resampleInputLength) {
          retireBuffer(state.resampleInputBuffer);
          state.resampleInputBuffer = state.device.createBuffer({
            size: srcLen * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          state.resampleInputLength = srcLen;
          buffersChanged = true;
        }

        if (
          removeDcSpike &&
          (!state.dcSpikeOutputBuffer || srcLen > state.dcSpikeInputLength)
        ) {
          retireBuffer(state.dcSpikeOutputBuffer);
          state.dcSpikeOutputBuffer = state.device.createBuffer({
            size: srcLen * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE,
          });
          state.dcSpikeInputLength = srcLen;
          buffersChanged = true;
        }

        // --- Resample output buffer: recreate when display width changes ---
        // This buffer holds the downsampled data that the render shader reads
        if (
          !state.resampleOutputBuffer ||
          displayWidth > state.resampleOutputLength
        ) {
          retireBuffer(state.resampleOutputBuffer);
          retireBuffer(state.resamplePeakIndexBuffer);
          state.resampleOutputBuffer = state.device.createBuffer({
            size: displayWidth * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          state.resamplePeakIndexBuffer = state.device.createBuffer({
            size: displayWidth * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE,
          });
          state.resampleOutputLength = displayWidth;
          buffersChanged = true;
        }

        // --- Rebuild bind groups when buffers change ---
        // Bind groups are immutable, so we must recreate them when buffer handles change
        if (buffersChanged || !state.resampleBindGroup) {
          // Compute bind group: raw input → resampled output
          state.resampleBindGroup = state.device.createBindGroup({
            layout: state.resampleBindGroupLayout,
            entries: [
              {
                binding: 0,
                resource: {
                  buffer: removeDcSpike
                    ? state.dcSpikeOutputBuffer!
                    : state.resampleInputBuffer,
                },
              },
              { binding: 1, resource: { buffer: state.resampleOutputBuffer } },
              { binding: 2, resource: { buffer: state.resampleParamsBuffer } },
              {
                binding: 3,
                resource: { buffer: state.resamplePeakIndexBuffer! },
              },
            ],
          });

          state.dcSpikeBindGroup = removeDcSpike
            ? state.device.createBindGroup({
                layout: state.dcSpikeBindGroupLayout,
                entries: [
                  {
                    binding: 0,
                    resource: { buffer: state.resampleInputBuffer },
                  },
                  {
                    binding: 1,
                    resource: { buffer: state.dcSpikeOutputBuffer! },
                  },
                  {
                    binding: 2,
                    resource: { buffer: state.dcSpikeParamsBuffer },
                  },
                ],
              })
            : null;

          // Render bind group: resampled output + uniforms
          state.bindGroup = state.device.createBindGroup({
            layout: state.bindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: state.resampleOutputBuffer } },
              { binding: 1, resource: { buffer: state.uniformBuffer } },
            ],
          });
        }

        // --- Spikes buffers rebuild ---
        if (!state.spikeBuffer) {
          state.spikeBuffer = state.device.createBuffer({
            // index: u32, value: f32, score: f32, radius: f32
            size: MAX_GPU_SPIKES * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
          });
          state.spikeCountBuffer = state.device.createBuffer({
            size: 4,
            usage:
              GPUBufferUsage.STORAGE |
              GPUBufferUsage.COPY_DST |
              GPUBufferUsage.COPY_SRC,
          });
        }

        if (
          buffersChanged ||
          !state.spikeComputeBindGroup ||
          !state.spikeRecoveryBindGroup ||
          !state.naptClassifyBindGroup ||
          !state.naptDetectBindGroup ||
          !state.naptTemporalBindGroup
        ) {
          state.floorAvgBindGroup = state.device.createBindGroup({
            layout: state.floorAvgBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: state.resampleOutputBuffer! } },
              { binding: 1, resource: { buffer: state.floorAvgResultBuffer } },
              { binding: 2, resource: { buffer: state.spikeParamsBuffer } },
            ],
          });

          state.spikeComputeBindGroup = state.device.createBindGroup({
            layout: state.spikeComputePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: state.resampleOutputBuffer! } },
              { binding: 1, resource: { buffer: state.spikeParamsBuffer } },
              { binding: 2, resource: { buffer: state.spikeBuffer! } },
              { binding: 3, resource: { buffer: state.spikeCountBuffer! } },
              { binding: 4, resource: { buffer: state.floorAvgResultBuffer } },
              {
                binding: 5,
                resource: { buffer: state.resamplePeakIndexBuffer! },
              },
            ],
          });

          state.spikeRecoveryBindGroup = state.device.createBindGroup({
            layout: state.spikeComputePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: state.resampleOutputBuffer! } },
              {
                binding: 1,
                resource: { buffer: state.spikeRecoveryParamsBuffer },
              },
              { binding: 2, resource: { buffer: state.spikeBuffer! } },
              { binding: 3, resource: { buffer: state.spikeCountBuffer! } },
              { binding: 4, resource: { buffer: state.floorAvgResultBuffer } },
              {
                binding: 5,
                resource: { buffer: state.resamplePeakIndexBuffer! },
              },
            ],
          });

          state.naptClassifyBindGroup = state.device.createBindGroup({
            layout: state.naptClassifyBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: state.resampleOutputBuffer! } },
              {
                binding: 1,
                resource: { buffer: state.naptClassifyParamsBuffer },
              },
              { binding: 2, resource: { buffer: state.spikeBuffer! } },
              {
                binding: 3,
                resource: { buffer: state.naptClassifyResultBuffer },
              },
              { binding: 4, resource: { buffer: state.spikeCountBuffer! } },
              { binding: 5, resource: { buffer: state.spikeMetricsBuffer } },
            ],
          });
          state.naptDetectBindGroup = state.device.createBindGroup({
            layout: state.naptDetectBindGroupLayout,
            entries: [
              {
                binding: 0,
                resource: { buffer: state.naptClassifyResultBuffer },
              },
              { binding: 1, resource: { buffer: state.naptDecisionBuffer } },
            ],
          });
          state.naptTemporalBindGroup = state.device.createBindGroup({
            layout: state.naptTemporalBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: state.naptDecisionBuffer } },
              {
                binding: 1,
                resource: { buffer: state.naptClassifyResultBuffer },
              },
              {
                binding: 2,
                resource: { buffer: state.naptTemporalHistoryBuffer },
              },
              {
                binding: 3,
                resource: { buffer: state.naptTemporalParamsBuffer },
              },
              {
                binding: 4,
                resource: { buffer: state.naptTemporalDecisionBuffer },
              },
            ],
          });

          state.spikeRenderBindGroup = state.device.createBindGroup({
            layout: state.spikeRenderLinePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: state.spikeBuffer! } },
              { binding: 1, resource: { buffer: state.uniformBuffer } },
              { binding: 2, resource: { buffer: state.spikeCountBuffer! } },
            ],
          });
        }

        // --- Spikes parameters (using persistent scratch buffers) ---
        // Suppress competing maxima within roughly three display pixels. The
        // resampler preserves each bucket's exact raw-bin argmax for rendering.
        const windowSize = 2;

        // Reuse persistent scratch buffers instead of allocating new ones each frame
        state.scratchSpikeParamsU32[0] = displayWidth;
        state.scratchSpikeParamsU32[1] = windowSize;
        state.scratchSpikeParamsF32[2] = 3.0; // min_z_score
        state.scratchSpikeParamsU32[3] = 0; // primary pass

        // --- All Uploads FIRST ---
        // Mirror mode keeps the acquisition fixed and only remaps the viewport
        // in the shader. Re-uploading a 65k FFT on every pan was the remaining
        // CPU/bus cost that made mirrored scrolling feel worse than the option-off path.
        const needsWaveformUpload =
          !reuseWaveformUpload ||
          waveformDirty ||
          state.lastUploadedWaveform !== waveformData ||
          state.lastUploadedByteOffset !== waveformData.byteOffset ||
          state.lastUploadedByteLength !== waveformData.byteLength;
        if (needsWaveformUpload) {
          state.device.queue.writeBuffer(
            state.resampleInputBuffer,
            0,
            waveformData.buffer,
            waveformData.byteOffset,
            waveformData.byteLength,
          );
          state.lastUploadedWaveform = waveformData;
          state.lastUploadedByteOffset = waveformData.byteOffset;
          state.lastUploadedByteLength = waveformData.byteLength;
        }
        if (removeDcSpike) {
          state.scratchDcSpikeParams[0] = srcLen;
          state.scratchDcSpikeParams[1] = 0;
          state.scratchDcSpikeParams[2] = 0;
          state.scratchDcSpikeParams[3] = 0;
          state.device.queue.writeBuffer(
            state.dcSpikeParamsBuffer,
            0,
            state.scratchDcSpikeParams,
          );
        }
        state.scratchResampleParamsView.setUint32(0, srcLen, true);
        state.scratchResampleParamsView.setUint32(4, displayWidth, true);
        state.scratchResampleParamsView.setUint32(
          8,
          mirrorEnabled ? 1 : 0,
          true,
        );
        state.scratchResampleParamsView.setUint32(12, 0, true);
        state.scratchResampleParamsView.setFloat32(16, sourceRange.min, true);
        state.scratchResampleParamsView.setFloat32(20, sourceRange.max, true);
        state.scratchResampleParamsView.setFloat32(
          24,
          frequencyRange.min,
          true,
        );
        state.scratchResampleParamsView.setFloat32(
          28,
          frequencyRange.max,
          true,
        );
        state.scratchResampleParamsView.setFloat32(32, fftMin, true);
        // A display pixel represents a frequency interval, not a point. Give
        // the edge pixel half its own bandwidth of support so Float32 rounding
        // cannot turn a moving acquisition boundary into a one-pixel floor
        // seam. Larger uncovered ranges still remain at the noise floor.
        writeResampleEdgeCoverageParams(
          state.scratchResampleParamsView,
          frequencyRange,
          displayWidth,
        );
        state.device.queue.writeBuffer(
          state.resampleParamsBuffer,
          0,
          state.scratchResampleParamsAB,
        );
        if (analyzeSpikeOverlay && state.spikeParamsBuffer) {
          state.device.queue.writeBuffer(
            state.spikeParamsBuffer,
            0,
            state.scratchSpikeParamsAB,
          );
          state.scratchSpikeParamsU32[3] = 1; // recovery pass, same FFT frame
          state.device.queue.writeBuffer(
            state.spikeRecoveryParamsBuffer,
            0,
            state.scratchSpikeParamsAB,
          );
        }
        if (analyzeSpikeOverlay) {
          state.scratchNaptClassifyParamsView.setUint32(0, displayWidth, true);
          state.scratchNaptClassifyParamsView.setUint32(4, srcLen, true);
          state.scratchNaptClassifyParamsView.setFloat32(
            8,
            sourceRange.min,
            true,
          );
          state.scratchNaptClassifyParamsView.setFloat32(
            12,
            sourceRange.max,
            true,
          );
          state.device.queue.writeBuffer(
            state.naptClassifyParamsBuffer,
            0,
            state.scratchNaptClassifyParamsAB,
          );
        }
        if (analyzeSpikeOverlay && state.spikeCountBuffer) {
          state.device.queue.writeBuffer(
            state.spikeCountBuffer,
            0,
            state.scratchZeroCount,
          );
        }
        if (advanceSpikeHistory) {
          state.scratchNaptTemporalParams[0] = NAPT_TEMPORAL_HISTORY_LENGTH;
          state.scratchNaptTemporalParams[1] = state.naptTemporalHistoryIndex;
          state.scratchNaptTemporalParams[2] = state.naptTemporalHistoryCount;
          state.scratchNaptTemporalParams[3] = 0;
          state.device.queue.writeBuffer(
            state.naptTemporalParamsBuffer,
            0,
            state.scratchNaptTemporalParams,
          );
        }

        // --- Build command encoder: compute (resample → spikes) then render ---
        const nowMs =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const shouldReadSpikeResults =
          analyzeSpikeOverlay &&
          (onSpikeAnalysis || onSpikeCount) &&
          !state.spikeResultsReadbackInFlight &&
          nowMs - state.lastSpikeResultsReadbackMs >= 250;
        const shouldReadSpikeAnalysis = shouldReadSpikeResults && !!onSpikeAnalysis;
        const shouldReadSpikeCount = shouldReadSpikeResults && !!onSpikeCount;
        // Keep results attached to the frame/view that encoded the readback.
        // A later pan may replace the callback before mapAsync resolves.
        const spikeAnalysisForReadback = onSpikeAnalysis;
        const spikeCountForReadback = onSpikeCount;
        const analysisScopeForReadback = analysisScope ?? "";
        const renderSubmitStartedAt = browserPipelineMetrics.startTiming();
        const encoder = state.device.createCommandEncoder();

        if (analyzeSpikeOverlay) {
          encoder.clearBuffer(state.floorAvgResultBuffer);
          encoder.clearBuffer(state.naptClassifyResultBuffer);
        }

        const computePass = encoder.beginComputePass();
        if (removeDcSpike && state.dcSpikeBindGroup) {
          computePass.setPipeline(state.dcSpikeComputePipeline);
          computePass.setBindGroup(0, state.dcSpikeBindGroup);
          computePass.dispatchWorkgroups(Math.ceil(srcLen / 64));
        }
        computePass.setPipeline(state.resamplePipeline);
        computePass.setBindGroup(0, state.resampleBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(displayWidth / 64));

        if (
          analyzeSpikeOverlay &&
          state.floorAvgBindGroup &&
          state.spikeComputeBindGroup &&
          state.spikeRecoveryBindGroup &&
          state.naptClassifyBindGroup &&
          state.naptDetectBindGroup &&
          state.naptTemporalBindGroup &&
          state.spikeCountBuffer
        ) {
          // Floor Avg (reduce)
          computePass.setPipeline(state.floorAvgPipeline);
          computePass.setBindGroup(0, state.floorAvgBindGroup);
          computePass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
          // Floor Avg (finalize)
          computePass.setPipeline(state.floorAvgFinalizePipeline);
          computePass.setBindGroup(0, state.floorAvgBindGroup);
          computePass.dispatchWorkgroups(1);

          // Primary and recovery classification both consume the one resampled
          // frame above. The recovery pass only contributes missed candidates.
          computePass.setPipeline(state.spikeComputePipeline);
          computePass.setBindGroup(0, state.spikeComputeBindGroup);
          computePass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
          computePass.setBindGroup(0, state.spikeRecoveryBindGroup);
          computePass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
          computePass.setPipeline(state.naptClassifyPipeline);
          computePass.setBindGroup(0, state.naptClassifyBindGroup);
          computePass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
          computePass.setPipeline(state.naptClassifyFinalizePipeline);
          computePass.dispatchWorkgroups(1);
          computePass.setPipeline(state.naptDetectPipeline);
          computePass.setBindGroup(0, state.naptDetectBindGroup);
          computePass.dispatchWorkgroups(1);
          if (advanceSpikeHistory) {
            computePass.setPipeline(state.naptTemporalPipeline);
            computePass.setBindGroup(0, state.naptTemporalBindGroup);
            computePass.dispatchWorkgroups(1);

            state.naptTemporalHistoryIndex =
              (state.naptTemporalHistoryIndex + 1) % NAPT_TEMPORAL_HISTORY_LENGTH;
            state.naptTemporalHistoryCount = Math.min(
              NAPT_TEMPORAL_HISTORY_LENGTH,
              state.naptTemporalHistoryCount + 1,
            );
          }
        }
        computePass.end();

        if (shouldReadSpikeResults) {
          encoder.copyBufferToBuffer(
            state.naptClassifyResultBuffer,
            0,
            state.spikeResultsReadbackBuffer,
            SPIKE_CLASSIFIER_RESULT_OFFSET,
            SPIKE_CLASSIFIER_RESULT_BYTES,
          );
          encoder.copyBufferToBuffer(
            state.naptDecisionBuffer,
            0,
            state.spikeResultsReadbackBuffer,
            SPIKE_DECISION_RESULT_OFFSET,
            SPIKE_DECISION_RESULT_BYTES,
          );
          encoder.copyBufferToBuffer(
            state.naptTemporalDecisionBuffer,
            0,
            state.spikeResultsReadbackBuffer,
            SPIKE_TEMPORAL_RESULT_OFFSET,
            SPIKE_TEMPORAL_RESULT_BYTES,
          );
          encoder.copyBufferToBuffer(
            state.spikeMetricsBuffer,
            0,
            state.spikeResultsReadbackBuffer,
            SPIKE_METRICS_RESULT_OFFSET,
            SPIKE_METRICS_RESULT_BYTES,
          );
          encoder.copyBufferToBuffer(
            state.spikeCountBuffer!,
            0,
            state.spikeResultsReadbackBuffer,
            SPIKE_COUNT_RESULT_OFFSET,
            4,
          );
          state.spikeResultsReadbackInFlight = true;
          state.lastSpikeResultsReadbackMs = nowMs;
        } else if (
          !showSpikeOverlay &&
          onSpikeCount &&
          state.lastReportedSpikeCount !== 0
        ) {
          state.lastReportedSpikeCount = 0;
          onSpikeCount(0);
        }

        // Convert CSS pixel coordinates to WebGPU Normalized Device Coordinates (-1 to +1) space
        // Use offsetWidth/offsetHeight — clientWidth returns post-transform dimensions
        // inside React Flow's scaled viewport, giving wrong NDC coordinates.
        const logicalWidth = canvas.offsetWidth || canvas.clientWidth || 1;
        const logicalHeight = canvas.offsetHeight || canvas.clientHeight || 1;
        const fftAreaMax = {
          x: logicalWidth - (nodePreview ? 0 : 40),
          y: logicalHeight - (nodePreview ? 0 : 40 + reservedBottomPx),
        };

        // Plot bounds in NDC: X is [-1, 1], Y is [+1, -1] (Y flipped for screen coords)
        const plotMinX =
          ((nodePreview ? 0 : FFT_AREA_MIN.x) / logicalWidth) * 2 - 1;
        const plotMaxX = (fftAreaMax.x / logicalWidth) * 2 - 1;
        const yToNdc = (y: number) => 1 - (y / logicalHeight) * 2;
        const plotMaxY = yToNdc(nodePreview ? 0 : FFT_AREA_MIN.y);
        const plotMinY = yToNdc(fftAreaMax.y);

        const [lineR, lineG, lineB, lineA] = cachedParseCssColor(lineColor);
        const [fillR, fillG, fillB, fillA] = cachedParseCssColor(fillColor);

        // Pack uniforms into Float32Array (layout must match shader)
        // [0-15]: spectrum plot, dB, and color uniforms
        // [16-19]: acquisition min/max and viewport min/max for spike projection
        // [20]: mirror flag (the remaining components are padding)
        state.uniformValues[0] = plotMinX;
        state.uniformValues[1] = plotMinY;
        state.uniformValues[2] = plotMaxX;
        state.uniformValues[3] = plotMaxY;
        state.uniformValues[4] = fftMin;
        state.uniformValues[5] = fftMax;
        state.uniformValues[6] = displayWidth;
        state.uniformValues[7] = srcLen; // Source waveform length for spike index→x mapping
        const useDottedLine = isStandby || isDotted;
        state.uniformValues[8] = lineR;
        state.uniformValues[9] = lineG;
        state.uniformValues[10] = lineB;
        state.uniformValues[11] = useDottedLine
          ? lineA > 0
            ? -lineA
            : -1.0
          : lineA;
        state.uniformValues[12] = fillR;
        state.uniformValues[13] = fillG;
        state.uniformValues[14] = fillB;
        state.uniformValues[15] = fillA;
        state.uniformValues[16] = sourceRange.min;
        state.uniformValues[17] = sourceRange.max;
        state.uniformValues[18] = frequencyRange.min;
        state.uniformValues[19] = frequencyRange.max;
        state.uniformValues[20] = mirrorEnabled ? 1 : 0;

        state.device.queue.writeBuffer(
          state.uniformBuffer,
          0,
          state.uniformValues.buffer as ArrayBuffer,
          state.uniformValues.byteOffset,
          state.uniformValues.byteLength,
        );

        // --- Render pass: clear → grid → fill → line → markers → spikes ---
        const view = state.ctx.getCurrentTexture().createView();
        const [bgR, bgG, bgB, bgA] = cachedParseCssColor(backgroundColor);
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view,
              clearValue: { r: bgR, g: bgG, b: bgB, a: bgA },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });

        // Grid first (background layer)
        if (showGrid && gridOverlayRenderer) {
          gridOverlayRenderer.renderInPass(pass);
        }

        // Main FFT visualization: fill under the curve, then line on top
        pass.setBindGroup(0, state.bindGroup);
        pass.setPipeline(state.pipelineFill);
        pass.draw(displayWidth * 2); // 2 vertices per point for triangle strip
        pass.setPipeline(state.pipelineLine);
        pass.draw(displayWidth); // 1 vertex per point for line strip

        // Natively render spikes using the GPU buffers!
        if (showSpikeOverlay && state.spikeRenderBindGroup) {
          pass.setBindGroup(0, state.spikeRenderBindGroup);
          pass.setPipeline(state.spikeRenderLinePipeline);
          pass.draw(2, MAX_GPU_SPIKES * 2);
          pass.setPipeline(state.spikeRenderCirclePipeline);
          pass.draw(6, MAX_GPU_SPIKES * 2);
        }

        // Overlays on top (frequency markers)
        if (markersOverlayRenderer) {
          markersOverlayRenderer.renderInPass(pass);
        }

        if (!showSpikeOverlay && spikesOverlayRenderer) {
          spikesOverlayRenderer.renderInPass(pass);
        }
        pass.end();
        const gpuQueueStartedAt =
          renderSubmitStartedAt === null
            ? null
            : browserPipelineMetrics.startTiming();
        state.device.queue.submit([encoder.finish()]);
        browserPipelineMetrics.finishTiming("renderSubmit", renderSubmitStartedAt);
        if (gpuQueueStartedAt !== null) {
          void state.device.queue.onSubmittedWorkDone().then(
            () => browserPipelineMetrics.finishTiming("gpuQueueCompletion", gpuQueueStartedAt),
            () => browserPipelineMetrics.finishTiming("gpuQueueCompletion", gpuQueueStartedAt),
          );
        }
        // These buffers may still be referenced by submitted commands. Release
        // them once that work completes instead of retaining every resize.
        if (retiredBuffersRef.current.length > 0) {
          const retired = retiredBuffersRef.current.splice(0);
          const release = () => { for (const buffer of retired) buffer.destroy(); };
          void state.device.queue.onSubmittedWorkDone().then(release, release);
        }

        if (shouldReadSpikeResults) {
          const readbackBuffer = state.spikeResultsReadbackBuffer;
          void readbackBuffer
            .mapAsync(GPUMapMode.READ)
            .then(() => {
              const mapped = readbackBuffer.getMappedRange();
              try {
                if (
                  !shouldAcceptSpectrumSpikeAnalysisResult(
                    analysisScopeForReadback,
                    state.naptTemporalAnalysisScope ?? "",
                  )
                ) {
                  return;
                }
                if (shouldReadSpikeCount) {
                  const count = Math.min(
                    new DataView(mapped, SPIKE_COUNT_RESULT_OFFSET, 4).getUint32(0, true),
                    MAX_GPU_SPIKES,
                  );
                  if (count !== state.lastReportedSpikeCount) {
                    state.lastReportedSpikeCount = count;
                    spikeCountForReadback?.(count);
                  }
                }

                if (shouldReadSpikeAnalysis) {
                  const result = new DataView(
                    mapped,
                    SPIKE_CLASSIFIER_RESULT_OFFSET,
                    SPIKE_CLASSIFIER_RESULT_BYTES,
                  );
                  const decision = new DataView(
                    mapped,
                    SPIKE_DECISION_RESULT_OFFSET,
                    SPIKE_DECISION_RESULT_BYTES,
                  );
                  const temporal = new DataView(
                    mapped,
                    SPIKE_TEMPORAL_RESULT_OFFSET,
                    SPIKE_TEMPORAL_RESULT_BYTES,
                  );
                  const floorDbm = result.getFloat32(40, true);
                  const aboveFloorFraction = result.getFloat32(44, true);
                  const count = Math.min(result.getUint32(52, true), MAX_GPU_SPIKES);
                  const suspensionBridgeScore = result.getFloat32(56, true);
                  const clumpCount = result.getUint32(60, true);
                  const bridgeWidthScore = result.getFloat32(64, true);
                  const bridgeShoulderScore = result.getFloat32(68, true);
                  const uDipScore = result.getFloat32(72, true);
                  const floorRelativePowerScore = result.getFloat32(76, true);
                  const temporalStability = result.getFloat32(80, true);
                  const bandwidthPrior = result.getFloat32(84, true);
                  const envelopeFitScore = result.getFloat32(88, true);
                  const envelopeResidualScore = result.getFloat32(92, true);
                  const envelopeSupportCount = result.getUint32(96, true);
                  const sincPenaltyScore = result.getFloat32(100, true);
                  const unimodalBridgeScore = result.getFloat32(112, true);
                  const partialBridgeScore = result.getFloat32(116, true);
                  const apexProminenceScore = result.getFloat32(120, true);
                  const shoulderSymmetryScore = result.getFloat32(124, true);
                  const captureQualityScore = result.getFloat32(128, true);
                  const spacingHzRaw = result.getFloat32(132, true);
                  const spacingScore = result.getFloat32(136, true);
                  const spacingSupport = result.getFloat32(140, true);
                  const spacingToleranceHzRaw = result.getFloat32(144, true);
                  const spikeValleyFillScore = result.getFloat32(148, true);
                  const broadFloorVariationScore = result.getFloat32(152, true);
                  const frameInterferenceScore = result.getFloat32(156, true);
                  const spacingHz = spacingHzRaw > 0 ? spacingHzRaw : null;
                  const spacingToleranceHz = spacingToleranceHzRaw > 0
                    ? spacingToleranceHzRaw
                    : null;
                  const baselineIsNapt = decision.getUint32(0, true) !== 0;
                  const baselineConfidence = decision.getFloat32(4, true);
                  const temporalIsNapt = advanceSpikeHistory
                    ? temporal.getUint32(4, true) !== 0
                    : baselineIsNapt;
                  const temporalConfidence = advanceSpikeHistory
                    ? temporal.getFloat32(12, true)
                    : baselineConfidence;
                  const multiFramePersistence = advanceSpikeHistory
                    ? temporal.getFloat32(16, true)
                    : 0;
                  const multiFrameBridgeScore = advanceSpikeHistory
                    ? temporal.getFloat32(20, true)
                    : 0;
                  const multiFrameUDipScore = advanceSpikeHistory
                    ? temporal.getFloat32(24, true)
                    : 0;
                  const multiFrameFrameCount = advanceSpikeHistory
                    ? temporal.getUint32(28, true)
                    : 0;
                  const multiFrameUnimodalBridgeScore = advanceSpikeHistory
                    ? temporal.getFloat32(32, true)
                    : 0;
                  const multiFramePartialBridgeScore = advanceSpikeHistory
                    ? temporal.getFloat32(36, true)
                    : 0;
                  const multiFrameApexProminenceScore = advanceSpikeHistory
                    ? temporal.getFloat32(40, true)
                    : 0;
                  const multiFrameShoulderSymmetryScore = advanceSpikeHistory
                    ? temporal.getFloat32(44, true)
                    : 0;
                  const multiFrameSincPenaltyScore = advanceSpikeHistory
                    ? temporal.getFloat32(48, true)
                    : 0;
                  const multiFrameCoalescingScore = advanceSpikeHistory
                    ? temporal.getFloat32(52, true)
                    : 0;
                  const interferenceScore = advanceSpikeHistory
                    ? temporal.getFloat32(56, true)
                    : 0;
                  const interferenceEvidenceFrames = advanceSpikeHistory
                    ? temporal.getUint32(60, true)
                    : 0;
                  const values = new DataView(
                    mapped,
                    SPIKE_METRICS_RESULT_OFFSET,
                    SPIKE_METRICS_RESULT_BYTES,
                  );
                  const spikes = Array.from({ length: count }, (_, index) => {
                    const offset = index * 16;
                    return {
                      index: values.getUint32(offset + 8, true),
                      frequencyHz: values.getFloat32(offset, true),
                      powerDbm: values.getFloat32(offset + 4, true),
                    };
                  }).sort((a, b) => a.index - b.index);
                  spikeAnalysisForReadback?.({
                    isNapt: temporalIsNapt,
                    confidence: temporalConfidence,
                    baselineIsNapt,
                    baselineConfidence,
                    multiFrameIsNapt: temporalIsNapt,
                    multiFrameConfidence: temporalConfidence,
                    multiFramePersistence,
                    multiFrameFrameCount,
                    multiFrameBridgeScore,
                    multiFrameUDipScore,
                    multiFrameUnimodalBridgeScore,
                    multiFramePartialBridgeScore,
                    multiFrameApexProminenceScore,
                    multiFrameShoulderSymmetryScore,
                    multiFrameSincPenaltyScore,
                    multiFrameCoalescingScore,
                    aboveFloorFraction,
                    floorDbm,
                    suspensionBridgeScore,
                    clumpCount,
                    bridgeWidthScore,
                    bridgeShoulderScore,
                    uDipScore,
                    floorRelativePowerScore,
                    temporalStability,
                    bandwidthPrior,
                    envelopeFitScore,
                    envelopeResidualScore,
                    envelopeSupportCount,
                    sincPenaltyScore,
                    unimodalBridgeScore,
                    partialBridgeScore,
                    apexProminenceScore,
                    shoulderSymmetryScore,
                    captureQualityScore,
                    spacingHz,
                    spacingToleranceHz,
                    spacingScore,
                    spacingSupport,
                    spikeValleyFillScore,
                    broadFloorVariationScore,
                    interferenceScore,
                    frameInterferenceScore,
                    interferenceEvidenceFrames,
                    spikes,
                  });
                }
              } finally {
                readbackBuffer.unmap();
                state.spikeResultsReadbackInFlight = false;
              }
            })
            .catch(() => {
              state.spikeResultsReadbackInFlight = false;
            });
        }
        return true;
      } catch (error) {
        console.error("WebGPU FFT rendering failed:", error);
        return false;
      }
    },
    [createFFTWebGPUState, destroyRendererResources],
  );

  const cleanup = useCallback(() => {
    rendererGenerationRef.current++;
    initializationRef.current = null;
    flushRetiredBuffers();
    const state = rendererRef.current;
    if (state) {
      destroyRendererResources(state);
    }
    rendererRef.current = null;
    lastDataRef.current = null;
  }, [destroyRendererResources, flushRetiredBuffers]);

  return {
    drawWebGPUFFTSignal,
    cleanup,
  };
}
