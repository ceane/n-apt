/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/hooks/useDrawWebGPUFIFOWaterfall";

// Mock WebGPU constants
(global as any).GPUBufferUsage = {
  UNIFORM: 1,
  COPY_DST: 2,
  COPY_SRC: 4,
};
(global as any).GPUTextureUsage = {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  COPY_SRC: 4,
};

describe("useDrawWebGPUFIFOWaterfall Hook", () => {
  const mockDevice = {
    createTexture: jest.fn(() => ({
      createView: jest.fn(),
      destroy: jest.fn(),
    })),
    createBuffer: jest.fn(() => ({
      destroy: jest.fn(),
    })),
    createBindGroup: jest.fn(),
    createShaderModule: jest.fn(),
    createRenderPipeline: jest.fn(() => ({
      getBindGroupLayout: jest.fn(),
    })),
    createCommandEncoder: jest.fn(() => ({
      beginRenderPass: jest.fn(() => ({
        setPipeline: jest.fn(),
        setBindGroup: jest.fn(),
        draw: jest.fn(),
        end: jest.fn(),
      })),
      finish: jest.fn(),
      copyTextureToTexture: jest.fn(),
    })),
    queue: {
      writeTexture: jest.fn(),
      writeBuffer: jest.fn(),
      submit: jest.fn(),
    },
  };

  const mockCanvas = {
    getContext: jest.fn(() => ({
      configure: jest.fn(),
      getCurrentTexture: jest.fn(() => ({
        createView: jest.fn(),
      })),
    })),
    width: 1000,
    height: 600,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should initialize and render a waterfall frame", async () => {
    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());
    
    const fftData = new Float32Array(4096).fill(-50);
    const options = {
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData,
      frequencyRange: { min: 100, max: 110 },
      fftMin: -100,
      fftMax: 0,
    };

    const success = await result.current.drawWebGPUFIFOWaterfall(options);
    
    expect(success).toBe(true);
    expect(mockDevice.createTexture).toHaveBeenCalled();
    expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
    expect(mockDevice.createCommandEncoder).toHaveBeenCalled();
  });

  it("should handle resizing", async () => {
    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());
    
    const fftData = new Float32Array(4096).fill(-50);
    const options = {
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData,
      frequencyRange: { min: 100, max: 110 },
    };

    // First draw
    await result.current.drawWebGPUFIFOWaterfall(options);
    
    // Change height
    const resizedCanvas = { ...mockCanvas, height: 800 };
    await result.current.drawWebGPUFIFOWaterfall({ ...options, canvas: resizedCanvas });

    // Should create a new texture for the new height
    expect(mockDevice.createTexture).toHaveBeenCalledTimes(3); // 1 for color, 1 for data, 1 for resized data
  });

  it("should handle freeze mode", async () => {
    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());
    
    const fftData = new Float32Array(4096).fill(-50);
    const options = {
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData,
      frequencyRange: { min: 100, max: 110 },
      freeze: true,
    };

    await result.current.drawWebGPUFIFOWaterfall(options);

    // Should NOT write texture when frozen
    expect(mockDevice.queue.writeTexture).not.toHaveBeenCalledWith(
        expect.objectContaining({ origin: expect.objectContaining({ y: expect.any(Number) }) }),
        expect.any(Uint8Array),
        expect.any(Object),
        expect.any(Object)
    );
    
    // Actually, it still writes the color texture on first init if we don't clear mock
    // Let's check specifically for the data texture write (which has Y origin)
  });
});
