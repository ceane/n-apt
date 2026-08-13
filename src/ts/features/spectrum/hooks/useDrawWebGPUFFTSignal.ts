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
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const result = value || fallback;
  cssColorCache.set(name, result);
  return result;
};

// Cached parseCssColorToRgba results — avoids repeated CSS string parsing
const parsedColorCache = new Map<string, [number, number, number, number]>();
const MAX_GPU_SPIKES = 1024;
const NAPT_TEMPORAL_HISTORY_LENGTH = 32;
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

const NAPT_CLASSIFIER_SHADER_FINGERPRINT = shaderFingerprint(NAPT_CLASSIFY_WGSL);

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
  floorDbm: number;
  spikes: Array<{ frequencyHz: number; powerDbm: number; index: number }>;
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
  spikeCountReadbackBuffer: GPUBuffer | null;
  spikeCountReadbackInFlight: boolean;
  lastSpikeCountReadbackMs: number;
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
  naptClassifyReadbackBuffer: GPUBuffer;
  naptClassifyReadbackInFlight: boolean;
  spikeMetricsBuffer: GPUBuffer;
  spikeMetricsReadbackBuffer: GPUBuffer;
  naptDetectPipeline: GPUComputePipeline;
  naptDetectBindGroupLayout: GPUBindGroupLayout;
  naptDetectBindGroup: GPUBindGroup | null;
  naptDecisionBuffer: GPUBuffer;
  naptDecisionReadbackBuffer: GPUBuffer;
  naptTemporalPipeline: GPUComputePipeline;
  naptTemporalBindGroupLayout: GPUBindGroupLayout;
  naptTemporalBindGroup: GPUBindGroup | null;
  naptTemporalHistoryBuffer: GPUBuffer;
  naptTemporalParamsBuffer: GPUBuffer;
  naptTemporalDecisionBuffer: GPUBuffer;
  naptTemporalReadbackBuffer: GPUBuffer;
  naptTemporalHistoryIndex: number;
  naptTemporalHistoryCount: number;
  naptTemporalReadbackInFlight: boolean;
  naptTemporalFrequencyMin: number;
  naptTemporalFrequencyMax: number;
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
  /** Shift display coordinates onto a stale acquisition during retune. */
  presentationOffsetHz?: number;
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
  onSpikeCount?: (count: number) => void;
  onSpikeAnalysis?: (analysis: SpikeAnalysis) => void;
  reservedBottomPx?: number;
  isStandby?: boolean;
  isDotted?: boolean;
  removeDcSpike?: boolean;
}

