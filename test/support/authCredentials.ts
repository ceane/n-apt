import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

/**
 * Resolve the local-only password without storing a credential in the test
 * suite. The backend and browser tests must receive the same value.
 */
export function resolvePlaywrightPassword(): string {
  const processPassword = process.env.UNSAFE_LOCAL_USER_PASSWORD?.trim();
  if (processPassword) return processPassword;

  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const filePassword = parse(readFileSync(envPath, "utf8"))
      .UNSAFE_LOCAL_USER_PASSWORD?.trim();
    if (filePassword) return filePassword;
  }

  throw new Error(
    "Playwright authentication requires UNSAFE_LOCAL_USER_PASSWORD in the process environment or .env.local",
  );
}
