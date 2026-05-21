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
import { OverlayTextureRenderer } from "@n-apt/hooks/useWebGPUInit";
import { LINE_COLOR, SHADOW_COLOR, FFT_AREA_MIN } from "@n-apt/consts";
import {
  SPECTRUM_SHADER,
  RESAMPLE_WGSL,
  SPIKE_COMPUTE_WGSL,
  SPIKE_RENDER_WGSL,
} from "@n-apt/shaders";
import {
  configureWebGPUCanvas,
  parseCssColorToRgba,
} from "@n-apt/utils/webgpu";

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
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-theme"],
  });
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
const cachedParseCssColor = (
  color: string,
): [number, number, number, number] => {
  const cached = parsedColorCache.get(color);
  if (cached) return cached;
  const result = parseCssColorToRgba(color);
  parsedColorCache.set(color, result);
  return result;
};

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
  resampleParamsBuffer: GPUBuffer;
  resampleBindGroup: GPUBindGroup | null;
  resampleInputLength: number;
  resampleOutputLength: number;
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
  spikeComputeBindGroup: GPUBindGroup | null;
  spikeRenderBindGroup: GPUBindGroup | null;
  spikeWaveformLength: number;
  floorAvgResultBuffer: GPUBuffer;
  floorAvgScratch: Uint32Array;
  // Persistent scratch buffers — allocated once, reused every frame
  scratchSpikeParamsAB: ArrayBuffer;
  scratchSpikeParamsU32: Uint32Array;
  scratchSpikeParamsF32: Float32Array;
  scratchResampleParams: Uint32Array;
  scratchZeroCount: Uint32Array;
  lastFrameCanvas?: HTMLCanvasElement;
};

export interface WebGPUFFTSignalOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  waveform: Float32Array | Uint8Array;
  frequencyRange: { min: number; max: number };
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
}

