import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/ts',
  testMatch: /.*\.spec\.(ts|tsx)$/,
  timeout: 60 * 1000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Run the local dev server before starting the tests
  webServer: {
    command: './target/dev-fast/n-apt-backend & npx vite --port 5173 --host 127.0.0.1',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120 * 1000,
    env: {
      UNSAFE_LOCAL_USER_PASSWORD: 'test-password-123',
      NODE_ENV: 'development',
    },
  },
});
