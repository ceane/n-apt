import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const REQUIRED_LOCAL_CREDENTIALS = [
  "UNSAFE_LOCAL_LATEX_PASSWORD",
  "UNSAFE_LOCAL_DEMOD_PASSWORD",
  "UNSAFE_LOCAL_USER_PASSWORD",
] as const;

export function hasLocalEncryptedMlE2ECredentials(
  root = process.cwd(),
): boolean {
  const envPath = resolve(root, ".env.local");
  const fileValues = existsSync(envPath)
    ? parse(readFileSync(envPath, "utf8"))
    : {};

  return REQUIRED_LOCAL_CREDENTIALS.every((key) =>
    Boolean(process.env[key]?.trim() || fileValues[key]?.trim()),
  );
}
