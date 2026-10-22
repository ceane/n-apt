import { copySpectrumIntoWaterfallRow } from "@n-apt/spectrum/hooks/useDrawWebGPUFIFOWaterfall";
import { act, renderHook } from "@testing-library/react";
import { useDrawWebGPUFIFOWaterfall } from "@n-apt/spectrum/hooks/useDrawWebGPUFIFOWaterfall";

const makeDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
};

const makeGpuFixture = () => {
  const pipeline = {};
  const pipelineTask = makeDeferred<any>();
  const uniformBuffer = { destroy: jest.fn() };
  const textures: any[] = [];
  const context = { configure: jest.fn() };
  const canvas: any = {
    width: 640, height: 360, offsetWidth: 640,
    parentElement: { offsetWidth: 640 },
    getContext: jest.fn(() => context),
  };
  const device: any = {
    createShaderModule: jest.fn(() => ({})),
    createRenderPipeline: jest.fn(() => pipeline),
    createRenderPipelineAsync: jest.fn(() => pipelineTask.promise),
    createBuffer: jest.fn(() => uniformBuffer),
    createTexture: jest.fn(() => {
      const texture = { destroy: jest.fn(), createView: jest.fn(() => ({})) };
      textures.push(texture);
      return texture;
    }),
    queue: { writeTexture: jest.fn() },
  };
  return { canvas, context, device, pipeline, pipelineTask, uniformBuffer, textures };
};

beforeEach(() => {
  Object.assign(globalThis, {
    GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
    GPUTextureUsage: { TEXTURE_BINDING: 1, COPY_DST: 2 },
  });
});

const drawOptions = (fixture: ReturnType<typeof makeGpuFixture>, onReady: () => void) => ({
  canvas: fixture.canvas,
  device: fixture.device,
  format: "bgra8unorm" as GPUTextureFormat,
  fftData: new Float32Array(8),
  onReady,
});

describe("copySpectrumIntoWaterfallRow", () => {
  it("copies a native-width spectrum without resampling", () => {
    const spectrum = new Float32Array([-80, -40, -20, -60]);
    const target = new Float32Array(4);

    copySpectrumIntoWaterfallRow(target, spectrum);

    expect(Array.from(target)).toEqual([-80, -40, -20, -60]);
  });

  it("resamples spectra that do not match the renderer width", () => {
    const spectrum = new Float32Array([-80, -20]);
    const target = new Float32Array(4);

    copySpectrumIntoWaterfallRow(target, spectrum);

    expect(Array.from(target)).toEqual([-80, -80, -20, -20]);
  });
});

describe("async waterfall initialization", () => {
  it("shares pending async pipeline setup and requests a redraw when ready", async () => {
    const fixture = makeGpuFixture();
    const onReady = jest.fn();
    const { result, unmount } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    act(() => {
      result.current.drawWebGPUFIFOWaterfall(drawOptions(fixture, onReady));
      result.current.drawWebGPUFIFOWaterfall(drawOptions(fixture, onReady));
    });
    expect(fixture.device.createRenderPipelineAsync).toHaveBeenCalledTimes(1);
    expect(fixture.device.createRenderPipeline).not.toHaveBeenCalled();
    expect(fixture.context.configure).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => {
      fixture.pipelineTask.resolve(fixture.pipeline);
      await fixture.pipelineTask.promise;
    });
    expect(fixture.context.configure).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("reuses the async pipeline for canvases with the same device and format", async () => {
    const first = makeGpuFixture();
    const second = makeGpuFixture();
    second.device = first.device;
    const firstReady = jest.fn();
    const secondReady = jest.fn();
    const firstHook = renderHook(() => useDrawWebGPUFIFOWaterfall());
    const secondHook = renderHook(() => useDrawWebGPUFIFOWaterfall());

    act(() => {
      firstHook.result.current.drawWebGPUFIFOWaterfall(drawOptions(first, firstReady));
      secondHook.result.current.drawWebGPUFIFOWaterfall(drawOptions(second, secondReady));
    });
    expect(first.device.createRenderPipelineAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.pipelineTask.resolve(first.pipeline);
      await first.pipelineTask.promise;
    });
    expect(firstReady).toHaveBeenCalledTimes(1);
    expect(secondReady).toHaveBeenCalledTimes(1);
    expect(first.context.configure).toHaveBeenCalledTimes(1);
    expect(second.context.configure).toHaveBeenCalledTimes(1);
    firstHook.unmount();
    secondHook.unmount();
  });

  it("discards and releases initialization that finishes after cleanup", async () => {
    const fixture = makeGpuFixture();
    const onReady = jest.fn();
    const { result, unmount } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    act(() => result.current.drawWebGPUFIFOWaterfall(drawOptions(fixture, onReady)));
    act(() => result.current.cleanup());
    await act(async () => {
      fixture.pipelineTask.resolve(fixture.pipeline);
      await fixture.pipelineTask.promise;
    });

    expect(onReady).not.toHaveBeenCalled();
    expect(fixture.context.configure).not.toHaveBeenCalled();
    expect(fixture.device.createBuffer).not.toHaveBeenCalled();
    expect(fixture.textures).toHaveLength(0);
    unmount();
  });

  it("does not configure a replaced device when its pipeline resolves late", async () => {
    const oldDevice = makeGpuFixture();
    const newDevice = makeGpuFixture();
    const oldReady = jest.fn();
    const newReady = jest.fn();
    const { result, unmount } = renderHook(() => useDrawWebGPUFIFOWaterfall());

    act(() => result.current.drawWebGPUFIFOWaterfall(drawOptions(oldDevice, oldReady)));
    act(() => result.current.drawWebGPUFIFOWaterfall(drawOptions(newDevice, newReady)));
    await act(async () => {
      oldDevice.pipelineTask.resolve(oldDevice.pipeline);
      await oldDevice.pipelineTask.promise;
    });
    expect(oldDevice.context.configure).not.toHaveBeenCalled();
    expect(oldDevice.device.createBuffer).not.toHaveBeenCalled();
    expect(oldReady).not.toHaveBeenCalled();

    await act(async () => {
      newDevice.pipelineTask.resolve(newDevice.pipeline);
      await newDevice.pipelineTask.promise;
    });
    expect(newDevice.context.configure).toHaveBeenCalledTimes(1);
    expect(newReady).toHaveBeenCalledTimes(1);
    unmount();
  });
});
