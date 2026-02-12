/**
 * OverlayTextureRenderer
 *
 * Renders 2D canvas content (grid, labels, markers) as a WebGPU texture overlay.
 * Draws to an offscreen CanvasRenderingContext2D, uploads the result as a GPU
 * texture, then composites it over the existing render target via a fullscreen
 * textured quad with alpha blending.
 */

const overlayShader = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
  // Fullscreen triangle-strip quad: 0→BL, 1→TL, 2→BR, 3→TR
  let x = select(-1.0, 1.0, (vi & 1u) != 0u);
  let y = select(-1.0, 1.0, (vi & 2u) != 0u);
  let u = (x + 1.0) * 0.5;
  let v = (1.0 - y) * 0.5;  // flip Y for texture coords
  return VertexOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(u, v));
}

@group(0) @binding(0) var overlayTex: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(overlayTex, overlaySampler, uv);
}
`

export class OverlayTextureRenderer {
  private device: GPUDevice
  private pipeline: GPURenderPipeline
  private sampler: GPUSampler
  private bindGroupLayout: GPUBindGroupLayout
  private texture: GPUTexture | null = null
  private bindGroup: GPUBindGroup | null = null
  private offscreen: OffscreenCanvas
  private offscreenCtx: OffscreenCanvasRenderingContext2D
  private texWidth = 0
  private texHeight = 0

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device

    this.offscreen = new OffscreenCanvas(1, 1)
    this.offscreenCtx = this.offscreen.getContext("2d")!

    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    })

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    })

    const module = device.createShaderModule({ code: overlayShader })

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
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
      primitive: { topology: "triangle-strip" },
    })
  }

  /**
   * Returns the offscreen 2D context for the caller to draw grid/markers/labels.
   * The caller should:
   *   1. Call `beginDraw(width, height, dpr)` to get the context
   *   2. Draw using standard Canvas2D API (the context is already scaled by dpr)
   *   3. Call `endDraw()` to upload the texture
   */
  beginDraw(width: number, height: number, dpr: number): OffscreenCanvasRenderingContext2D {
    const pw = Math.max(1, Math.round(width * dpr))
    const ph = Math.max(1, Math.round(height * dpr))

    if (this.offscreen.width !== pw || this.offscreen.height !== ph) {
      this.offscreen.width = pw
      this.offscreen.height = ph
      // Re-acquire context after resize (resizing can reset the context state)
      this.offscreenCtx = this.offscreen.getContext("2d")!
    }

    this.offscreenCtx.clearRect(0, 0, pw, ph)
    this.offscreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

    return this.offscreenCtx
  }

  /**
   * Uploads the offscreen canvas content as a GPU texture.
   * Must be called after drawing to the context returned by beginDraw().
   */
  endDraw(): void {
    const pw = this.offscreen.width
    const ph = this.offscreen.height

    if (
      !this.texture ||
      this.texWidth !== pw ||
      this.texHeight !== ph
    ) {
      if (this.texture) this.texture.destroy()
      this.texture = this.device.createTexture({
        size: [pw, ph],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.texWidth = pw
      this.texHeight = ph

      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: this.texture.createView() },
          { binding: 1, resource: this.sampler },
        ],
      })
    }

    // Upload offscreen canvas pixels to the GPU texture
    this.device.queue.copyExternalImageToTexture(
      { source: this.offscreen },
      { texture: this.texture },
      [pw, ph],
    )
  }

  /**
   * Renders the overlay texture as a fullscreen quad into the given render pass.
   * Call this AFTER the spectrum waveform has been drawn in the same render pass,
   * so the overlay composites on top.
   */
  renderInPass(pass: GPURenderPassEncoder): void {
    if (!this.bindGroup) return
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.draw(4)
  }

  destroy(): void {
    if (this.texture) {
      this.texture.destroy()
      this.texture = null
    }
  }
}
