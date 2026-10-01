import { expect, test } from "@playwright/test";

test.describe("Logout route", () => {
  test("/logout returns an unauthenticated visitor to auth", async ({
    page,
  }) => {
    await page.goto("/logout");

    await expect(page).toHaveURL("/");
    await expect(
      page.getByText("Secure Access Required for N-APT"),
    ).toBeVisible();
  });
});
