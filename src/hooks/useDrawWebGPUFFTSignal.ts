import { useCallback, useRef } from "react";
import { OverlayTextureRenderer } from "@n-apt/hooks/useWebGPUInit";
import { LINE_COLOR, SHADOW_COLOR, FFT_CANVAS_BG } from "@n-apt/consts";

// WebGPU SIMD Resampling Compute Shader (exported for reuse)
export const RESAMPLE_WGSL = `
struct ResampleParams {
  src_len: u32,
  out_len: u32,
  reserved1: u32,
  reserved2: u32,
};

@group(0) @binding(0) var<storage, read> input_buffer: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_buffer: array<f32>;
@group(0) @binding(2) var<uniform> params: ResampleParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  if (x >= params.out_len) {
    return;
  }
  
  let start = u32(floor(f32(x * params.src_len) / f32(params.out_len)));
  let end = min(start + 1, u32(floor(f32((x + 1) * params.src_len) / f32(params.out_len))));
  
  var max_val: f32 = -3.402823466e38; // f32::MIN
  for (var i = start; i < end && i < params.src_len; i = i + 1) {
    let v = input_buffer[i];
    // Check if v is finite by comparing with infinity values
    if (v != -3.402823466e38 && v != 3.402823466e38 && v > max_val) {
      max_val = v;
    }
  }
  
  output_buffer[x] = select(f32(-120.0), max_val, max_val > -3.402823466e38);
}
`;

// Inlined from gpu/webgpu.ts
function configureWebGPUCanvas(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  format: GPUTextureFormat,
  alphaMode: GPUCanvasAlphaMode = "premultiplied",
): GPUCanvasContext {
  const ctx = canvas.getContext("webgpu");
  if (!ctx) {
    throw new Error("WebGPU context not available");
  }
  ctx.configure({
    device,
    format,
    alphaMode,
  });
  return ctx;
}

function parseCssColorToRgba(color: string): [number, number, number, number] {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r / 255, g / 255, b / 255, 1];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r / 255, g / 255, b / 255, 1];
    }
  }

  const rgbaMatch = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    const r = Number(parts[0] ?? 0);
    const g = Number(parts[1] ?? 0);
    const b = Number(parts[2] ?? 0);
    const a = parts.length > 3 ? Number(parts[3]) : 1;
    return [r / 255, g / 255, b / 255, Math.max(0, Math.min(1, a))];
  }

  return [0, 0, 0, 1];
}

// Inlined FFTWebGPU shader
const spectrumShader = `
@group(0) @binding(0) var<storage, read> waveform: array<f32>;
@group(0) @binding(1) var<uniform> uniforms: array<vec4<f32>, 4>;

fn idx_to_x(idx: i32) -> f32 {
  let len = max(1.0, uniforms[1].z);
  let t = select(0.0, f32(idx) / (len - 1.0), len > 1.0);
  return mix(uniforms[0].x, uniforms[0].z, t);
}

fn value_to_y(value: f32) -> f32 {
  let norm = clamp((value - uniforms[1].x) / (uniforms[1].y - uniforms[1].x), 0.0, 1.0);
  return mix(uniforms[0].y, uniforms[0].w, norm);
}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn vs_line(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let idx = i32(vertex_index);
  let x = idx_to_x(idx);
  let y = value_to_y(waveform[idx]);
  return VertexOut(vec4<f32>(x, y, 0.0, 1.0));
}

@vertex
fn vs_fill(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  let idx = i32(vertex_index / 2u);
  let isTop = (vertex_index & 1u) == 0u;
  let x = idx_to_x(idx);
  let y = select(uniforms[0].y, value_to_y(waveform[idx]), isTop);
  return VertexOut(vec4<f32>(x, y, 0.0, 1.0));
}

@fragment
fn fs_line() -> @location(0) vec4<f32> {
  return uniforms[2];
}

@fragment
fn fs_fill() -> @location(0) vec4<f32> {
  return uniforms[3];
}
`;

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
}

export function useDrawWebGPUFFTSignal() {
  const rendererRef = useRef<FFTWebGPUState | null>(null);
  const lastDataRef = useRef<{ waveform: Float32Array; frequencyRange: any } | null>(null);

  const createFFTWebGPUState = useCallback(
    (canvas: HTMLCanvasElement, device: GPUDevice, format: GPUTextureFormat): FFTWebGPUState => {
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
      const module = device.createShaderModule({ code: spectrumShader });

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
          plotLeft: 40, // FFT_AREA_MIN.x
          plotRight: fftAreaMax.x,
          plotTop: 40, // FFT_AREA_MIN.y
          plotBottom: fftAreaMax.y,
          dbMin: fftMin,
          dbMax: fftMax,
          lineColor: LINE_COLOR,
          fillColor: SHADOW_COLOR,
          backgroundColor: FFT_CANVAS_BG,
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

        const [lineR, lineG, lineB, lineA] = parseCssColorToRgba(params.lineColor);
        const [fillR, fillG, fillB, fillA] = parseCssColorToRgba(params.fillColor);

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

        const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(params.backgroundColor);

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
