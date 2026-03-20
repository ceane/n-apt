import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveGitCommonRoot = (): string | null => {
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (!gitCommonDir) {
      return null;
    }

    const absoluteCommonDir = path.isAbsolute(gitCommonDir)
      ? gitCommonDir
      : path.resolve(__dirname, gitCommonDir);

    return path.resolve(absoluteCommonDir, "..");
  } catch {
    return null;
  }
};

const normalizePath = (value: string) => {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
};

const fsAllow = Array.from(
  new Set(
    [searchForWorkspaceRoot(process.cwd()), resolveGitCommonRoot()]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizePath(value)),
  ),
);

export default defineConfig({
  server: {
    fs: {
      allow: fsAllow,
    },
  },
});
