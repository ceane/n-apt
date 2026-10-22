import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const hardwareEnabled = process.env.NAPT_RUN_FIDO_HARDWARE === "1";

test.describe("physical FIDO security-key E2E", () => {
  test.skip(
    !hardwareEnabled,
    "Set NAPT_RUN_FIDO_HARDWARE=1 and run headed with an enrolled, plugged-in FIDO key.",
  );

  test("authenticates with the physical key, encrypts an I/Q capture, and decrypts it for playback", async ({
    page,
  }) => {
    page.setDefaultTimeout(120_000);
    // The running Vite dev server serves the SPA shell at `/`; AuthProvider
    // presents the authentication gate there for a fresh browser profile.
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: "Use FIDO Security Key" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use FIDO Security Key" }).click();
    await expect(
      page.getByRole("link", { name: /Use app Explore spectrum/ }),
    ).toBeVisible({ timeout: 120_000 });
    await page.getByRole("link", { name: /Use app Explore spectrum/ }).click();

    await page.getByRole("button", { name: /Take an I\/Q Capture/ }).click();

    const captureControls = page.locator(
      '[data-sidebar-scroll-root="iq-capture"]',
    );
    await expect(captureControls).toBeVisible();
    const fidoEncryption = page.getByRole("checkbox", {
      name: "Encrypt capture with FIDO vault",
    });
    await expect(fidoEncryption).toBeEnabled();
    await fidoEncryption.check();
    await expect(fidoEncryption).toBeChecked();

    await captureControls.locator("select").first().selectOption(".iq");
    const duration = captureControls.locator(
      'input[name="iq-capture-duration"]',
    );
    await duration.fill("1");

    const playbackOption = page
      .getByText("Playback after capture", { exact: true })
      .locator("xpath=preceding-sibling::input");
    await playbackOption.check();

    const captureButton = captureControls.getByRole("button", {
      name: "Capture",
      exact: true,
    });
    await expect(captureButton).toBeEnabled();
    await captureButton.click();

    const selectedFile = page.getByTestId("sidebar-selected-file");
    await expect(selectedFile).toContainText(/capture_.*\.iq/);
    await expect(selectedFile).toContainText("File Loaded");
    const metadataPanel = page.getByTestId("sidebar-file-metadata");
    await expect(metadataPanel).toContainText("Capture Rate");
    await expect(page.locator("#fft-spectrum-canvas-webgpu")).toBeVisible();

    const downloadLink = selectedFile.getByRole("link", {
      name: "Download",
      exact: true,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      downloadLink.click(),
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();

    const captureBytes = await readFile(downloadPath!);
    expect(captureBytes.subarray(0, 8).toString("utf8")).toBe("NAPT-IQ3");
    expect(captureBytes[32]).toBe(1);

    const metadataLength = Number(captureBytes.readBigUInt64LE(8));
    const metadata = JSON.parse(
      captureBytes.subarray(40, 40 + metadataLength).toString("utf8"),
    ) as {
      encryption?: string;
      sections?: {
        binary?: {
          encrypted?: boolean;
          offset_bytes?: number;
          length_bytes?: number;
        };
      };
      vault_key_recovery?: unknown;
    };
    expect(metadata.encryption).toBe("AES-256-GCM-FIDO-VAULT-V1");
    expect(metadata.sections?.binary?.encrypted).toBe(true);
    expect(metadata.vault_key_recovery).toBeDefined();

    const payloadOffset = metadata.sections?.binary?.offset_bytes;
    const payloadLength = metadata.sections?.binary?.length_bytes;
    expect(payloadOffset).toEqual(expect.any(Number));
    expect(payloadLength).toEqual(expect.any(Number));
    expect(
      captureBytes.subarray(payloadOffset!, payloadOffset! + payloadLength!)
        .length,
    ).toBeGreaterThan(12);
  });
});
