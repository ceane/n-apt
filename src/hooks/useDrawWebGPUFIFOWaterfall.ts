import { useCallback, useRef } from "react";
import { WATERFALL_CANVAS_BG, DEFAULT_COLOR_MAP } from "@n-apt/consts";

// Inlined from gpu/webgpu.ts
function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

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

// Inlined WaterfallWebGPU shader
const waterfallShader = `
@group(0) @binding(0) var dataTex: texture_2d<f32>;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: array<vec4<f32>, 3>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let p = pos[vertex_index];
  return VertexOut(vec4<f32>(p, 0.0, 1.0));
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let pixel = position.xy;
  let wfSize = uniforms[0].xy;
  let margin = uniforms[0].zw;
  let xIn = pixel.x - margin.x;
  let yIn = pixel.y - margin.y;

  let inBounds = xIn >= 0.0 && yIn >= 0.0 && xIn < wfSize.x && yIn < wfSize.y;

  let texSize = uniforms[1].yz;
  let clampedX = clamp(xIn, 0.0, wfSize.x - 1.0);
  let clampedY = clamp(yIn, 0.0, wfSize.y - 1.0);
  let x = i32((clampedX / wfSize.x) * texSize.x);
  let y = i32((clampedY / wfSize.y) * texSize.y);

  let height = i32(texSize.y);
  var row = i32(uniforms[1].x) - y;
  if (row < 0) {
    row = row + height;
  }
  if (row >= height) {
    row = row - height;
  }

  let sample = textureLoad(dataTex, vec2<i32>(x, row), 0);
  let colorCount = max(1.0, uniforms[1].w);
  var colorIndex = i32(round(sample.r * (colorCount - 1.0)));
  colorIndex = clamp(colorIndex, 0, i32(colorCount) - 1);
  let color = textureLoad(colorTex, vec2<i32>(colorIndex, 0), 0);
  let mask = select(0.0, 1.0, inBounds);
  return mix(uniforms[2], color, mask);
}
`;

export type WaterfallRenderParams = {
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  marginX: number;
  marginY: number;
  backgroundColor: string;
};

// Inlined WaterfallWebGPU class as internal state
type WaterfallWebGPUState = {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  ctx: GPUCanvasContext;
  pipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  uniformValues: Float32Array;
  dataTexture: GPUTexture | null;
  colorTexture: GPUTexture;
  colorCount: number;
  bindGroup: GPUBindGroup | null;
  textureWidth: number;
  textureHeight: number;
  paddedRowBytes: number;
  rowUploadBuffer: Uint8Array;
  clearBuffer: Uint8Array | null;
  writeRow: number;
  clearColor: GPUColor;
};

export interface WebGPUFIFOWaterfallOptions {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  waterfallBuffer: Uint8ClampedArray;
  frequencyRange: { min: number; max: number };
  waterfallMin?: number;
  waterfallMax?: number;
  driftAmount?: number;
  driftDirection?: number;
}

