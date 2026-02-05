import { configureWebGPUCanvas, parseCssColorToRgba } from "./webgpu"

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
`

export type SpectrumRenderParams = {
  canvasWidth: number
  canvasHeight: number
  dpr: number
  plotLeft: number
  plotRight: number
  plotTop: number
  plotBottom: number
  dbMin: number
  dbMax: number
  lineColor: string
  fillColor: string
  backgroundColor: string
}

export class FFTWebGPU {
  private canvas: HTMLCanvasElement
  private device: GPUDevice
  private format: GPUTextureFormat
  private ctx: GPUCanvasContext
  private uniformBuffer: GPUBuffer
  private waveformBuffer: GPUBuffer | null = null
  private waveformLength = 0
  private pipelineLine: GPURenderPipeline
  private pipelineFill: GPURenderPipeline
  private bindGroup: GPUBindGroup
  private bindGroupLayout: GPUBindGroupLayout
  private uniformValues = new Float32Array(16)

  constructor(canvas: HTMLCanvasElement, device: GPUDevice, format: GPUTextureFormat) {
    this.canvas = canvas
    this.device = device
    this.format = format

    this.ctx = configureWebGPUCanvas(canvas, device, format, canvas.clientWidth, canvas.clientHeight, 1)

    this.bindGroupLayout = device.createBindGroupLayout({
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
    })

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    })

    this.device.pushErrorScope("validation")
    const module = device.createShaderModule({ code: spectrumShader })

    this.pipelineLine = device.createRenderPipeline({
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
    })

    this.pipelineFill = device.createRenderPipeline({
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
    })
    this.device.popErrorScope().then((error) => {
      if (error) {
        console.error("FFTWebGPU pipeline error:", error.message)
      }
    })

    this.uniformBuffer = device.createBuffer({
      size: this.uniformValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.createWaveformBuffer(1) },
        },
        {
          binding: 1,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    })
  }

  resize(width: number, height: number, dpr: number): void {
    this.ctx = configureWebGPUCanvas(this.canvas, this.device, this.format, width, height, dpr)
  }

  updateWaveform(data: Float32Array): void {
    if (data.length === 0) return

    if (!this.waveformBuffer || data.length !== this.waveformLength) {
      this.waveformBuffer = this.createWaveformBuffer(data.length)
      this.waveformLength = data.length
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.waveformBuffer } },
          { binding: 1, resource: { buffer: this.uniformBuffer } },
        ],
      })
    }

    this.device.queue.writeBuffer(this.waveformBuffer, 0, data)
  }

  render(params: SpectrumRenderParams): void {
    if (!this.waveformBuffer || this.waveformLength < 2) return

    const plotMinX = (params.plotLeft / params.canvasWidth) * 2 - 1
    const plotMaxX = (params.plotRight / params.canvasWidth) * 2 - 1
    const yToNdc = (y: number) => 1 - (y / params.canvasHeight) * 2
    const plotMaxY = yToNdc(params.plotTop)
    const plotMinY = yToNdc(params.plotBottom)

    const [lineR, lineG, lineB, lineA] = parseCssColorToRgba(params.lineColor)
    const [fillR, fillG, fillB, fillA] = parseCssColorToRgba(params.fillColor)

    this.uniformValues[0] = plotMinX
    this.uniformValues[1] = plotMinY
    this.uniformValues[2] = plotMaxX
    this.uniformValues[3] = plotMaxY
    this.uniformValues[4] = params.dbMin
    this.uniformValues[5] = params.dbMax
    this.uniformValues[6] = this.waveformLength
    this.uniformValues[7] = 0
    this.uniformValues[8] = lineR
    this.uniformValues[9] = lineG
    this.uniformValues[10] = lineB
    this.uniformValues[11] = lineA
    this.uniformValues[12] = fillR
    this.uniformValues[13] = fillG
    this.uniformValues[14] = fillB
    this.uniformValues[15] = fillA

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformValues)

    const encoder = this.device.createCommandEncoder()
    const view = this.ctx.getCurrentTexture().createView()

    const [bgR, bgG, bgB, bgA] = parseCssColorToRgba(params.backgroundColor)

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: bgR, g: bgG, b: bgB, a: bgA },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })

    pass.setBindGroup(0, this.bindGroup)

    pass.setPipeline(this.pipelineFill)
    pass.draw(this.waveformLength * 2)

    pass.setPipeline(this.pipelineLine)
    pass.draw(this.waveformLength)

    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  private createWaveformBuffer(length: number): GPUBuffer {
    return this.device.createBuffer({
      size: length * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
}
