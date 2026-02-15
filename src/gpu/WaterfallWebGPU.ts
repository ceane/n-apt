import { alignTo, configureWebGPUCanvas, parseCssColorToRgba } from "./webgpu";
import { DEFAULT_COLOR_MAP } from "@n-apt/consts";

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

export class WaterfallWebGPU {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice;
  private format: GPUTextureFormat;
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private uniformValues = new Float32Array(12);
  private dataTexture: GPUTexture | null = null;
  private colorTexture: GPUTexture;
  private colorCount = DEFAULT_COLOR_MAP.length;
  private bindGroup: GPUBindGroup | null = null;
  private textureWidth = 0;
  private textureHeight = 0;
  private paddedRowBytes = 0;
  private rowUploadBuffer = new Uint8Array(0);
  private clearBuffer: Uint8Array | null = null;
  private writeRow = 0;
  private clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 1 };

  constructor(canvas: HTMLCanvasElement, device: GPUDevice, format: GPUTextureFormat) {
    this.canvas = canvas;
    this.device = device;
    this.format = format;
    this.ctx = configureWebGPUCanvas(
      canvas,
      device,
      format,
      canvas.clientWidth,
      canvas.clientHeight,
      1,
    );

    this.device.pushErrorScope("validation");
    const module = device.createShaderModule({ code: waterfallShader });
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.device.popErrorScope().then((error) => {
      if (error) {
        console.error("WaterfallWebGPU pipeline error:", error.message);
      }
    });

    this.uniformBuffer = device.createBuffer({
      size: this.uniformValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.colorTexture = this.createColorMapTexture();
  }

  resize(width: number, height: number, dpr: number): void {
    this.ctx = configureWebGPUCanvas(this.canvas, this.device, this.format, width, height, dpr);
  }

  updateDimensions(width: number, height: number): void {
    if (width === this.textureWidth && height === this.textureHeight) return;

    const prevTexture = this.dataTexture;
    const prevWidth = this.textureWidth;
    const prevHeight = this.textureHeight;

    this.textureWidth = Math.max(1, Math.floor(width));
    this.textureHeight = Math.max(1, Math.floor(height));
    const widthChanged = prevWidth !== this.textureWidth;

    this.dataTexture = this.device.createTexture({
      size: { width: this.textureWidth, height: this.textureHeight },
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });

    this.paddedRowBytes = alignTo(this.textureWidth, 256);
    this.rowUploadBuffer = new Uint8Array(this.paddedRowBytes);
    this.writeRow = widthChanged ? 0 : Math.min(this.writeRow, this.textureHeight - 1);

    const clearSize = this.paddedRowBytes * this.textureHeight;
    if (!this.clearBuffer || this.clearBuffer.length !== clearSize) {
      this.clearBuffer = new Uint8Array(clearSize);
    }
    this.device.queue.writeTexture(
      { texture: this.dataTexture },
      new Uint8Array(clearSize),
      { bytesPerRow: this.paddedRowBytes, rowsPerImage: this.textureHeight },
      {
        width: this.textureWidth,
        height: this.textureHeight,
        depthOrArrayLayers: 1,
      },
    );

    if (prevTexture && !widthChanged) {
      const encoder = this.device.createCommandEncoder();
      const copyWidth = Math.min(prevWidth, this.textureWidth);
      const copyHeight = Math.min(prevHeight, this.textureHeight);
      encoder.copyTextureToTexture(
        { texture: prevTexture },
        { texture: this.dataTexture },
        { width: copyWidth, height: copyHeight, depthOrArrayLayers: 1 },
      );
      this.device.queue.submit([encoder.finish()]);
      prevTexture.destroy();
    } else if (prevTexture) {
      prevTexture.destroy();
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.dataTexture.createView() },
        { binding: 1, resource: this.colorTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  pushLine(amplitudes: Float32Array, smearRows: number = 0, driftPixels: number = 0): void {
    if (!this.dataTexture || amplitudes.length === 0) return;

    const width = this.textureWidth;
    if (width === 0) return;

    const smear = Math.max(0, Math.min(Math.floor(smearRows), this.textureHeight - 1));
    const boost = smear > 0 && Math.abs(driftPixels) > 0 ? 1.18 : 1;
    for (let s = 0; s <= smear; s++) {
      const drift =
        smear > 0 ? Math.round(((smear - s) / smear) * driftPixels) : Math.round(driftPixels);
      for (let i = 0; i < width; i++) {
        const src = (((i - drift) % width) + width) % width;
        const amp = Math.max(0, Math.min(1, amplitudes[src] ?? 0));
        const boosted = Math.min(1, amp * boost);
        this.rowUploadBuffer[i] = Math.round(boosted * 255);
      }

      const row = (this.writeRow - s + this.textureHeight) % this.textureHeight;
      this.device.queue.writeTexture(
        { texture: this.dataTexture, origin: { x: 0, y: row } },
        this.rowUploadBuffer,
        { bytesPerRow: this.paddedRowBytes, rowsPerImage: 1 },
        { width: width, height: 1, depthOrArrayLayers: 1 },
      );
    }

    this.writeRow = (this.writeRow + 1) % this.textureHeight;
  }

  render(params: WaterfallRenderParams): void {
    if (!this.bindGroup || !this.dataTexture) return;

    this.clearColor = this.colorToGpu(params.backgroundColor);

    const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(params.backgroundColor);
    const displayWidth = Math.max(
      1,
      Math.round(params.canvasWidth * params.dpr - params.marginX * 2),
    );
    const displayHeight = Math.max(
      1,
      Math.round(params.canvasHeight * params.dpr - params.marginY * 2),
    );

    this.uniformValues[0] = displayWidth;
    this.uniformValues[1] = displayHeight;
    this.uniformValues[2] = params.marginX;
    this.uniformValues[3] = params.marginY;
    const renderRow =
      this.textureHeight > 0 ? (this.writeRow - 1 + this.textureHeight) % this.textureHeight : 0;
    this.uniformValues[4] = renderRow;
    this.uniformValues[5] = this.textureWidth;
    this.uniformValues[6] = this.textureHeight;
    this.uniformValues[7] = this.colorCount;
    this.uniformValues[8] = bgR;
    this.uniformValues[9] = bgG;
    this.uniformValues[10] = bgB;
    this.uniformValues[11] = bgA;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformValues);

    const encoder = this.device.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: this.clearColor,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  private createColorMapTexture(): GPUTexture {
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

    const texture = this.device.createTexture({
      size: { width, height: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: width * 4 },
      { width, height: 1, depthOrArrayLayers: 1 },
    );

    return texture;
  }

  private colorToGpu(color: string): GPUColor {
    const [r, g, b, a] = parseCssColorToRgba(color);
    return { r, g, b, a };
  }
}