export function useDrawWebGPUFIFOWaterfall() {
  const rendererRef = useRef<WaterfallWebGPUState | null>(null);
  const lastBufferRef = useRef<{ length: number; timestamp: number } | null>(null);

  const createColorMapTexture = useCallback((device: GPUDevice): GPUTexture => {
    const colors = DEFAULT_COLOR_MAP;
    const width = colors.length;
    const data = new Uint8Array(width * 4);
    for (let i = 0; i < colors.length; i++) {
      const [r, g, b] = colors[i];
      const idx = i * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }

    const texture = device.createTexture({
      size: { width, height: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: width * 4 },
      { width, height: 1, depthOrArrayLayers: 1 },
    );

    return texture;
  }, []);

  const createWaterfallWebGPUState = useCallback(
    (
      canvas: HTMLCanvasElement,
      device: GPUDevice,
      format: GPUTextureFormat,
    ): WaterfallWebGPUState => {
      const ctx = configureWebGPUCanvas(canvas, device, format);

      device.pushErrorScope("validation");
      const module = device.createShaderModule({ code: waterfallShader });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      device.popErrorScope().then((error) => {
        if (error) {
          console.error("WaterfallWebGPU pipeline error:", error.message);
        }
      });

      const uniformValues = new Float32Array(12);
      const uniformBuffer = device.createBuffer({
        size: uniformValues.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const colorTexture = createColorMapTexture(device);

      return {
        canvas,
        device,
        format,
        ctx,
        pipeline,
        uniformBuffer,
        uniformValues,
        dataTexture: null,
        colorTexture,
        colorCount: DEFAULT_COLOR_MAP.length,
        bindGroup: null,
        textureWidth: 0,
        textureHeight: 0,
        paddedRowBytes: 0,
        rowUploadBuffer: new Uint8Array(0),
        clearBuffer: null,
        writeRow: 0,
        clearColor: { r: 0, g: 0, b: 0, a: 1 },
      };
    },
    [createColorMapTexture],
  );

  const drawWebGPUFIFOWaterfall = useCallback(
    async (options: WebGPUFIFOWaterfallOptions) => {
      const {
        canvas,
        device,
        format,
        waterfallBuffer,
        frequencyRange,
        waterfallMin = -80,
        waterfallMax = 20,
        driftAmount = 0,
        driftDirection = 1,
      } = options;

      // Initialize renderer state if needed
      if (!rendererRef.current) {
        try {
          rendererRef.current = createWaterfallWebGPUState(canvas, device, format);
        } catch (error) {
          console.error("Failed to create WebGPU waterfall renderer:", error);
          return false;
        }
      }

      const state = rendererRef.current;

      try {
        // Reconfigure canvas if needed
        const currentDpr = window.devicePixelRatio || 1;
        const targetWidth = Math.max(1, Math.round(canvas.width * currentDpr));
        const targetHeight = Math.max(1, Math.round(canvas.height * currentDpr));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          state.ctx = configureWebGPUCanvas(canvas, state.device, state.format);
        }

        // Update dimensions if needed
        const marginY = Math.round(8 * currentDpr);
        const dataWidth = Math.max(1, Math.floor(waterfallBuffer.length / 4));
        const dataHeight = Math.max(1, Math.round(canvas.height * currentDpr) - marginY * 2);

        if (dataWidth !== state.textureWidth || dataHeight !== state.textureHeight) {
          const prevTexture = state.dataTexture;
          const prevWidth = state.textureWidth;
          const prevHeight = state.textureHeight;

          state.textureWidth = dataWidth;
          state.textureHeight = dataHeight;
          const widthChanged = prevWidth !== state.textureWidth;

          state.dataTexture = state.device.createTexture({
            size: { width: state.textureWidth, height: state.textureHeight },
            format: "r8unorm",
            usage:
              GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
          });

          state.paddedRowBytes = alignTo(state.textureWidth, 256);
          state.rowUploadBuffer = new Uint8Array(state.paddedRowBytes);
          state.writeRow = widthChanged ? 0 : Math.min(state.writeRow, state.textureHeight - 1);

          const clearSize = state.paddedRowBytes * state.textureHeight;
          if (!state.clearBuffer || state.clearBuffer.length !== clearSize) {
            state.clearBuffer = new Uint8Array(clearSize);
          }
          state.device.queue.writeTexture(
            { texture: state.dataTexture },
            new Uint8Array(clearSize),
            { bytesPerRow: state.paddedRowBytes, rowsPerImage: state.textureHeight },
            {
              width: state.textureWidth,
              height: state.textureHeight,
              depthOrArrayLayers: 1,
            },
          );

          if (prevTexture && !widthChanged) {
            const encoder = state.device.createCommandEncoder();
            const copyWidth = Math.min(prevWidth, state.textureWidth);
            const copyHeight = Math.min(prevHeight, state.textureHeight);
            encoder.copyTextureToTexture(
              { texture: prevTexture },
              { texture: state.dataTexture },
              { width: copyWidth, height: copyHeight, depthOrArrayLayers: 1 },
            );
            state.device.queue.submit([encoder.finish()]);
            prevTexture.destroy();
          } else if (prevTexture) {
            prevTexture.destroy();
          }

          state.bindGroup = state.device.createBindGroup({
            layout: state.pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: state.dataTexture.createView() },
              { binding: 1, resource: state.colorTexture.createView() },
              { binding: 2, resource: { buffer: state.uniformBuffer } },
            ],
          });
        }

        // Update waterfall data by pushing new line
        // Convert waterfall buffer to amplitude data (assuming RGBA format)
        const amplitudes = new Float32Array(canvas.width);

        // Extract the latest row from waterfallBuffer (assuming it's at the beginning)
        for (let i = 0; i < canvas.width && i < waterfallBuffer.length / 4; i++) {
          const pixelIndex = i * 4;
          // Convert RGBA to normalized amplitude
          const r = waterfallBuffer[pixelIndex] / 255.0;
          const g = waterfallBuffer[pixelIndex + 1] / 255.0;
          const b = waterfallBuffer[pixelIndex + 2] / 255.0;
          // Use average color intensity as the amplitude
          amplitudes[i] = (r + g + b) / 3.0;
        }

        // Add the new line to the waterfall with drift/smear effects (inlined pushLine logic)
        if (state.dataTexture && amplitudes.length > 0) {
          const smear = Math.max(
            0,
            Math.min(Math.floor(driftAmount || 0), state.textureHeight - 1),
          );
          const driftPixels = 0; // Set to 0 for now
          const boost = smear > 0 && Math.abs(driftPixels) > 0 ? 1.18 : 1;

          for (let s = 0; s <= smear; s++) {
            const drift =
              smear > 0 ? Math.round(((smear - s) / smear) * driftPixels) : Math.round(driftPixels);
            for (let i = 0; i < state.textureWidth; i++) {
              const src =
                (((i - drift) % state.textureWidth) + state.textureWidth) % state.textureWidth;
              const amp = Math.max(0, Math.min(1, amplitudes[src] ?? 0));
              const boosted = Math.min(1, amp * boost);
              state.rowUploadBuffer[i] = Math.round(boosted * 255);
            }

            const row = (state.writeRow - s + state.textureHeight) % state.textureHeight;
            state.device.queue.writeTexture(
              { texture: state.dataTexture, origin: { x: 0, y: row } },
              state.rowUploadBuffer,
              { bytesPerRow: state.paddedRowBytes, rowsPerImage: 1 },
              { width: state.textureWidth, height: 1, depthOrArrayLayers: 1 },
            );
          }

          state.writeRow = (state.writeRow + 1) % state.textureHeight;
        }

        // Prepare render parameters
        const logicalWidth = canvas.clientWidth || 1;
        const logicalHeight = canvas.clientHeight || 1;
        const dpr = window.devicePixelRatio || 1;
        const params: WaterfallRenderParams = {
          canvasWidth: logicalWidth,
          canvasHeight: logicalHeight,
          dpr,
          marginX: 40,
          marginY: 8,
          backgroundColor: WATERFALL_CANVAS_BG,
        };

        // Render the waterfall (inlined render logic)
        if (state.bindGroup && state.dataTexture) {
          const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(params.backgroundColor);
          state.clearColor = { r: bgR, g: bgG, b: bgB, a: bgA };

          const displayWidth = Math.max(
            1,
            Math.round(params.canvasWidth * params.dpr - params.marginX * 2),
          );
          const displayHeight = Math.max(
            1,
            Math.round(params.canvasHeight * params.dpr - params.marginY * 2),
          );

          state.uniformValues[0] = displayWidth;
          state.uniformValues[1] = displayHeight;
          state.uniformValues[2] = params.marginX;
          state.uniformValues[3] = params.marginY;
          const renderRow =
            state.textureHeight > 0
              ? (state.writeRow - 1 + state.textureHeight) % state.textureHeight
              : 0;
          state.uniformValues[4] = renderRow;
          state.uniformValues[5] = state.textureWidth;
          state.uniformValues[6] = state.textureHeight;
          state.uniformValues[7] = state.colorCount;
          state.uniformValues[8] = bgR;
          state.uniformValues[9] = bgG;
          state.uniformValues[10] = bgB;
          state.uniformValues[11] = bgA;

          state.device.queue.writeBuffer(state.uniformBuffer, 0, state.uniformValues);

          const encoder = state.device.createCommandEncoder();
          const view = state.ctx.getCurrentTexture().createView();

          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view,
                clearValue: state.clearColor,
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });

          pass.setPipeline(state.pipeline);
          pass.setBindGroup(0, state.bindGroup);
          pass.draw(3);
          pass.end();

          state.device.queue.submit([encoder.finish()]);
        }

        return true;
      } catch (error) {
        console.error("WebGPU waterfall rendering failed:", error);
        return false;
      }
    },
    [createWaterfallWebGPUState],
  );

  const cleanup = useCallback(() => {
    // WaterfallWebGPU doesn't have a destroy method, just clear the reference
    rendererRef.current = null;
    lastBufferRef.current = null;
  }, []);

  return {
    drawWebGPUFIFOWaterfall,
    cleanup,
  };
}
