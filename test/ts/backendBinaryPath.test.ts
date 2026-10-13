import { resolveBackendBinaryPath } from "../../scripts/build/backendBinaryPath";
import { win32 } from "node:path";

describe("resolveBackendBinaryPath", () => {
  it("resolves the dev-incremental backend artifact for the current platform", () => {
    expect(resolveBackendBinaryPath("/repo", "linux")).toBe(
      "/repo/target/dev-incremental/n-apt-backend",
    );
    expect(resolveBackendBinaryPath("C:/repo", "win32")).toBe(
      win32.resolve(
        "C:/repo",
        "target",
        "dev-incremental",
        "n-apt-backend.exe",
      ),
    );
  });
});
