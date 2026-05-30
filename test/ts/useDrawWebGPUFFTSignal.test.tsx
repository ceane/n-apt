/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useDrawWebGPUFFTSignal } from "@n-apt/hooks/useDrawWebGPUFFTSignal";

jest.mock("@n-apt/utils/webgpu", () => ({
  configureWebGPUCanvas: jest.fn(() => ({
    configure: jest.fn(),
    getCurrentTexture: jest.fn(() => ({
      createView: jest.fn(),
    })),
  })),
  parseCssColorToRgba: jest.fn(() => [0, 0, 0, 1]),
}));

jest.mock("@n-apt/consts", () => ({
  LINE_COLOR: "#ffffff",
  SHADOW_COLOR: "#000000",
  FFT_AREA_MIN: 0,
}));

jest.mock("@n-apt/shaders", () => ({
  SPECTRUM_SHADER: "shader",
  RESAMPLE_WGSL: "shader",
  SPIKE_COMPUTE_WGSL: "shader",
  SPIKE_RENDER_WGSL: "shader",
}));

(global as any).GPUShaderStage = {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
};
(global as any).GPUBufferUsage = {
  STORAGE: 1,
  COPY_DST: 2,
  COPY_SRC: 4,
  UNIFORM: 8,
};

describe("useDrawWebGPUFFTSignal", () => {
  const createMockBuffer = () => ({
    destroy: jest.fn(),
  });

  const mockDevice = {
    createShaderModule: jest.fn(),
    createRenderPipeline: jest.fn(() => ({
      getBindGroupLayout: jest.fn(() => ({})),
    })),
    createComputePipeline: jest.fn(() => ({
      getBindGroupLayout: jest.fn(() => ({})),
    })),
    createPipelineLayout: jest.fn(() => ({})),
    createBindGroupLayout: jest.fn(() => ({})),
    createBindGroup: jest.fn(() => ({})),
    createBuffer: jest.fn(() => createMockBuffer()),
    createCommandEncoder: jest.fn(() => ({
      beginComputePass: jest.fn(() => ({
        setPipeline: jest.fn(),
        setBindGroup: jest.fn(),
        dispatchWorkgroups: jest.fn(),
        end: jest.fn(),
      })),
      beginRenderPass: jest.fn(() => ({
        setPipeline: jest.fn(),
        setBindGroup: jest.fn(),
        draw: jest.fn(),
        end: jest.fn(),
      })),
      finish: jest.fn(() => ({})),
    })),
    queue: {
      writeBuffer: jest.fn(),
      submit: jest.fn(),
      onSubmittedWorkDone: jest.fn(() => Promise.resolve()),
    },
    popErrorScope: jest.fn(() => Promise.resolve(null)),
    pushErrorScope: jest.fn(),
  };

  const mockCanvas = {
    parentElement: { offsetWidth: 1380 },
    offsetWidth: 1380,
    width: 1380,
    height: 400,
    getContext: jest.fn(() => ({
      configure: jest.fn(),
      getCurrentTexture: jest.fn(() => ({
        createView: jest.fn(),
      })),
    })),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("defers destroying resized buffers until submitted work completes", async () => {
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    const waveformA = new Float32Array(1024).fill(-50);
    const waveformB = new Float32Array(2048).fill(-45);

    expect(
      await result.current.drawWebGPUFFTSignal({
        canvas: mockCanvas,
        device: mockDevice as any,
        format: "rgba8unorm" as GPUTextureFormat,
        waveform: waveformA,
        frequencyRange: { min: 0, max: 1 },
      }),
    ).toBe(true);

    const firstOutputBuffer =
      mockDevice.createBuffer.mock.results[
        mockDevice.createBuffer.mock.results.length - 1
      ]?.value;

    expect(
      await result.current.drawWebGPUFFTSignal({
        canvas: mockCanvas,
        device: mockDevice as any,
        format: "rgba8unorm" as GPUTextureFormat,
        waveform: waveformB,
        frequencyRange: { min: 0, max: 1 },
      }),
    ).toBe(true);

    expect(firstOutputBuffer.destroy).not.toHaveBeenCalled();
    expect(mockDevice.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
    result.current.cleanup();
    expect(firstOutputBuffer.destroy).toHaveBeenCalledTimes(1);
  });
});