export function useDrawWebGPUFFTSignal() {
  const rendererRef = useRef<FFTWebGPUState | null>(null);
  const onSpikeCountRef = useRef<((count: number) => void) | undefined>(
    undefined,
  );
  const onSpikeAnalysisRef = useRef<((analysis: SpikeAnalysis) => void) | undefined>(
    undefined,
  );
  const retiredBuffersRef = useRef<GPUBuffer[]>([]);
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
    state.resampleInputBuffer?.destroy();
    state.resampleOutputBuffer?.destroy();
    state.resamplePeakIndexBuffer?.destroy();
    state.resampleParamsBuffer?.destroy();
    state.dcSpikeOutputBuffer?.destroy();
    state.dcSpikeParamsBuffer?.destroy();
    state.spikeBuffer?.destroy();
    state.spikeCountBuffer?.destroy();
    state.spikeCountReadbackBuffer?.destroy();
    state.spikeParamsBuffer?.destroy();
    state.spikeRecoveryParamsBuffer?.destroy();
    state.floorAvgResultBuffer?.destroy();
    state.naptClassifyParamsBuffer?.destroy();
    state.naptClassifyResultBuffer?.destroy();
    state.naptClassifyReadbackBuffer?.destroy();
    state.spikeMetricsBuffer?.destroy();
    state.spikeMetricsReadbackBuffer?.destroy();
    state.naptDecisionBuffer?.destroy();
    state.naptDecisionReadbackBuffer?.destroy();
    state.naptTemporalHistoryBuffer?.destroy();
    state.naptTemporalParamsBuffer?.destroy();
    state.naptTemporalDecisionBuffer?.destroy();
    state.naptTemporalReadbackBuffer?.destroy();
  }, []);

  const retireBuffer = useCallback((buffer: GPUBuffer | null | undefined) => {
    if (!buffer) return;
    retiredBuffersRef.current.push(buffer);
  }, []);

  const createFFTWebGPUState = useCallback(
    (
      canvas: HTMLCanvasElement,
      device: GPUDevice,
      format: GPUTextureFormat,
    ): FFTWebGPUState | null => {
      const ctx = configureWebGPUCanvas(canvas, device, format);
      if (!ctx) {
        return null;
      }

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

      const pipelineLine = device.createRenderPipeline({
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

      const pipelineFill = device.createRenderPipeline({
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

      // Uniform buffer holds 16 floats: plot bounds (4), dB range (2), length (1),
      // padding (1), line color RGBA (4), fill color RGBA (4)
      const uniformValues = new Float32Array(16);
      const uniformBuffer = device.createBuffer({
        size: uniformValues.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // Dummy buffer for initial bind group creation - replaced with actual resampled data later
      const dummyWaveformBuffer = device.createBuffer({
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
      const resamplePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [resampleBindGroupLayout],
        }),
        compute: { module: resampleModule, entryPoint: "main" },
      });

      // Resample params: 12 x 4 bytes (mirror fold + frequency ranges)
      const resampleParamsBuffer = device.createBuffer({
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
      const dcSpikeComputePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [dcSpikeBindGroupLayout],
        }),
        compute: { module: dcSpikeModule, entryPoint: "remove_dc_spike" },
      });
      const dcSpikeParamsBuffer = device.createBuffer({
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
      const spikeComputePipeline = device.createComputePipeline({
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

      const spikeRenderLinePipeline = device.createRenderPipeline({
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

      const spikeRenderCirclePipeline = device.createRenderPipeline({
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

      const spikeParamsBuffer = device.createBuffer({
        size: 16,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.UNIFORM |
          GPUBufferUsage.COPY_DST,
      });
      const spikeRecoveryParamsBuffer = device.createBuffer({
        size: 16,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.UNIFORM |
          GPUBufferUsage.COPY_DST,
      });

      const floorAvgResultBuffer = device.createBuffer({
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
      const floorAvgPipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [floorAvgBindGroupLayout],
        }),
        compute: { module: floorAvgModule, entryPoint: "reduce" },
      });
      const floorAvgFinalizePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [floorAvgBindGroupLayout],
        }),
        compute: { module: floorAvgModule, entryPoint: "finalize" },
      });

      const naptClassifyParamsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const naptClassifyResultBuffer = device.createBuffer({
        size: 132,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC,
      });
      const naptClassifyReadbackBuffer = device.createBuffer({
        size: 132,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const spikeMetricsBuffer = device.createBuffer({
        size: MAX_GPU_SPIKES * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      const spikeMetricsReadbackBuffer = device.createBuffer({
        size: MAX_GPU_SPIKES * 16,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const naptClassifyModule = device.createShaderModule({
        code: NAPT_CLASSIFY_WGSL,
      });
      const naptClassifyBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        ],
      });
      const naptClassifyPipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [naptClassifyBindGroupLayout] }),
        compute: { module: naptClassifyModule, entryPoint: "classify" },
      });
      const naptClassifyFinalizePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [naptClassifyBindGroupLayout] }),
        compute: { module: naptClassifyModule, entryPoint: "finalize" },
      });
      const naptDecisionBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      const naptDecisionReadbackBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const naptDetectModule = device.createShaderModule({ code: NAPT_DETECT_WGSL });
      const naptDetectBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        ],
      });
      const naptDetectPipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [naptDetectBindGroupLayout] }),
        compute: { module: naptDetectModule, entryPoint: "main" },
      });
      const naptTemporalHistoryBuffer = device.createBuffer({
        size: NAPT_TEMPORAL_HISTORY_LENGTH * 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(
        naptTemporalHistoryBuffer,
        0,
        new Uint32Array(NAPT_TEMPORAL_HISTORY_LENGTH * 8),
      );
      const naptTemporalParamsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const naptTemporalDecisionBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      const naptTemporalReadbackBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const naptTemporalModule = device.createShaderModule({ code: NAPT_TEMPORAL_WGSL });
      const naptTemporalBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        ],
      });
      const naptTemporalPipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [naptTemporalBindGroupLayout] }),
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

      return {
        canvas,
        device,
        format,
        ctx,
        uniformBuffer,
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
        spikeCountReadbackBuffer: null,
        spikeCountReadbackInFlight: false,
        lastSpikeCountReadbackMs: 0,
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
        naptClassifyReadbackBuffer,
        naptClassifyReadbackInFlight: false,
        spikeMetricsBuffer,
        spikeMetricsReadbackBuffer,
        naptDetectPipeline,
        naptDetectBindGroupLayout,
        naptDetectBindGroup: null,
        naptDecisionBuffer,
        naptDecisionReadbackBuffer,
        naptTemporalPipeline,
        naptTemporalBindGroupLayout,
        naptTemporalBindGroup: null,
        naptTemporalHistoryBuffer,
        naptTemporalParamsBuffer,
        naptTemporalDecisionBuffer,
        naptTemporalReadbackBuffer,
        naptTemporalHistoryIndex: 0,
        naptTemporalHistoryCount: 0,
        naptTemporalReadbackInFlight: false,
        naptTemporalFrequencyMin: Number.NaN,
        naptTemporalFrequencyMax: Number.NaN,
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
        presentationOffsetHz = 0,
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
        onSpikeCount,
        onSpikeAnalysis,
        reservedBottomPx = 0,
        isStandby = false,
        isDotted = false,
        removeDcSpike = false,
      } = options;

      onSpikeCountRef.current = onSpikeCount;
      onSpikeAnalysisRef.current = onSpikeAnalysis;

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
        destroyRendererResources(staleState);
      }

      if (!rendererRef.current) {
        if (!canvas || !device || !format) return false;

        try {
          const nextState = createFFTWebGPUState(canvas, device, format);
          if (!nextState) return false;
          rendererRef.current = nextState;
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
          new Uint32Array(NAPT_TEMPORAL_HISTORY_LENGTH * 8),
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
        let buffersChanged = false;

        if (state.removeDcSpike !== removeDcSpike) {
          state.removeDcSpike = removeDcSpike;
          buffersChanged = true;
        }

        // A retune changes the normalized capture span. Do not let history
        // from the previous span vote on the new one; the one-frame baseline
        // remains available immediately while the new temporal window warms.
        if (
          state.naptTemporalFrequencyMin !== frequencyRange.min ||
          state.naptTemporalFrequencyMax !== frequencyRange.max
        ) {
          state.naptTemporalHistoryIndex = 0;
          state.naptTemporalHistoryCount = 0;
          state.device.queue.writeBuffer(
            state.naptTemporalHistoryBuffer,
            0,
            new Uint32Array(NAPT_TEMPORAL_HISTORY_LENGTH * 8),
          );
          state.naptTemporalFrequencyMin = frequencyRange.min;
          state.naptTemporalFrequencyMax = frequencyRange.max;
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

        if (removeDcSpike &&
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
                  { binding: 0, resource: { buffer: state.resampleInputBuffer } },
                  { binding: 1, resource: { buffer: state.dcSpikeOutputBuffer! } },
                  { binding: 2, resource: { buffer: state.dcSpikeParamsBuffer } },
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
          state.spikeCountReadbackBuffer = state.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
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
              { binding: 1, resource: { buffer: state.naptClassifyParamsBuffer } },
              { binding: 2, resource: { buffer: state.spikeBuffer! } },
              { binding: 3, resource: { buffer: state.naptClassifyResultBuffer } },
              { binding: 4, resource: { buffer: state.spikeCountBuffer! } },
              { binding: 5, resource: { buffer: state.spikeMetricsBuffer } },
            ],
          });
          state.naptDetectBindGroup = state.device.createBindGroup({
            layout: state.naptDetectBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: state.naptClassifyResultBuffer } },
              { binding: 1, resource: { buffer: state.naptDecisionBuffer } },
            ],
          });
          state.naptTemporalBindGroup = state.device.createBindGroup({
            layout: state.naptTemporalBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: state.naptDecisionBuffer } },
              { binding: 1, resource: { buffer: state.naptClassifyResultBuffer } },
              { binding: 2, resource: { buffer: state.naptTemporalHistoryBuffer } },
              { binding: 3, resource: { buffer: state.naptTemporalParamsBuffer } },
              { binding: 4, resource: { buffer: state.naptTemporalDecisionBuffer } },
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
        const sourceRange = sourceFrequencyRange ?? frequencyRange;
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
        state.scratchResampleParamsView.setFloat32(
          36,
          presentationOffsetHz,
          true,
        );
        state.scratchResampleParamsView.setFloat32(40, 0, true);
        state.scratchResampleParamsView.setFloat32(44, 0, true);
        state.device.queue.writeBuffer(
          state.resampleParamsBuffer,
          0,
          state.scratchResampleParamsAB,
        );
        if (state.spikeParamsBuffer) {
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
        state.scratchNaptClassifyParamsView.setUint32(0, displayWidth, true);
        state.scratchNaptClassifyParamsView.setUint32(4, srcLen, true);
        state.scratchNaptClassifyParamsView.setFloat32(
          8,
          frequencyRange.min,
          true,
        );
        state.scratchNaptClassifyParamsView.setFloat32(
          12,
          frequencyRange.max,
          true,
        );
        state.device.queue.writeBuffer(
          state.naptClassifyParamsBuffer,
          0,
          state.scratchNaptClassifyParamsAB,
        );
        if (state.spikeCountBuffer) {
          state.device.queue.writeBuffer(
            state.spikeCountBuffer,
            0,
            state.scratchZeroCount,
          );
        }
        if (showSpikeOverlay) {
          state.scratchNaptTemporalParams[0] = NAPT_TEMPORAL_HISTORY_LENGTH;
          state.scratchNaptTemporalParams[1] =
            state.naptTemporalHistoryIndex;
          state.scratchNaptTemporalParams[2] =
            state.naptTemporalHistoryCount;
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
        const shouldReadSpikeAnalysis =
          showSpikeOverlay &&
          onSpikeAnalysis &&
          !state.naptClassifyReadbackInFlight &&
          !state.naptTemporalReadbackInFlight &&
          nowMs - state.lastSpikeCountReadbackMs >= 250;
        const encoder = state.device.createCommandEncoder();

        if (showSpikeOverlay) {
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
          showSpikeOverlay &&
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
        computePass.end();

        if (shouldReadSpikeAnalysis) {
          encoder.copyBufferToBuffer(
            state.naptClassifyResultBuffer,
            0,
            state.naptClassifyReadbackBuffer,
            0,
            132,
          );
          encoder.copyBufferToBuffer(
            state.naptDecisionBuffer,
            0,
            state.naptDecisionReadbackBuffer,
            0,
            8,
          );
          encoder.copyBufferToBuffer(
            state.naptTemporalDecisionBuffer,
            0,
            state.naptTemporalReadbackBuffer,
            0,
            32,
          );
          encoder.copyBufferToBuffer(
            state.spikeMetricsBuffer,
            0,
            state.spikeMetricsReadbackBuffer,
            0,
            MAX_GPU_SPIKES * 16,
          );
          state.naptClassifyReadbackInFlight = true;
          state.naptTemporalReadbackInFlight = true;
        }

        const shouldReadSpikeCount =
          showSpikeOverlay &&
          onSpikeCount &&
          state.spikeCountBuffer &&
          state.spikeCountReadbackBuffer &&
          !state.spikeCountReadbackInFlight &&
          nowMs - state.lastSpikeCountReadbackMs >= 250;
        if (shouldReadSpikeCount) {
          encoder.copyBufferToBuffer(
            state.spikeCountBuffer!,
            0,
            state.spikeCountReadbackBuffer!,
            0,
            4,
          );
          state.spikeCountReadbackInFlight = true;
          state.lastSpikeCountReadbackMs = nowMs;
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
        // [0-3]: plot bounds (minX, minY, maxX, maxY)
        // [4-5]: dB range (min, max)
        // [6]:   display width (resampled waveform length for FFT shader)
        // [7]:   source waveform length (raw bin count, for spike index→x mapping)
        // [8-11]: line color RGBA
        // [12-15]: fill color RGBA
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
        state.uniformValues[11] = useDottedLine ? (lineA > 0 ? -lineA : -1.0) : lineA;
        state.uniformValues[12] = fillR;
        state.uniformValues[13] = fillG;
        state.uniformValues[14] = fillB;
        state.uniformValues[15] = fillA;

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
          pass.draw(2, MAX_GPU_SPIKES);
          pass.setPipeline(state.spikeRenderCirclePipeline);
          pass.draw(6, MAX_GPU_SPIKES);
        }

        // Overlays on top (frequency markers)
        if (markersOverlayRenderer) {
          markersOverlayRenderer.renderInPass(pass);
        }

        if (!showSpikeOverlay && spikesOverlayRenderer) {
          spikesOverlayRenderer.renderInPass(pass);
        }
        pass.end();
        state.device.queue.submit([encoder.finish()]);

        if (shouldReadSpikeCount && state.spikeCountReadbackBuffer) {
          const readbackBuffer = state.spikeCountReadbackBuffer;
          void readbackBuffer
            .mapAsync(GPUMapMode.READ)
            .then(() => {
              const mapped = readbackBuffer.getMappedRange();
              const count = Math.min(
                new Uint32Array(mapped)[0] ?? 0,
                MAX_GPU_SPIKES,
              );
              readbackBuffer.unmap();
              state.spikeCountReadbackInFlight = false;
              if (count !== state.lastReportedSpikeCount) {
                state.lastReportedSpikeCount = count;
                onSpikeCountRef.current?.(count);
              }
            })
            .catch(() => {
              state.spikeCountReadbackInFlight = false;
            });
        }
        if (shouldReadSpikeAnalysis) {
          const resultBuffer = state.naptClassifyReadbackBuffer;
          const spikeBuffer = state.spikeMetricsReadbackBuffer;
          void resultBuffer
            .mapAsync(GPUMapMode.READ)
            .then(() => {
              const result = new DataView(resultBuffer.getMappedRange());
              const floorDbm = result.getFloat32(40, true);
              const aboveFloorFraction = result.getFloat32(44, true);
              const periodicity = result.getFloat32(48, true);
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
              resultBuffer.unmap();
              return state.naptDecisionReadbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
              const decision = new DataView(
                  state.naptDecisionReadbackBuffer.getMappedRange(),
                );
                const baselineIsNapt = decision.getUint32(0, true) !== 0;
                const baselineConfidence = decision.getFloat32(4, true);
                state.naptDecisionReadbackBuffer.unmap();
                return state.naptTemporalReadbackBuffer
                  .mapAsync(GPUMapMode.READ)
                  .then(() => {
                    const temporal = new DataView(
                      state.naptTemporalReadbackBuffer.getMappedRange(),
                    );
                    const temporalIsNapt =
                      temporal.getUint32(4, true) !== 0;
                    const temporalConfidence = temporal.getFloat32(12, true);
                    const multiFramePersistence = temporal.getFloat32(16, true);
                    const multiFrameBridgeScore = temporal.getFloat32(20, true);
                    const multiFrameUDipScore = temporal.getFloat32(24, true);
                    const multiFrameFrameCount = temporal.getUint32(28, true);
                    state.naptTemporalReadbackBuffer.unmap();
                    return spikeBuffer.mapAsync(GPUMapMode.READ).then(() => ({
                      floorDbm,
                      confidence: temporalConfidence,
                      baselineIsNapt,
                      baselineConfidence,
                      multiFrameIsNapt: temporalIsNapt,
                      multiFrameConfidence: temporalConfidence,
                      multiFramePersistence,
                      multiFrameFrameCount,
                      multiFrameBridgeScore,
                      multiFrameUDipScore,
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
                      aboveFloorFraction,
                      periodicity,
                      isNapt: temporalIsNapt,
                      count,
                      data: spikeBuffer.getMappedRange(),
                    }));
                  });
              });
            })
            .then(({ floorDbm, confidence, baselineIsNapt, baselineConfidence, multiFrameIsNapt, multiFrameConfidence, multiFramePersistence, multiFrameFrameCount, multiFrameBridgeScore, multiFrameUDipScore, suspensionBridgeScore, clumpCount, bridgeWidthScore, bridgeShoulderScore, uDipScore, floorRelativePowerScore, temporalStability, bandwidthPrior, envelopeFitScore, envelopeResidualScore, envelopeSupportCount, sincPenaltyScore, unimodalBridgeScore, partialBridgeScore, apexProminenceScore, shoulderSymmetryScore, captureQualityScore, aboveFloorFraction, periodicity, isNapt, count, data }) => {
              const values = new DataView(data);
              const spikes = Array.from({ length: count }, (_, index) => {
                const offset = index * 16;
                const frequencyHz = values.getFloat32(offset, true);
                const powerDbm = values.getFloat32(offset + 4, true);
                const rawIndex = values.getUint32(offset + 8, true);
                return {
                  index: rawIndex,
                  frequencyHz,
                  powerDbm,
                };
              }).sort((a, b) => a.index - b.index);
              spikeBuffer.unmap();
              state.naptClassifyReadbackInFlight = false;
              state.naptTemporalReadbackInFlight = false;
              onSpikeAnalysisRef.current?.({
                isNapt,
                confidence,
                baselineIsNapt,
                baselineConfidence,
                multiFrameIsNapt,
                multiFrameConfidence,
                multiFramePersistence,
                multiFrameFrameCount,
                multiFrameBridgeScore,
                multiFrameUDipScore,
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
                spikes,
              });
              void aboveFloorFraction;
              void periodicity;
            })
            .catch(() => {
              state.naptClassifyReadbackInFlight = false;
              state.naptTemporalReadbackInFlight = false;
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
