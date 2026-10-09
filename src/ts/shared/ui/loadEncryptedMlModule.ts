type EncryptedMlModule = typeof import("@n-apt/encrypted-modules/tmp/ml/index");

export function loadEncryptedMlModule(): Promise<EncryptedMlModule> {
  const bundleReady =
    typeof __N_APT_ML_BUNDLE_READY__ !== "undefined" &&
    __N_APT_ML_BUNDLE_READY__;

  if (!bundleReady) {
    return Promise.reject(
      new Error("The encrypted ML feature bundle is unavailable."),
    );
  }

  return import("@n-apt/encrypted-modules/tmp/ml/index").then((module) => {
    if (module.ML_MODULE_BUNDLE_API_VERSION !== 1) {
      throw new Error("The encrypted ML bundle API version is unsupported.");
    }
    return module;
  });
}
