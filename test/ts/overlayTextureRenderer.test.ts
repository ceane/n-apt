/** @jest-environment jsdom */
import { OverlayTextureRenderer } from "@n-apt/spectrum/hooks/useWebGPUInit";

class FakeOffscreenCanvas {
  width = 1;
  height = 1;
  getContext() {
    return { clearRect: jest.fn(), setTransform: jest.fn() };
  }
}

const createFakeDevice = () => {
  const textures: Array<{ createView: jest.Mock; destroy: jest.Mock }> = [];
  const device = {
    createSampler: jest.fn(() => ({})),
    createBindGroupLayout: jest.fn(() => ({})),
    createShaderModule: jest.fn(() => ({})),
    createRenderPipeline: jest.fn(() => ({})),
    createPipelineLayout: jest.fn(() => ({})),
    createTexture: jest.fn(() => {
      const texture = { createView: jest.fn(() => ({})), destroy: jest.fn() };
      textures.push(texture);
      return texture;
    }),
    createBindGroup: jest.fn(() => ({})),
    queue: { copyExternalImageToTexture: jest.fn() },
  };
  return { device: device as unknown as GPUDevice, textures };
};

const createPass = () => ({
  setPipeline: jest.fn(),
  setBindGroup: jest.fn(),
  draw: jest.fn(),
});

const asPass = (pass: ReturnType<typeof createPass>) =>
  pass as unknown as GPURenderPassEncoder;

const FORMAT = "bgra8unorm" as GPUTextureFormat;

describe("OverlayTextureRenderer lifecycle", () => {
  beforeAll(() => {
    // jsdom has neither OffscreenCanvas nor the WebGPU enum objects the
    // renderer builds its layout and texture from.
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.OffscreenCanvas = FakeOffscreenCanvas;
    globals.GPUShaderStage = { FRAGMENT: 0x2 };
    globals.GPUTextureUsage = {
      TEXTURE_BINDING: 0x4,
      COPY_DST: 0x2,
      RENDER_ATTACHMENT: 0x10,
    };
  });

  it("never composites a destroyed overlay texture", () => {
    // The bind group holds a view of the texture. Drawing it after destroy
    // composites a dead texture: the grid and axis labels vanish while the
    // spectrum trace, which re-uploads every frame, keeps painting.
    const { device } = createFakeDevice();
    const renderer = new OverlayTextureRenderer(device, FORMAT);

    renderer.beginDraw(320, 180, 1);
    renderer.endDraw();
    const live = createPass();
    renderer.renderInPass(asPass(live));
    expect(live.draw).toHaveBeenCalledTimes(1);

    renderer.destroy();
    const afterDestroy = createPass();
    renderer.renderInPass(asPass(afterDestroy));
    expect(afterDestroy.setPipeline).not.toHaveBeenCalled();
    expect(afterDestroy.setBindGroup).not.toHaveBeenCalled();
    expect(afterDestroy.draw).not.toHaveBeenCalled();
  });

  it("gives every renderer instance a distinct identity", () => {
    // A rebuilt renderer starts with no texture. Any cache deciding whether the
    // overlay needs a redraw keys on this identity, so it cannot outlive the
    // texture it was measured against.
    const { device } = createFakeDevice();
    const first = new OverlayTextureRenderer(device, FORMAT);
    const second = new OverlayTextureRenderer(device, FORMAT);

    expect(second.generation).not.toBe(first.generation);

    // Nothing to composite before the first upload, even though the bind group
    // layout and pipeline already exist.
    const pass = createPass();
    second.renderInPass(asPass(pass));
    expect(pass.draw).not.toHaveBeenCalled();
  });

  it("recreates its texture on the next upload after destroy", () => {
    const { device, textures } = createFakeDevice();
    const renderer = new OverlayTextureRenderer(device, FORMAT);

    renderer.beginDraw(100, 50, 2);
    renderer.endDraw();
    expect(textures).toHaveLength(1);

    renderer.destroy();
    expect(textures[0].destroy).toHaveBeenCalledTimes(1);

    renderer.beginDraw(100, 50, 2);
    renderer.endDraw();
    expect(textures).toHaveLength(2);

    const pass = createPass();
    renderer.renderInPass(asPass(pass));
    expect(pass.draw).toHaveBeenCalledTimes(1);
  });
});
