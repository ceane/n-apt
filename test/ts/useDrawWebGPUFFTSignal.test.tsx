/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useDrawWebGPUFFTSignal } from "@n-apt/spectrum/hooks/useDrawWebGPUFFTSignal";

jest.mock("@n-apt/app/infrastructure/visualization/webgpu", () => ({
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
  FLOOR_AVG_WGSL: "shader",
  NAPT_CLASSIFY_WGSL: "shader",
  NAPT_DETECT_WGSL: "shader",
  NAPT_TEMPORAL_WGSL: "shader",
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
  MAP_READ: 16,
};
(global as any).GPUMapMode = { READ: 1 };

describe("useDrawWebGPUFFTSignal", () => {
  const createMockBuffer = (descriptor?: GPUBufferDescriptor) => {
    const mapped = new ArrayBuffer(Math.max(20_000, Number(descriptor?.size ?? 0)));
    if ((Number(descriptor?.usage ?? 0) & GPUBufferUsage.MAP_READ) !== 0) {
      new DataView(mapped).setUint32(160 + 8 + 64 + 1024 * 16, 1, true);
    }
    return {
      destroy: jest.fn(),
      mapAsync: jest.fn(() => Promise.resolve()),
      getMappedRange: jest.fn(() => mapped),
      unmap: jest.fn(),
    };
  };

  const computePass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    dispatchWorkgroups: jest.fn(),
    end: jest.fn(),
  };

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
    createBuffer: jest.fn((descriptor?: GPUBufferDescriptor) => createMockBuffer(descriptor)),
    createCommandEncoder: jest.fn(() => ({
      clearBuffer: jest.fn(),
      beginComputePass: jest.fn(() => computePass),
      beginRenderPass: jest.fn(() => ({
        setPipeline: jest.fn(),
        setBindGroup: jest.fn(),
        draw: jest.fn(),
        end: jest.fn(),
      })),
      finish: jest.fn(() => ({})),
      copyBufferToBuffer: jest.fn(),
    })),
    queue: {
      writeBuffer: jest.fn(),
      submit: jest.fn(),
      onSubmittedWorkDone: jest.fn(() => Promise.resolve()),
    },
    popErrorScope: jest.fn(() => Promise.resolve(null)),
    pushErrorScope: jest.fn(),
  };

  Object.assign(mockDevice, {
    createRenderPipelineAsync: jest.fn(async (descriptor: unknown) => mockDevice.createRenderPipeline()),
    createComputePipelineAsync: jest.fn(async (descriptor: unknown) => mockDevice.createComputePipeline()),
  });

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

  it("compiles pipelines asynchronously and shares concurrent initialization", async () => {
    const device = { ...mockDevice,
      createRenderPipelineAsync: jest.fn(async () => ({ getBindGroupLayout: () => ({}) })),
      createComputePipelineAsync: jest.fn(async () => ({ getBindGroupLayout: () => ({}) })),
    };
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    const options = { canvas: mockCanvas, device: device as any, format: "rgba8unorm" as GPUTextureFormat,
      waveform: new Float32Array(2048), frequencyRange: { min: 0, max: 1 } };
    await Promise.all([result.current.drawWebGPUFFTSignal(options), result.current.drawWebGPUFFTSignal(options)]);
    expect(device.createRenderPipelineAsync).toHaveBeenCalled();
    expect(device.createComputePipelineAsync).toHaveBeenCalled();
    expect(mockDevice.createRenderPipeline).not.toHaveBeenCalled();
    expect(mockDevice.createComputePipeline).not.toHaveBeenCalled();
    result.current.cleanup();
  });

  it("releases initialization buffers when asynchronous compilation fails", async () => {
    const device = { ...mockDevice,
      createRenderPipelineAsync: jest.fn(async () => ({ getBindGroupLayout: () => ({}) })),
      createComputePipelineAsync: jest.fn(async () => { throw new Error("compilation failed"); }),
    };
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    expect(await result.current.drawWebGPUFFTSignal({ canvas: mockCanvas, device: device as any, format: "rgba8unorm",
      waveform: new Float32Array(2048), frequencyRange: { min: 0, max: 1 } })).toBe(false);
    expect(mockDevice.createBuffer.mock.results.length).toBeGreaterThan(0);
    expect(mockDevice.createBuffer.mock.results.every(result => result.value.destroy.mock.calls.length === 1)).toBe(true);
    result.current.cleanup();
  });

  it("releases resized buffers after submitted GPU work completes", async () => {
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    const device = { ...mockDevice, queue: { ...mockDevice.queue, onSubmittedWorkDone: jest.fn(() => completion) } };
    const canvas = { ...mockCanvas, parentElement: { offsetWidth: 800 } };
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    const draw = () => result.current.drawWebGPUFFTSignal({ canvas, device: device as any, format: "rgba8unorm",
      waveform: new Float32Array(2048), frequencyRange: { min: 0, max: 1 } });
    await draw();
    const previous = mockDevice.createBuffer.mock.results.map(result => result.value);
    canvas.parentElement.offsetWidth = 1000;
    await draw();
    expect(previous.some(buffer => buffer.destroy.mock.calls.length)).toBe(false);
    finish();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(previous.some(buffer => buffer.destroy.mock.calls.length)).toBe(true);
    result.current.cleanup();
  });

  it("invalidates cached CSS reads on root attributes and head mutations", async () => {
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    const computedStyle = jest.spyOn(window, "getComputedStyle");
    const root = document.documentElement;
    const oldTheme = root.getAttribute("data-theme");
    const oldClass = root.getAttribute("class");
    const oldStyle = root.getAttribute("style");
    const style = document.createElement("style");
    const draw = () => result.current.drawWebGPUFFTSignal({
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm",
      waveform: new Float32Array(2048).fill(-50),
      frequencyRange: { min: 0, max: 1 },
    });
    try {
      root.style.setProperty("--color-fft-background", "#123456");
      await Promise.resolve();
      await draw();
      const firstReads = computedStyle.mock.calls.length;
      expect(firstReads).toBeGreaterThan(0);
      await draw();
      expect(computedStyle).toHaveBeenCalledTimes(firstReads);
      for (const [attribute, value] of [["data-theme", "test"], ["class", "test-render"]]) {
        root.setAttribute(attribute, value);
        await Promise.resolve();
        const reads = computedStyle.mock.calls.length;
        await draw();
        expect(computedStyle).toHaveBeenCalledTimes(reads + 1);
      }
      root.style.setProperty("--color-fft-background", "#654321");
      await Promise.resolve();
      const styleReads = computedStyle.mock.calls.length;
      await draw();
      expect(computedStyle).toHaveBeenCalledTimes(styleReads + 1);
      document.head.appendChild(style);
      await Promise.resolve();
      const headReads = computedStyle.mock.calls.length;
      await draw();
      expect(computedStyle).toHaveBeenCalledTimes(headReads + 1);
    } finally {
      style.remove();
      const attributes: [string, string | null][] = [["data-theme", oldTheme], ["class", oldClass], ["style", oldStyle]];
      for (const [attribute, value] of attributes) {
        if (value === null) root.removeAttribute(attribute);
        else root.setAttribute(attribute, value);
      }
      computedStyle.mockRestore();
      result.current.cleanup();
    }
  });

  it("runs both spike-detection passes against one resampled FFT frame", async () => {
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());

    expect(
      await result.current.drawWebGPUFFTSignal({
        canvas: mockCanvas,
        device: mockDevice as any,
        format: "rgba8unorm" as GPUTextureFormat,
        waveform: new Float32Array(2048).fill(-50),
        frequencyRange: { min: 0, max: 1 },
        showSpikeOverlay: true,
      }),
    ).toBe(true);

    const spikePipeline =
      mockDevice.createComputePipeline.mock.results[2]?.value;
    expect(computePass.setPipeline).toHaveBeenCalledWith(spikePipeline);
    const displayWorkgroups = Math.ceil(
      (mockCanvas.parentElement.offsetWidth - 40) / 64,
    );
    expect(computePass.dispatchWorkgroups).toHaveBeenCalledTimes(9);
    expect(computePass.dispatchWorkgroups.mock.calls).toEqual([
      [displayWorkgroups], // resample
      [displayWorkgroups], // floor average
      [1], // floor finalize
      [displayWorkgroups], // primary spike classification
      [displayWorkgroups], // recovery spike classification
      [displayWorkgroups], // N-APT metrics classification
      [1], // N-APT metrics finalize
      [1], // N-APT decision
      [1], // temporal N-APT decision
    ]);
    const bindGroupCalls = computePass.setBindGroup.mock.calls;
    expect(bindGroupCalls[bindGroupCalls.length - 2]?.[1]).not.toBe(
      bindGroupCalls[bindGroupCalls.length - 1]?.[1],
    );
    expect(mockDevice.createCommandEncoder).toHaveBeenCalledTimes(1);
    expect(mockDevice.queue.submit).toHaveBeenCalledTimes(1);
  });

  it("packs count and classifier results into one mapped readback buffer", async () => {
    jest.spyOn(performance, "now").mockReturnValue(1000);
    const onSpikeCount = jest.fn();
    const onSpikeAnalysis = jest.fn();
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());

    await result.current.drawWebGPUFFTSignal({
      canvas: mockCanvas,
      device: mockDevice as any,
      format: "rgba8unorm" as GPUTextureFormat,
      waveform: new Float32Array(2048).fill(-50),
      frequencyRange: { min: 0, max: 1 },
      showSpikeOverlay: true,
      onSpikeCount,
      onSpikeAnalysis,
    });
    await Promise.resolve();

    const readbackBuffers = mockDevice.createBuffer.mock.results
      .map((entry) => entry.value)
      .filter((buffer) => buffer.mapAsync.mock.calls.length > 0);
    expect(readbackBuffers).toHaveLength(1);
    expect(readbackBuffers[0].mapAsync).toHaveBeenCalledTimes(1);
    const encoder = mockDevice.createCommandEncoder.mock.results[0].value;
    const copies = encoder.copyBufferToBuffer.mock.calls;
    expect(copies).toHaveLength(5);
    expect(new Set(copies.map((call: unknown[]) => call[2])).size).toBe(1);
    expect(onSpikeCount).toHaveBeenCalledWith(1);
    expect(onSpikeAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      spikes: [],
      isNapt: false,
      confidence: 0,
    }));
    result.current.cleanup();
    jest.restoreAllMocks();
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
    expect(mockDevice.queue.onSubmittedWorkDone).toHaveBeenCalled();
    result.current.cleanup();
    expect(firstOutputBuffer.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not upload an unchanged FFT again for a pan-only GPU resample", async () => {
    const { result } = renderHook(() => useDrawWebGPUFFTSignal());
    const waveform = new Float32Array(2048).fill(-50);
    const draw = (frequencyRange: { min: number; max: number }, waveformDirty: boolean) =>
      result.current.drawWebGPUFFTSignal({
        canvas: mockCanvas,
        device: mockDevice as any,
        format: "rgba8unorm" as GPUTextureFormat,
        waveform,
        waveformDirty,
        frequencyRange,
        sourceFrequencyRange: { min: 0, max: 100 },
        reuseWaveformUpload: true,
      });

    await draw({ min: 0, max: 50 }, true);
    await draw({ min: 25, max: 75 }, false);

    const waveformUploads = mockDevice.queue.writeBuffer.mock.calls.filter(
      (call) => call[2] === waveform.buffer,
    );
    expect(waveformUploads).toHaveLength(1);
  });
});
