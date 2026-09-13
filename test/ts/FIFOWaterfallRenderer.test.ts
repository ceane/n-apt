/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/spectrum/hooks/useDrawWebGPUFIFOWaterfall";

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
      copyBufferToTexture: jest.fn(),
      copyTextureToTexture: jest.fn(),
    })),
    queue: {
      writeTexture: jest.fn(),
      writeBuffer: jest.fn(),
      submit: jest.fn(),
      onSubmittedWorkDone: jest.fn(() => Promise.resolve()),
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
    mockCanvas.width = 1000;
    mockCanvas.height = 600;
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

  it("uploads the initial named colormap only once", async () => {
    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    await result.current.drawWebGPUFIFOWaterfall({
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData: new Float32Array(4096).fill(-50),
      colormap: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      colormapName: "test-gradient",
    });

    expect(mockDevice.createTexture).toHaveBeenCalledTimes(2);
  });

  it("uses the CPU FFT row when present so waterfall never waits on an async GPU row", async () => {
    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    const fftData = new Float32Array(4096).fill(-45);
    const gpuRowBuffer = { destroy: jest.fn() } as any;

    const success = await result.current.drawWebGPUFIFOWaterfall({
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData,
      fftDataBuffer: gpuRowBuffer,
      fftMin: -100,
      fftMax: 0,
    });

    expect(success).toBe(true);
    expect(mockDevice.queue.writeTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: expect.objectContaining({ y: expect.any(Number) }),
      }),
      expect.any(Uint8Array),
      expect.objectContaining({ bytesPerRow: expect.any(Number) }),
      expect.objectContaining({ width: 4096, height: 1 }),
    );

    const encoders = mockDevice.createCommandEncoder.mock.results.map(
      (entry) => entry.value,
    );
    expect(
      encoders.some(
        (encoder) => encoder.copyBufferToTexture.mock.calls.length > 0,
      ),
    ).toBe(false);
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
    (mockCanvas as any).height = 800;
    await result.current.drawWebGPUFIFOWaterfall({
      ...options,
      canvas: mockCanvas,
    });

    // Should create a new texture for the new height
    expect(mockDevice.createTexture).toHaveBeenCalledTimes(3); // 1 for color, 1 for data, 1 for resized data
  });

  it("reinitializes renderer state when the canvas identity changes", async () => {
    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());
    const fftData = new Float32Array(4096).fill(-50);
    const nextCanvas = {
      ...mockCanvas,
      getContext: jest.fn(() => ({
        configure: jest.fn(),
        getCurrentTexture: jest.fn(() => ({ createView: jest.fn() })),
      })),
    } as any;

    await result.current.drawWebGPUFIFOWaterfall({
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData,
    });
    await result.current.drawWebGPUFIFOWaterfall({
      canvas: nextCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData,
    });

    expect(mockCanvas.getContext).toHaveBeenCalledTimes(1);
    expect(nextCanvas.getContext).toHaveBeenCalledTimes(1);
  });

  it("should preserve paused waterfall history across taller resizes", async () => {
    const { result } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    const fftData = new Float32Array(4096).fill(-50);
    const options = {
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      fftData,
      frequencyRange: { min: 100, max: 110 },
      isPaused: true,
    };

    await result.current.drawWebGPUFIFOWaterfall(options);

    (mockCanvas as any).height = 800;
    await result.current.drawWebGPUFIFOWaterfall({
      ...options,
      canvas: mockCanvas,
    });

    const resizeEncoder = mockDevice.createCommandEncoder.mock.results
      .map((entry) => entry.value)
      .find((encoder) => encoder.copyTextureToTexture.mock.calls.length > 0);

    expect(resizeEncoder?.copyTextureToTexture).toHaveBeenCalled();
    expect(resizeEncoder?.copyTextureToTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        texture: expect.anything(),
      }),
      expect.objectContaining({
        texture: expect.anything(),
      }),
      expect.objectContaining({ width: 4096, height: 1 }),
    );
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
      expect.objectContaining({
        origin: expect.objectContaining({ y: expect.any(Number) }),
      }),
      expect.any(Uint8Array),
      expect.any(Object),
      expect.any(Object),
    );

    // Actually, it still writes the color texture on first init if we don't clear mock
    // Let's check specifically for the data texture write (which has Y origin)
  });
});
