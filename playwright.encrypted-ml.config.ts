import { defineConfig, devices } from "@playwright/test";
import { resolveBackendBinaryPath } from "./scripts/build/backendBinaryPath";
import { resolvePlaywrightPassword } from "./test/support/authCredentials";
import { hasLocalEncryptedMlE2ECredentials } from "./test/support/encryptedMlE2ECredentials";

const credentialsAvailable = hasLocalEncryptedMlE2ECredentials();
const localWebServer = credentialsAvailable
  ? {
      webServer: {
        command: "node scripts/test/startEncryptedMlE2EServer.mjs",
        url: "http://127.0.0.1:5183",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          UNSAFE_LOCAL_USER_PASSWORD: resolvePlaywrightPassword(),
          NAPT_E2E_BACKEND_BINARY: resolveBackendBinaryPath(),
          WEBSOCKETS_URL: "http://127.0.0.1:8770",
          NAPT_BACKEND_PROXY_URL: "http://127.0.0.1:8770",
          NODE_ENV: "development",
        },
      },
    }
  : {};

export default defineConfig({
  testDir: "./test",
  testMatch: /EncryptedMlBundleE2E\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5183",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  ...localWebServer,
});