export function useDrawWebGPUFFTSignal() {
  const rendererRef = useRef<FFTWebGPUState | null>(null);
  const onSpikeCountRef = useRef<((count: number) => void) | undefined>(
    undefined,
  );
  const lastDataRef = useRef<{
    waveform: Float32Array;
    frequencyRange: any;
  } | null>(null);

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
        ],
      });

      const resampleModule = device.createShaderModule({ code: RESAMPLE_WGSL });
      const resamplePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [resampleBindGroupLayout],
        }),
        compute: { module: resampleModule, entryPoint: "main" },
      });

      // Resample params: [src_len, out_len, reserved, reserved] for compute shader
      const resampleParamsBuffer = device.createBuffer({
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
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const floorAvgResultBuffer = device.createBuffer({
        size: 12,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const floorAvgScratch = new Uint32Array(3);

      // Persistent scratch buffers — allocated once, reused every frame to avoid GC
      const scratchSpikeParamsAB = new ArrayBuffer(16);
      const scratchSpikeParamsU32 = new Uint32Array(scratchSpikeParamsAB);
      const scratchSpikeParamsF32 = new Float32Array(scratchSpikeParamsAB);
      const scratchResampleParams = new Uint32Array(4);
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
        resampleParamsBuffer,
        resampleBindGroup: null,
        resampleInputLength: 0,
        resampleOutputLength: 0,
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
        spikeComputeBindGroup: null,
        spikeRenderBindGroup: null,
        spikeWaveformLength: 0,
        floorAvgResultBuffer,
        floorAvgScratch,
        scratchSpikeParamsAB,
        scratchSpikeParamsU32,
        scratchSpikeParamsF32,
        scratchResampleParams,
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
        frequencyRange,
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
      } = options;

      onSpikeCountRef.current = onSpikeCount;

      // Background color from CSS variable - not configurable per-call to ensure
      // snapshot consistency (snapshots capture waveform data, not background)
      const backgroundColor = readCssColor("--color-fft-background", "#0a0a0a");

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

        // --- Resample input buffer: recreate when waveform length changes ---
        if (
          !state.resampleInputBuffer ||
          srcLen !== state.resampleInputLength
        ) {
          state.resampleInputBuffer?.destroy();
          state.resampleInputBuffer = state.device.createBuffer({
            size: srcLen * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          state.resampleInputLength = srcLen;
          buffersChanged = true;
        }

        // --- Resample output buffer: recreate when display width changes ---
        // This buffer holds the downsampled data that the render shader reads
        if (
          !state.resampleOutputBuffer ||
          displayWidth !== state.resampleOutputLength
        ) {
          state.resampleOutputBuffer?.destroy();
          state.resampleOutputBuffer = state.device.createBuffer({
            size: displayWidth * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
              { binding: 0, resource: { buffer: state.resampleInputBuffer } },
              { binding: 1, resource: { buffer: state.resampleOutputBuffer } },
              { binding: 2, resource: { buffer: state.resampleParamsBuffer } },
            ],
          });

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
        if (!state.spikeBuffer || srcLen !== state.spikeWaveformLength) {
          state.spikeBuffer?.destroy();
          state.spikeBuffer = state.device.createBuffer({
            // 128 spikes * 16 bytes (index: u32, value: f32, score: f32, radius: f32)
            size: 128 * 16,
            usage: GPUBufferUsage.STORAGE,
          });
          state.spikeCountBuffer?.destroy();
          state.spikeCountBuffer = state.device.createBuffer({
            size: 4,
            usage:
              GPUBufferUsage.STORAGE |
              GPUBufferUsage.COPY_DST |
              GPUBufferUsage.COPY_SRC,
          });
          state.spikeCountReadbackBuffer?.destroy();
          state.spikeCountReadbackBuffer = state.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          });
          state.spikeWaveformLength = srcLen;

          state.spikeComputeBindGroup = state.device.createBindGroup({
            layout: state.spikeComputePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: state.resampleInputBuffer! } },
              { binding: 1, resource: { buffer: state.spikeParamsBuffer } },
              { binding: 2, resource: { buffer: state.spikeBuffer } },
              { binding: 3, resource: { buffer: state.spikeCountBuffer } },
              { binding: 4, resource: { buffer: state.floorAvgResultBuffer } },
            ],
          });

          state.spikeRenderBindGroup = state.device.createBindGroup({
            layout: state.spikeRenderLinePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: state.spikeBuffer } },
              { binding: 1, resource: { buffer: state.uniformBuffer } },
              { binding: 2, resource: { buffer: state.spikeCountBuffer } },
            ],
          });
        }

        // --- Spikes parameters (using persistent scratch buffers) ---
        const spanHz = frequencyRange
          ? Math.abs(frequencyRange.max - frequencyRange.min)
          : 3_200_000;
        const binsPerHz = srcLen / Math.max(spanHz, 1);
        const bins45kHz = Math.ceil(binsPerHz * 45_000);
        const windowSize = Math.max(
          8,
          Math.min(Math.floor(srcLen / 64), bins45kHz, 18),
        );

        // Reuse persistent scratch buffers instead of allocating new ones each frame
        state.scratchSpikeParamsU32[0] = srcLen;
        state.scratchSpikeParamsU32[1] = windowSize;
        state.scratchSpikeParamsF32[2] = 3.0; // min_z_score
        let floorSum = 0.0;
        for (let i = 0; i < srcLen; i++) {
          floorSum += waveformData[i];
        }
        const globalFloor = floorSum / Math.max(1, srcLen);
        state.scratchSpikeParamsF32[3] = globalFloor;
        state.floorAvgScratch[0] = new Uint32Array(
          new Float32Array([globalFloor]).buffer,
        )[0];
        state.floorAvgScratch[1] = srcLen;
        state.floorAvgScratch[2] = Math.round(globalFloor * 1024);

        // --- All Uploads FIRST ---
        state.device.queue.writeBuffer(
          state.resampleInputBuffer,
          0,
          waveformData.buffer,
          waveformData.byteOffset,
          waveformData.byteLength,
        );
        state.scratchResampleParams[0] = srcLen;
        state.scratchResampleParams[1] = displayWidth;
        state.scratchResampleParams[2] = 0;
        state.scratchResampleParams[3] = 0;
        state.device.queue.writeBuffer(
          state.resampleParamsBuffer,
          0,
          state.scratchResampleParams,
        );
        if (state.spikeParamsBuffer) {
          state.device.queue.writeBuffer(
            state.spikeParamsBuffer,
            0,
            state.scratchSpikeParamsAB,
          );
        }
        if (state.spikeCountBuffer) {
          state.device.queue.writeBuffer(
            state.spikeCountBuffer,
            0,
            state.scratchZeroCount,
          );
        }
        state.device.queue.writeBuffer(
          state.floorAvgResultBuffer,
          0,
          state.floorAvgScratch,
        );

        // --- Build command encoder: compute (resample → spikes) then render ---
        const encoder = state.device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(state.resamplePipeline);
        computePass.setBindGroup(0, state.resampleBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(displayWidth / 64));

        if (
          showSpikeOverlay &&
          state.spikeComputeBindGroup &&
          state.spikeCountBuffer
        ) {
          computePass.setPipeline(state.spikeComputePipeline);
          computePass.setBindGroup(0, state.spikeComputeBindGroup);
          computePass.dispatchWorkgroups(Math.ceil(srcLen / 64));
        }
        computePass.end();

        const nowMs =
          typeof performance !== "undefined" ? performance.now() : Date.now();
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
          y: logicalHeight - (nodePreview ? 0 : 40),
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
        state.uniformValues[8] = lineR;
        state.uniformValues[9] = lineG;
        state.uniformValues[10] = lineB;
        state.uniformValues[11] = lineA;
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
          pass.draw(2, 128); // Max 128 instances
          pass.setPipeline(state.spikeRenderCirclePipeline);
          pass.draw(6, 128);
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

        if (canvas instanceof HTMLCanvasElement) {
          if (!state.lastFrameCanvas) {
            state.lastFrameCanvas = document.createElement("canvas");
          }
          const cacheCanvas = state.lastFrameCanvas;
          if (cacheCanvas.width !== canvas.width || cacheCanvas.height !== canvas.height) {
            cacheCanvas.width = canvas.width;
            cacheCanvas.height = canvas.height;
          }
          const cacheCtx = cacheCanvas.getContext("2d");
          if (cacheCtx) {
            cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
            cacheCtx.drawImage(canvas, 0, 0);
          }
          (canvas as any)._lastFrameCanvas = cacheCanvas;
        }

        if (shouldReadSpikeCount && state.spikeCountReadbackBuffer) {
          const readbackBuffer = state.spikeCountReadbackBuffer;
          void readbackBuffer
            .mapAsync(GPUMapMode.READ)
            .then(() => {
              const mapped = readbackBuffer.getMappedRange();
              const count = Math.min(new Uint32Array(mapped)[0] ?? 0, 128);
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
        return true;
      } catch (error) {
        console.error("WebGPU FFT rendering failed:", error);
        return false;
      }
    },
    [createFFTWebGPUState],
  );

  const cleanup = useCallback(() => {
    rendererRef.current = null;
    lastDataRef.current = null;
  }, []);

  return {
    drawWebGPUFFTSignal,
    cleanup,
  };
}
