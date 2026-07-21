import { expect, test } from "@playwright/test";

test.describe("Logout route", () => {
  test("/logout is handled by the backend and returns to auth", async ({
    page,
  }) => {
    await page.goto("/logout");

    await expect(page).toHaveURL("/");
    await expect(
      page.getByText("Secure Access Required for N-APT"),
    ).toBeVisible();
  });
});
