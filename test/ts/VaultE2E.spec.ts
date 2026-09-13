import { test, expect } from "@playwright/test";
import { resolvePlaywrightPassword } from "../support/authCredentials";

const PLAYWRIGHT_PASSWORD = resolvePlaywrightPassword();

test.describe("Vault E2E Lifecycle", () => {
  test("should unlock vault and show spectrum", async ({ page }) => {
    // 1. Navigate to the app
    await page.goto("/");

    // 2. Wait for the initial auth check to complete and show the auth UI
    // We expect to see "Secure Access Required"
    await expect(
      page.locator("text=Secure Access Required for N-APT"),
    ).toBeVisible({ timeout: 20000 });

    // 3. Handle Passkey vs Password screen
    // If the "Use password instead" link is visible, click it
    const usePasswordLink = page.locator("text=Use password instead");
    if (await usePasswordLink.isVisible()) {
      await usePasswordLink.click();
    }

    // 4. Enter password and authenticate
    const passwordInput = page.locator('input[placeholder="Password"]');
    await passwordInput.fill(PLAYWRIGHT_PASSWORD);
    await page.locator('button:has-text("Authenticate")').click();

    // 5. Verify successful authentication and the current post-auth landing
    // screen before entering the full spectrum application.
    await expect(
      page.getByRole("heading", { name: "Let's get started." }),
    ).toBeVisible({ timeout: 15000 });

    await page
      .getByRole("link", { name: /Use app Explore spectrum/ })
      .click();

    // 6. Verify the spectrum canvas is rendered
    // This confirms that decrypted data is flowing to the visualizer
    const canvas = page.locator("#fft-spectrum-canvas-webgpu");
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Optional: Check if we can see the "Vault Locked" status after logout
    // (This would require a logout button which is usually in the Re-auth flow or we can trigger it)
  });

  test("should show decryption failed for invalid password", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.locator("text=Secure Access Required for N-APT"),
    ).toBeVisible();

    // Handle Passkey screen
    const usePasswordLink = page.locator("text=Use password instead");
    if (await usePasswordLink.isVisible()) {
      await usePasswordLink.click();
    }

    const passwordInput = page.locator('input[placeholder="Password"]');
    await passwordInput.fill("wrong-password");
    await page.locator('button:has-text("Authenticate")').click();

    // Should show error message
    await expect(page.locator("text=Invalid passkey")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Let's get started." }),
    ).not.toBeVisible();
  });
});
