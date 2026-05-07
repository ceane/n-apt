# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: VaultE2E.spec.ts >> Vault E2E Lifecycle >> should unlock vault and show spectrum
- Location: test/ts/VaultE2E.spec.ts:4:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('VAULT UNLOCKED', { exact: true })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText('VAULT UNLOCKED', { exact: true })

```

# Page snapshot

```yaml
- main [ref=e2]:
  - generic [ref=e3]:
    - generic:
      - img
      - generic:
        - generic: 9D 14
      - generic:
        - generic: BB 74
      - generic:
        - generic: C1 4F
      - generic:
        - generic: 77 62
      - generic:
        - generic: 45 1E
      - generic:
        - generic: 64 94
      - generic:
        - generic: C7 28
      - generic:
        - generic: EC F0
      - generic:
        - generic: C4 92
      - generic:
        - generic: CB D3
      - generic:
        - generic: 99 5C
      - generic:
        - generic: 99 49
    - img "N-APT Logo" [ref=e5]
    - generic [ref=e6]:
      - heading "Secure Access Required for N-APT" [level=2] [ref=e7]:
        - img [ref=e8]
        - text: Secure Access Required for N-APT
      - paragraph [ref=e11]: Invalid passkey
    - generic [ref=e12]:
      - textbox "Password" [ref=e13]: test-password-123
      - button "Retry" [ref=e14] [cursor=pointer]
      - generic [ref=e15]: or
      - button "Use passkey instead" [ref=e16] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | test.describe("Vault E2E Lifecycle", () => {
  4  |   test("should unlock vault and show spectrum", async ({ page }) => {
  5  |     // 1. Navigate to the app
  6  |     await page.goto("/");
  7  | 
  8  |     // 2. Wait for the initial auth check to complete and show the auth UI
  9  |     // We expect to see "Secure Access Required"
  10 |     await expect(
  11 |       page.locator("text=Secure Access Required for N-APT"),
  12 |     ).toBeVisible({ timeout: 20000 });
  13 | 
  14 |     // 3. Handle Passkey vs Password screen
  15 |     // If the "Use password instead" link is visible, click it
  16 |     const usePasswordLink = page.locator("text=Use password instead");
  17 |     if (await usePasswordLink.isVisible()) {
  18 |       await usePasswordLink.click();
  19 |     }
  20 | 
  21 |     // 4. Enter password and authenticate
  22 |     const passwordInput = page.locator('input[placeholder="Password"]');
  23 |     await passwordInput.fill("test-password-123");
  24 |     await page.locator('button:has-text("Authenticate")').click();
  25 | 
  26 |     // 5. Verify successful authentication
  27 |     // Use getByText with exact: true to avoid strict mode violation if multiple elements exist
> 28 |     await expect(page.getByText("VAULT UNLOCKED", { exact: true })).toBeVisible(
     |                                                                     ^ Error: expect(locator).toBeVisible() failed
  29 |       { timeout: 15000 },
  30 |     );
  31 | 
  32 |     // 5. Verify the spectrum canvas is rendered
  33 |     // This confirms that decrypted data is flowing to the visualizer
  34 |     const canvas = page.locator("#fft-spectrum-canvas-webgpu");
  35 |     await expect(canvas).toBeVisible({ timeout: 10000 });
  36 | 
  37 |     // Optional: Check if we can see the "Vault Locked" status after logout
  38 |     // (This would require a logout button which is usually in the Re-auth flow or we can trigger it)
  39 |   });
  40 | 
  41 |   test("should show decryption failed for invalid password", async ({
  42 |     page,
  43 |   }) => {
  44 |     await page.goto("/");
  45 |     await expect(
  46 |       page.locator("text=Secure Access Required for N-APT"),
  47 |     ).toBeVisible();
  48 | 
  49 |     // Handle Passkey screen
  50 |     const usePasswordLink = page.locator("text=Use password instead");
  51 |     if (await usePasswordLink.isVisible()) {
  52 |       await usePasswordLink.click();
  53 |     }
  54 | 
  55 |     const passwordInput = page.locator('input[placeholder="Password"]');
  56 |     await passwordInput.fill("wrong-password");
  57 |     await page.locator('button:has-text("Authenticate")').click();
  58 | 
  59 |     // Should show error message
  60 |     await expect(page.locator("text=Invalid passkey")).toBeVisible();
  61 |     await expect(
  62 |       page.getByText("VAULT UNLOCKED", { exact: true }),
  63 |     ).not.toBeVisible();
  64 |   });
  65 | });
  66 | 
```