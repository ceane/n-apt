/** @jest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { useWebGPULifecycle } from "@n-apt/spectrum/hooks/useWebGPUInit";

// A never-settling `lost` promise keeps the device alive. The shared device
// pool in the canvas shim resolves `lost` immediately, which would tear the
// canvas back down part-way through the test.
jest.mock("@n-apt/app/infrastructure/visualization/webgpuDevicePool", () => {
  const device = {
    createSampler: jest.fn(() => ({})),
    createBindGroupLayout: jest.fn(() => ({})),
    createShaderModule: jest.fn(() => ({})),
    createRenderPipeline: jest.fn(() => ({})),
    createComputePipeline: jest.fn(() => ({})),
    createPipelineLayout: jest.fn(() => ({})),
    createBuffer: jest.fn(() => ({ destroy: jest.fn() })),
    createTexture: jest.fn(() => ({
      createView: jest.fn(() => ({})),
      destroy: jest.fn(),
    })),
    createBindGroup: jest.fn(() => ({})),
    queue: {
      writeBuffer: jest.fn(),
      copyExternalImageToTexture: jest.fn(),
      submit: jest.fn(),
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    lost: new Promise(() => {}),
  };

  return {
    acquireSharedWebGpuDevice: jest.fn(
      async () => device as unknown as GPUDevice,
    ),
    resetSharedWebGpuDeviceForTests: jest.fn(),
  };
});

class FakeOffscreenCanvas {
  width = 1;
  height = 1;
  getContext() {
    return { clearRect: jest.fn(), setTransform: jest.fn() };
  }
}

describe("useWebGPULifecycle overlay readiness", () => {
  beforeAll(() => {
    // jsdom has neither OffscreenCanvas nor the WebGPU enum objects the
    // overlay renderer builds its bind group layout from.
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.OffscreenCanvas = FakeOffscreenCanvas;
    globals.GPUShaderStage = { FRAGMENT: 0x2 };
    globals.GPUTextureUsage = {
      TEXTURE_BINDING: 0x4,
      COPY_DST: 0x2,
      RENDER_ATTACHMENT: 0x10,
    };
  });

  it("has the grid overlay renderer ready before the canvas can paint", async () => {
    // The grid, axes and labels are composed from the grid overlay texture in
    // the same pass as the spectrum. If the renderer is built after the paint
    // gate opens, the first painted frame has no grid and the chrome pops in a
    // frame later — the preview-frame flash in file playback.
    const renders: Array<{
      enabled: boolean;
      initializing: boolean;
      gridReady: boolean;
    }> = [];

    const initOptions: Parameters<typeof useWebGPULifecycle>[0] = {
      spectrumGpuCanvasRef: { current: null },
      waterfallGpuCanvasRef: { current: null },
      resampleWgsl: "// resample",
      resampleComputePipelineRef: { current: null },
      resampleParamsBufferRef: { current: null },
      gpuBufferPoolRef: { current: [] },
    };

    const { result } = renderHook(() => {
      const lifecycle = useWebGPULifecycle(initOptions);

      renders.push({
        enabled: lifecycle.webgpuEnabled,
        initializing: lifecycle.isInitializingWebGPU,
        gridReady: !!lifecycle.gridOverlayRendererRef.current,
      });

      return lifecycle;
    });

    await waitFor(() => expect(result.current.webgpuEnabled).toBe(true));

    const paintableRenders = renders.filter(
      (render) => render.enabled && !render.initializing,
    );
    expect(paintableRenders.length).toBeGreaterThan(0);
    expect(paintableRenders.every((render) => render.gridReady)).toBe(true);
  });
});
