import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { encryptBundleBytes } from "../../scripts/encrypted-modules/bundle.ts";
import {
  ensureMlBundle,
  ML_BUNDLE_RELATIVE_PATH,
  ML_EXTRACTION_RELATIVE_PATH,
  ML_REQUIRED_FILES,
} from "../../scripts/encrypted-modules/mlRuntime.ts";
import { loadEncryptedMlModule } from "../../src/ts/shared/ui/loadEncryptedMlModule.ts";

const TEST_ONLY_PASSWORD = "generated-ml-bundle-test-password";
const TEST_MODULE_SOURCE = Buffer.from(
  [
    "export const ML_MODULE_BUNDLE_API_VERSION = 1;",
    "export function DemodReadinessNode() { return 'fixture readiness'; }",
    "",
  ].join("\n"),
  "utf8",
);

test("an extracted test bundle passes through the ML loader contract", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "napt-ml-loader-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const files = ML_REQUIRED_FILES.map((filePath) => ({
    path: filePath,
    content:
      filePath === "index.ts"
        ? TEST_MODULE_SOURCE
        : Buffer.from(`// generated contract fixture: ${filePath}\n`, "utf8"),
  }));
  const bundlePath = path.join(root, ML_BUNDLE_RELATIVE_PATH);
  await fs.mkdir(path.dirname(bundlePath), { recursive: true });
  await fs.writeFile(
    bundlePath,
    encryptBundleBytes(files, TEST_ONLY_PASSWORD, {
      requiredFiles: ML_REQUIRED_FILES,
    }),
  );

  const ready = await ensureMlBundle(root, { password: TEST_ONLY_PASSWORD });
  assert.equal(
    path.resolve(ready.extractionPath),
    path.resolve(root, ML_EXTRACTION_RELATIVE_PATH),
  );

  const indexUrl = pathToFileURL(
    path.join(ready.extractionPath, "index.ts"),
  ).href;
  const previousReady = Object.getOwnPropertyDescriptor(
    globalThis,
    "__N_APT_ML_BUNDLE_READY__",
  );
  const previousDev = Object.getOwnPropertyDescriptor(globalThis, "__DEV__");

  Object.defineProperty(globalThis, "__N_APT_ML_BUNDLE_READY__", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(globalThis, "__DEV__", {
    configurable: true,
    value: false,
  });

  try {
    const module = await loadEncryptedMlModule(() => import(indexUrl));
    assert.equal(module.ML_MODULE_BUNDLE_API_VERSION, 1);
    assert.equal(module.DemodReadinessNode(), "fixture readiness");
  } finally {
    if (previousReady) {
      Object.defineProperty(globalThis, "__N_APT_ML_BUNDLE_READY__", previousReady);
    } else {
      Reflect.deleteProperty(globalThis, "__N_APT_ML_BUNDLE_READY__");
    }
    if (previousDev) {
      Object.defineProperty(globalThis, "__DEV__", previousDev);
    } else {
      Reflect.deleteProperty(globalThis, "__DEV__");
    }
  }
});
