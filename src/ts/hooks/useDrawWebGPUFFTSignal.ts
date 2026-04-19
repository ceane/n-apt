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
import { SPECTRUM_SHADER, RESAMPLE_WGSL } from "@n-apt/shaders";
import { configureWebGPUCanvas, parseCssColorToRgba } from "@n-apt/utils/webgpu";

const readCssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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
  centerFrequencyMHz?: number;
  isDeviceConnected?: boolean;
  showGrid?: boolean;
  lineColor?: string;
  fillColor?: string;
}

export function useDrawWebGPUFFTSignal() {
  const rendererRef = useRef<FFTWebGPUState | null>(null);
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
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        ],
      });

      const resampleModule = device.createShaderModule({ code: RESAMPLE_WGSL });
      const resamplePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [resampleBindGroupLayout] }),
        compute: { module: resampleModule, entryPoint: "main" },
      });

      // Resample params: [src_len, out_len, reserved, reserved] for compute shader
      const resampleParamsBuffer = device.createBuffer({
        size: 4 * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

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
        fftMin = -80,
        fftMax = 20,
        gridOverlayRenderer,
        markersOverlayRenderer,
        spikesOverlayRenderer,
        showGrid = true,
        lineColor = LINE_COLOR,
        fillColor = SHADOW_COLOR,
      } = options;

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

      const waveformData = waveform instanceof Uint8Array
        ? Float32Array.from(waveform)
        : waveform;

      if (waveformData.length === 0) return false;

      try {
        // Calculate target display width (CSS width minus 40px margins)
        // Must match CPU-side calculation for coordinate consistency
        const rect = canvas.parentElement?.getBoundingClientRect();
        const displayWidth = Math.max(
          1,
          Math.floor((rect?.width || canvas.clientWidth || 1) - 40),
        );

        const srcLen = waveformData.length;
        let buffersChanged = false;

        // --- Resample input buffer: recreate when waveform length changes ---
        if (!state.resampleInputBuffer || srcLen !== state.resampleInputLength) {
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
        if (!state.resampleOutputBuffer || displayWidth !== state.resampleOutputLength) {
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

        // --- Upload raw waveform to input buffer ---
        state.device.queue.writeBuffer(
          state.resampleInputBuffer,
          0,
          waveformData.buffer as ArrayBuffer,
          waveformData.byteOffset,
          waveformData.byteLength,
        );

        // --- Upload resample params ---
        const paramsData = new Uint32Array([srcLen, displayWidth, 0, 0]);
        state.device.queue.writeBuffer(
          state.resampleParamsBuffer,
          0,
          paramsData.buffer as ArrayBuffer,
          paramsData.byteOffset,
          paramsData.byteLength,
        );

        // --- Build command encoder: compute (resample) then render ---
        const encoder = state.device.createCommandEncoder();

        // Compute pass: GPU downsamples waveform from srcLen to displayWidth
        // Workgroup size 64 means we need ceil(displayWidth/64) dispatches
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(state.resamplePipeline);
        computePass.setBindGroup(0, state.resampleBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(displayWidth / 64));
        computePass.end();

        // --- Prepare render parameters ---
        // Convert CSS pixel coordinates to WebGPU Normalized Device Coordinates (-1 to +1) space
        const logicalWidth = canvas.clientWidth || 1;
        const logicalHeight = canvas.clientHeight || 1;
        const fftAreaMax = { x: logicalWidth - 40, y: logicalHeight - 40 };

        // Plot bounds in NDC: X is [-1, 1], Y is [+1, -1] (Y flipped for screen coords)
        const plotMinX = (FFT_AREA_MIN.x / logicalWidth) * 2 - 1;
        const plotMaxX = (fftAreaMax.x / logicalWidth) * 2 - 1;
        const yToNdc = (y: number) => 1 - (y / logicalHeight) * 2;
        const plotMaxY = yToNdc(FFT_AREA_MIN.y);
        const plotMinY = yToNdc(fftAreaMax.y);

        const [lineR, lineG, lineB, lineA] = parseCssColorToRgba(lineColor);
        const [fillR, fillG, fillB, fillA] = parseCssColorToRgba(fillColor);

        // Pack uniforms into Float32Array (layout must match shader)
        // [0-3]: plot bounds (minX, minY, maxX, maxY)
        // [4-5]: dB range (min, max)
        // [6-7]: waveform length + padding
        // [8-11]: line color RGBA
        // [12-15]: fill color RGBA
        state.uniformValues[0] = plotMinX;
        state.uniformValues[1] = plotMinY;
        state.uniformValues[2] = plotMaxX;
        state.uniformValues[3] = plotMaxY;
        state.uniformValues[4] = fftMin;
        state.uniformValues[5] = fftMax;
        state.uniformValues[6] = displayWidth;
        state.uniformValues[7] = 0;
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
        const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(backgroundColor);
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

        // Overlays on top (frequency markers, spike detections)
        if (markersOverlayRenderer) {
          markersOverlayRenderer.renderInPass(pass);
        }
        if (spikesOverlayRenderer) {
          spikesOverlayRenderer.renderInPass(pass);
        }
        pass.end();
        state.device.queue.submit([encoder.finish()]);
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
