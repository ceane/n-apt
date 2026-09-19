import { act, renderHook } from "@testing-library/react";
import { acquireSharedWebGpuDevice } from "@n-apt/app/infrastructure/visualization/webgpuDevicePool";
import { useWebGPULifecycle } from "@n-apt/spectrum/hooks/useWebGPUInit";

jest.mock("@n-apt/app/infrastructure/visualization/webgpuDevicePool", () => ({
  acquireSharedWebGpuDevice: jest.fn(),
  resetSharedWebGpuDeviceForTests: jest.fn(),
}));
jest.mock("@n-apt/spectrum/hooks/useAsyncShaderCache", () => ({
  useAsyncShaderCache: () => ({ isInitialized: false }),
}));
jest.mock("@n-apt/spectrum/hooks/useSharedBufferManager", () => ({
  useSharedBufferManager: () => ({}),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDevice() {
  const lost = deferred<GPUDeviceLostInfo>();
  const device = Object.assign(new EventTarget(), {
    lost: lost.promise,
    onuncapturederror: null as (() => void) | null,
    createSampler: jest.fn(() => ({})),
    createBindGroupLayout: jest.fn(() => ({})),
    createShaderModule: jest.fn(() => ({})),
    createRenderPipeline: jest.fn(() => ({})),
    createComputePipeline: jest.fn(() => ({})),
    createPipelineLayout: jest.fn(() => ({})),
    createBuffer: jest.fn(() => ({ destroy: jest.fn() })),
    destroy: jest.fn(),
  });
  const fail = () => {
    device.dispatchEvent(new Event("uncapturederror"));
    device.onuncapturederror?.();
  };
  return { device, lost, fail };
}

function options(): Parameters<typeof useWebGPULifecycle>[0] {
  return {
    spectrumGpuCanvasRef: { current: null },
    waterfallGpuCanvasRef: { current: null },
    resampleWgsl: "",
    resampleComputePipelineRef: { current: null },
    resampleParamsBufferRef: { current: null },
    gpuBufferPoolRef: { current: [] },
  };
}

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  jest.mocked(acquireSharedWebGpuDevice).mockReset();
  Object.assign(globalThis, {
    OffscreenCanvas: class {
      getContext() { return {}; }
    },
    GPUShaderStage: { FRAGMENT: 2 },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

it("ignores device loss and queued error callbacks after unmount", async () => {
  const { device, lost, fail } = makeDevice();
  jest.mocked(acquireSharedWebGpuDevice).mockResolvedValue(device as unknown as GPUDevice);
  const initOptions = options();
  const { unmount } = renderHook(() => useWebGPULifecycle(initOptions));
  await flush();
  unmount();
  fail();
  lost.resolve({ reason: "unknown", message: "test" } as GPUDeviceLostInfo);
  await flush();
  expect(jest.getTimerCount()).toBe(0);
  expect(device.destroy).not.toHaveBeenCalled();
});

it.each(["resolve", "reject"] as const)("ignores late device acquisition %s after unmount", async (outcome) => {
  const request = deferred<GPUDevice | null>();
  const { device } = makeDevice();
  jest.mocked(acquireSharedWebGpuDevice).mockReturnValue(request.promise);
  const initOptions = options();
  const { unmount } = renderHook(() => useWebGPULifecycle(initOptions));
  unmount();
  if (outcome === "resolve") request.resolve(device as unknown as GPUDevice);
  else request.reject(new Error("unavailable"));
  await flush();
  expect(jest.getTimerCount()).toBe(0);
  expect(device.createBuffer).not.toHaveBeenCalled();
  expect(initOptions.gpuBufferPoolRef.current).toEqual([]);
  expect(device.destroy).not.toHaveBeenCalled();
});

it("coalesces retries and clears every pending retry on unmount", async () => {
  const { device, lost, fail } = makeDevice();
  jest.mocked(acquireSharedWebGpuDevice).mockResolvedValue(device as unknown as GPUDevice);
  const initOptions = options();
  const { unmount } = renderHook(() => useWebGPULifecycle(initOptions));
  await flush();
  act(() => { fail(); fail(); });
  lost.resolve({ reason: "unknown", message: "test" } as GPUDeviceLostInfo);
  await flush();
  expect(jest.getTimerCount()).toBe(1);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it("preserves other device subscribers and removes only its own listener", async () => {
  const { device } = makeDevice();
  const subscriber = jest.fn();
  device.onuncapturederror = subscriber;
  const add = jest.spyOn(device, "addEventListener");
  const remove = jest.spyOn(device, "removeEventListener");
  jest.mocked(acquireSharedWebGpuDevice).mockResolvedValue(device as unknown as GPUDevice);
  const initOptions = options();
  const { unmount } = renderHook(() => useWebGPULifecycle(initOptions));
  await flush();
  expect(device.onuncapturederror).toBe(subscriber);
  expect(add).toHaveBeenCalledWith("uncapturederror", expect.any(Function));
  const listener = add.mock.calls[0][1] as EventListener;
  unmount();
  expect(remove).toHaveBeenCalledWith("uncapturederror", listener);
  listener(new Event("uncapturederror"));
  expect(jest.getTimerCount()).toBe(0);
});
