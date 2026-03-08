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
import { LINE_COLOR, SHADOW_COLOR, FFT_CANVAS_BG, FFT_AREA_MIN } from "@n-apt/consts";
import { SPECTRUM_SHADER } from "@n-apt/consts/shaders/spectrum";
import { configureWebGPUCanvas, parseCssColorToRgba } from "@n-apt/utils/webgpu";

// Shaders are imported from @n-apt/consts/shaders/

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
  waveformBuffer: GPUBuffer | null;
  waveformLength: number;
  pipelineLine: GPURenderPipeline;
  pipelineFill: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  bindGroupLayout: GPUBindGroupLayout;
  uniformValues: Float32Array;
};

export interface WebGPUFFTSignalOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  waveform: Float32Array;
  frequencyRange: { min: number; max: number };
  fftMin?: number;
  fftMax?: number;
  gridOverlayRenderer?: OverlayTextureRenderer;
  markersOverlayRenderer?: OverlayTextureRenderer;
  centerFrequencyMHz?: number;
  isDeviceConnected?: boolean;
  showGrid?: boolean;
  lineColor?: string;
  fillColor?: string;
  backgroundColor?: string;
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
    ): FFTWebGPUState => {
      const ctx = configureWebGPUCanvas(canvas, device, format);

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

      const uniformValues = new Float32Array(16);
      const uniformBuffer = device.createBuffer({
        size: uniformValues.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const createWaveformBuffer = (length: number): GPUBuffer => {
        return device.createBuffer({
          size: length * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      };

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: createWaveformBuffer(1) },
          },
          {
            binding: 1,
            resource: { buffer: uniformBuffer },
          },
        ],
      });

      return {
        canvas,
        device,
        format,
        ctx,
        uniformBuffer,
        waveformBuffer: null,
        waveformLength: 0,
        pipelineLine,
        pipelineFill,
        bindGroup,
        bindGroupLayout,
        uniformValues,
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
        showGrid = true,
        lineColor = LINE_COLOR,
        fillColor = SHADOW_COLOR,
        backgroundColor = FFT_CANVAS_BG,
      } = options;

      // Initialize renderer state if needed
      if (!rendererRef.current) {
        try {
          rendererRef.current = createFFTWebGPUState(canvas, device, format);
        } catch (error) {
          console.error("Failed to create WebGPU FFT renderer:", error);
          return false;
        }
      }

      const state = rendererRef.current;
      if (!state) return false;

      try {
        // Update waveform data
        if (waveform.length === 0) return false;

        if (!state.waveformBuffer || waveform.length !== state.waveformLength) {
          const createWaveformBuffer = (length: number): GPUBuffer => {
            return state.device.createBuffer({
              size: length * Float32Array.BYTES_PER_ELEMENT,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
          };

          state.waveformBuffer = createWaveformBuffer(waveform.length);
          state.waveformLength = waveform.length;
          state.bindGroup = state.device.createBindGroup({
            layout: state.bindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: state.waveformBuffer } },
              { binding: 1, resource: { buffer: state.uniformBuffer } },
            ],
          });
        }

        state.device.queue.writeBuffer(
          state.waveformBuffer,
          0,
          waveform.buffer as ArrayBuffer,
          waveform.byteOffset,
          waveform.byteLength,
        );

        // Prepare render parameters
        const logicalWidth = canvas.clientWidth || 1;
        const logicalHeight = canvas.clientHeight || 1;
        const dpr = window.devicePixelRatio || 1;

        const fftAreaMax = { x: logicalWidth - 40, y: logicalHeight - 40 };

        const params: SpectrumRenderParams = {
          canvasWidth: logicalWidth,
          canvasHeight: logicalHeight,
          dpr,
          plotLeft: FFT_AREA_MIN.x, 
          plotRight: fftAreaMax.x,
          plotTop: FFT_AREA_MIN.y, 
          plotBottom: fftAreaMax.y,
          dbMin: fftMin,
          dbMax: fftMax,
          lineColor: lineColor,
          fillColor: fillColor,
          backgroundColor: backgroundColor,
        };

        // Prepare overlays (overlays are rendered by FFTCanvas using useOverlayRenderer)
        const overlays = {
          pre: showGrid ? gridOverlayRenderer : null,
          post: markersOverlayRenderer,
        };

        // Render spectrum using WebGPU (inlined render logic)
        if (!state.waveformBuffer || state.waveformLength < 2) return false;

        const plotMinX = (params.plotLeft / params.canvasWidth) * 2 - 1;
        const plotMaxX = (params.plotRight / params.canvasWidth) * 2 - 1;
        const yToNdc = (y: number) => 1 - (y / params.canvasHeight) * 2;
        const plotMaxY = yToNdc(params.plotTop);
        const plotMinY = yToNdc(params.plotBottom);

        const [lineR, lineG, lineB, lineA] = parseCssColorToRgba(
          params.lineColor,
        );
        const [fillR, fillG, fillB, fillA] = parseCssColorToRgba(
          params.fillColor,
        );

        state.uniformValues[0] = plotMinX;
        state.uniformValues[1] = plotMinY;
        state.uniformValues[2] = plotMaxX;
        state.uniformValues[3] = plotMaxY;
        state.uniformValues[4] = params.dbMin;
        state.uniformValues[5] = params.dbMax;
        state.uniformValues[6] = state.waveformLength;
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

        const encoder = state.device.createCommandEncoder();
        const view = state.ctx.getCurrentTexture().createView();

        const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(
          params.backgroundColor,
        );

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

        // Draw underlay first (e.g. grid)
        if (overlays?.pre) {
          overlays.pre.renderInPass(pass);
        }

        pass.setBindGroup(0, state.bindGroup);

        pass.setPipeline(state.pipelineFill);
        pass.draw(state.waveformLength * 2);

        pass.setPipeline(state.pipelineLine);
        pass.draw(state.waveformLength);

        // Draw overlay last (e.g. markers/labels)
        if (overlays?.post) {
          overlays.post.renderInPass(pass);
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
