type EncryptedMlModule = typeof import("@n-apt/encrypted-modules/tmp/ml/index");
type EncryptedMlModuleImporter = () => Promise<EncryptedMlModule>;

export function loadEncryptedMlModule(
  importModule: EncryptedMlModuleImporter = () =>
    import("@n-apt/encrypted-modules/tmp/ml/index"),
): Promise<EncryptedMlModule> {
  const bundleReady =
    typeof __N_APT_ML_BUNDLE_READY__ !== "undefined" &&
    __N_APT_ML_BUNDLE_READY__;
  const developmentBuild = typeof __DEV__ !== "undefined" && __DEV__;

  if (!bundleReady && !developmentBuild) {
    return Promise.reject(
      new Error("The encrypted ML feature bundle is unavailable."),
    );
  }

  return importModule().then((module) => {
    if (module.ML_MODULE_BUNDLE_API_VERSION !== 1) {
      throw new Error("The encrypted ML bundle API version is unsupported.");
    }
    return module;
  });
}
