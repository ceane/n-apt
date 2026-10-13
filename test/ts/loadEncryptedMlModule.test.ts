import { loadEncryptedMlModule } from "@n-apt/shared/ui/loadEncryptedMlModule";

describe("loadEncryptedMlModule", () => {
  let previousDev: PropertyDescriptor | undefined;
  let previousBundleReady: PropertyDescriptor | undefined;

  beforeEach(() => {
    previousDev = Object.getOwnPropertyDescriptor(globalThis, "__DEV__");
    previousBundleReady = Object.getOwnPropertyDescriptor(
      globalThis,
      "__N_APT_ML_BUNDLE_READY__",
    );
  });

  afterEach(() => {
    if (previousDev) {
      Object.defineProperty(globalThis, "__DEV__", previousDev);
    } else {
      Reflect.deleteProperty(globalThis, "__DEV__");
    }
    if (previousBundleReady) {
      Object.defineProperty(
        globalThis,
        "__N_APT_ML_BUNDLE_READY__",
        previousBundleReady,
      );
    } else {
      Reflect.deleteProperty(globalThis, "__N_APT_ML_BUNDLE_READY__");
    }
  });

  it("retries module import in development after the startup readiness snapshot was false", async () => {
    Object.defineProperty(globalThis, "__DEV__", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(globalThis, "__N_APT_ML_BUNDLE_READY__", {
      configurable: true,
      value: false,
    });

    const loadedModule = {
      ML_MODULE_BUNDLE_API_VERSION: 1,
    };
    const importModule = jest.fn().mockResolvedValue(loadedModule);

    await expect(
      loadEncryptedMlModule(importModule as never),
    ).resolves.toBe(loadedModule);
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it("keeps the readiness guard in production", async () => {
    Object.defineProperty(globalThis, "__DEV__", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(globalThis, "__N_APT_ML_BUNDLE_READY__", {
      configurable: true,
      value: false,
    });

    const importModule = jest.fn();
    await expect(loadEncryptedMlModule(importModule as never)).rejects.toThrow(
      "The encrypted ML feature bundle is unavailable.",
    );
    expect(importModule).not.toHaveBeenCalled();
  });
});
