import { test, expect } from "@playwright/test";
import { resolvePlaywrightPassword } from "../support/authCredentials";

const PLAYWRIGHT_PASSWORD = resolvePlaywrightPassword();

test.describe("Vault E2E Lifecycle", () => {
  test("should preserve paused RX and standby TX presentation", async ({
    page,
  }) => {
    const sentStreamCommands: string[] = [];
    const sentRxOptions: Record<string, unknown>[] = [];
    let receivedStreamFrames = 0;
    let receivedChannelSnapshots = 0;
    page.on("websocket", (socket) => {
      const path = new URL(socket.url()).pathname;
      if (path === "/ws") {
        socket.on("framereceived", ({ payload }) => {
          if (typeof payload !== "string") return;
          try {
            const message = JSON.parse(payload) as Record<string, unknown>;
            if (message.type === "channels") {
              receivedChannelSnapshots += 1;
            }
          } catch {
            // Ignore non-JSON control frames.
          }
        });
        return;
      }
      if (!path.endsWith("/ws/streams")) return;
      socket.on("framesent", ({ payload }) => {
        if (typeof payload !== "string") return;
        try {
          const message = JSON.parse(payload) as Record<string, unknown>;
          if (typeof message.type === "string") {
            sentStreamCommands.push(message.type);
          }
          if (
            (message.type === "stream_subscribe" ||
              message.type === "stream_update_options") &&
            typeof message.options === "object" &&
            message.options !== null &&
            (message.options as Record<string, unknown>).mode === "rx"
          ) {
            sentRxOptions.push(message.options as Record<string, unknown>);
          }
        } catch {
          // Ignore non-JSON transport frames.
        }
      });
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string") return;
        try {
          const message = JSON.parse(payload) as { type?: unknown };
          if (message.type === "stream_frame") {
            receivedStreamFrames += 1;
          }
        } catch {
          // Ignore non-JSON transport frames.
        }
      });
    });

    // 1. Navigate to the app
    await page.goto("/");

    // 2. Wait for the initial auth check to complete and show the auth UI
    // We expect to see "Secure Access Required"
    await expect(
      page.locator("text=Secure Access Required for N-APT"),
    ).toBeVisible({ timeout: 20000 });

    // Open the password form from the current passkey/password choice screen.
    await page.getByRole("button", { name: "Use Password" }).click();

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
    await expect.poll(() => receivedStreamFrames, { timeout: 10000 }).toBeGreaterThan(0);
    const spectrumStream = page
      .locator('[data-testid="fft-waterfall"][data-stream-mode="rx"]')
      .first();
    await expect
      .poll(() => spectrumStream.getAttribute("data-stream-frame-sequence"))
      .toMatch(/^\d+$/);
    const sequenceBeforePause = await spectrumStream.getAttribute(
      "data-stream-frame-sequence",
    );

    const pauseButton = page.getByRole("button", { name: /^Pause/ });
    await pauseButton.click();
    await expect(
      page.getByRole("button", { name: /^Resume/ }),
    ).toBeVisible();

    const requestFrameCount = () =>
      sentStreamCommands.filter((type) => type === "stream_request_frame")
        .length;
    await expect.poll(requestFrameCount, { timeout: 3000 }).toBeGreaterThan(0);
    await expect
      .poll(() =>
        spectrumStream.getAttribute("data-stream-frame-sequence"),
      )
      .not.toBe(sequenceBeforePause);

    // A settled spectrum scroll while paused must ask the managed Rx
    // subscriber for a frame using the final viewport options.
    await page.waitForTimeout(100);
    const requestsBeforeScroll = requestFrameCount();
    const channelSnapshotsBeforeScroll = receivedChannelSnapshots;
    const sentOptionsBeforeScroll = sentRxOptions.length;
    const rxOptionsBeforeScroll =
      sentRxOptions[sentRxOptions.length - 1];
    const sequenceBeforeScroll = await spectrumStream.getAttribute(
      "data-stream-frame-sequence",
    );
    const canvasBounds = await canvas.boundingBox();
    expect(canvasBounds).not.toBeNull();
    await page.mouse.move(
      canvasBounds!.x + canvasBounds!.width / 2,
      canvasBounds!.y + canvasBounds!.height / 2,
    );
    await page.mouse.wheel(0, 240);
    await expect
      .poll(requestFrameCount, { timeout: 3000 })
      .toBeGreaterThan(requestsBeforeScroll);
    await expect
      .poll(() =>
        spectrumStream.getAttribute("data-stream-frame-sequence"),
      )
      .not.toBe(sequenceBeforeScroll);
    await expect
      .poll(() => sentRxOptions.length, { timeout: 3000 })
      .toBeGreaterThan(sentOptionsBeforeScroll);
    await page.waitForTimeout(100);
    const selectionMetadataChanged = sentRxOptions
      .slice(sentOptionsBeforeScroll)
      .some(
        (options) =>
          options.signalArea !== rxOptionsBeforeScroll?.signalArea ||
          options.mirrorSpectrumBelowZero !==
            rxOptionsBeforeScroll?.mirrorSpectrumBelowZero,
      );
    if (!selectionMetadataChanged) {
      expect(receivedChannelSnapshots).toBe(channelSnapshotsBeforeScroll);
    }

    // Select Tx standby to verify previews do not start transmission.
    const txSourceButton = page.getByRole("button", {
      name: /^Mock Tx SDR Tx · Standby/,
    });
    await txSourceButton.click();
    await expect(txSourceButton).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Tx", exact: true }).first(),
    ).toBeVisible();

    // Returning to the paused RX source retains its pause state and frame.
    await page.getByRole("button", { name: /^Mock APT SDR/ }).click();
    const resumeButton = page.getByRole("button", { name: /^Resume/ });
    await expect(resumeButton).toBeVisible();
    await resumeButton.click();
    await expect(
      page.getByRole("button", { name: /^Pause/ }),
    ).toBeVisible();

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

    await page.getByRole("button", { name: "Use Password" }).click();

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
