import { expect, test } from "@playwright/test";
import { resolvePlaywrightPassword } from "./support/authCredentials";
import { hasLocalEncryptedMlE2ECredentials } from "./support/encryptedMlE2ECredentials";

test.describe("Encrypted ML bundle E2E", () => {
  test.skip(
    !hasLocalEncryptedMlE2ECredentials(),
    "The real encrypted ML smoke test needs local ML, demod, and vault credentials; CI intentionally skips it.",
  );

  test("loads demod readiness from the encrypted ML bundle", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Secure Access Required for N-APT"),
    ).toBeVisible({ timeout: 20_000 });

    const usePasswordLink = page.getByText("Use password instead");
    if (await usePasswordLink.isVisible()) await usePasswordLink.click();

    await page
      .locator('input[placeholder="Password"]')
      .fill(resolvePlaywrightPassword());
    await page.getByRole("button", { name: "Authenticate" }).click();
    await expect(
      page.getByRole("heading", { name: "Let's get started." }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("link", { name: /Use app Explore spectrum/ }).click();
    const routesHeader = page.getByRole("button", { name: "Routes" });
    if ((await routesHeader.getAttribute("aria-expanded")) === "false") {
      await routesHeader.click();
    }
    await page.getByRole("button", { name: "Demod N-APT with ML" }).click();

    await expect(
      page.getByRole("region", { name: "Demodulation Readiness" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("alert", { name: "Demod readiness unavailable" }),
    ).toHaveCount(0);
  });
});
