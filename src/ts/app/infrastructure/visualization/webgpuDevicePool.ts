let devicePromise: Promise<GPUDevice | null> | null = null;
let deviceGpu: GPU | null = null;

/** One GPUDevice is shared by every FFT/waterfall target. Creating a device
 * per canvas duplicates pipeline caches and can serialize command queues. */
export const acquireSharedWebGpuDevice = (
  gpu: GPU | undefined = typeof navigator !== "undefined" && "gpu" in navigator
    ? navigator.gpu
    : undefined,
): Promise<GPUDevice | null> => {
  if (!gpu) return Promise.resolve(null);
  if (deviceGpu && deviceGpu !== gpu) devicePromise = null;
  if (!devicePromise) {
    deviceGpu = gpu;
    devicePromise = (async () => {
      try {
        const adapter = await gpu.requestAdapter({
          powerPreference: "high-performance",
        });
        if (!adapter) {
          devicePromise = null;
          return null;
        }
        const maxTextureDimension2D =
          adapter.limits?.maxTextureDimension2D ?? 16384;
        const device = await adapter.requestDevice({
          requiredLimits: {
            maxTextureDimension2D: Math.min(maxTextureDimension2D, 16384),
          },
        });
        if (device.lost && typeof device.lost.then === "function") {
          void device.lost.then(() => {
            devicePromise = null;
          });
        }
        return device;
      } catch {
        devicePromise = null;
        return null;
      }
    })();
  }
  return devicePromise;
};

export const resetSharedWebGpuDeviceForTests = (): void => {
  devicePromise = null;
  deviceGpu = null;
};
