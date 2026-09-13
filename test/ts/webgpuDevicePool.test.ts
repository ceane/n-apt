import {
  acquireSharedWebGpuDevice,
  resetSharedWebGpuDeviceForTests,
} from "@n-apt/app/infrastructure/visualization/webgpuDevicePool";

describe("shared WebGPU device pool", () => {
  beforeEach(() => resetSharedWebGpuDeviceForTests());

  it("initializes one GPU device for concurrent visualization targets", async () => {
    const device = { lost: new Promise(() => undefined) } as unknown as GPUDevice;
    const requestDevice = jest.fn(async () => device);
    const requestAdapter = jest.fn(async () => ({ requestDevice }));
    const gpu = { requestAdapter } as unknown as GPU;

    const [first, second] = await Promise.all([
      acquireSharedWebGpuDevice(gpu),
      acquireSharedWebGpuDevice(gpu),
    ]);

    expect(first).toBe(device);
    expect(second).toBe(device);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
  });
});
