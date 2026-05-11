import { expect, test } from "@playwright/test";

test.describe("Logout route", () => {
  test("/logout is handled by the backend and returns to auth", async ({
    page,
  }) => {
    const logoutResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/logout" &&
        response.status() === 303,
    );

    await page.goto("/logout");

    const logoutResponse = await logoutResponsePromise;
    expect(logoutResponse.headers()["location"]).toBe("/");

    await expect(page).toHaveURL("/");
    await expect(
      page.getByText("Secure Access Required for N-APT"),
    ).toBeVisible();
  });
});
