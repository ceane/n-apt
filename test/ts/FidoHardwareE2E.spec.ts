import { expect, test } from "@playwright/test";

const hardwareEnabled = process.env.NAPT_RUN_FIDO_HARDWARE === "1";

test.describe("physical FIDO security-key E2E", () => {
  test.skip(
    !hardwareEnabled,
    "Set NAPT_RUN_FIDO_HARDWARE=1 and run headed with an enrolled, plugged-in FIDO key.",
  );

  test("authenticates with the physical key and enables FIDO encryption", async ({ page }) => {
    page.setDefaultTimeout(120_000);
    // Start at the auth route so a fresh browser profile does not stop at the
    // first-run walkthrough before reaching the physical-key ceremony.
    await page.goto("/auth");

    await expect(page.getByRole("button", { name: "Use FIDO Security Key" })).toBeVisible();
    await page.getByRole("button", { name: "Use FIDO Security Key" }).click();
    await expect(
      page.getByRole("link", { name: /Use app Explore spectrum/ }),
    ).toBeVisible({ timeout: 120_000 });
    await page.getByRole("link", { name: /Use app Explore spectrum/ }).click();

    await page.getByRole("button", { name: /Take an I\/Q Capture/ }).click();
    const fidoEncryption = page.getByRole("checkbox", { name: "Encrypt capture with FIDO vault" });
    await expect(fidoEncryption).toBeEnabled();
    await fidoEncryption.check();
    await expect(fidoEncryption).toBeChecked();
  });
});
