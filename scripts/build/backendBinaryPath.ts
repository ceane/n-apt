import { posix, win32 } from "node:path";

export function resolveBackendBinaryPath(
  projectRoot = process.cwd(),
  platform = process.platform,
): string {
  const path = platform === "win32" ? win32 : posix;
  const executable =
    platform === "win32" ? "n-apt-backend.exe" : "n-apt-backend";
  return path.resolve(projectRoot, "target", "dev-incremental", executable);
}
