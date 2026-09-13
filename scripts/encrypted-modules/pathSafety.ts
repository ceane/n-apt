import path from "node:path";

/** Resolves a bundle member only when it remains inside its extraction root. */
export function resolveContainedPath(targetDir: string, relativePath: string): string {
  if (!relativePath || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error("Bundle paths must be relative");
  }

  const normalized = relativePath.replace(/\//g, path.sep);
  const target = path.resolve(targetDir);
  const resolved = path.resolve(target, normalized);
  if (resolved !== target && !resolved.startsWith(`${target}${path.sep}`)) {
    throw new Error("Bundle path resolves outside target directory");
  }
  return resolved;
}
